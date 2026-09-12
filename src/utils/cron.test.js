const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'cron.js'), 'utf8');

const setup = ({ hour = 10, minute = 0, scrapedPrice, storedPrice = 371650 } = {}) => {
  const sent = [];
  const Nalco = function Nalco() {};
  Nalco.findOne = () => ({ sort: async () => storedPrice ? { nalcoPrice: storedPrice, date: new Date() } : null });
  const module = { exports: {} };
  function DateTimeFormat() {
    return {
      resolvedOptions: () => ({ timeZone: 'UTC' }),
      formatToParts: () => [{ type: 'hour', value: String(hour) }, { type: 'minute', value: String(minute).padStart(2, '0') }],
    };
  }
  const context = {
    module,
    exports: module.exports,
    Date,
    Intl: { DateTimeFormat },
    console: { log() {}, warn() {}, error() {} },
    require(name) {
      if (name === 'node-cron') return { schedule() {} };
      if (name === '../models/Order') return { Nalco };
      if (name === './nalcoPriceFetch') return { downloadPdf: async () => scrapedPrice };
      if (name === './nalcoWhatsapp') return { sendNalcoMessageToUsers: async (price) => sent.push(price) };
      if (name === 'dotenv') return { config() {} };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(source, context);
  return { runJob: module.exports.runJob, sent };
};

test('10 AM job sends the latest database price when scraping finds no price link', async () => {
  const service = setup({ scrapedPrice: undefined, storedPrice: 371650 });
  await service.runJob();
  assert.deepEqual(service.sent, [371650]);
});

test('a scrape failure outside 10 AM does not send a stored price', async () => {
  const service = setup({ hour: 10, minute: 15, scrapedPrice: undefined, storedPrice: 371650 });
  await service.runJob();
  assert.deepEqual(service.sent, []);
});

test('10 AM job sends nothing when neither scraped nor stored price is valid', async () => {
  const service = setup({ scrapedPrice: undefined, storedPrice: null });
  await service.runJob();
  assert.deepEqual(service.sent, []);
});
