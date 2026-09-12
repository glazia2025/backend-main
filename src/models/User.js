const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  gstNumber: { type: String, default: '' },
  pincode: { type: String, default: '' },
  city: { type: String, default: '' },
  state: { type: String, default: '' },
  address: { type: String, default: '' },
  phoneNumber: { type: String, required: true, unique: true }, // This is the primary mobile number for login
  phoneNumbers: { type: [String], default: [] }, // Additional login numbers (includes primary)
  accountType: {
    type: String,
    enum: ['FABRICATOR', 'DEALERSHIP', 'ADMIN'],
    default: 'FABRICATOR',
    index: true
  },
  adminPermissions: {
    type: [String],
    enum: ['*', 'DASHBOARD', 'ORDERS', 'INVENTORY', 'QUOTATIONS', 'USERS', 'STOCK_APPROVALS', 'PRODUCTS', 'BLOGS', 'ADMIN_ACCOUNTS'],
    default: []
  },
  isActive: { type: Boolean, default: true },
  disabledModules: {
    type: [String],
    enum: ['MAIN_SITE', 'QUOTATION_ERP'],
    default: []
  },
  dealership: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  partnerAgreement: {
    type: { type: String, enum: ['GLAZIA_FABRICATOR', 'GLAZIA_DEALERSHIP', 'DEALERSHIP_FABRICATOR'], default: 'GLAZIA_FABRICATOR' },
    accepted: { type: Boolean, default: false },
    acceptedAt: { type: Date, default: null },
    acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    version: { type: String, default: '1.0' }
  },
  paUrl: {type: String, required: false, default: null, unique: true},
  dynamicPricing: {
    type: {
      hardware: {
        type: Map,
        of: Number,
        default: {}
      }, 
      profiles: {
        type: Map,
        of: Number,
        default: {}
      }
    },
    required: false,
    default: () => ({
      hardware: {},
      profiles: {}
    }),
    authorizedPerson: { type: String, required: true, default: '' },
    authorizedPersonDesignation: { type: String, required: true, default: '' }
  }
}, {timestamps: true });

userSchema.index({ phoneNumbers: 1 }, { unique: true });

const User = mongoose.model('User', userSchema);

module.exports = User;
