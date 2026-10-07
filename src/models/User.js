const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  ...require('./businessMemberFields'),
  paymentRevision: { type: Number, default: 0 },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  gstNumber: { type: String, default: '' },
  pincode: { type: String, default: '' },
  city: { type: String, default: '' },
  state: { type: String, default: '' },
  address: { type: String, default: '' },
  phoneNumber: { type: String, required: true, unique: true }, // This is the primary mobile number for login
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
  virtualAccount: {
  virtualAccountNo: {
    type: String,
    default: null
  },
  ifscCode: {
    type: String,
    default: null
  },
  beneficiaryName: {
    type: String,
    default: null
  },
  bankName: {
    type: String,
    default: null
  }
},

whitelistedRemitters: [{
  accountName: {
    type: String,
    default: ''
  },
  accountNo: {
    type: String,
    default: ''
  },
  ifscCode: {
    type: String,
    default: ''
  }
}],
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


userSchema.index({ 'members.phoneNumber': 1 }, { unique: true, partialFilterExpression: { 'members.phoneNumber': { $type: 'string' } } });

const User = mongoose.model('User', userSchema);

module.exports = User;
