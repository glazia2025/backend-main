const { extractAuthToken } = require('../utils/authCookies');
const { verifyJwt } = require('../utils/jwt');
const User = require('../models/User');
require('dotenv').config();

const isAdmin = async (req, res, next) => {
  const token = extractAuthToken(req);

  if (!token) {
    return res.status(403).json({ message: 'Access denied, token missing!' });
  }

  try {
    // Verify JWT token
    const decoded = verifyJwt(token);

    // Check if the user is admin
    if (decoded.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied, admin only!' });
    }

    if (decoded.superAdmin === true && decoded.email && decoded.email === String(process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase()) {
      req.user = { ...decoded, permissions: ['*'] };
      req.adminAccount = { _id: null, name: decoded.name || 'Super Admin', email: decoded.email, phoneNumber: null, adminPermissions: ['*'], superAdmin: true };
      return next();
    }

    const admin = decoded.userId ? await User.findOne({ _id: decoded.userId, accountType: 'ADMIN', isActive: { $ne: false } }).select('adminPermissions name phoneNumber') : null;
    if (!admin) return res.status(403).json({ message: 'Admin account is disabled or no longer exists.' });
    req.user = { ...decoded, permissions: admin.adminPermissions || [] };
    req.adminAccount = admin;
    next(); // Proceed to next route handler
  } catch (err) {
    return res.status(400).json({ message: 'Invalid token!' });
  }
};

isAdmin.withPermission = (permission) => (req, res, next) => {
  isAdmin(req, res, () => {
    const permissions = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    if (!permissions.includes('*') && !permissions.includes(permission)) {
      return res.status(403).json({ message: `Access denied. ${permission} permission is required.` });
    }
    return next();
  });
};

module.exports = isAdmin;
