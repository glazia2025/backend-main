const mongoose = require('mongoose');
const nalcoBroadcastSchema = new mongoose.Schema({
  _id: String, runId: String, state: String, startedAt: Date, finishedAt: Date,
  nalcoPrice: Number, rateDate: Date, requestedBy: String, phase: String,
  recipients: Number, accepted: Number, failed: Number, message: String,
});

const NalcoBroadcast =
  mongoose.models.NalcoBroadcast || mongoose.model('NalcoBroadcast', nalcoBroadcastSchema);

module.exports = { NalcoBroadcast };