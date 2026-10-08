const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { paysharpEnabled } = require('./paymentRollout');
const rules = require('./paymentRules');
function setup(phone, env, totalPaise = 118000) {
  let accountCalls = 0;
  const user = { _id: 'business', phoneNumber: phone, accountType: 'FABRICATOR' };
  const payments = { ensureAccount: async () => { accountCalls++; return { creditPaise: 0 }; }, accountView: value => ({...value}) };
  const context = { exports: {}, console: { error() {} }, require(name) {
    if (name === 'crypto') return require('node:crypto');
    if (name === '../models/User') return { findOne: () => ({lean: async () => user}) };
    if (name === '../models/Order') return { UserOrder: {findOne: async () => null} };
    if (name === '../models/Payment') return { PaymentCheckout: {findOne: async () => null} };
    if (name === '../services/paymentService') return payments;
    if (name === '../services/orderPricingService') return {priceOrder: async () => ({totalPaise})};
    if (name === '../utils/authCookies') return {extractAuthToken: () => 'test'};
    if (name === '../utils/paymentRollout') return {paysharpEnabled: value => paysharpEnabled(value, env)};
    if (name === '../utils/paymentRules') return rules;
    return {};
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/paymentController.js'),'utf8'), context);
  return { get accountCalls(){return accountCalls;}, async call(handler, body = {}) {
    const res = {statusCode:200, status(code){this.statusCode=code;return this;}, json(value){this.body=value;return this;}};
    await context.exports[handler]({user:{userId:'business',phoneNumber:'7777777777'},access:{isOwner:false},body},res);
    return res;
  }};
}
const limited = {Paysharp_test_active:' True ',Paysharp_Test_users:' +91 99999 99999, 08888888888, '};
test('listed owner still falls back to legacy checkout outside the current UPI checkout range', async () => {
  for (const [totalPaise, provider] of [[99, 'LEGACY'], [100, 'PAYSHARP'], [9999900, 'PAYSHARP'], [10000000, 'LEGACY']]) {
    const s = setup('9999999999', limited, totalPaise);
    assert.equal((await s.call('config')).body.paymentProvider, 'PAYSHARP');
    assert.equal((await s.call('quote')).body.paymentProvider, provider, `totalPaise=${totalPaise}`);
  }
});
test('first and subsequent comma-separated business numbers enable config, quote and account',async()=>{
  for (const phone of ['9999999999','8888888888']) {
    const s=setup(phone,limited);
    const config=await s.call('config');assert.equal(config.body.paymentProvider,'PAYSHARP');assert.equal(config.body.virtualAccountEnabled,true);
    assert.equal((await s.call('quote')).body.paymentProvider,'PAYSHARP');
    assert.equal((await s.call('account')).statusCode,200);assert.equal(s.accountCalls,1);
  }
});
test('unlisted business gets legacy checkout and cannot provision a virtual account or force Paysharp',async()=>{
  const s=setup('7777777777',limited);
  assert.equal((await s.call('config')).body.virtualAccountEnabled,false);
  assert.equal((await s.call('quote')).body.paymentProvider,'LEGACY');
  assert.equal((await s.call('account')).statusCode,403);assert.equal(s.accountCalls,0);
  assert.equal((await s.call('createOrder',{checkoutKey:'checkout_test_00001',expectedTotalPaise:118000,paymentProvider:'PAYSHARP'})).statusCode,409);
});
test('empty or invalid test lists enable nobody; global rollout enables all business numbers',async()=>{
  for (const list of ['', 'invalid,123']) {
    const s=setup('9999999999',{...limited,Paysharp_Test_users:list});
    assert.equal((await s.call('quote')).body.paymentProvider,'LEGACY');
    assert.equal((await s.call('account')).statusCode,403);assert.equal(s.accountCalls,0);
  }
  const s=setup('7777777777',{Paysharp_test_active:'false',Paysharp_Test_users:''});
  assert.equal((await s.call('account')).statusCode,200);
});
