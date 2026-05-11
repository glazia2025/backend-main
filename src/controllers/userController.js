const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const path = require('path');
const User = require('../models/User');
const HardwareOptions = require('../models/Hardware');
const Category = require('../models/Profiles/Category');
const Size = require('../models/Profiles/Size');
const { Nalco } = require('../models/Order');
const { AUTH_COOKIE_MAX_AGE_MS, extractAuthToken, setAuthCookie } = require('../utils/authCookies');
require('dotenv').config();

// Secret for JWT (you should store this in your .env file)
const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key'; // Replace with a more secure secret

const normalizePhoneNumbers = (phoneNumbers, phoneNumber) => {
  const rawNumbers = [];
  if (Array.isArray(phoneNumbers)) {
    rawNumbers.push(...phoneNumbers);
  } else if (typeof phoneNumbers === 'string') {
    rawNumbers.push(phoneNumbers);
  }
  if (phoneNumber) {
    rawNumbers.push(phoneNumber);
  }

  const uniqueNumbers = new Set(
    rawNumbers
      .map((number) => String(number).trim())
      .filter((number) => number.length > 0)
  );

  return Array.from(uniqueNumbers);
};

const findUserByPhoneNumbers = (phoneNumbers, excludeUserId) => {
  const query = {
    $or: [
      { phoneNumber: { $in: phoneNumbers } },
      { phoneNumbers: { $in: phoneNumbers } },
    ],
  };

  if (excludeUserId) {
    query._id = { $ne: excludeUserId };
  }

  return User.findOne(query);
};

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const buildS3PublicUrl = (bucket, region, key) => {
  const baseUrl = process.env.AWS_S3_BASE_URL;
  return `${baseUrl}/${key}`;
};

const normalizeLabels = (labels) => {
  if (!Array.isArray(labels)) {
    return [];
  }
  const uniqueLabels = new Set(
    labels
      .filter((label) => label !== undefined && label !== null)
      .map((label) => String(label).trim())
      .filter((label) => label.length > 0)
  );
  return Array.from(uniqueLabels);
};

const normalizePricingSource = (source) => {
  if (!source) {
    return {};
  }
  if (source instanceof Map) {
    return Object.fromEntries(source);
  }
  return source;
};

const mergePricing = (labels, ...sources) => {
  const merged = {};
  labels.forEach((label) => {
    merged[label] = 0;
  });
  sources.forEach((source) => {
    const normalized = normalizePricingSource(source);
    if (!normalized || typeof normalized !== 'object') {
      return;
    }
    Object.entries(normalized).forEach(([key, value]) => {
      if (value !== undefined) {
        merged[key] = value;
      }
    });
  });
  return merged;
};

const getDynamicPricingLabels = async () => {
  const [hardwareLabels, profileCategories, profileSizes] = await Promise.all([
    HardwareOptions.distinct('subCategory'),
    Category.find({}, { name: 1 }).lean(),
    Size.find({}, { label: 1, categoryId: 1 }).lean(),
  ]);

  const categoryNameById = new Map(
    profileCategories
      .filter((category) => category?.name)
      .map((category) => [String(category._id), category.name])
  );

  const sizeLabels = profileSizes
    .map((size) => {
      const sizeLabel = size?.label ? String(size.label).trim() : '';
      if (!sizeLabel) {
        return null;
      }
      const categoryName = categoryNameById.get(String(size.categoryId));
      return categoryName ? `${categoryName} - ${sizeLabel}` : sizeLabel;
    })
    .filter((label) => label);

  return {
    hardwareLabels: normalizeLabels(hardwareLabels),
    profileLabels: normalizeLabels([
      ...profileCategories.map((category) => category?.name),
      ...sizeLabels,
    ]),
  };
};

const deleteExistingPaFiles = async (bucket, prefix) => {
  let continuationToken;
  do {
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    const keys = (response.Contents || []).map((item) => ({ Key: item.Key }));
    if (keys.length) {
      await s3Client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys, Quiet: true },
        })
      );
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
};

// API to store user data when they log in with mobile number
const createUser = async (req, res) => {
  const {
    name,
    email,
    gstNumber,
    pincode,
    city,
    state,
    address,
    phoneNumber,
    phoneNumbers,
    authorizedPerson,
    authorizedPersonDesignation,
  } = req.body;

  console.log(req.body, req.file, 'Request');

  const normalizedPhoneNumbers = normalizePhoneNumbers(phoneNumbers, phoneNumber);
  const primaryPhoneNumber = normalizedPhoneNumbers[0];

  if (!primaryPhoneNumber) {
    return res.status(400).json({ message: 'At least one phone number is required' });
  }

  // Check if the user already exists
  try {
    const existingUser = await findUserByPhoneNumbers(normalizedPhoneNumbers);
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    let paUrl;
    if (req.file) {
      const bucket = process.env.AWS_S3_BUCKET;
      const region = process.env.AWS_REGION;
      if (!bucket || !region) {
        return res.status(500).json({ message: 'S3 is not configured' });
      }

      const ext = path.extname(req.file.originalname || '').toLowerCase() || '.pdf';
      const objectPrefix = `${primaryPhoneNumber}/`;
      await deleteExistingPaFiles(bucket, objectPrefix);

      const objectKey = `${objectPrefix}${crypto.randomUUID()}${ext}`;
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: req.file.buffer,
          ContentType: req.file.mimetype || 'application/pdf',
          ACL: 'public-read'
        })
      );

      paUrl = buildS3PublicUrl(bucket, region, objectKey);
    }

    const { hardwareLabels, profileLabels } = await getDynamicPricingLabels();
    const dynamicPricing = {
      hardware: mergePricing(hardwareLabels),
      profiles: mergePricing(profileLabels),
    };

    // Create a new user
    const newUser = new User({
      name,
      email,
      gstNumber,
      pincode,
      city,
      state,
      address,
      phoneNumber: primaryPhoneNumber,
      phoneNumbers: normalizedPhoneNumbers,
      authorizedPerson,
      authorizedPersonDesignation,
      paUrl,
      dynamicPricing,
    });

    // Save the new user
    await newUser.save();

    // Generate a JWT token for the new user
    const token = jwt.sign(
      { userId: newUser._id, phoneNumber: primaryPhoneNumber, role: 'user' }, // Include relevant data like userId and role
      JWT_SECRET,
      { expiresIn: '120d' }
    );

    setAuthCookie(req, res, token, AUTH_COOKIE_MAX_AGE_MS);

    // Send the response with the token
    res.status(201).json({
      message: 'User registered successfully',
      user: newUser,
      token, // Include the token in the response
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get User API
const getUser = async (req, res) => {
  const token = extractAuthToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Authorization token is missing or invalid' });
  }

  try {
    // Verify the JWT token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Extract userId from the token payload
    const userId = decoded.userId;

    // Fetch the user details from the database
    const user = await User.findById(userId).select('-password'); // Exclude sensitive fields like password

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { hardwareLabels, profileLabels } = await getDynamicPricingLabels();
    const dynamicPricing = {
      hardware: mergePricing(hardwareLabels, user.dynamicPricing?.hardware),
      profiles: mergePricing(profileLabels, user.dynamicPricing?.profiles),
    };

    const userResponse = user.toObject();
    userResponse.dynamicPricing = dynamicPricing;

    // Send the user data in the response
    res.status(200).json({ user: userResponse });
  } catch (error) {
    console.error('Error verifying token or fetching user:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token has expired. Please log in again.' });
    }
    res.status(500).json({ message: 'Server error' });
  }
};

const updateUser = async (req, res) => {
  const token = extractAuthToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Authorization token is required' });
  }

  try {
    // Verify and decode the JWT
    const decoded = jwt.verify(token, JWT_SECRET);

    // Find the user by ID from the token
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update the user's profile fields
    const { name, email, gstNumber, pincode, city, state, address, phoneNumber, phoneNumbers } = req.body;
    if (name) user.name = name;
    if (email) user.email = email;
    if (gstNumber) user.gstNumber = gstNumber;
    if (pincode) user.pincode = pincode;
    if (city) user.city = city;
    if (state) user.state = state;
    if (address) user.address = address;

    let nextPhoneNumbers = null;
    if (phoneNumbers !== undefined) {
      nextPhoneNumbers = normalizePhoneNumbers(phoneNumbers, phoneNumber);
    } else if (phoneNumber) {
      nextPhoneNumbers = normalizePhoneNumbers([phoneNumber]);
    }

    if (nextPhoneNumbers) {
      if (!nextPhoneNumbers.length) {
        return res.status(400).json({ message: 'At least one phone number is required' });
      }

      const conflictingUser = await findUserByPhoneNumbers(nextPhoneNumbers, user._id);
      if (conflictingUser) {
        return res.status(400).json({ message: 'Phone number already in use' });
      }

      user.phoneNumbers = nextPhoneNumbers;
      user.phoneNumber = nextPhoneNumbers[0];
    }

    // Save the updated user data
    await user.save();

    res.status(200).json({
      message: 'User profile updated successfully',
      user,
    });
  } catch (err) {
    console.error(err);
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }
    res.status(500).json({ message: 'Server error' });
  }
};

const getNalco = async (req, res) => {
  try {
    const nalco = await Nalco.findOne().sort({ date: -1 });

    if (!nalco) {
      return res.status(404).json({ message: 'No data found' });
    }

    res.status(200).json(nalco);
  } catch (error) {
    console.error("Error fetching nalco price:", error);
    res.status(500).json({ message: 'Error fetching nalco price' });
  }
};

const getNalcoGraph = async (req, res) => {
  try {
    const nalco = await Nalco.find({});

    if (!nalco) {
      return res.status(404).json({ message: 'No data found' });
    }

    res.status(200).json(nalco);
  } catch (error) {
    console.error("Error fetching nalco price:", error);
    res.status(500).json({ message: 'Error fetching nalco price' });
  }
};

// Update dynamic pricing for a user (Admin only)
const updateDynamicPricing = async (req, res) => {
  const { userId } = req.params;
  const { hardware, profiles } = req.body;

  if (!userId) {
    return res.status(400).json({ message: 'User ID is required' });
  }

  if (!hardware && !profiles) {
    return res.status(400).json({ message: 'At least one of hardware or profiles pricing data is required' });
  }

  try {
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { hardwareLabels, profileLabels } = await getDynamicPricingLabels();

    // Initialize dynamicPricing if it doesn't exist
    if (!user.dynamicPricing) {
      user.dynamicPricing = {
        hardware: {},
        profiles: {}
      };
    }

    // Update hardware pricing
    if (hardware) {
      if (typeof hardware !== 'object') {
        return res.status(400).json({ message: 'Hardware pricing must be an object' });
      }
      user.dynamicPricing.hardware = mergePricing(
        hardwareLabels,
        user.dynamicPricing.hardware,
        hardware
      );
    } else {
      user.dynamicPricing.hardware = mergePricing(
        hardwareLabels,
        user.dynamicPricing.hardware
      );
    }

    // Update profiles pricing
    if (profiles) {
      if (typeof profiles !== 'object') {
        return res.status(400).json({ message: 'Profiles pricing must be an object' });
      }
      user.dynamicPricing.profiles = mergePricing(
        profileLabels,
        user.dynamicPricing.profiles,
        profiles
      );
    } else {
      user.dynamicPricing.profiles = mergePricing(
        profileLabels,
        user.dynamicPricing.profiles
      );
    }

    await user.save();

    res.status(200).json({
      message: 'Dynamic pricing updated successfully',
      dynamicPricing: user.dynamicPricing
    });
  } catch (error) {
    console.error('Error updating dynamic pricing:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get dynamic pricing for a user
const getDynamicPricing = async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ message: 'User ID is required' });
  }

  try {
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { hardwareLabels, profileLabels } = await getDynamicPricingLabels();
    const dynamicPricing = {
      hardware: mergePricing(hardwareLabels, user.dynamicPricing?.hardware),
      profiles: mergePricing(profileLabels, user.dynamicPricing?.profiles),
    };

    res.status(200).json({
      userId: user._id,
      name: user.name,
      dynamicPricing
    });
  } catch (error) {
    console.error('Error fetching dynamic pricing:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// List all users for admin with basic details and dynamic pricing summary
const listUsers = async (req, res) => {
  try {
    const users = await User.find({}, {
      name: 1,
      email: 1,
      phoneNumber: 1,
      phoneNumbers: 1,
      city: 1,
      state: 1,
      gstNumber: 1,
      dynamicPricing: 1,
      createdAt: 1,
    }).sort({ name: 1 });

    res.status(200).json({ users });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const createTransporter = () => {
  return nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 587,            // TLS port
    secure: false,        // use STARTTLS
    auth: {
      user: process.env.EMAIL_USER,      // your Gmail address
      pass: process.env.EMAIL_PASSWORD,  // Gmail App Password (16 characters)
    }
  });
};

// Send 2FA code via email
const sendContactMail = async (firstName, lastName, email, phoneNumber, company, subject, message) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: 'sales@glazia.in',
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Thank you for contacting Glazia!</h2>
          <p>Name: ${firstName} ${lastName}</p>
          <p>Email: ${email}</p>
          <p>Phone: ${phoneNumber}</p>
          <p>Company: ${company}</p>
          <p>Message:</p>
          <div style="padding: 20px; text-align: center; margin: 20px 0;">
            ${message}
          </div>
        </div>
      `,
    };

    const copyMailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `Copy - ${subject}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Thank you for contacting Glazia!</h2>
          <p>Name: ${firstName} ${lastName}</p>
          <p>Email: ${email}</p>
          <p>Phone: ${phoneNumber}</p>
          <p>Company: ${company}</p>
          <p>Message:</p>
          <div style="padding: 20px; text-align: center; margin: 20px 0;">
            ${message}
          </div>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    const copyInfo = await transporter.sendMail(copyMailOptions);
    console.log('Contact email sent successfully:', info.messageId, copyInfo.messageId);
    return true;
  } catch (error) {
    console.error('Error sending 2FA code:', error);
    return false;
  }
};


module.exports = { createUser, getUser, updateUser, getNalco, getNalcoGraph, updateDynamicPricing, getDynamicPricing, listUsers, sendContactMail };
