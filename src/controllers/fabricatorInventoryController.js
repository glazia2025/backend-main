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

const productCode = (req) => {
  const value = req.params?.productId;

  return typeof value === 'string' ? value.trim() : '';
};

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
  const { productId, description, quantity: rawQuantity, productType } = req.body || {};
  const quantity =
    typeof rawQuantity === 'string'
      ? Number(rawQuantity)
      : rawQuantity;

  if (
    typeof productId !== 'string' ||
    !productId.trim() ||
    typeof description !== 'string' ||
    !description.trim() ||
    !quantityIsValid(quantity)
  ) {
    return res.status(400).json({
      message:
        'Product code, description and a non-negative whole quantity are required',
    });
  }

  const type = productType === 'OTHER' ? 'OTHER' : 'GLAZIA';

  if (type === 'OTHER' && !req.file) {
    return res.status(400).json({
      message: 'Image is required for other products',
    });
  }

  try {
    let imageUrl = '';

    if (type === 'OTHER') {
      const { uploadInventoryImage } = require('./userController');

      imageUrl = await uploadInventoryImage(
        req.file,
        req.fabricatorId.toString()
      );
    }

    const item = await FabricatorInventory.create({
      fabricator: req.fabricatorId,
      productId: productId.trim(),
      description: description.trim(),
      quantity,
      productType: type,
      imageUrl,
    });

    return res.status(201).json({
      message: 'Stock item added',
      item,
    });
  } catch (error) {
    console.error('CREATE INVENTORY ERROR:', error);
    if (error.code === 11000) {
      return res.status(409).json({
        message:
          'This product is already in your inventory; edit its quantity instead',
      });
    }

    return res.status(500).json({
      message: 'Unable to add stock item',
    });
  }
};

exports.updateInventoryItem = async (req, res) => {
  const productId = productCode(req);
  const { quantity: rawQuantity } = req.body || {};

  const quantity =
    typeof rawQuantity === 'string'
      ? Number(rawQuantity)
      : rawQuantity;

  if (!productId || !quantityIsValid(quantity)) {
    return res.status(400).json({
      message:
        'Product code and a non-negative whole quantity are required',
    });
  }

  try {
    const existingItem = await FabricatorInventory.findOne({
      fabricator: req.fabricatorId,
      productId,
    });

    if (!existingItem) {
      return res.status(404).json({
        message: 'Stock item not found',
      });
    }

    const updateData = {
      quantity,
    };

    if (existingItem.productType === 'OTHER' && req.file) {
      const { uploadInventoryImage } = require('./userController');

      updateData.imageUrl = await uploadInventoryImage(
        req.file,
        req.fabricatorId.toString()
      );
    }

    const item = await FabricatorInventory.findOneAndUpdate(
      {
        fabricator: req.fabricatorId,
        productId,
      },
      {
        $set: updateData,
      },
      {
        new: true,
        runValidators: true,
      }
    );

    return res.json({
      message: 'Stock item updated',
      item,
    });
  } catch (error) {
    console.error('UPDATE INVENTORY ERROR:', error);

    return res.status(500).json({
      message: 'Unable to update stock item',
    });
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
