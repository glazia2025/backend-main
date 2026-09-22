const mongoose = require('mongoose');
const { Schema } = mongoose;
const accountSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  externalCustomerId: { type: String, required: true, unique: true },
  virtualAccountNo: String, ifscCode: String, beneficiaryName: String, bankName: String,
  creditPaise: { type: Number, default: 0 },
  revision: { type: Number, default: 0 },
}, { timestamps: true });
const receiptSchema = new Schema({
  reference: { type: String, required: true, unique: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  method: { type: String, enum: ['UPI', 'BANK_TRANSFER'], required: true },
  amountPaise: { type: Number, required: true }, feePaise: Number, netPaise: Number,
  utr: String, receivedAt: Date,
  allocations: [{ order: { type: Schema.Types.ObjectId, ref: 'UserOrder' }, amountPaise: Number }],
  unallocatedPaise: { type: Number, required: true },
}, { timestamps: true });
// Separate from UserOrder: unpaid checkouts never appear in orders/admin/fulfillment.
const checkoutSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  checkoutKey: { type: String, required: true },
  checkoutFingerprint: { type: String, required: true },
  orderSnapshot: { type: Schema.Types.Mixed, required: true },
  sourceOrder: { type: Schema.Types.ObjectId, ref: 'UserOrder' },
  status: { type: String, enum: ['PENDING', 'COMPLETED'], default: 'PENDING' },
  completedAt: Date,
}, { timestamps: true });
checkoutSchema.index({ user: 1, checkoutKey: 1 }, { unique: true });
checkoutSchema.index({ sourceOrder: 1, status: 1 });

const attemptSchema = new Schema({
  // Reserved future order ID for pending checkouts; existing orders retain this field.
  order: { type: Schema.Types.ObjectId, ref: 'UserOrder', required: true },
  checkout: { type: Schema.Types.ObjectId, ref: 'PaymentCheckout' },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  amountPaise: { type: Number, required: true },
  active: { type: Boolean, default: true },
  kind: { type: String, enum: ['qr', 'intent'], default: 'qr' }, intentUrl: String,
  status: { type: String, default: 'PENDING' }, reference: String, qrCode: String,
}, { timestamps: true });
attemptSchema.index({ order: 1 }, { unique: true, partialFilterExpression: { active: true } });
module.exports = {
  PaymentCheckout: mongoose.model('PaymentCheckout', checkoutSchema),
  PaymentAccount: mongoose.model('PaymentAccount', accountSchema),
  PaymentReceipt: mongoose.model('PaymentReceipt', receiptSchema),
  PaymentAttempt: mongoose.model('PaymentAttempt', attemptSchema),
};
