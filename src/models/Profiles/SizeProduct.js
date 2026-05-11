const mongoose = require("mongoose");

const SizeProductSchema = new mongoose.Schema(
  {
    sizeId: { type: mongoose.Schema.Types.ObjectId, ref: "Size", required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("SizeProduct", SizeProductSchema);
