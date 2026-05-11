const mongoose = require("mongoose");

const CategorySizeSchema = new mongoose.Schema(
  {
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
    sizeId: { type: mongoose.Schema.Types.ObjectId, ref: "Size", required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("CategorySize", CategorySizeSchema);
