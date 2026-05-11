const mongoose = require("mongoose");

const CategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: String,
    enabled: Boolean
  },
  { timestamps: true }
);

module.exports = mongoose.model("Category", CategorySchema);
