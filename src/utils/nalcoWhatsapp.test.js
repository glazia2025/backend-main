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
