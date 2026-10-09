const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'cron.js'), 'utf8');

const CHANGE_ID = 'auto:2026-10-08:change';
const DAILY_ID = 'auto:2026-10-08:daily';
const manualAt = (iso, accepted = 50) => ({ state: 'completed', accepted, startedAt: new Date(iso) });

const setup = ({
  hour = 10,
  minute = 0,
  scrapedPrice,
  storedPrice = 371650,
  records = {},      
  manual = null,    
  sendFails = false,
  sendResult,       
} = {}) => {
  const sent = [];
  const marks = [];

  const Nalco = function Nalco(doc) {
    Object.assign(this, doc);
    this.save = async () => this;
  };
  Nalco.findOne = () => ({
    sort: async () => (storedPrice ? { nalcoPrice: storedPrice, date: new Date() } : null),
  });

  const NalcoBroadcast = {
    findById: async (id) => (id === 'manual' ? manual : records[id] || null),
    updateOne: async (_filter, update) => { marks.push(update.$set.phase); },
  };

  const module = { exports: {} };
  function DateTimeFormat() {
    return {
      resolvedOptions: () => ({ timeZone: 'UTC' }),
      formatToParts: () => [
        { type: 'year', value: '2026' },
        { type: 'month', value: '10' },
        { type: 'day', value: '08' },
        { type: 'hour', value: String(hour) },
        { type: 'minute', value: String(minute).padStart(2, '0') },
      ],
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
      if (name === '../models/NalcoBroadcast') return { NalcoBroadcast };
      if (name === './nalcoPriceFetch') return { downloadPdf: async () => scrapedPrice };
      if (name === './nalcoWhatsapp') {
        return {
          sendNalcoMessageToUsers: async (price) => {
            if (sendFails) throw new Error('send failed');
            sent.push(price);
            return sendResult;
          },
        };
      }
      if (name === 'dotenv') return { config() {} };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(source, context);
  return { runJob: module.exports.runJob, sent, marks };
};


test('10 AM job sends the latest database price when scraping finds no price link', async () => {
  const service = setup({ scrapedPrice: undefined, storedPrice: 371650 });
  await service.runJob();
  assert.deepEqual(service.sent, [371650]);
  assert.deepEqual(service.marks, ['daily']);
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


test('price change at 9:30 sends and records a change message', async () => {
  const service = setup({ hour: 9, minute: 30, scrapedPrice: 371700, storedPrice: 371650 });
  await service.runJob();
  assert.deepEqual(service.sent, [371700]);
  assert.deepEqual(service.marks, ['change']);
});

test('no change between 9 and 10 sends nothing', async () => {
  const service = setup({ hour: 9, minute: 30, scrapedPrice: 371650, storedPrice: 371650 });
  await service.runJob();
  assert.deepEqual(service.sent, []);
});

test('10:00 regular message is skipped if a change message went out between 9 and 10', async () => {
  const service = setup({
    scrapedPrice: 371650, storedPrice: 371650,
    records: { [CHANGE_ID]: {} },
  });
  await service.runJob();
  assert.deepEqual(service.sent, []);
  assert.deepEqual(service.marks, []);
});

test('10:00 regular message is sent and recorded when no change message went out', async () => {
  const service = setup({ scrapedPrice: 371650, storedPrice: 371650 });
  await service.runJob();
  assert.deepEqual(service.sent, [371650]);
  assert.deepEqual(service.marks, ['daily']);
});

test('10:00 fallback (scrape failed) is skipped if a change message already went out', async () => {
  const service = setup({
    scrapedPrice: undefined, storedPrice: 371650,
    records: { [CHANGE_ID]: {} },
  });
  await service.runJob();
  assert.deepEqual(service.sent, []);
});


test('price change at 10:30 is not sent when the 10:00 regular message was sent', async () => {
  const service = setup({
    hour: 10, minute: 30, scrapedPrice: 371700, storedPrice: 371650,
    records: { [DAILY_ID]: {} },
  });
  await service.runJob();
  assert.deepEqual(service.sent, []);
});

test('price change at 11:15 is sent', async () => {
  const service = setup({ hour: 11, minute: 15, scrapedPrice: 371700, storedPrice: 371650 });
  await service.runJob();
  assert.deepEqual(service.sent, [371700]);
  assert.deepEqual(service.marks, []);
});

test('price change at 10:30 is sent when a change message went out between 9 and 10', async () => {
  const service = setup({
    hour: 10, minute: 30, scrapedPrice: 371700, storedPrice: 371650,
    records: { [CHANGE_ID]: {} },
  });
  await service.runJob();
  assert.deepEqual(service.sent, [371700]);
});

test('price change at 10:30 is sent when the 10:00 regular message was never sent', async () => {
  const service = setup({ hour: 10, minute: 30, scrapedPrice: 371700, storedPrice: 371650 });
  await service.runJob();
  assert.deepEqual(service.sent, [371700]);
});

test('price change at exactly 10:00 is sent when a change message already went out between 9 and 10', async () => {
  const service = setup({
    hour: 10, minute: 0, scrapedPrice: 371700, storedPrice: 371650,
    records: { [CHANGE_ID]: {} },
  });
  await service.runJob();
  assert.deepEqual(service.sent, [371700]);
});


test('a failed send does not record anything', async () => {
  const service = setup({
    hour: 9, minute: 30, scrapedPrice: 371700, storedPrice: 371650, sendFails: true,
  });
  await service.runJob();
  assert.deepEqual(service.sent, []);
  assert.deepEqual(service.marks, []);
});

test('a send where every recipient failed is not recorded', async () => {
  const service = setup({
    hour: 9, minute: 30, scrapedPrice: 371700, storedPrice: 371650,
    sendResult: { recipients: 3, sent: 0, failed: 3 },
  });
  await service.runJob();
  assert.deepEqual(service.sent, [371700]);
  assert.deepEqual(service.marks, []);
});


test('a manual broadcast between 9 and 10 that reached users skips the 10:00 regular message', async () => {
  const service = setup({
    scrapedPrice: 371650, storedPrice: 371650,
    manual: manualAt('2026-10-08T09:40:00+05:30'),
  });
  await service.runJob();
  assert.deepEqual(service.sent, []);
});

test('a manual broadcast where nobody received it does not skip the 10:00 regular message', async () => {
  const service = setup({
    scrapedPrice: 371650, storedPrice: 371650,
    manual: manualAt('2026-10-08T09:40:00+05:30', 0),
  });
  await service.runJob();
  assert.deepEqual(service.sent, [371650]);
});

test('a manual broadcast from another day does not skip the 10:00 regular message', async () => {
  const service = setup({
    scrapedPrice: 371650, storedPrice: 371650,
    manual: manualAt('2026-10-07T09:40:00+05:30'),
  });
  await service.runJob();
  assert.deepEqual(service.sent, [371650]);
});