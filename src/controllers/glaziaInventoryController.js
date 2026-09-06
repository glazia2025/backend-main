const { GlaziaInventory, GlaziaInventoryMovement } = require('../models/GlaziaInventory');

const actor = (req) => req.user?.username || req.user?.email || 'admin';
const wholeNumber = (value, fallback) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

exports.listInventory = async (_req, res) => {
  try {
    const inventory = await GlaziaInventory.find().sort({ description: 1 }).lean();
    const summary = inventory.reduce((result, item) => {
      result.totalSkus += 1;
      result.totalUnits += item.quantity;
      if (item.quantity === 0) result.outOfStock += 1;
      if (item.quantity <= item.reorderLevel) result.lowStock += 1;
      return result;
    }, { totalSkus: 0, totalUnits: 0, lowStock: 0, outOfStock: 0 });
    return res.json({ inventory, summary });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load inventory', error: error.message });
  }
};

exports.listMovements = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const movements = await GlaziaInventoryMovement.find().sort({ createdAt: -1 }).limit(limit).lean();
    return res.json({ movements });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load inventory history', error: error.message });
  }
};

exports.createInventoryItem = async (req, res) => {
  try {
    const { productId, description, category = 'OTHER', reason = '' } = req.body;
    const quantity = wholeNumber(req.body.quantity, 0);
    const reorderLevel = wholeNumber(req.body.reorderLevel, 0);
    if (!productId?.trim() || !description?.trim() || quantity === null || reorderLevel === null) {
      return res.status(400).json({ message: 'Product, description, quantity and reorder level are required; quantities must be whole numbers.' });
    }
    const item = await GlaziaInventory.create({
      productId: productId.trim(), description: description.trim(), category, quantity, reorderLevel,
      lastRestockedAt: quantity > 0 ? new Date() : null,
    });
    await GlaziaInventoryMovement.create({
      inventory: item._id, productId: item.productId, description: item.description,
      quantityChange: quantity, balanceAfter: quantity, action: 'CREATED', reason, performedBy: actor(req),
    });
    return res.status(201).json({ message: 'Inventory item added', item });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'This product is already in inventory.' });
    return res.status(500).json({ message: 'Unable to add inventory item', error: error.message });
  }
};

exports.updateInventoryItem = async (req, res) => {
  try {
    const item = await GlaziaInventory.findById(req.params.inventoryId);
    if (!item) return res.status(404).json({ message: 'Inventory item not found' });
    const quantity = wholeNumber(req.body.quantity, item.quantity);
    const reorderLevel = wholeNumber(req.body.reorderLevel, item.reorderLevel);
    if (quantity === null || reorderLevel === null) {
      return res.status(400).json({ message: 'Quantity and reorder level must be non-negative whole numbers.' });
    }
    const previousQuantity = item.quantity;
    item.quantity = quantity;
    item.reorderLevel = reorderLevel;
    if (quantity > previousQuantity) item.lastRestockedAt = new Date();
    await item.save();
    if (quantity !== previousQuantity) {
      await GlaziaInventoryMovement.create({
        inventory: item._id, productId: item.productId, description: item.description,
        quantityChange: quantity - previousQuantity, balanceAfter: quantity,
        action: quantity > previousQuantity ? 'RESTOCKED' : 'ADJUSTED',
        reason: req.body.reason || '', performedBy: actor(req),
      });
    }
    return res.json({ message: 'Inventory item updated', item });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to update inventory item', error: error.message });
  }
};

exports.deleteInventoryItem = async (req, res) => {
  try {
    const item = await GlaziaInventory.findByIdAndDelete(req.params.inventoryId);
    if (!item) return res.status(404).json({ message: 'Inventory item not found' });
    await GlaziaInventoryMovement.create({
      inventory: null, productId: item.productId, description: item.description,
      quantityChange: -item.quantity, balanceAfter: 0, action: 'DELETED',
      reason: req.body.reason || '', performedBy: actor(req),
    });
    return res.json({ message: 'Inventory item deleted' });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to delete inventory item', error: error.message });
  }
};
