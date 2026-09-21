const mongoose = require('mongoose');
const User = require('../models/User');
const { addDeliveredProductsToFabricatorInventory } = require('./fabricatorInventoryService');
const { UserOrder } = require('../models/Order');
const { consumeStock, addStock } = require('./dealershipInventoryService');
const { fail } = require('../utils/paymentRules');
async function completePaidOrder(id, documents) {
  let result;
  await mongoose.connection.transaction(async session => {
    const order = await UserOrder.findById(id).session(session);
    if (!order || order.isComplete) throw fail('Order is already complete or no longer exists', 409);
    if (order.paymentStatus !== 'PAID' || order.paidPaise < order.totalPaise) throw fail('Full payment must be received before completion', 409);
    if (!documents.driverInfo?.name || !documents.driverInfo?.phone) throw fail('Driver name and phone are required');
    if (order.fulfillment.status === 'GLAZIA_VIA_DEALER' && order.fulfillment.remainingProducts?.length) {
      const upstream = order.upstreamOrder ? await UserOrder.findById(order.upstreamOrder).session(session) : null;
      if (!upstream?.isComplete) throw fail('The Glazia shortage order must be delivered first', 409);
      const stock = await consumeStock(order.dealership, order.fulfillment.remainingProducts, order._id, session);
      if (!stock.fulfilledFromStock) throw fail('Shortage items are not fully available in dealer stock', 409);
      order.fulfillment.remainingProducts = [];
      order.fulfillment.status = 'DEALER_STOCK';
      order.inventoryProcessedAt = new Date();
    }
    if (order.inventoryDisposition === 'ADD_TO_DEALER_STOCK' && !order.inventoryProcessedAt) {
      await addStock(order.dealership || order.user.userId, order.products, order._id, session);
      order.inventoryProcessedAt = new Date();
    }
    const fabricator = await User.findOne({ _id: order.user.userId, accountType: 'FABRICATOR' }).session(session);
    if (fabricator && !order.fabricatorInventoryProcessedAt) {
      await addDeliveredProductsToFabricatorInventory(fabricator._id, order.products, order._id, session);
      order.fabricatorInventoryProcessedAt = new Date();
    }
    for (const key of ['biltyDoc', 'eWayBill', 'taxInvoice', 'driverInfo']) order[key] = documents[key];
    order.isComplete = true; order.completedAt = new Date();
    await order.save({ session }); result = order;
  });
  return result;
}
module.exports = { completePaidOrder };
