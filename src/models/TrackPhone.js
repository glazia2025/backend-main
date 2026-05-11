const mongoose = require('mongoose');

const trackPhoneSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  reason: { type: String, required: true },
  status: { type: String, enum: ["new", "contacted", "closed"], default: "new" },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('trackPhone', trackPhoneSchema);
