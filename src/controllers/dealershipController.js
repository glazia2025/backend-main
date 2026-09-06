const mongoose = require('mongoose');
const User = require('../models/User');
const { UserOrder } = require('../models/Order');
const { DealershipInventory, InventoryMovement } = require('../models/DealershipInventory');
const { uploadPartnerAgreement } = require('./userController');
const StockAdjustmentRequest = require('../models/StockAdjustmentRequest');

const getDealership = async (req, res) => {
  const dealership = await User.findById(req.user.userId);
  if (!dealership || dealership.accountType !== 'DEALERSHIP') {
    res.status(403).json({ message: 'A dealership account is required' });
    return null;
  }
  return dealership;
};

const listFabricators = async (req, res) => {
  try {
    const dealership = await getDealership(req, res);
    if (!dealership) return;
    const fabricators = await User.find({ dealership: dealership._id })
      .select('name email gstNumber phoneNumber phoneNumbers city state address partnerAgreement createdAt')
      .sort({ name: 1 });
    res.json({ fabricators });
  } catch (error) {
    console.error('Error listing dealership fabricators:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const registerFabricator = async (req, res) => {
  try {
    const dealership = await getDealership(req, res);
    if (!dealership) return;
    const required = ['name', 'email', 'gstNumber', 'pincode', 'city', 'state', 'address', 'phoneNumber'];
    const missing = required.find((field) => !String(req.body[field] || '').trim());
    if (missing) return res.status(400).json({ message: `${missing} is required` });
    if (![true, 'true'].includes(req.body.partnerAgreementAccepted)) {
      return res.status(400).json({ message: 'Partner Agreement acceptance is required' });
    }
    const phoneNumber = String(req.body.phoneNumber).trim();
    const exists = await User.findOne({ $or: [{ email: req.body.email }, { phoneNumber }, { phoneNumbers: phoneNumber }] });
    if (exists) return res.status(409).json({ message: 'A user with this email or phone number already exists' });

    const paUrl = await uploadPartnerAgreement(req.file, phoneNumber);
    const fabricator = await User.create({
      name: req.body.name,
      email: req.body.email,
      gstNumber: req.body.gstNumber,
      pincode: req.body.pincode,
      city: req.body.city,
      state: req.body.state,
      address: req.body.address,
      authorizedPerson: req.body.authorizedPerson || '',
      authorizedPersonDesignation: req.body.authorizedPersonDesignation || '',
      phoneNumber,
      phoneNumbers: [phoneNumber],
      accountType: 'FABRICATOR',
      paUrl,
      dealership: dealership._id,
      partnerAgreement: {
        type: 'DEALERSHIP_FABRICATOR',
        accepted: true,
        acceptedAt: new Date(),
        acceptedBy: dealership._id,
        version: process.env.PARTNER_AGREEMENT_VERSION || '1.0',
      },
    });
    res.status(201).json({ message: 'Fabricator registered successfully', fabricator });
  } catch (error) {
    console.error('Error registering fabricator:', error);
    if (error?.code === 11000) return res.status(409).json({ message: 'Email or phone number is already registered' });
    res.status(500).json({ message: 'Server error' });
  }
};

const assignDealership = async (req, res) => {
  try {
    const { dealershipId = null } = req.body;
    if (!mongoose.isValidObjectId(req.params.userId)) return res.status(400).json({ message: 'Invalid user ID' });
    if (dealershipId) {
      if (!mongoose.isValidObjectId(dealershipId)) return res.status(400).json({ message: 'Invalid dealership ID' });
      const dealer = await User.findOne({ _id: dealershipId, accountType: 'DEALERSHIP' });
      if (!dealer) return res.status(404).json({ message: 'Dealership not found' });
    }
    const user = await User.findOneAndUpdate({ _id: req.params.userId, accountType: 'FABRICATOR' }, { dealership: dealershipId }, { new: true });
    if (!user) return res.status(404).json({ message: 'Fabricator not found' });
    res.json({ message: 'Dealership assignment updated', user });
  } catch (error) {
    console.error('Error assigning dealership:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const promoteToDealership = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) return res.status(400).json({ message: 'Invalid user ID' });
    if (![true, 'true'].includes(req.body.partnerAgreementAccepted)) return res.status(400).json({ message: 'Partner Agreement acceptance is required' });
    if (!req.file) return res.status(400).json({ message: 'The signed Glazia–Dealership agreement PDF is required' });
    const user = await User.findOne({ _id: req.params.userId, accountType: 'FABRICATOR' });
    if (!user) return res.status(404).json({ message: 'Fabricator not found or already promoted' });
    const paUrl = await uploadPartnerAgreement(req.file, user.phoneNumber);
    user.accountType = 'DEALERSHIP';
    user.dealership = null;
    user.paUrl = paUrl;
    user.partnerAgreement = {
      type: 'GLAZIA_DEALERSHIP', accepted: true, acceptedAt: new Date(),
      acceptedBy: req.user.userId, version: process.env.PARTNER_AGREEMENT_VERSION || '1.0',
    };
    await user.save();
    return res.json({ message: 'Fabricator promoted to dealership and agreement replaced', user });
  } catch (error) {
    console.error('Error promoting fabricator:', error);
    return res.status(500).json({ message: 'Unable to promote fabricator', error: error.message });
  }
};

const listOrders = async (req, res) => {
  try {
    const dealership = await getDealership(req, res);
    if (!dealership) return;
    const orders = await UserOrder.find({ dealership: dealership._id }).sort({ createdAt: -1 });
    res.json({ orders });
  } catch (error) {
    console.error('Error listing dealership orders:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const getInventory = async (req, res) => {
  try {
    const dealership = await getDealership(req, res);
    if (!dealership) return;
    const [inventory, movements] = await Promise.all([
      DealershipInventory.find({ dealership: dealership._id }).sort({ description: 1, productId: 1 }),
      InventoryMovement.find({ dealership: dealership._id }).sort({ createdAt: -1 }).limit(100),
    ]);
    res.json({ inventory, movements });
  } catch (error) {
    console.error('Error listing dealership inventory:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const listAdjustmentRequests = async (req, res) => {
  try {
    const dealership = await getDealership(req, res);
    if (!dealership) return;
    const requests = await StockAdjustmentRequest.find({ dealership: dealership._id }).sort({ createdAt: -1 }).limit(100);
    res.json({ requests });
  } catch (error) {
    console.error('Error listing stock adjustment requests:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const ensureNoPendingRequest = async (dealershipId, productId) => {
  const pending = await StockAdjustmentRequest.exists({ dealership: dealershipId, productId, status: 'PENDING' });
  if (pending) { const error = new Error('A stock request for this product is already pending'); error.statusCode = 409; throw error; }
};

const adjustInventory = async (req, res) => {
  try {
    const dealership = await getDealership(req, res);
    if (!dealership) return;
    const quantity = Number(req.body.quantity);
    if (!Number.isInteger(quantity) || quantity < 0) {
      return res.status(400).json({ message: 'Quantity must be a whole number of zero or more' });
    }
    const productId = String(req.params.productId || '').trim();
    if (!productId) return res.status(400).json({ message: 'Product ID is required' });
    const inventory = await DealershipInventory.findOne({ dealership: dealership._id, productId });
    if (!inventory) return res.status(404).json({ message: 'Stock item not found' });
    await ensureNoPendingRequest(dealership._id, productId);
    const request = await StockAdjustmentRequest.create({ dealership: dealership._id, operation: 'EDIT', productId, description: inventory.description, currentQuantity: inventory.quantity, requestedQuantity: quantity, requestReason: String(req.body.notes || '').trim() });
    res.status(202).json({ message: 'Stock edit submitted for Glazia approval', request });
  } catch (error) {
    console.error('Error adjusting dealership inventory:', error);
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Server error' });
  }
};

const createInventoryItem = async (req, res) => {
  try {
    const dealership = await getDealership(req, res);
    if (!dealership) return;
    const productId = String(req.body.productId || '').trim();
    const description = String(req.body.description || '').trim();
    const quantity = Number(req.body.quantity);
    if (!productId || !description) return res.status(400).json({ message: 'Product code and name are required' });
    if (!Number.isInteger(quantity) || quantity < 0) return res.status(400).json({ message: 'Quantity must be a whole number of zero or more' });
    const exists = await DealershipInventory.exists({ dealership: dealership._id, productId });
    if (exists) return res.status(409).json({ message: 'This product already exists in stock; edit its quantity instead' });
    await ensureNoPendingRequest(dealership._id, productId);
    const request = await StockAdjustmentRequest.create({ dealership: dealership._id, operation: 'ADD', productId, description, currentQuantity: 0, requestedQuantity: quantity, requestReason: String(req.body.notes || '').trim() });
    res.status(202).json({ message: 'New stock item submitted for Glazia approval', request });
  } catch (error) {
    console.error('Error creating dealership inventory:', error);
    if (error?.code === 11000) return res.status(409).json({ message: 'This product already exists in stock' });
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Server error' });
  }
};

const deleteInventoryItem = async (req, res) => {
  try {
    const dealership = await getDealership(req, res);
    if (!dealership) return;
    const productId = String(req.params.productId || '').trim();
    const inventory = await DealershipInventory.findOne({ dealership: dealership._id, productId });
    if (!inventory) return res.status(404).json({ message: 'Stock item not found' });
    await ensureNoPendingRequest(dealership._id, productId);
    const request = await StockAdjustmentRequest.create({ dealership: dealership._id, operation: 'DELETE', productId, description: inventory.description, currentQuantity: inventory.quantity, requestedQuantity: 0, requestReason: String(req.body?.notes || '').trim() });
    res.status(202).json({ message: 'Stock deletion submitted for Glazia approval', request });
  } catch (error) {
    console.error('Error deleting dealership inventory:', error);
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Server error' });
  }
};

const decideFulfillment = async (req, res) => {
  try {
    const dealership = await getDealership(req, res);
    if (!dealership) return;
    const { strategy, notes = '' } = req.body;
    if (!['DEALER_STOCK', 'GLAZIA_VIA_DEALER'].includes(strategy)) {
      return res.status(400).json({ message: 'Select dealer stock or Glazia supply' });
    }
    if (!mongoose.isValidObjectId(req.params.orderId)) return res.status(400).json({ message: 'Invalid order ID' });
    const order = await UserOrder.findOneAndUpdate(
      { _id: req.params.orderId, dealership: dealership._id, 'fulfillment.status': 'AWAITING_DEALER' },
      { $set: { 'fulfillment.status': strategy, 'fulfillment.notes': String(notes).trim(), 'fulfillment.decidedAt': new Date(), 'fulfillment.decidedBy': dealership._id } },
      { new: true }
    );
    if (!order) return res.status(404).json({ message: 'Pending dealership order not found' });
    res.json({ message: strategy === 'DEALER_STOCK' ? 'Order marked for dealer dispatch' : 'Supply requested from Glazia through dealership', order });
  } catch (error) {
    console.error('Error deciding fulfillment:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { listFabricators, registerFabricator, listOrders, getInventory, listAdjustmentRequests, createInventoryItem, adjustInventory, deleteInventoryItem, decideFulfillment, assignDealership, promoteToDealership };
