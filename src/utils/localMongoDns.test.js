const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../db.js'), 'utf8');
async function run(environment, error) {
  let attempts = 0, servers, exitCode;
  const context = {
    module: { exports: {} }, console: { log() {}, warn() {}, error() {} },
    process: { env: { NODE_ENV: environment, MONGO_URI: 'mongodb+srv://example.invalid/test' }, exit(code) { exitCode = code; } },
    require(name) {
      if (name === 'mongoose') return { connect: async () => { if (++attempts === 1 && error) throw error; } };
      if (name === 'node:dns') return { setServers(value) { servers = Array.from(value); } };
      if (name === 'dotenv') return { config() {} };
      throw new Error(name);
    },
  };
  vm.runInNewContext(source, context);
  await context.module.exports();
  return { attempts, servers, exitCode };
}
test('local SRV failure retries once using public DNS', async () => {
  assert.deepEqual(await run('development', { syscall: 'querySrv', code: 'ECONNREFUSED' }),
    { attempts: 2, servers: ['1.1.1.1', '8.8.8.8'], exitCode: undefined });
});
test('production DNS errors do not change resolvers', async () => {
  assert.deepEqual(await run('production', { syscall: 'querySrv', code: 'ECONNREFUSED' }),
    { attempts: 1, servers: undefined, exitCode: 1 });
});
test('successful connections and authentication failures do not change DNS', async () => {
  assert.equal((await run('development')).attempts, 1);
  assert.deepEqual(await run('development', { code: 18 }), { attempts: 1, servers: undefined, exitCode: 1 });
});
