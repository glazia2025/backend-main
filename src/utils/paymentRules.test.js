const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { paise, payable, upiAllowed } = require('./paymentRules');
test('checkout threshold includes GST and preserves integer paise', () => {
  assert.equal(upiAllowed(payable([{ productId: 'A', quantity: 1, amount: 84745.99 }]).totalPaise), true);
  assert.equal(upiAllowed(payable([{ productId: 'A', quantity: 1, amount: 84746 }]).totalPaise), false);
  assert.equal(paise(0.1 + 0.2), 30);
});
test('invalid amounts and quantities cannot produce payable orders', () => {
  for (const value of [NaN, Infinity, -1, 'not-a-number']) assert.throws(() => paise(value));
  for (const quantity of [0, -1, Infinity, 'bad']) assert.throws(() => payable([{ productId: 'A', quantity, amount: 1 }]));
  assert.throws(() => payable([]));
  assert.throws(() => payable([{ productId: 'A', quantity: 1, amount: 0 }]));
});
function client(env, axios) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../services/paysharpClient'), 'utf8'), {
    module, process: { env }, URL, require: name => name === 'axios' ? axios : require('./paymentRules'),
  });
  return module.exports;
}
test('Paysharp token stays in server authorization header and calls have timeouts', async () => {
  let config;
  const api = client({ PAYSHARP_TOKEN: 'test-server-token', PAYSHARP_VA_BASE_URL: 'https://sandbox.example/api' }, async c => { config = c; return { data: { code: 200, data: { value: 'ok' } } }; });
  assert.equal((await api.request('va', 'GET', '/customers/1')).value, 'ok');
  assert.equal(config.headers.Authorization, 'Bearer test-server-token');
  assert.equal(config.timeout, 15000); assert.equal(config.maxRedirects, 0);
});
test('provider failures never expose token or Axios configuration', async () => {
  const api = client({ PAYSHARP_TOKEN: 'secret-token', PAYSHARP_UPI_BASE_URL: 'https://sandbox.example/api' }, async () => {
    throw { config: { headers: { Authorization: 'secret-token' } }, message: 'secret-token', response: { data: { errorCode: 6001 } } };
  });
  await assert.rejects(api.request('upi', 'POST', '/order/qrcode', {}), error => {
    assert.equal(error.providerCode, 6001); assert.equal(error.status, 502);
    assert.equal(JSON.stringify(error).includes('secret-token'), false);
    assert.equal(error.message.includes('secret-token'), false); assert.equal(error.config, undefined); return true;
  });
});
test('missing credentials or insecure API base fails closed before network calls', async () => {
  let called = false;
  const axios = async () => { called = true; };
  await assert.rejects(client({}, axios).request('va', 'GET', '/customers/1'), /not configured/);
  await assert.rejects(client({ PAYSHARP_TOKEN: 'test', PAYSHARP_VA_BASE_URL: 'http://example.test' }, axios).request('va', 'GET', '/customers/1'), /HTTPS/);
  assert.equal(called, false);
});
const { paysharpEnabled, normalizeMobile } = require('./paymentRollout');
test('rollout false enables every user; true enables only registered allowlisted mobiles', () => {
  const user = { phoneNumber: '9999999999' };
  assert.equal(paysharpEnabled(user, { Paysharp_test_active: 'False' }), true);
  assert.equal(paysharpEnabled(user, { Paysharp_test_active: 'True', Paysharp_Test_users: ' +91 99999 99999,7777777777 ' }), true);
  assert.equal(paysharpEnabled(user, { Paysharp_test_active: 'true', Paysharp_Test_users: '08888888888' }), false);
  assert.equal(paysharpEnabled(user, { Paysharp_test_active: 'true', Paysharp_Test_users: '7777777777' }), false);
  assert.equal(paysharpEnabled(user, { Paysharp_test_active: 'true', Paysharp_Test_users: '' }), false);
  assert.equal(paysharpEnabled(user, { Paysharp_test_active: 'typo' }), false);
  assert.equal(paysharpEnabled(user, {}), true);
});
test('rollout phone matching normalizes Indian country codes but never accepts partial matches', () => {
  assert.equal(normalizeMobile('+91 99999-99999'), '9999999999');
  assert.equal(normalizeMobile('09999999999'), '9999999999');
  assert.equal(normalizeMobile('99999'), null);
  assert.equal(paysharpEnabled({ phoneNumber: '9999999999' }, { Paysharp_test_active: 'true', Paysharp_Test_users: '999999999' }), false);
});

test('common API root builds UPI paths for QR, intent and verification without VA configuration', async () => {
  const urls = [];
  const api = client({ PAYSHARP_TOKEN: 'test', PAYSHARP_BASE_URL: 'https://sandbox.paysharp.co.in/external/api/v1/' }, async config => {
    urls.push(config.url); return { data: { code: 200, data: {} } };
  });
  for (const path of ['/order/intent', '/order/qrcode', '/order/test']) await api.request('upi', 'POST', path, {});
  assert.deepEqual(urls, ['order/intent', 'order/qrcode', 'order/test'].map(path => `https://sandbox.paysharp.co.in/external/api/v1/upi/${path}`));
});
