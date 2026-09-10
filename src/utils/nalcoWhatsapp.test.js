const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeIndianPhoneNumber } = require("./nalcoWhatsapp");

test("normalizes local and country-coded Indian WhatsApp numbers", () => {
  assert.equal(normalizeIndianPhoneNumber("98765 43210"), "919876543210");
  assert.equal(normalizeIndianPhoneNumber("+91-98765-43210"), "919876543210");
});

test("rejects invalid WhatsApp numbers", () => {
  assert.equal(normalizeIndianPhoneNumber("98765"), "");
  assert.equal(normalizeIndianPhoneNumber(""), "");
});

test("logs each recipient's API status without exposing request credentials", async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const logs = [];
  const numbers = ['9876543210', '9876543211', '9876543212', '9876543213'];
  const context = {
    module: { exports: {} }, process: { env: { META_TOKEN: 'secret-token', META_NUMID: 'sender' } },
    console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    require: name => {
      if (name === 'crypto') return { randomUUID: () => 'broadcast-test' };
      if (name === '../models/User') return { find: () => ({ lean: async () => numbers.map(phoneNumber => ({ phoneNumber })) }) };
      return { post: async (_url, body) => {
        if (body.to.endsWith('11')) throw { response: { status: 400, data: { error: { code: 131049, message: 'Rejected' } } }, config: { token: 'secret-token' } };
        if (body.to.endsWith('12')) throw { code: 'ECONNABORTED', message: 'timeout', config: { token: 'secret-token' } };
        return { status: 200, data: { messages: [{ id: body.to, ...(body.to.endsWith('13') ? { message_status: 'held_for_quality_assessment' } : {}) }] } };
      } };
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./nalcoWhatsapp'), 'utf8'), context);
  await context.module.exports.sendNalcoMessageToUsers(371650);
  const entries = logs.filter(row => row[0] === 'NALCO_WHATSAPP_RECIPIENT').map(row => JSON.parse(row[1]));
  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map(row => row.recipient), numbers.map(number => `91${number}`));
  assert.deepEqual(entries.map(row => row.status), ['api_accepted', 'api_failed', 'request_outcome_unknown', 'held_for_quality_assessment']);
  assert.equal(entries[1].errorCode, 131049);
  assert.ok(entries.every(row => row.broadcastId === 'broadcast-test'));
  assert.equal(JSON.stringify(logs).includes('secret-token'), false);
});
