const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../controllers/fabricatorInventoryController.js'), 'utf8');

function setup(account = { _id: 'fabricator-a', accountType: 'FABRICATOR', isActive: true }) {
  const records = [];
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => row[key] === value);
  const inventory = {
    find: filter => ({ sort: () => ({ lean: async () => records.filter(row => matches(row, filter)) }) }),
    create: async item => {
      if (records.some(row => row.fabricator === item.fabricator && row.productId === item.productId)) {
        throw Object.assign(new Error('Duplicate'), { code: 11000 });
      }
      const row = { ...item, _id: String(records.length + 1) };
      records.push(row); return row;
    },
    findOneAndUpdate: async (filter, update) => {
      const row = records.find(item => matches(item, filter));
      if (row) Object.assign(row, update.$set);
      return row;
    },
    findOneAndDelete: async filter => {
      const index = records.findIndex(item => matches(item, filter));
      return index < 0 ? null : records.splice(index, 1)[0];
    },
  };
  const context = { exports: {}, require: name => {
    if (name === '../models/FabricatorInventory') return inventory;
    if (name === '../models/User') return {
      findOne: filter => ({ select: () => ({ lean: async () => account &&
        account._id === filter._id && account.accountType === filter.accountType && account.isActive !== false ? account : null }) }),
    };
    throw new Error(`Unexpected dependency: ${name}`);
  } };
  vm.runInNewContext(source, context);
  const call = async (handler, overrides = {}) => {
    const req = { user: { role: 'user', userId: 'fabricator-a' }, params: {}, body: {}, ...overrides };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    let allowed = false;
    await context.exports.requireFabricator(req, res, () => { allowed = true; });
    if (allowed) await context.exports[handler](req, res);
    return res;
  };
  return { records, call };
}

test('direct and dealership-linked fabricators can maintain independent stock immediately', async () => {
  for (const dealership of [null, 'dealer-a']) {
    const s = setup({ _id: 'fabricator-a', accountType: 'FABRICATOR', dealership });
    const added = await s.call('createInventoryItem', { body: { productId: ' SAP-1 ', description: ' Profile ', quantity: 12, fabricator: 'someone-else', dealership } });
    assert.equal(added.statusCode, 201);
    assert.equal(added.body.item.fabricator, 'fabricator-a');
    assert.equal(added.body.item.productId, 'SAP-1');
    assert.equal(added.body.item.quantity, 12);
    const updated = await s.call('updateInventoryItem', { params: { productId: 'SAP-1' }, body: { quantity: 0 } });
    assert.equal(updated.body.item.quantity, 0);
    assert.equal((await s.call('listInventory')).body.inventory.length, 1);
    assert.equal((await s.call('deleteInventoryItem', { params: { productId: 'SAP-1' } })).statusCode, 200);
    assert.equal(s.records.length, 0);
  }
});

test('reads, updates and deletes never access another fabricator inventory', async () => {
  const s = setup();
  s.records.push({ _id: 'other', fabricator: 'fabricator-b', productId: 'SAP-1', quantity: 9 });
  assert.equal((await s.call('listInventory', { query: { fabricator: 'fabricator-b' } })).body.inventory.length, 0);
  for (const handler of ['updateInventoryItem', 'deleteInventoryItem']) {
    const result = await s.call(handler, { params: { productId: 'SAP-1' }, body: { quantity: 0, fabricator: 'fabricator-b' } });
    assert.equal(result.statusCode, 404);
    assert.equal(s.records[0].quantity, 9);
  }
  assert.equal((await s.call('createInventoryItem', { body: { productId: 'SAP-1', description: 'Profile', quantity: 3 } })).statusCode, 201);
  assert.equal(s.records.length, 2);
});

test('admins, dealerships, missing users, inactive users and disabled accounts are denied', async () => {
  const accounts = [null, { accountType: 'DEALERSHIP' }, { accountType: 'ADMIN' },
    { accountType: 'FABRICATOR', isActive: false }, { accountType: 'FABRICATOR', disabledModules: ['MAIN_SITE'] }];
  for (const account of accounts) {
    const s = setup(account && { _id: 'fabricator-a', ...account });
    assert.equal((await s.call('listInventory')).statusCode, 403);
  }
  assert.equal((await setup().call('listInventory', { user: { role: 'admin', userId: 'fabricator-a' } })).statusCode, 403);
  assert.equal((await setup().call('listInventory', { user: {} })).statusCode, 403);
});

test('invalid quantities and product inputs are rejected before mutation', async () => {
  const s = setup();
  for (const quantity of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, '', '3', true, undefined]) {
    assert.equal((await s.call('createInventoryItem', { body: { productId: 'P', description: 'Profile', quantity } })).statusCode, 400);
    assert.equal((await s.call('updateInventoryItem', { params: { productId: 'P' }, body: { quantity } })).statusCode, 400);
  }
  for (const productId of ['', ' ', null, {}, 123]) {
    assert.equal((await s.call('createInventoryItem', { body: { productId, description: 'Profile', quantity: 0 } })).statusCode, 400);
  }
  assert.equal(s.records.length, 0);
});

test('duplicate products return conflict without changing the existing quantity', async () => {
  const s = setup();
  const body = { productId: 'P', description: 'Profile', quantity: 5 };
  await s.call('createInventoryItem', { body });
  assert.equal((await s.call('createInventoryItem', { body: { ...body, quantity: 20 } })).statusCode, 409);
  assert.equal(s.records[0].quantity, 5);
});
