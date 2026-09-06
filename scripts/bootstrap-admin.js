const mongoose = require('mongoose');
const connectDB = require('../src/db');
const User = require('../src/models/User');

const required = name => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

(async () => {
  await connectDB();
  const name = required('ADMIN_NAME');
  const email = required('ADMIN_EMAIL').toLowerCase();
  const phoneNumber = required('ADMIN_PHONE');
  const collision = await User.findOne({ $or: [{ email }, { phoneNumber }, { phoneNumbers: phoneNumber }] });
  if (collision && collision.accountType !== 'ADMIN') throw new Error('That email or phone belongs to a non-admin user. Use an unused phone and email.');
  const admin = await User.findOneAndUpdate(
    { accountType: 'ADMIN', $or: [{ email }, { phoneNumber }] },
    { $set: { name, email, phoneNumber, phoneNumbers: [phoneNumber], accountType: 'ADMIN', adminPermissions: ['*'], isActive: true } },
    { upsert: true, new: true, runValidators: true }
  );
  console.log(`Full-access admin ready: ${admin.name} (${admin.phoneNumber})`);
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
