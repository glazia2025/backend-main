const FabricatorInventory = require('../models/FabricatorInventory');
const User = require('../models/User');

// Always derive ownership from the authenticated account, never request input.
exports.requireFabricator = async (req, res, next) => {
  try {
    if (req.user?.role !== 'user' || !req.user.userId) {
      return res.status(403).json({ message: 'A fabricator account is required' });
    }
    const user = await User.findOne({
      _id: req.user.userId, accountType: 'FABRICATOR', isActive: { $ne: false },
    }).select('_id disabledModules').lean();
    if (!user || user.disabledModules?.includes('MAIN_SITE')) {
      return res.status(403).json({ message: 'An active fabricator account with main-site access is required' });
    }
    req.fabricatorId = user._id;
    return next();
  } catch (_error) {
    return res.status(500).json({ message: 'Unable to verify fabricator access' });
  }
};

const quantityIsValid = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const productCode = req => typeof req.params.productId === 'string' ? req.params.productId.trim() : '';

exports.listInventory = async (req, res) => {
  try {
    const inventory = await FabricatorInventory.find({ fabricator: req.fabricatorId })
      .sort({ description: 1, productId: 1 }).lean();
    return res.json({ inventory });
  } catch (_error) {
    return res.status(500).json({ message: 'Unable to load your inventory' });
  }
};

exports.createInventoryItem = async (req, res) => {
  const { productId, description, quantity } = req.body || {};
  if (typeof productId !== 'string' || !productId.trim() ||
      typeof description !== 'string' || !description.trim() || !quantityIsValid(quantity)) {
    return res.status(400).json({ message: 'Product code, description and a non-negative whole quantity are required' });
  }
  try {
    const item = await FabricatorInventory.create({
      fabricator: req.fabricatorId, productId: productId.trim(), description: description.trim(), quantity,
    });
    return res.status(201).json({ message: 'Stock item added', item });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'This product is already in your inventory; edit its quantity instead' });
    return res.status(500).json({ message: 'Unable to add stock item' });
  }
};

exports.updateInventoryItem = async (req, res) => {
  const productId = productCode(req);
  const { quantity } = req.body || {};
  if (!productId || !quantityIsValid(quantity)) {
    return res.status(400).json({ message: 'Product code and a non-negative whole quantity are required' });
  }
  try {
    const item = await FabricatorInventory.findOneAndUpdate(
      { fabricator: req.fabricatorId, productId },
      { $set: { quantity } },
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ message: 'Stock item not found' });
    return res.json({ message: 'Stock quantity updated', item });
  } catch (_error) {
    return res.status(500).json({ message: 'Unable to update stock item' });
  }
};

exports.deleteInventoryItem = async (req, res) => {
  const productId = productCode(req);
  if (!productId) return res.status(400).json({ message: 'Product code is required' });
  try {
    const item = await FabricatorInventory.findOneAndDelete({ fabricator: req.fabricatorId, productId });
    if (!item) return res.status(404).json({ message: 'Stock item not found' });
    return res.json({ message: 'Stock item deleted' });
  } catch (_error) {
    return res.status(500).json({ message: 'Unable to delete stock item' });
  }
};
