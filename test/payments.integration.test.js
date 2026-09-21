const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const express = require('express');
const { PaymentAccount, PaymentReceipt, PaymentAttempt } = require('../src/models/Payment');
const { UserOrder } = require('../src/models/Order');
const User = require('../src/models/User');
const Hardware = require('../src/models/Hardware');
const { DealershipInventory, InventoryMovement } = require('../src/models/DealershipInventory');
const provider = require('../src/services/paysharpClient');
const service = require('../src/services/paymentService');
const { completePaidOrder } = require('../src/services/completePaidOrder');
const controller = require('../src/controllers/paymentController');
const { signJwt } = require('../src/utils/jwt');
const isUser = require('../src/middleware/userMiddleware');
const { upiAllowed } = require('../src/utils/paymentRules');
let mongo, server, base, customer, token, remote, calls;
const originalRequest = provider.request;
const originalRollout = { active: process.env.Paysharp_test_active, users: process.env.Paysharp_Test_users };
before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.14' } });
  await mongoose.connect(mongo.getUri('paysharp_tests'));
  await Promise.all(Object.values(mongoose.models).map(m => m.init()));
  const app = express(); app.use(express.json());
  app.use('/api/payments', require('../src/routes/paymentRoutes'));
  app.post('/api/user/pi-generate', isUser, controller.createOrder);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  for (const [key, value] of [['Paysharp_test_active', originalRollout.active], ['Paysharp_Test_users', originalRollout.users]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  provider.request = originalRequest; if (server) await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); if (mongo) await mongo.stop(); });
beforeEach(async () => {
  process.env.Paysharp_test_active = 'false'; process.env.Paysharp_Test_users = '';
  await Promise.all(Object.values(mongoose.models).map(m => m.deleteMany({})));
  await mongoose.models.Counter.create({ name: 'userOrder', seq: 0 });
  customer = await User.create({ name: 'Fabricator', email: 'fabricator@test.invalid', phoneNumber: '9999999999', phoneNumbers: ['9999999999'], city: 'Pune', paUrl: 'test-fabricator' });
  token = signJwt({ role: 'user', userId: String(customer._id) });
  await Hardware.create({ id: 1, sapCode: 'HW1', perticular: 'Handle', subCategory: 'Handles', rate: 900, system: 'Pcs', moq: '1' });
  remote = new Map(); calls = [];
  provider.request = async (kind, method, path, body) => {
    calls.push({ kind, method, path, body });
    if (kind === 'va' && path.startsWith('/customers/')) {
      const id = path.split('/').pop();
      return { externalCustomerId: id, virtualAccountNo: `VA${id}`, ifscCode: 'TEST00001', beneficiaryName: 'Paysharp Private Limited', bankName: 'Test Bank' };
    }
    if (kind === 'upi' && method === 'POST') {
      const data = { ...body, paysharpReferenceNo: `UPI_${body.orderId}`, qrCode: 'data:image/png;base64,aGVsbG8=', intentUrl: 'upi://pay?pa=test', status: 'PENDING' };
      remote.set(`/order/${body.orderId}`, data); return data;
    }
    if (remote.has(path)) return remote.get(path);
    throw Object.assign(new Error('not found'), { status: 502, providerCode: kind === 'upi' ? 6002 : 2201 });
  };
});
async function api(path, body, auth = token) {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() };
}
async function checkout(quantity = 1, key = 'checkout_test_00001') {
  const body = { products: [{ productId: 'HW1', quantity }] };
  const quote = await api('/api/payments/quote', body);
  assert.equal(quote.status, 200);
  const result = await api('/api/user/pi-generate', { ...body, checkoutKey: key, expectedTotalPaise: quote.data.totalPaise });
  assert.equal(result.status, 201, JSON.stringify(result));
  return result.data.order;
}
function bank(amount, reference = 'BANK001', user = customer) {
  const data = { externalCustomerId: String(user._id), virtualAccountNo: `VA${user._id}`, amount, totalFee: 5, netAmount: amount - 5, paysharpReferenceNo: reference, utrNumber: `UTR_${reference}`, transactionDate: new Date().toISOString() };
  remote.set(`/transactions/${reference}`, data); return data;
}
test('server prices ignore browser amounts, and checkout retries create one order', async () => {
  const body = { products: [{ productId: 'HW1', quantity: 1, amount: 0.01 }], totalAmount: 0.01, checkoutKey: 'idempotent_checkout_01', expectedTotalPaise: 118000 };
  const [first, second] = await Promise.all([api('/api/user/pi-generate', body), api('/api/user/pi-generate', body)]);
  assert.ok([200, 201].includes(first.status), JSON.stringify(first)); assert.ok([200, 201].includes(second.status), JSON.stringify(second));
  assert.equal(first.data.order._id, second.data.order._id);
  assert.equal(await UserOrder.countDocuments(), 1);
  assert.equal(first.data.order.totalPaise, 118000);
  const tampered = await api('/api/user/pi-generate', { ...body, checkoutKey: 'idempotent_checkout_02', expectedTotalPaise: 1 });
  assert.equal(tampered.status, 409);
});
test('₹1,00,000 boundary is based on full order total, even after partial payment', async () => {
  assert.equal(upiAllowed(9999999), true); assert.equal(upiAllowed(10000000), false); assert.equal(upiAllowed(10000001), false);
  const order = await checkout(100);
  const response = await api(`/api/payments/orders/${order._id}/upi`, {});
  assert.equal(response.status, 400);
  await service.recordReceipt(bank(117000), 'BANK_TRANSFER');
  assert.equal((await api(`/api/payments/orders/${order._id}/upi`, {})).status, 400);
});
test('orders between ₹50,000 and ₹1,00,000 now allow UPI', async () => {
  const order = await checkout(50);
  assert.equal(order.totalPaise, 5900000);
  assert.equal((await api(`/api/payments/orders/${order._id}/upi`, {})).status, 200);
});
test('bank webhook uses provider data, deduplicates concurrent delivery and keeps fees separate', async () => {
  const order = await checkout(); bank(1180);
  const responses = await Promise.all([1, 2, 3].map(() => api('/api/payments/webhooks/virtual-account', { paysharpReferenceNo: 'BANK001', amount: 99999999, externalCustomerId: 'forged' }, null)));
  responses.forEach(response => assert.equal(response.status, 200, JSON.stringify(response)));
  const saved = await UserOrder.findById(order._id);
  assert.equal(saved.paymentStatus, 'PAID'); assert.equal(saved.paidPaise, 118000);
  assert.equal(saved.payments.length, 1); assert.equal(await PaymentReceipt.countDocuments(), 1);
  const receipt = await PaymentReceipt.findOne(); assert.equal(receipt.feePaise, 500); assert.equal(receipt.netPaise, 117500);
});
test('partial receipts allocate FIFO and excess credits a future order', async () => {
  const first = await checkout(1, 'checkout_first_0001'); const second = await checkout(1, 'checkout_second_0001');
  await service.recordReceipt(bank(500), 'BANK_TRANSFER');
  assert.equal((await UserOrder.findById(first._id)).paymentStatus, 'PARTIALLY_PAID');
  assert.equal((await UserOrder.findById(second._id)).paidPaise, 0);
  await service.recordReceipt(bank(3000, 'BANK002'), 'BANK_TRANSFER');
  assert.equal((await PaymentAccount.findOne()).creditPaise, 114000);
  const third = await checkout(1, 'checkout_third_0001');
  assert.equal(third.paidPaise, 114000); assert.equal(third.paymentStatus, 'PARTIALLY_PAID');
  assert.equal((await PaymentAccount.findOne()).creditPaise, 0);
});
test('UPI is tied to its intended order, verifies success and never regresses to pending', async () => {
  const first = await checkout(1, 'checkout_first_0001'); const second = await checkout(1, 'checkout_second_0001');
  assert.equal((await api(`/api/payments/orders/${second._id}/upi`, { kind: 'intent' })).status, 200);
  const attempt = await PaymentAttempt.findOne();
  const path = `/order/${attempt._id}`;
  remote.set(path, { ...remote.get(path), status: 'SUCCESS', utrNumber: 'UPIUTR', transactionDate: new Date().toISOString() });
  const result = await api('/api/payments/webhooks/upi', { orderId: String(attempt._id), status: 'FAILED', amount: 0 }, null);
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal((await UserOrder.findById(first._id)).paidPaise, 0);
  assert.equal((await UserOrder.findById(second._id)).paymentStatus, 'PAID');
  remote.set(path, { ...remote.get(path), status: 'PENDING' });
  await service.verifyUpi(attempt);
  assert.equal((await PaymentAttempt.findById(attempt._id)).status, 'SUCCESS');
});
test('wrong customer / amount / account confirmations cannot credit an order', async () => {
  const order = await checkout(); await api(`/api/payments/orders/${order._id}/upi`, {});
  const attempt = await PaymentAttempt.findOne(); const path = `/order/${attempt._id}`;
  remote.set(path, { ...remote.get(path), status: 'SUCCESS', amount: 1, utrNumber: 'WRONG', transactionDate: new Date().toISOString() });
  assert.equal((await api('/api/payments/webhooks/upi', { orderId: String(attempt._id) }, null)).status, 409);
  const data = bank(1180); remote.set('/transactions/BANK001', { ...data, virtualAccountNo: 'WRONG' });
  assert.equal((await api('/api/payments/webhooks/virtual-account', { paysharpReferenceNo: 'BANK001' }, null)).status, 409);
  assert.equal(await PaymentReceipt.countDocuments(), 0);
});
test('account and order payment APIs require the owner', async () => {
  const order = await checkout();
  assert.equal((await api(`/api/payments/orders/${order._id}`, undefined, null)).status, 403);
  const other = await User.create({ name: 'Other', email: 'other@test.invalid', phoneNumber: '8888888888', phoneNumbers: ['8888888888'], city: 'Pune', paUrl: 'other' });
  const otherToken = signJwt({ role: 'user', userId: String(other._id) });
  assert.equal((await api(`/api/payments/orders/${order._id}`, undefined, otherToken)).status, 404);
  assert.equal((await api(`/api/payments/orders/${order._id}/upi`, {}, otherToken)).status, 404);
});
test('dealer stock is consumed only when fully paid; duplicate notifications cannot consume twice', async () => {
  const dealer = await User.create({ name: 'Dealer', email: 'dealer@test.invalid', phoneNumber: '7777777777', phoneNumbers: ['7777777777'], city: 'Pune', accountType: 'DEALERSHIP', paUrl: 'dealer' });
  await User.updateOne({ _id: customer._id }, { dealership: dealer._id });
  await DealershipInventory.create({ dealership: dealer._id, productId: 'HW1', quantity: 10 });
  const order = await checkout(2);
  assert.equal((await DealershipInventory.findOne()).quantity, 10);
  await service.recordReceipt(bank(2360), 'BANK_TRANSFER');
  await service.recordReceipt(bank(2360), 'BANK_TRANSFER');
  assert.equal((await DealershipInventory.findOne()).quantity, 8);
  assert.equal((await UserOrder.findById(order._id)).fulfillment.status, 'DEALER_STOCK');
  assert.equal(await InventoryMovement.countDocuments(), 1);
});
test('completion requires paid status and stock additions happen once', async () => {
  await User.updateOne({ _id: customer._id }, { accountType: 'DEALERSHIP' });
  const order = await checkout();
  const documents = { biltyDoc: 'doc', eWayBill: 'doc', taxInvoice: 'doc', driverInfo: { name: 'Driver', phone: '9999999999' } };
  await assert.rejects(completePaidOrder(order._id, documents), /Full payment/);
  await service.recordReceipt(bank(1180), 'BANK_TRANSFER');
  await completePaidOrder(order._id, documents);
  await assert.rejects(completePaidOrder(order._id, documents), /already complete/);
  assert.equal((await DealershipInventory.findOne()).quantity, 1);
});
test('invalid source order cannot leave an orphan upstream order', async () => {
  const result = await api('/api/user/pi-generate', { sourceOrderId: String(new mongoose.Types.ObjectId()), checkoutKey: 'bad_source_checkout1', expectedTotalPaise: 118000 });
  assert.equal(result.status, 400); assert.equal(await UserOrder.countDocuments(), 0);
});
test('inventory-write failure rolls back receipt, payment balance, and stock before retry', async () => {
  const dealer = await User.create({ name: 'Dealer', email: 'dealer@test.invalid', phoneNumber: '7777777777', phoneNumbers: ['7777777777'], city: 'Pune', accountType: 'DEALERSHIP', paUrl: 'dealer' });
  await User.updateOne({ _id: customer._id }, { dealership: dealer._id });
  await DealershipInventory.create({ dealership: dealer._id, productId: 'HW1', quantity: 3 });
  const order = await checkout(); const data = bank(1180);
  const originalInsert = InventoryMovement.insertMany;
  InventoryMovement.insertMany = async () => { throw new Error('simulated ledger-write failure'); };
  try { await assert.rejects(service.recordReceipt(data, 'BANK_TRANSFER'), /simulated/); }
  finally { InventoryMovement.insertMany = originalInsert; }
  assert.equal(await PaymentReceipt.countDocuments(), 0);
  assert.equal((await UserOrder.findById(order._id)).paidPaise, 0);
  assert.equal((await DealershipInventory.findOne()).quantity, 3);
  await service.recordReceipt(data, 'BANK_TRANSFER');
  assert.equal((await DealershipInventory.findOne()).quantity, 2);
  assert.equal((await UserOrder.findById(order._id)).paymentStatus, 'PAID');
});
test('shortage purchase links once, replenishes dealer inventory and releases original order', async () => {
  const dealer = await User.create({ name: 'Dealer', email: 'dealer@test.invalid', phoneNumber: '7777777777', phoneNumbers: ['7777777777'], city: 'Pune', accountType: 'DEALERSHIP', paUrl: 'dealer' });
  await User.updateOne({ _id: customer._id }, { dealership: dealer._id });
  await DealershipInventory.create({ dealership: dealer._id, productId: 'HW1', quantity: 1 });
  const original = await checkout(3);
  await service.recordReceipt(bank(3540), 'BANK_TRANSFER');
  assert.equal((await UserOrder.findById(original._id)).fulfillment.remainingProducts[0].quantity, 2);
  const dealerToken = signJwt({ role: 'user', userId: String(dealer._id) });
  const body = { sourceOrderId: original._id, checkoutKey: 'dealer_shortage_0001', expectedTotalPaise: 236000 };
  const first = await api('/api/user/pi-generate', body, dealerToken);
  assert.equal(first.status, 201, JSON.stringify(first));
  assert.equal((await api('/api/user/pi-generate', body, dealerToken)).data.order._id, first.data.order._id);
  const duplicate = await api('/api/user/pi-generate', { ...body, checkoutKey: 'dealer_shortage_0002' }, dealerToken);
  assert.equal(duplicate.status, 409); assert.equal(await UserOrder.countDocuments(), 2);
  const documents = { biltyDoc: 'doc', eWayBill: 'doc', taxInvoice: 'doc', driverInfo: { name: 'Driver', phone: '9999999999' } };
  await assert.rejects(completePaidOrder(original._id, documents), /shortage order/);
  await service.recordReceipt(bank(2360, 'DEALER_BANK', dealer), 'BANK_TRANSFER');
  await completePaidOrder(first.data.order._id, documents);
  assert.equal((await DealershipInventory.findOne()).quantity, 2);
  await completePaidOrder(original._id, documents);
  assert.equal((await DealershipInventory.findOne()).quantity, 0);
  assert.equal((await UserOrder.findById(original._id)).isComplete, true);
});
test('expired UPI attempts can be retried without reusing the provider order ID', async () => {
  const order = await checkout();
  assert.equal((await api(`/api/payments/orders/${order._id}/upi`, {})).status, 200);
  const first = await PaymentAttempt.findOne();
  remote.set(`/order/${first._id}`, { ...remote.get(`/order/${first._id}`), status: 'EXPIRED' });
  await service.verifyUpi(first);
  assert.equal((await api(`/api/payments/orders/${order._id}`)).data.upiStatus, 'EXPIRED');
  assert.equal((await api(`/api/payments/orders/${order._id}/upi`, {})).status, 200);
  const active = await PaymentAttempt.findOne({ active: true });
  assert.notEqual(String(active._id), String(first._id));
  assert.equal(await PaymentAttempt.countDocuments(), 2);
});
test('pending or unverifiable notifications do not approve payment', async () => {
  const order = await checkout(); await api(`/api/payments/orders/${order._id}/upi`, {});
  const attempt = await PaymentAttempt.findOne();
  assert.equal((await api('/api/payments/webhooks/upi', { orderId: String(attempt._id), status: 'SUCCESS', amount: 1180 }, null)).status, 200);
  assert.equal((await UserOrder.findById(order._id)).paidPaise, 0);
  assert.equal((await api('/api/payments/webhooks/virtual-account', { paysharpReferenceNo: 'NONEXISTENT' }, null)).status, 502);
  assert.equal(await PaymentReceipt.countDocuments(), 0);
});
test('quotation checkout fetches authoritative BOM and stores quotation linkage', async () => {
  const axios = require('axios'); const originalGet = axios.get;
  const quotationId = String(new mongoose.Types.ObjectId());
  axios.get = async (url, options) => {
    assert.ok(url.endsWith(`/api/quotations/${quotationId}/bom-data`));
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    return { data: { projectCode: 'QT-TEST', rows: [{ itemCode: 'HW1', description: 'Handle', quantity: 2, amount: 2000 }] } };
  };
  try {
    const result = await api('/api/user/pi-generate', { quotationId, products: [{ productId: 'fake', quantity: 100, amount: 0.01 }], checkoutKey: 'quotation_checkout01', expectedTotalPaise: 236000 });
    assert.equal(result.status, 201, JSON.stringify(result));
    const saved = await UserOrder.findById(result.data.order._id);
    assert.equal(String(saved.quotationId), quotationId); assert.equal(saved.quotationCode, 'QT-TEST');
    assert.equal(saved.products[0].productId, 'HW1'); assert.equal(saved.products[0].quantity, 2);
  } finally { axios.get = originalGet; }
});
test('manual payment endpoints cannot edit a Paysharp receipt', async () => {
  const order = await checkout(); await service.recordReceipt(bank(1180), 'BANK_TRANSFER');
  const saved = await UserOrder.findById(order._id);
  const legacy = require('../src/controllers/orderController');
  for (const fn of [legacy.approvePayment, legacy.updatePaymentDueDate, legacy.uploadPaymentProof, legacy.createPayment]) {
    let code = 200;
    const res = { status(value) { code = value; return this; }, json() { return this; } };
    await fn({ user: { role: 'admin', userId: String(customer._id) }, body: { orderId: order._id, paymentId: saved.payments[0]._id, amount: 1, proof: 'fake', depositedAmount: 1, finalPaymentDueDate: '2027-01-01', dueDate: '2027-01-01' } }, res);
    assert.equal(code, 409);
  }
  assert.equal((await UserOrder.findById(order._id)).paidPaise, 118000);
});
test('UPI amounts below provider minimum are rejected after a partial bank receipt', async () => {
  const order = await checkout(); await service.recordReceipt(bank(1179.99), 'BANK_TRANSFER');
  const result = await api(`/api/payments/orders/${order._id}/upi`, {});
  assert.equal(result.status, 400);
  assert.match(result.data.message, /at least ₹1/);
});
test('test mode excludes unlisted users from Paysharp and creates proof-based orders without provider calls', async () => {
  process.env.Paysharp_test_active = 'True';
  process.env.Paysharp_Test_users = '8888888888';
  const config = await api('/api/payments/config');
  assert.equal(config.data.paymentProvider, 'LEGACY');
  assert.equal((await api('/api/payments/account')).status, 403);
  const body = { products: [{ productId: 'HW1', quantity: 1 }] };
  assert.equal((await api('/api/payments/quote', body)).data.paymentProvider, 'LEGACY');
  assert.equal((await api('/api/user/pi-generate', { ...body, checkoutKey: 'legacy_missing_proof', expectedTotalPaise: 118000 })).status, 400);
  assert.equal((await api('/api/user/pi-generate', { ...body, checkoutKey: 'legacy_bypass_00001', expectedTotalPaise: 118000, paymentProvider: 'PAYSHARP' })).status, 409);
  const result = await api('/api/user/pi-generate', { ...body, checkoutKey: 'legacy_checkout_001', expectedTotalPaise: 118000, paymentProvider: 'LEGACY', payment: { proof: 'data:image/png;base64,aGVsbG8=' } });
  assert.equal(result.status, 201, JSON.stringify(result));
  assert.equal(result.data.order.paymentProvider, 'LEGACY');
  const saved = await UserOrder.findById(result.data.order._id);
  assert.equal(saved.paymentProvider, undefined); assert.equal(saved.payments[0].proofAdded, true); assert.equal(saved.payments[0].isApproved, false);
  assert.equal(await PaymentAccount.countDocuments(), 0); assert.equal(calls.length, 0);
  assert.equal((await api(`/api/payments/orders/${saved._id}/upi`, {})).status, 404);
  // Once rollout changes, this existing order still uses manual proof review.
  process.env.Paysharp_test_active = 'False';
  const legacy = require('../src/controllers/orderController');
  let code = 200;
  await legacy.approvePayment({ user: { role: 'admin' }, body: { orderId: saved._id, paymentId: saved.payments[0]._id, depositedAmount: 1180, finalPaymentDueDate: '2027-01-01' } }, { status(c) { code = c; return this; }, json() { return this; } });
  assert.equal(code, 200);
});
test('test mode allows listed registered users and global rollout ignores the list', async () => {
  process.env.Paysharp_test_active = 'true'; process.env.Paysharp_Test_users = '+91 99999 99999,8888888888';
  assert.equal((await api('/api/payments/config')).data.paymentProvider, 'PAYSHARP');
  const order = await checkout(); assert.equal(order.paymentProvider, 'PAYSHARP');
  process.env.Paysharp_Test_users = '7777777777';
  assert.equal((await api('/api/payments/config')).data.paymentProvider, 'LEGACY');
  // Already-created Paysharp orders remain payable after removing a user from the list.
  assert.equal((await api(`/api/payments/orders/${order._id}/upi`, {})).status, 200);
  process.env.Paysharp_test_active = 'false';
  assert.equal((await api('/api/payments/config')).data.paymentProvider, 'PAYSHARP');
});
test('rollout changes mid-checkout require a refreshed quote and do not create an order', async () => {
  const body = { products: [{ productId: 'HW1', quantity: 1 }], checkoutKey: 'rollout_changed_001', expectedTotalPaise: 118000 };
  process.env.Paysharp_test_active = 'true'; process.env.Paysharp_Test_users = '';
  assert.equal((await api('/api/user/pi-generate', { ...body, paymentProvider: 'PAYSHARP' })).status, 409);
  process.env.Paysharp_test_active = 'false';
  assert.equal((await api('/api/user/pi-generate', { ...body, paymentProvider: 'LEGACY', payment: { proof: 'data:image/png;base64,aGVsbG8=' } })).status, 409);
  assert.equal(await UserOrder.countDocuments(), 0); assert.equal(calls.length, 0);
});
