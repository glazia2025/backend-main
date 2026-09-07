const express = require('express');
const { sendWhatsAppOTP, verifyOTP, sendAdminOtp, verifyAdminOtp, loginSuperAdmin, getAdminSession, logout } = require('../controllers/authcontroller');
const isAdmin = require('../middleware/adminMiddleware');

const router = express.Router();

router.post('/send-otp', sendWhatsAppOTP);
router.post('/verify-otp', verifyOTP);
router.post('/logout', logout);

// admin routes ------------------------------------------
router.post('/admin/send-otp', sendAdminOtp);
router.post('/admin/verify-otp', verifyAdminOtp);
router.post('/admin/super-login', loginSuperAdmin);
router.get('/admin/session', isAdmin, getAdminSession);

router.get('/admin/dashboard', isAdmin, (req, res) => {
  res.send('Welcome to the Admin Dashboard!');
});

module.exports = router;
