const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const express = require('express');
const { PaymentAccount, PaymentReceipt, PaymentAttempt, PaymentCheckout } = require('../src/models/Payment');
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
  customer = await User.create({ name: 'Fabricator', email: 'fabricator@test.invalid', phoneNumber: '9999999999', city: 'Pune', paUrl: 'test-fabricator' });
  token = signJwt({ role: 'user', userId: String(customer._id), phoneNumber: customer.phoneNumber });
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
async function pendingCheckout(quantity = 1, key = 'checkout_test_00001') {
  const body = { products: [{ productId: 'HW1', quantity }] };
  const quote = await api('/api/payments/quote', body);
  assert.equal(quote.status, 200);
  const result = await api('/api/user/pi-generate', { ...body, checkoutKey: key, expectedTotalPaise: quote.data.totalPaise });
  assert.equal(result.status, 201, JSON.stringify(result));
  assert.equal(result.data.order, null);
  return result.data.checkout;
}
// Explicit fixtures for orders created before pay-first checkout was introduced.
async function historicalOrder(quantity = 1, key = 'checkout_test_00001') {
  const pending = await pendingCheckout(quantity, key);
  const draft = await PaymentCheckout.findById(pending._id);
  await UserOrder.create(draft.orderSnapshot);
  await PaymentCheckout.deleteOne({ _id: draft._id });
  await mongoose.connection.transaction(async session => {
    const account = await PaymentAccount.findOne({ user: customer._id }).session(session);
    await service.allocateCredit(account, session);
  });
  const order = await UserOrder.findById(pending._id);
  return { ...pending, paidPaise: order.paidPaise, paymentStatus: order.paymentStatus };
}
async function payCheckout(id, auth = token) {
  const response = await api(`/api/payments/orders/${id}/upi`, { kind: 'qr' }, auth);
  assert.equal(response.status, 200, JSON.stringify(response));
  const attempt = await PaymentAttempt.findOne({ order: id, active: true });
  const path = `/order/${attempt._id}`;
  remote.set(path, { ...remote.get(path), status: 'SUCCESS', utrNumber: `UTR_${attempt._id}`, transactionDate: new Date().toISOString() });
  const paid = await api('/api/payments/webhooks/upi', { orderId: String(attempt._id) }, null);
  assert.equal(paid.status, 200, JSON.stringify(paid));
  return attempt;
}
async function bank(amount, reference = 'BANK001', user = customer) {
  // Historical VA fixture: only bank-payment tests provision an account.
  await service.ensureAccount(user);
  const data = { externalCustomerId: String(user._id), virtualAccountNo: `VA${user._id}`, amount, totalFee: 5, netAmount: amount - 5, paysharpReferenceNo: reference, utrNumber: `UTR_${reference}`, transactionDate: new Date().toISOString() };
  remote.set(`/transactions/${reference}`, data); return data;
}
test('server prices ignore browser amounts; concurrent checkout retries create one pending checkout and no order', async () => {
  const body = { products: [{ productId: 'HW1', quantity: 1, amount: 0.01 }], totalAmount: 0.01, checkoutKey: 'idempotent_checkout_01', expectedTotalPaise: 118000 };
  const [first, second] = await Promise.all([api('/api/user/pi-generate', body), api('/api/user/pi-generate', body)]);
  assert.ok([200, 201].includes(first.status), JSON.stringify(first)); assert.ok([200, 201].includes(second.status), JSON.stringify(second));
  assert.equal(first.data.checkout._id, second.data.checkout._id);
  assert.equal(await UserOrder.countDocuments(), 0);
  assert.equal(await PaymentCheckout.countDocuments(), 1);
  assert.equal((await mongoose.models.Counter.findOne()).seq, 0);
  assert.equal(first.data.checkout.totalPaise, 118000);
  const tampered = await api('/api/user/pi-generate', { ...body, checkoutKey: 'idempotent_checkout_02', expectedTotalPaise: 1 });
  assert.equal(tampered.status, 409);
});
test('₹1,00,000 boundary is based on full order total, even after partial payment', async () => {
  assert.equal(upiAllowed(9999999), true); assert.equal(upiAllowed(10000000), false); assert.equal(upiAllowed(10000001), false);
  // Existing high-value Paysharp orders keep their original payment rules.
  const order = await historicalOrder();
  await UserOrder.updateOne({ _id: order._id }, { totalPaise: 11800000, totalAmount: 118000 });
  const response = await api(`/api/payments/orders/${order._id}/upi`, {});
  assert.equal(response.status, 400);
  await service.recordReceipt(await bank(117000), 'BANK_TRANSFER');
  assert.equal((await api(`/api/payments/orders/${order._id}/upi`, {})).status, 400);
});
test('orders between ₹50,000 and ₹1,00,000 now allow UPI', async () => {
  const order = await historicalOrder(50);
  assert.equal(order.totalPaise, 5900000);
  assert.equal((await api(`/api/payments/orders/${order._id}/upi`, {})).status, 200);
});
test('bank webhook uses provider data, deduplicates concurrent delivery and keeps fees separate', async () => {
  const order = await historicalOrder(); await bank(1180);
  const responses = await Promise.all([1, 2, 3].map(() => api('/api/payments/webhooks/virtual-account', { paysharpReferenceNo: 'BANK001', amount: 99999999, externalCustomerId: 'forged' }, null)));
  responses.forEach(response => assert.equal(response.status, 200, JSON.stringify(response)));
  const saved = await UserOrder.findById(order._id);
  assert.equal(saved.paymentStatus, 'PAID'); assert.equal(saved.paidPaise, 118000);
  assert.equal(saved.payments.length, 1); assert.equal(await PaymentReceipt.countDocuments(), 1);
  const receipt = await PaymentReceipt.findOne(); assert.equal(receipt.feePaise, 500); assert.equal(receipt.netPaise, 117500);
});
test('partial receipts allocate FIFO and excess credits a future order', async () => {
  const first = await historicalOrder(1, 'checkout_first_0001'); const second = await historicalOrder(1, 'checkout_second_0001');
  await service.recordReceipt(await bank(500), 'BANK_TRANSFER');
  assert.equal((await UserOrder.findById(first._id)).paymentStatus, 'PARTIALLY_PAID');
  assert.equal((await UserOrder.findById(second._id)).paidPaise, 0);
  await service.recordReceipt(await bank(3000, 'BANK002'), 'BANK_TRANSFER');
  assert.equal((await PaymentAccount.findOne()).creditPaise, 114000);
  const third = await historicalOrder(1, 'checkout_third_0001');
  assert.equal(third.paidPaise, 114000); assert.equal(third.paymentStatus, 'PARTIALLY_PAID');
  assert.equal((await PaymentAccount.findOne()).creditPaise, 0);
});
test('UPI is tied to its intended order, verifies success and never regresses to pending', async () => {
  const first = await historicalOrder(1, 'checkout_first_0001'); const second = await historicalOrder(1, 'checkout_second_0001');
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
  const order = await historicalOrder(); await api(`/api/payments/orders/${order._id}/upi`, {});
  const attempt = await PaymentAttempt.findOne(); const path = `/order/${attempt._id}`;
  remote.set(path, { ...remote.get(path), status: 'SUCCESS', amount: 1, utrNumber: 'WRONG', transactionDate: new Date().toISOString() });
  assert.equal((await api('/api/payments/webhooks/upi', { orderId: String(attempt._id) }, null)).status, 409);
  const data = await bank(1180); remote.set('/transactions/BANK001', { ...data, virtualAccountNo: 'WRONG' });
  assert.equal((await api('/api/payments/webhooks/virtual-account', { paysharpReferenceNo: 'BANK001' }, null)).status, 409);
  assert.equal(await PaymentReceipt.countDocuments(), 0);
});
test('account and order payment APIs require the owner', async () => {
  const order = await historicalOrder();
  assert.equal((await api(`/api/payments/orders/${order._id}`, undefined, null)).status, 403);
  const other = await User.create({ name: 'Other', email: 'other@test.invalid', phoneNumber: '8888888888', city: 'Pune', paUrl: 'other' });
  const otherToken = signJwt({ role: 'user', userId: String(other._id), phoneNumber: other.phoneNumber });
  assert.equal((await api(`/api/payments/orders/${order._id}`, undefined, otherToken)).status, 404);
  assert.equal((await api(`/api/payments/orders/${order._id}/upi`, {}, otherToken)).status, 404);
});
test('dealer stock is consumed only when fully paid; duplicate notifications cannot consume twice', async () => {
  const dealer = await User.create({ name: 'Dealer', email: 'dealer@test.invalid', phoneNumber: '7777777777', city: 'Pune', accountType: 'DEALERSHIP', paUrl: 'dealer' });
  await User.updateOne({ _id: customer._id }, { dealership: dealer._id });
  await DealershipInventory.create({ dealership: dealer._id, productId: 'HW1', quantity: 10 });
  const order = await historicalOrder(2);
  assert.equal((await DealershipInventory.findOne()).quantity, 10);
  await service.recordReceipt(await bank(2360), 'BANK_TRANSFER');
  await service.recordReceipt(await bank(2360), 'BANK_TRANSFER');
  assert.equal((await DealershipInventory.findOne()).quantity, 8);
  assert.equal((await UserOrder.findById(order._id)).fulfillment.status, 'DEALER_STOCK');
  assert.equal(await InventoryMovement.countDocuments(), 1);
});
test('completion requires paid status and stock additions happen once', async () => {
  await User.updateOne({ _id: customer._id }, { accountType: 'DEALERSHIP' });
  const order = await historicalOrder();
  const documents = { biltyDoc: 'doc', eWayBill: 'doc', taxInvoice: 'doc', driverInfo: { name: 'Driver', phone: '9999999999' } };
  await assert.rejects(completePaidOrder(order._id, documents), /Full payment/);
  await service.recordReceipt(await bank(1180), 'BANK_TRANSFER');
  await completePaidOrder(order._id, documents);
  await assert.rejects(completePaidOrder(order._id, documents), /already complete/);
  assert.equal((await DealershipInventory.findOne()).quantity, 1);
});
test('invalid source order cannot leave an orphan upstream order', async () => {
  const result = await api('/api/user/pi-generate', { sourceOrderId: String(new mongoose.Types.ObjectId()), checkoutKey: 'bad_source_checkout1', expectedTotalPaise: 118000 });
  assert.equal(result.status, 400); assert.equal(await UserOrder.countDocuments(), 0);
});
test('inventory-write failure rolls back receipt, payment balance, and stock before retry', async () => {
  const dealer = await User.create({ name: 'Dealer', email: 'dealer@test.invalid', phoneNumber: '7777777777', city: 'Pune', accountType: 'DEALERSHIP', paUrl: 'dealer' });
  await User.updateOne({ _id: customer._id }, { dealership: dealer._id });
  await DealershipInventory.create({ dealership: dealer._id, productId: 'HW1', quantity: 3 });
  const order = await historicalOrder(); const data = await bank(1180);
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
  const dealer = await User.create({ name: 'Dealer', email: 'dealer@test.invalid', phoneNumber: '7777777777', city: 'Pune', accountType: 'DEALERSHIP', paUrl: 'dealer' });
  await User.updateOne({ _id: customer._id }, { dealership: dealer._id });
  await DealershipInventory.create({ dealership: dealer._id, productId: 'HW1', quantity: 1 });
  const original = await historicalOrder(3);
  await service.recordReceipt(await bank(3540), 'BANK_TRANSFER');
  assert.equal((await UserOrder.findById(original._id)).fulfillment.remainingProducts[0].quantity, 2);
  const dealerToken = signJwt({ role: 'user', userId: String(dealer._id), phoneNumber: dealer.phoneNumber });
  const body = { sourceOrderId: original._id, checkoutKey: 'dealer_shortage_0001', expectedTotalPaise: 236000 };
  const first = await api('/api/user/pi-generate', body, dealerToken);
  assert.equal(first.status, 201, JSON.stringify(first));
  assert.equal((await api('/api/user/pi-generate', body, dealerToken)).data.checkout._id, first.data.checkout._id);
  assert.equal((await UserOrder.findById(original._id)).upstreamOrder, null);
  const duplicate = await api('/api/user/pi-generate', { ...body, checkoutKey: 'dealer_shortage_0002' }, dealerToken);
  assert.equal(duplicate.status, 409); assert.equal(await UserOrder.countDocuments(), 1);
  const documents = { biltyDoc: 'doc', eWayBill: 'doc', taxInvoice: 'doc', driverInfo: { name: 'Driver', phone: '9999999999' } };
  await assert.rejects(completePaidOrder(original._id, documents), /shortage order/);
  await payCheckout(first.data.checkout._id, dealerToken);
  assert.equal(await UserOrder.countDocuments(), 2);
  await completePaidOrder(first.data.checkout._id, documents);
  assert.equal((await DealershipInventory.findOne()).quantity, 2);
  await completePaidOrder(original._id, documents);
  assert.equal((await DealershipInventory.findOne()).quantity, 0);
  assert.equal((await UserOrder.findById(original._id)).isComplete, true);
});
test('expired UPI attempts can be retried without reusing the provider order ID', async () => {
  const order = await historicalOrder();
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
  const order = await historicalOrder(); await api(`/api/payments/orders/${order._id}/upi`, {});
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
    assert.equal(await UserOrder.countDocuments(), 0);
    await payCheckout(result.data.checkout._id);
    const saved = await UserOrder.findById(result.data.checkout._id);
    assert.equal(String(saved.quotationId), quotationId); assert.equal(saved.quotationCode, 'QT-TEST');
    assert.equal(saved.products[0].productId, 'HW1'); assert.equal(saved.products[0].quantity, 2);
  } finally { axios.get = originalGet; }
});
test('manual payment endpoints cannot edit a Paysharp receipt', async () => {
  const order = await historicalOrder(); await service.recordReceipt(await bank(1180), 'BANK_TRANSFER');
  const saved = await UserOrder.findById(order._id);
  const legacy = require('../src/controllers/orderController');
  for (const fn of [legacy.approvePayment, legacy.updatePaymentDueDate, legacy.uploadPaymentProof, legacy.createPayment]) {
    let code = 200;
    const res = { status(value) { code = value; return this; }, json() { return this; } };
    await fn({ user: { role: 'admin', userId: String(customer._id), phoneNumber: customer.phoneNumber }, body: { orderId: order._id, paymentId: saved.payments[0]._id, amount: 1, proof: 'fake', depositedAmount: 1, finalPaymentDueDate: '2027-01-01', dueDate: '2027-01-01' } }, res);
    assert.equal(code, 409);
  }
  assert.equal((await UserOrder.findById(order._id)).paidPaise, 118000);
});
test('UPI amounts below provider minimum are rejected after a partial bank receipt', async () => {
  const order = await historicalOrder(); await service.recordReceipt(await bank(1179.99), 'BANK_TRANSFER');
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
  const order = await historicalOrder(); assert.equal(order.paymentProvider, 'PAYSHARP');
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
test('merged fabricator delivery updates inventory once when a Paysharp order completes', async () => {
  const order = await historicalOrder();
  const FabricatorInventory = require('../src/models/FabricatorInventory');
  assert.equal(await FabricatorInventory.countDocuments(), 0);
  await service.recordReceipt(await bank(1180), 'BANK_TRANSFER');
  assert.equal(await FabricatorInventory.countDocuments(), 0);
  const documents = { biltyDoc: 'doc', eWayBill: 'doc', taxInvoice: 'doc', driverInfo: { name: 'Driver', phone: '9999999999' } };
  await completePaidOrder(order._id, documents);
  const item = await FabricatorInventory.findOne({ fabricator: customer._id, productId: 'HW1' });
  assert.equal(item.quantity, 1);
  assert.ok((await UserOrder.findById(order._id)).fabricatorInventoryProcessedAt);
  await assert.rejects(completePaidOrder(order._id, documents), /already complete/);
  assert.equal((await FabricatorInventory.findById(item._id)).quantity, 1);
});

test('UPI-only checkout creates a local ledger and QR/intent without any VA calls', async () => {
  for (const kind of ['qr', 'intent']) {
    const order = await pendingCheckout(1, `upi_only_checkout_${kind}`);
    assert.equal(await UserOrder.findById(order._id), null);
    assert.equal(calls.filter(call => call.kind === 'va').length, 0);
    const account = await PaymentAccount.findOne({ user: customer._id });
    assert.ok(account); assert.equal(account.virtualAccountNo, undefined);
    const response = await api(`/api/payments/orders/${order._id}/upi`, { kind });
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.ok(kind === 'qr' ? response.data.qrCode : response.data.intentUrl);
    const attempt = await PaymentAttempt.findOne({ order: order._id });
    const data = remote.get(`/order/${attempt._id}`);
    remote.set(`/order/${attempt._id}`, { ...data, status: 'SUCCESS', utrNumber: `UTR_${kind}`, transactionDate: new Date().toISOString() });
    const result = await api('/api/payments/webhooks/upi', { orderId: String(attempt._id), amount: 1 }, null);
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal((await UserOrder.findById(order._id)).paymentStatus, 'PAID');
  }
  assert.equal((await api('/api/payments/account')).status, 403);
  assert.equal((await api('/api/payments/config')).data.virtualAccountEnabled, false);
  assert.equal(calls.some(call => call.kind === 'va'), false);
});

test('high-value checkout uses proof upload and rejects forcing Paysharp', async () => {
  const body = { products: [{ productId: 'HW1', quantity: 100 }] };
  const quote = await api('/api/payments/quote', body);
  assert.equal(quote.data.paymentProvider, 'LEGACY');
  const request = { ...body, expectedTotalPaise: quote.data.totalPaise, checkoutKey: 'high_value_checkout_01' };
  assert.equal((await api('/api/user/pi-generate', { ...request, paymentProvider: 'PAYSHARP' })).status, 409);
  assert.equal((await api('/api/user/pi-generate', { ...request, paymentProvider: 'LEGACY' })).status, 400);
  const response = await api('/api/user/pi-generate', { ...request, paymentProvider: 'LEGACY', payment: { proof: 'data:image/png;base64,aGVsbG8=' } });
  assert.equal(response.status, 201, JSON.stringify(response));
  assert.equal(response.data.order.paymentProvider, 'LEGACY');
  assert.equal(calls.length, 0); assert.equal(await PaymentAccount.countDocuments(), 0);
});

test('pending, failed, expired and forged success notifications never create an order', async () => {
  const checkout = await pendingCheckout();
  assert.equal(checkout.orderId, undefined);
  assert.equal((await api(`/api/payments/orders/${checkout._id}/upi`, {})).status, 200);
  const attempt = await PaymentAttempt.findOne({ checkout: checkout._id });
  assert.ok(attempt);
  const path = `/order/${attempt._id}`;
  for (const status of ['PENDING', 'ON PROGRESS', 'FAILED', 'EXPIRED']) {
    remote.set(path, { ...remote.get(path), status });
    assert.equal((await api('/api/payments/webhooks/upi', { orderId: String(attempt._id), status: 'SUCCESS' }, null)).status, 200);
    assert.equal(await UserOrder.countDocuments(), 0);
    assert.equal(await PaymentReceipt.countDocuments(), 0);
    assert.equal(await InventoryMovement.countDocuments(), 0);
    assert.equal((await mongoose.models.Counter.findOne()).seq, 0);
    const statusResponse = await api(`/api/payments/orders/${checkout._id}`);
    assert.equal(statusResponse.data.order, null);
    assert.equal(statusResponse.data.checkout._id, checkout._id);
  }
  // Reopening starts another payment attempt against the same pending checkout.
  assert.equal((await api(`/api/payments/orders/${checkout._id}/upi`, {})).status, 200);
  const retry = await PaymentAttempt.findOne({ checkout: checkout._id, active: true });
  assert.notEqual(String(attempt._id), String(retry._id));
  assert.equal(await UserOrder.countDocuments(), 0);
});

test('verified payment creates exactly one paid order under concurrent webhook and refresh retries', async () => {
  const dealer = await User.create({ name: 'Dealer', email: 'dealer@test.invalid', phoneNumber: '7777777777', city: 'Pune', accountType: 'DEALERSHIP', paUrl: 'dealer' });
  await User.updateOne({ _id: customer._id }, { dealership: dealer._id });
  await DealershipInventory.create({ dealership: dealer._id, productId: 'HW1', quantity: 10 });
  const checkout = await pendingCheckout(2);
  assert.equal((await DealershipInventory.findOne()).quantity, 10);
  await api(`/api/payments/orders/${checkout._id}/upi`, {});
  const attempt = await PaymentAttempt.findOne();
  const path = `/order/${attempt._id}`;
  remote.set(path, { ...remote.get(path), status: 'SUCCESS', utrNumber: 'VERIFIED', transactionDate: new Date().toISOString() });
  const responses = await Promise.all([
    api('/api/payments/webhooks/upi', { orderId: String(attempt._id) }, null),
    api('/api/payments/webhooks/upi', { orderId: String(attempt._id) }, null),
    api(`/api/payments/orders/${checkout._id}/refresh`, {}),
  ]);
  responses.forEach(result => assert.equal(result.status, 200, JSON.stringify(result)));
  assert.equal(await UserOrder.countDocuments(), 1);
  assert.equal(await PaymentReceipt.countDocuments(), 1);
  assert.equal(await InventoryMovement.countDocuments(), 1);
  assert.equal((await DealershipInventory.findOne()).quantity, 8);
  const order = await UserOrder.findById(checkout._id);
  assert.equal(order.paymentStatus, 'PAID'); assert.equal(order.paidPaise, 236000);
  assert.equal(order.orderId, 1);
  assert.equal((await PaymentCheckout.findById(checkout._id)).status, 'COMPLETED');
  const retry = await api('/api/user/pi-generate', { products: [{ productId: 'HW1', quantity: 2 }], checkoutKey: 'checkout_test_00001', expectedTotalPaise: 236000 });
  assert.equal(retry.status, 200); assert.equal(retry.data.order._id, checkout._id);
});

test('order creation and counter roll back with inventory failure, then verified retry creates the order', async () => {
  const dealer = await User.create({ name: 'Dealer', email: 'dealer@test.invalid', phoneNumber: '7777777777', city: 'Pune', accountType: 'DEALERSHIP', paUrl: 'dealer' });
  await User.updateOne({ _id: customer._id }, { dealership: dealer._id });
  await DealershipInventory.create({ dealership: dealer._id, productId: 'HW1', quantity: 10 });
  const checkout = await pendingCheckout();
  await api(`/api/payments/orders/${checkout._id}/upi`, {});
  const attempt = await PaymentAttempt.findOne(); const path = `/order/${attempt._id}`;
  remote.set(path, { ...remote.get(path), status: 'SUCCESS', utrNumber: 'VERIFIED', transactionDate: new Date().toISOString() });
  const originalInsert = InventoryMovement.insertMany;
  InventoryMovement.insertMany = async () => { throw new Error('simulated inventory failure'); };
  try { assert.equal((await api('/api/payments/webhooks/upi', { orderId: String(attempt._id) }, null)).status, 500); }
  finally { InventoryMovement.insertMany = originalInsert; }
  assert.equal(await UserOrder.countDocuments(), 0); assert.equal(await PaymentReceipt.countDocuments(), 0);
  assert.equal((await mongoose.models.Counter.findOne()).seq, 0);
  assert.equal((await PaymentCheckout.findById(checkout._id)).status, 'PENDING');
  assert.equal((await DealershipInventory.findOne()).quantity, 10);
  const refreshed = await api(`/api/payments/orders/${checkout._id}/refresh`, {});
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed));
  assert.equal(refreshed.data.order.paymentStatus, 'PAID');
  assert.equal(await UserOrder.countDocuments(), 1);
});

test('wrong amount/customer or unavailable provider cannot finalize a checkout', async () => {
  const checkout = await pendingCheckout(); await api(`/api/payments/orders/${checkout._id}/upi`, {});
  const attempt = await PaymentAttempt.findOne(); const path = `/order/${attempt._id}`;
  const valid = { ...remote.get(path), status: 'SUCCESS', utrNumber: 'VERIFIED', transactionDate: new Date().toISOString() };
  for (const change of [{ amount: 1 }, { customerId: String(new mongoose.Types.ObjectId()) }, { orderId: String(new mongoose.Types.ObjectId()) }]) {
    remote.set(path, { ...valid, ...change });
    assert.equal((await api('/api/payments/webhooks/upi', { orderId: String(attempt._id) }, null)).status, 409);
    assert.equal(await UserOrder.countDocuments(), 0);
  }
  remote.delete(path);
  assert.equal((await api('/api/payments/webhooks/upi', { orderId: String(attempt._id) }, null)).status, 502);
  assert.equal(await UserOrder.countDocuments(), 0); assert.equal(await PaymentReceipt.countDocuments(), 0);
});

test('pending checkout cannot be accessed by another user and survives rollout changes without becoming a legacy order', async () => {
  const checkout = await pendingCheckout();
  const other = await User.create({ name: 'Other', email: 'other@test.invalid', phoneNumber: '8888888888', city: 'Pune', paUrl: 'other' });
  const otherToken = signJwt({ role: 'user', userId: String(other._id), phoneNumber: other.phoneNumber });
  for (const suffix of ['', '/refresh', '/upi']) {
    assert.equal((await api(`/api/payments/orders/${checkout._id}${suffix}`, suffix ? {} : undefined, otherToken)).status, 404);
  }
  process.env.Paysharp_test_active = 'True'; process.env.Paysharp_Test_users = '';
  const retry = await api('/api/user/pi-generate', { products: [{ productId: 'HW1', quantity: 1 }], checkoutKey: 'checkout_test_00001', expectedTotalPaise: 118000, paymentProvider: 'LEGACY', payment: { proof: 'data:image/png;base64,aGVsbG8=' } });
  assert.equal(retry.status, 200); assert.equal(retry.data.order, null); assert.equal(retry.data.checkout._id, checkout._id);
  assert.equal(await UserOrder.countDocuments(), 0);
  await payCheckout(checkout._id);
  assert.equal((await UserOrder.findById(checkout._id)).paymentStatus, 'PAID');
});
