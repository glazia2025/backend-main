const mongoose = require('mongoose');

const glaziaInventorySchema = new mongoose.Schema({
  productId: { type: String, required: true, unique: true, index: true, trim: true },
  description: { type: String, required: true, trim: true },
  category: { type: String, enum: ['PROFILE', 'HARDWARE', 'OTHER'], default: 'OTHER' },
  quantity: { type: Number, required: true, min: 0, default: 0 },
  reorderLevel: { type: Number, required: true, min: 0, default: 0 },
  lastRestockedAt: { type: Date, default: null },
}, { timestamps: true });

const glaziaInventoryMovementSchema = new mongoose.Schema({
  inventory: { type: mongoose.Schema.Types.ObjectId, ref: 'GlaziaInventory', default: null },
  productId: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  quantityChange: { type: Number, required: true },
  balanceAfter: { type: Number, required: true, min: 0 },
  action: {
    type: String,
    enum: ['CREATED', 'ADJUSTED', 'DELETED', 'ORDER_FULFILLED', 'RESTOCKED'],
    required: true,
  },
  reason: { type: String, trim: true, default: '' },
  performedBy: { type: String, trim: true, default: 'admin' },
}, { timestamps: true });

const GlaziaInventory = mongoose.model('GlaziaInventory', glaziaInventorySchema);
const GlaziaInventoryMovement = mongoose.model('GlaziaInventoryMovement', glaziaInventoryMovementSchema);

module.exports = { GlaziaInventory, GlaziaInventoryMovement };
