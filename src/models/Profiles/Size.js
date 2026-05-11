const mongoose = require("mongoose");

const SizeSchema = new mongoose.Schema(
  {
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
    label: String,
    rate: Number,
    enabled: Boolean
  },
  { timestamps: true }
);

module.exports = mongoose.model("Size", SizeSchema);
