const { DealershipInventory, InventoryMovement } = require('../models/DealershipInventory');

const aggregateProducts = (products) => {
  const totals = new Map();
  for (const product of products || []) {
    const productId = String(product.productId);
    const current = totals.get(productId) || { productId, description: product.description || '', quantity: 0 };
    current.quantity += Number(product.quantity);
    totals.set(productId, current);
  }
  return [...totals.values()];
};

const consumeStock = async (dealershipId, products, orderId) => {
  const consumed = [];
  for (const product of aggregateProducts(products)) {
    const inventory = await DealershipInventory.findOneAndUpdate(
      { dealership: dealershipId, productId: product.productId, quantity: { $gte: product.quantity } },
      { $inc: { quantity: -product.quantity } },
      { new: true }
    );
    if (!inventory) {
      for (const rollback of consumed) {
        await DealershipInventory.updateOne(
          { dealership: dealershipId, productId: rollback.productId },
          { $inc: { quantity: rollback.quantity } }
        );
      }
      return false;
    }
    consumed.push({ ...product, balanceAfter: inventory.quantity });
  }
  await InventoryMovement.insertMany(consumed.map((product) => ({
    dealership: dealershipId,
    productId: product.productId,
    quantityChange: -product.quantity,
    balanceAfter: product.balanceAfter,
    reason: 'FABRICATOR_ORDER_PLACED',
    order: orderId,
  })));
  return true;
};

const addStock = async (dealershipId, products, orderId) => {
  for (const product of aggregateProducts(products)) {
    const inventory = await DealershipInventory.findOneAndUpdate(
      { dealership: dealershipId, productId: product.productId },
      { $inc: { quantity: product.quantity }, $set: { description: product.description || '' } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    await InventoryMovement.create({
      dealership: dealershipId,
      productId: product.productId,
      quantityChange: product.quantity,
      balanceAfter: inventory.quantity,
      reason: 'DEALER_ORDER_DELIVERED',
      order: orderId,
    });
  }
};

module.exports = { aggregateProducts, consumeStock, addStock };
