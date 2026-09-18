const mongoose = require('mongoose');

// A fabricator's manually maintained stock register, independent of order stock.
const fabricatorInventorySchema = new mongoose.Schema({
  fabricator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  productId: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
}, { timestamps: true });

fabricatorInventorySchema.index({ fabricator: 1, productId: 1 }, { unique: true });

module.exports = mongoose.model('FabricatorInventory', fabricatorInventorySchema);
