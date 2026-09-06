const User = require('../models/User');

const ADMIN_PERMISSIONS = ['DASHBOARD', 'ORDERS', 'INVENTORY', 'QUOTATIONS', 'USERS', 'STOCK_APPROVALS', 'PRODUCTS', 'BLOGS', 'ADMIN_ACCOUNTS'];
const cleanPermissions = (values) => [...new Set((Array.isArray(values) ? values : []).filter(value => ADMIN_PERMISSIONS.includes(value)))];

exports.listAdminAccounts = async (_req, res) => {
  const admins = await User.find({ accountType: 'ADMIN' }).select('name email phoneNumber adminPermissions isActive createdAt updatedAt').sort({ createdAt: -1 }).lean();
  return res.json({ admins, availablePermissions: ADMIN_PERMISSIONS });
};

exports.createAdminAccount = async (req, res) => {
  try {
    const { name, email, phoneNumber } = req.body;
    if (!name?.trim() || !email?.trim() || !phoneNumber?.trim()) return res.status(400).json({ message: 'Name, email and phone number are required.' });
    const admin = await User.create({
      name: name.trim(), email: email.trim().toLowerCase(), phoneNumber: phoneNumber.trim(),
      phoneNumbers: [phoneNumber.trim()], accountType: 'ADMIN', adminPermissions: cleanPermissions(req.body.permissions), isActive: true,
    });
    return res.status(201).json({ message: 'Admin account created', admin });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'An account already uses this email or phone number.' });
    return res.status(500).json({ message: 'Unable to create admin account', error: error.message });
  }
};

exports.updateAdminAccount = async (req, res) => {
  try {
    const update = {};
    if (req.body.name !== undefined) update.name = String(req.body.name).trim();
    if (req.body.email !== undefined) update.email = String(req.body.email).trim().toLowerCase();
    if (req.body.permissions !== undefined) update.adminPermissions = cleanPermissions(req.body.permissions);
    if (req.body.isActive !== undefined) update.isActive = Boolean(req.body.isActive);
    const admin = await User.findOneAndUpdate({ _id: req.params.adminId, accountType: 'ADMIN' }, update, { new: true, runValidators: true });
    if (!admin) return res.status(404).json({ message: 'Admin account not found' });
    return res.json({ message: 'Admin account updated', admin });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to update admin account', error: error.message });
  }
};

exports.ADMIN_PERMISSIONS = ADMIN_PERMISSIONS;
