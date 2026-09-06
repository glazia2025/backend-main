const mongoose = require('mongoose');

const stockAdjustmentRequestSchema = new mongoose.Schema({
  dealership: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  operation: { type: String, enum: ['ADD', 'EDIT', 'DELETE'], required: true },
  productId: { type: String, required: true, index: true },
  description: { type: String, required: true },
  currentQuantity: { type: Number, default: 0 },
  requestedQuantity: { type: Number, default: null },
  requestReason: { type: String, default: '' },
  status: { type: String, enum: ['PENDING', 'PROCESSING', 'APPROVED', 'REJECTED'], default: 'PENDING', index: true },
  reviewedBy: { type: String, default: null },
  reviewedAt: { type: Date, default: null },
  reviewReason: { type: String, default: '' },
}, { timestamps: true });

stockAdjustmentRequestSchema.index({ dealership: 1, productId: 1, status: 1 });
module.exports = mongoose.model('StockAdjustmentRequest', stockAdjustmentRequestSchema);
