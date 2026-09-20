const FabricatorInventory = require("../models/FabricatorInventory");

const addDeliveredProductsToFabricatorInventory = async (
  fabricatorId,
  products,
  orderId
) => {
  if (!fabricatorId || !Array.isArray(products) || products.length === 0) {
    return;
  }

  for (const product of products) {
    const productId = String(product.productId || "").trim();
    const description = String(product.description || "").trim();
    const quantity = Number(product.quantity);

    if (!productId || !Number.isSafeInteger(quantity) || quantity <= 0) {
      continue;
    }

    const existingItem = await FabricatorInventory.findOne({
      fabricator: fabricatorId,
      productId,
    });

    if (existingItem) {
      existingItem.quantity += quantity;
      await existingItem.save();
    } else {
      await FabricatorInventory.create({
        fabricator: fabricatorId,
        productId,
        description: description || productId,
        quantity,
        productType: "GLAZIA",
        imageUrl: "",
      });
    }
  }
};

module.exports = {
  addDeliveredProductsToFabricatorInventory,
};