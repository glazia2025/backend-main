const { extractAuthToken } = require('../utils/authCookies');
const { verifyJwt } = require('../utils/jwt');
const User = require('../models/User');
require('dotenv').config();

const isUser = (req, res, next) => {
  const token = extractAuthToken(req);

  if (!token) {
    return res.status(403).json({ message: 'Access denied, token missing!' });
  }

  try {
    console.log( "token", token);
    // Verify JWT token
    const decoded = verifyJwt(token);

    console.log(decoded);

    // Check if the user is user
    if (!['user', 'admin'].includes(decoded.role)) {
      return res.status(403).json({ message: 'Access denied, user only!' });
    }


    req.user = decoded; // Attach user info to request
    next(); // Proceed to next route handler
  } catch (err) {
    return res.status(400).json({ message: 'Invalid token!' });
  }
};

isUser.withAdminPermission = (permission) => (req, res, next) => {
  isUser(req, res, () => {
    if (req.user.role !== 'admin') return next();
    return User.findOne({ _id: req.user.userId, accountType: 'ADMIN', isActive: { $ne: false } }).select('adminPermissions').lean().then(admin => {
      const permissions = admin?.adminPermissions || [];
      if (!admin || (!permissions.includes('*') && !permissions.includes(permission))) return res.status(403).json({ message: `Access denied. ${permission} permission is required.` });
      req.user.permissions = permissions;
      return next();
    }).catch(() => res.status(500).json({ message: 'Unable to verify admin access.' }));
  });
};

module.exports = isUser;
