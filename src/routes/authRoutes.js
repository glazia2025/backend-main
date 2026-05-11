const express = require('express');
const { sendWhatsAppOTP, verifyOTP, adminLogin, logout } = require('../controllers/authcontroller');
const isAdmin = require('../middleware/adminMiddleware');

const router = express.Router();

router.post('/send-otp', sendWhatsAppOTP);
router.post('/verify-otp', verifyOTP);
router.post('/logout', logout);

// admin routes ------------------------------------------
router.post('/admin/login', adminLogin);

router.get('/admin/dashboard', isAdmin, (req, res) => {
  res.send('Welcome to the Admin Dashboard!');
});

module.exports = router;
