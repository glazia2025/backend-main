const twilio = require('twilio');
const Otp = require('../models/Otp');
const axios = require('axios');
const User = require('../models/User');
const TrackPhone = require('../models/TrackPhone');
const { AUTH_COOKIE_MAX_AGE_MS, clearAuthCookie, setAuthCookie } = require('../utils/authCookies');
const { signJwt } = require('../utils/jwt');
require('dotenv').config();

const META_TOKEN = process.env.META_TOKEN;
const META_NUMID = process.env.META_NUMID;

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);


const sendLoginOtp = async (otp, number) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DEV OTP] ${number}: ${otp}`);
    return;
  }
  if (!META_TOKEN || !META_NUMID) {
    const error = new Error('WhatsApp OTP service is not configured on the server.');
    error.code = 'OTP_PROVIDER_NOT_CONFIGURED';
    throw error;
  }
    let data = JSON.stringify({
      "messaging_product": "whatsapp",
      "to": `91${number}`,
      "type": "template",
      "template": {
        "name": "login_otp",
        "language": {
          "code": "en"
        },
        "components": [
          {
            "type": "body",
            "parameters": [
              {
                "type": "text",
                "text": otp
              }
            ]
          },
          {
            "type": "button",
            "sub_type": "url",
            "index": "0",
            "parameters": [
              {
                "type": "text",
                "text": otp
              }
            ]
          }
        ]
      }
    });

    let config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: `https://graph.facebook.com/v22.0/${META_NUMID}/messages`,
      headers: {
        'Authorization': `Bearer ${META_TOKEN}`,
        'Content-Type': 'application/json'
      },
      data: data
    };

    try {
      await axios.request(config);
    } catch (providerError) {
      const error = new Error(providerError.response?.data?.error?.message || 'WhatsApp rejected the OTP delivery request.');
      error.code = 'OTP_DELIVERY_FAILED';
      throw error;
    }
}


const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();
const sendWhatsAppOTP = async (req, res) => {
  const phoneNumber = String(req.body.phoneNumber || '').trim();
  if (!/^\d{10}$/.test(phoneNumber)) return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number.' });
  const otp = generateOtp();

  try {
    await sendLoginOtp(otp, phoneNumber);

    await Otp.findOneAndUpdate(
      { phone: phoneNumber },
      { otp, createdAt: new Date() },
      { upsert: true }
    );

    return res.status(200).json({ message: 'OTP sent successfully' });
  } catch (error) {
    console.error('Error sending OTP:', error);
    const status = error.code === 'OTP_DELIVERY_FAILED' ? 502 : 503;
    return res.status(status).json({ message: error.message || 'OTP service is temporarily unavailable. Please try again later.', code: error.code || 'OTP_SEND_FAILED' });
  }
};

const sendAdminOtp = async (req, res) => {
  const phoneNumber = String(req.body.phoneNumber || '').trim();
  if (!/^\d{10}$/.test(phoneNumber)) return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number.', code: 'INVALID_PHONE_NUMBER' });
  try {
    const account = await User.findOne({ $or: [{ phoneNumber }, { phoneNumbers: phoneNumber }] }).select('accountType isActive');
    if (!account) return res.status(404).json({ message: 'This mobile number is not registered. Ask a full-access administrator to create an admin account for it.', code: 'ADMIN_NOT_FOUND' });
    if (account.accountType !== 'ADMIN') return res.status(403).json({ message: `This number belongs to a ${account.accountType.toLowerCase()} account and cannot sign in to the admin portal. Use a separate admin account number.`, code: 'NOT_AN_ADMIN' });
    if (account.isActive === false) return res.status(403).json({ message: 'This admin account is disabled. Contact a full-access administrator.', code: 'ADMIN_DISABLED' });
    const otp = generateOtp();
    await sendLoginOtp(otp, phoneNumber);
    await Otp.findOneAndUpdate({ phone: phoneNumber }, { otp, createdAt: new Date() }, { upsert: true });
    return res.json({ message: 'OTP sent successfully' });
  } catch (error) {
    console.error('Admin OTP send failed:', error.message);
    const status = error.code === 'OTP_DELIVERY_FAILED' ? 502 : error.code === 'OTP_PROVIDER_NOT_CONFIGURED' ? 503 : 500;
    return res.status(status).json({ message: error.message || 'The OTP could not be sent because of a server error. Please try again.', code: error.code || 'OTP_SEND_FAILED' });
  }
};

const verifyAdminOtp = async (req, res) => {
  const phoneNumber = String(req.body.phoneNumber || '').trim();
  const otp = String(req.body.otp || '').trim();
  if (!/^\d{10}$/.test(phoneNumber)) return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number.', code: 'INVALID_PHONE_NUMBER' });
  if (!/^\d{6}$/.test(otp)) return res.status(400).json({ message: 'Enter the complete 6-digit OTP.', code: 'INVALID_OTP_FORMAT' });
  try {
    const record = await Otp.findOne({ phone: phoneNumber, otp });
    if (!record) return res.status(400).json({ message: 'The OTP is incorrect or has expired. Request a new OTP and try again.', code: 'INVALID_OR_EXPIRED_OTP' });
    const admin = await User.findOne({ accountType: 'ADMIN', isActive: { $ne: false }, $or: [{ phoneNumber }, { phoneNumbers: phoneNumber }] });
    if (!admin) return res.status(403).json({ message: 'This admin account is disabled or no longer exists. Contact a full-access administrator.', code: 'ADMIN_DISABLED' });
    await Otp.deleteOne({ _id: record._id });
    const permissions = admin.adminPermissions || [];
    const token = signJwt({ userId: admin._id, phoneNumber, role: 'admin', permissions, name: admin.name }, { expiresIn: '12h' });
    setAuthCookie(req, res, token, 12 * 60 * 60 * 1000);
    return res.json({ message: 'OTP verified successfully', token, admin: { id: admin._id, name: admin.name, email: admin.email, permissions } });
  } catch (error) {
    console.error('Admin OTP verification failed:', error.message);
    return res.status(500).json({ message: 'The OTP could not be verified because of a server error. Please try again.', code: 'OTP_VERIFY_FAILED' });
  }
};

const getAdminSession = async (req, res) => {
  return res.json({
    admin: {
      id: req.adminAccount._id,
      name: req.adminAccount.name,
      phoneNumber: req.adminAccount.phoneNumber,
      permissions: req.adminAccount.adminPermissions || [],
    },
  });
};

const verifyOTP = async (req, res) => {
  const { phoneNumber, otp } = req.body;

  try {
    const record = await Otp.findOne({ phone: phoneNumber, otp });

    if (record) {
      await Otp.deleteOne({ phone: phoneNumber });
      const existingUser = await User.findOne({
        $or: [{ phoneNumber }, { phoneNumbers: phoneNumber }],
      });

      if (existingUser) {
        const token = signJwt(
          { phoneNumber, userId: existingUser._id, role: 'user' },
          { expiresIn: '120d' }
        );

        setAuthCookie(req, res, token, AUTH_COOKIE_MAX_AGE_MS);

        return res.status(200).json({
          message: 'OTP verified successfully',
          token,
          existingUser,
          userExists: true
        });
      }

      return res.status(200).json({
        message: 'OTP verified successfully',
        userExists: false
      });
    } else {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }
  } catch (error) {
    console.error('Error in verifying OTP:', error);
    return res.status(500).json({ message: 'Server error. Please try again later.' });
  }
};


const trackPhone = async (req, res) => {
  const { phone, reason } = req.body;

  const track = await TrackPhone.findOne({ phone });
  if (track) {
    return res.status(200).json({ message: 'Phone already tracked' });
  }

  try {
    const newTrack = new TrackPhone({
      phone,
      reason,
      status: 'new'
    });

    const savedTrack = await newTrack.save();

    return res.status(200).json({ message: 'Phone tracked successfully' });
  } catch (error) {
    console.error('Error tracking phone:', error);
    return res.status(500).json({ message: 'Server error. Please try again later.' });
  }
};

const listLeads = async (req, res) => {
  try {
    const leads = await TrackPhone.find().sort({ createdAt: -1 });
    return res.status(200).json({ leads });
  } catch (error) {
    console.error('Error fetching leads:', error);
    return res.status(500).json({ message: 'Server error. Please try again later.' });
  }
};

const updateLead = async (req, res) => {
  const { leadId } = req.params;
  const { status, reason } = req.body;

  try {
    const update = {};
    if (typeof status !== "undefined") update.status = status;
    if (typeof reason !== "undefined") update.reason = reason;

    const lead = await TrackPhone.findByIdAndUpdate(leadId, update, {
      new: true,
      runValidators: true,
    });
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    return res.status(200).json({ message: 'Lead updated', lead });
  } catch (error) {
    console.error('Error updating lead:', error);
    return res.status(500).json({ message: 'Server error. Please try again later.' });
  }
};

const deleteLead = async (req, res) => {
  const { leadId } = req.params;

  try {
    const lead = await TrackPhone.findByIdAndDelete(leadId);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    return res.status(200).json({ message: 'Lead deleted' });
  } catch (error) {
    console.error('Error deleting lead:', error);
    return res.status(500).json({ message: 'Server error. Please try again later.' });
  }
};

module.exports = {
  sendWhatsAppOTP,
  verifyOTP,
  sendAdminOtp,
  verifyAdminOtp,
  getAdminSession,
  logout: (req, res) => {
    clearAuthCookie(req, res);
    return res.status(200).json({ message: 'Logged out successfully' });
  },
  trackPhone,
  listLeads,
  updateLead,
  deleteLead,
};
