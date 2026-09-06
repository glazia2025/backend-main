const mongoose = require('mongoose');
const StockAdjustmentRequest = require('../models/StockAdjustmentRequest');
const { DealershipInventory, InventoryMovement } = require('../models/DealershipInventory');

const listRequests = async (req, res) => {
  try {
    const status = req.query.status;
    const query = status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status) ? { status } : {};
    const requests = await StockAdjustmentRequest.find(query).populate('dealership', 'name email phoneNumber city state').sort({ createdAt: -1 }).limit(250);
    res.json({ requests });
  } catch (error) { console.error('Error listing stock requests:', error); res.status(500).json({ message: 'Server error' }); }
};

const reviewRequest = async (req, res) => {
  const { decision, reason = '' } = req.body;
  if (!mongoose.isValidObjectId(req.params.requestId)) return res.status(400).json({ message: 'Invalid request ID' });
  if (!['APPROVED', 'REJECTED'].includes(decision)) return res.status(400).json({ message: 'Decision must be APPROVED or REJECTED' });
  if (decision === 'REJECTED' && !String(reason).trim()) return res.status(400).json({ message: 'A rejection reason is required' });
  try {
    if (decision === 'REJECTED') {
      const request = await StockAdjustmentRequest.findOneAndUpdate({ _id: req.params.requestId, status: 'PENDING' }, { status: 'REJECTED', reviewReason: String(reason).trim(), reviewedAt: new Date(), reviewedBy: req.user.username || 'admin' }, { new: true });
      if (!request) return res.status(409).json({ message: 'Request is no longer pending' });
      return res.json({ message: 'Stock request rejected', request });
    }

    const request = await StockAdjustmentRequest.findOneAndUpdate({ _id: req.params.requestId, status: 'PENDING' }, { status: 'PROCESSING' }, { new: true });
    if (!request) return res.status(409).json({ message: 'Request is no longer pending' });
    try {
      let quantityChange = 0;
      let balanceAfter = 0;
      if (request.operation === 'ADD') {
        const exists = await DealershipInventory.exists({ dealership: request.dealership, productId: request.productId });
        if (exists) throw new Error('Product already exists in dealership stock');
        balanceAfter = request.requestedQuantity;
        quantityChange = balanceAfter;
        await DealershipInventory.create({ dealership: request.dealership, productId: request.productId, description: request.description, quantity: balanceAfter });
      } else {
        const inventory = await DealershipInventory.findOne({ dealership: request.dealership, productId: request.productId });
        if (!inventory) throw new Error('Stock item no longer exists');
        quantityChange = request.operation === 'DELETE' ? -inventory.quantity : request.requestedQuantity - inventory.quantity;
        balanceAfter = request.operation === 'DELETE' ? 0 : request.requestedQuantity;
        if (request.operation === 'DELETE') await inventory.deleteOne();
        else { inventory.quantity = balanceAfter; await inventory.save(); }
      }
      await InventoryMovement.create({ dealership: request.dealership, productId: request.productId, quantityChange, balanceAfter, reason: 'ADJUSTMENT', notes: `Approved stock ${request.operation.toLowerCase()} request`, adjustedBy: request.dealership });
      request.status = 'APPROVED'; request.reviewReason = String(reason).trim(); request.reviewedAt = new Date(); request.reviewedBy = req.user.username || 'admin'; await request.save();
      res.json({ message: 'Stock request approved and inventory updated', request });
    } catch (error) {
      request.status = 'PENDING'; await request.save(); throw error;
    }
  } catch (error) { console.error('Error reviewing stock request:', error); res.status(409).json({ message: error.message || 'Unable to review request' }); }
};

module.exports = { listRequests, reviewRequest };
