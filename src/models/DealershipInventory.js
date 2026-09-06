const mongoose = require('mongoose');

const dealershipInventorySchema = new mongoose.Schema({
  dealership: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  productId: { type: String, required: true },
  description: { type: String, default: '' },
  quantity: { type: Number, required: true, default: 0, min: 0 },
}, { timestamps: true });

dealershipInventorySchema.index({ dealership: 1, productId: 1 }, { unique: true });

const inventoryMovementSchema = new mongoose.Schema({
  dealership: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  productId: { type: String, required: true },
  quantityChange: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  reason: { type: String, enum: ['DEALER_ORDER_DELIVERED', 'FABRICATOR_ORDER_PLACED', 'ADJUSTMENT'], required: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'UserOrder', default: null },
  notes: { type: String, default: '' },
  adjustedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

const DealershipInventory = mongoose.model('DealershipInventory', dealershipInventorySchema);
const InventoryMovement = mongoose.model('InventoryMovement', inventoryMovementSchema);

module.exports = { DealershipInventory, InventoryMovement };
