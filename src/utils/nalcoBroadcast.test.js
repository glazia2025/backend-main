const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../controllers/nalcoBroadcastController.js'), 'utf8');
function setup({ rate = { _id: 'latest', nalcoPrice: 371650, date: new Date() }, locked = false, fail = false } = {}) {
  const updates = [], sent = [], tasks = [], queries = [];
  const Broadcast = {
    findOneAndUpdate: async () => { if (locked) throw Object.assign(new Error(), { code: 11000 }); return { state: 'running' }; },
    updateOne: async (filter, update) => updates.push(update.$set),
  };
  const context = { exports: {}, console, setImmediate: task => tasks.push(task), process: { env: { META_TOKEN: 'test', META_NUMID: 'test' } }, require(name) {
    if (name === 'mongoose') return { model: () => Broadcast, Schema: class {} };
    if (name === 'crypto') return { randomUUID: () => 'run' };
    if (name === '../models/Order') return { Nalco: { findOne: () => ({ sort: sort => { queries.push(sort); return { lean: async () => rate }; } }) } };
    return { sendNalcoMessageToUsers: async price => { sent.push(price); if (fail) throw new Error('failed'); return { recipients: 3, sent: 2, failed: 1 }; } };
  } };
  vm.runInNewContext(source, context);
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  return { context, res, updates, sent, tasks, queries, run: body => context.exports.send({ body, user: { userId: 'admin' } }, res) };
}
test('uses latest database rate, ignores supplied price, persists partial failures asynchronously', async () => {
  const s = setup(); await s.run({ rateId: 'latest', nalcoPrice: 1 });
  assert.equal(s.res.statusCode, 202); assert.equal(s.sent.length, 0);
  assert.equal(JSON.stringify(s.queries[0]), JSON.stringify({ date: -1, _id: -1 }));
  await s.tasks[0](); assert.deepEqual(s.sent, [371650]);
  assert.equal(s.updates[0].accepted, 2); assert.equal(s.updates[0].failed, 1);
});
test('rejects missing rate, changed rate and concurrent broadcast without sending', async () => {
  for (const [options, body, status] of [[{ rate: null }, {}, 400], [{}, { rateId: 'old' }, 409], [{ locked: true }, { rateId: 'latest' }, 409]]) {
    const s = setup(options); await s.run(body); assert.equal(s.res.statusCode, status); assert.equal(s.tasks.length, 0);
  }
});
test('missing credentials prevents starting', async () => {
  const s = setup(); delete s.context.process.env.META_TOKEN;
  await s.run({ rateId: 'latest' }); assert.equal(s.res.statusCode, 503); assert.equal(s.tasks.length, 0);
});
test('send exceptions persist failed state', async () => {
  const s = setup({ fail: true }); await s.run({ rateId: 'latest' }); await s.tasks[0]();
  assert.equal(s.updates[0].state, 'failed');
});
