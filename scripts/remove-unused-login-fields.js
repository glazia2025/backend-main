require('dotenv').config();
const mongoose = require('mongoose');
const { removeUnusedLoginFields } = require('../src/utils/removeUnusedLoginFields');
async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI must be explicitly configured');
  await mongoose.connect(process.env.MONGO_URI);
  console.log(JSON.stringify(await removeUnusedLoginFields(mongoose.connection.collection('users'), { apply: process.argv.includes('--apply') })));
}
main().catch(() => { console.error('Cleanup failed. Check the configured database and index permissions.'); process.exitCode = 1; }).finally(() => mongoose.disconnect());
