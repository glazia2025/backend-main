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
  const remaining = [];

  for (const product of aggregateProducts(products)) {
    const inventory = await DealershipInventory.findOne({
      dealership: dealershipId,
      productId: product.productId,
    });

    const availableQuantity = Number(inventory?.quantity || 0);
    const orderedQuantity = Number(product.quantity || 0);

    const dealerQuantity = Math.min(
      orderedQuantity,
      availableQuantity
    );

    const remainingQuantity =
      orderedQuantity - dealerQuantity;
    if (dealerQuantity > 0) {
      const updatedInventory = await DealershipInventory.findOneAndUpdate(
        {
          dealership: dealershipId,
          productId: product.productId,
          quantity: { $gte: dealerQuantity },
        },
        {
          $inc: { quantity: -dealerQuantity },
        },
        { new: true }
      );

      if (!updatedInventory) {
        throw new Error(
          `Unable to consume stock for product ${product.productId}`
        );
      }

      consumed.push({
        ...product,
        quantity: dealerQuantity,
        balanceAfter: updatedInventory.quantity,
      });
    }

    if (remainingQuantity > 0) {
      remaining.push({
        ...product,
        quantity: remainingQuantity,
      });
    }
  }

  if (consumed.length > 0) {
    await InventoryMovement.insertMany(
      consumed.map((product) => ({
        dealership: dealershipId,
        productId: product.productId,
        quantityChange: -product.quantity,
        balanceAfter: product.balanceAfter,
        reason: "FABRICATOR_ORDER_PLACED",
        order: orderId,
      }))
    );
  }

  return {
    fulfilledFromStock: remaining.length === 0,
    consumedProducts: consumed,
    remainingProducts: remaining,
  };
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
