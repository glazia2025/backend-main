const twilio = require('twilio');
const Otp = require('../models/Otp');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const TrackPhone = require('../models/TrackPhone');
const { AUTH_COOKIE_MAX_AGE_MS, clearAuthCookie, setAuthCookie } = require('../utils/authCookies');
require('dotenv').config();

const otpStore = {};

const META_TOKEN = process.env.META_TOKEN;
const META_NUMID = process.env.META_NUMID;

const staticAdmin = {
  username: 'admin',
  password: ''
};

const password = 'admin123';

// Hash the password asynchronously
bcrypt.hash(password, 10, (err, hashedPassword) => {
  if (err) {
    console.error('Error hashing password:', err);
  } else {
    // Now that the password is hashed, create the staticAdmin object

    staticAdmin.password = hashedPassword;
  }
});

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);


const sendLoginOtp = async (otp, number) => {
  try {
    // Logic to send message to users
    console.log("Sending Otp to user:", otp, number);
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

    axios.request(config)
      .then((response) => {
        console.log(JSON.stringify(response.data));
      })
      .catch((error) => {
        console.log(error);
      });

  } catch (error) {
    console.error('Error sending SMS message:', error.data.error);
  }
}


const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();
const sendWhatsAppOTP = async (req, res) => {
  const { phoneNumber } = req.body;
  const otp = generateOtp();

  console.log("otp", otp);

  try {
    sendLoginOtp(otp, phoneNumber);

    await Otp.findOneAndUpdate(
      { phone: phoneNumber },
      { otp, createdAt: new Date() },
      { upsert: true }
    );

    return res.status(200).json({ message: 'OTP sent successfully' });
  } catch (error) {
    console.error('Error sending OTP:', error);
    return res.status(500).json({ message: 'Failed to send OTP' });
  }
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
        const token = jwt.sign(
          { phoneNumber, userId: existingUser._id, role: 'user' },
          process.env.JWT_SECRET || 'secret',
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


const adminLogin = async (req, res) => {
  const { username, password } = req.body;

  if (username !== staticAdmin.username) {
    return res.status(400).json({ message: 'Invalid username' });
  }

  // Compare hashed password
  bcrypt.compare(password, staticAdmin.password, (err, isMatch) => {
    if (err || !isMatch) {
      console.error('Error comparing passwords:', password);
      return res.status(400).json({ message: 'Invalid password' });
    }

    // Create JWT token with role as 'admin'
    console.log("debugge", process.env.JWT_SECRET)
    const token = jwt.sign({ username, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '120d' });

    // Send token as response
    res.status(200).json({ message: 'Login successful', token });
  });
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
  adminLogin,
  logout: (req, res) => {
    clearAuthCookie(req, res);
    return res.status(200).json({ message: 'Logged out successfully' });
  },
  trackPhone,
  listLeads,
  updateLead,
  deleteLead,
};
