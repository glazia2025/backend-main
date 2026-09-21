const FabricatorInventory = require("../models/FabricatorInventory");

const addDeliveredProductsToFabricatorInventory = async (
  fabricatorId,
  products,
  orderId,
  session = null
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
    }).session(session);

    if (existingItem) {
      existingItem.quantity += quantity;
      await existingItem.save({ session });
    } else {
      await FabricatorInventory.create([{
        fabricator: fabricatorId,
        productId,
        description: description || productId,
        quantity,
        productType: "GLAZIA",
        imageUrl: "",
      }], { session });
    }
  }
};

module.exports = {
  addDeliveredProductsToFabricatorInventory,
};