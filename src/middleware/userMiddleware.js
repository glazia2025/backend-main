const { extractAuthToken } = require('../utils/authCookies');
const { verifyJwt } = require('../utils/jwt');
const User = require('../models/User');
require('dotenv').config();

const isUser = async (req, res, next) => {
  const token = extractAuthToken(req);

  if (!token) {
    return res.status(403).json({ message: 'Access denied, token missing!' });
  }

  try {
    const decoded = verifyJwt(token);

    // Check if the user is user
    if (!['user', 'admin'].includes(decoded.role)) {
      return res.status(403).json({ message: 'Access denied, user only!' });
    }


    if (decoded.role === 'user') {
      const user = await User.findById(decoded.userId).select('disabledModules').lean();
      if (!user) return res.status(403).json({ message: 'This user account no longer exists.', code: 'USER_NOT_FOUND' });
      if (user.disabledModules?.includes('MAIN_SITE')) {
        return res.status(403).json({ message: 'Your access to the Glazia Main Site has been disabled. Contact Glazia administration.', code: 'MODULE_ACCESS_DISABLED', module: 'MAIN_SITE' });
      }
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

    const configuredSuperAdminEmail = String(process.env.SUPER_ADMIN_EMAIL || '')
      .trim()
      .toLowerCase();
    const tokenEmail = String(req.user.email || '').trim().toLowerCase();
    if (
      req.user.superAdmin === true &&
      configuredSuperAdminEmail &&
      tokenEmail === configuredSuperAdminEmail
    ) {
      req.user.permissions = ['*'];
      return next();
    }

    return User.findOne({ _id: req.user.userId, accountType: 'ADMIN', isActive: { $ne: false } }).select('adminPermissions').lean().then(admin => {
      const permissions = admin?.adminPermissions || [];
      if (!admin || (!permissions.includes('*') && !permissions.includes(permission))) return res.status(403).json({ message: `Access denied. ${permission} permission is required.` });
      req.user.permissions = permissions;
      return next();
    }).catch(() => res.status(500).json({ message: 'Unable to verify admin access.' }));
  });
};

module.exports = isUser;
