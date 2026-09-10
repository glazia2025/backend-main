const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const { Nalco } = require('../models/Order');
const { sendNalcoMessageToUsers } = require('../utils/nalcoWhatsapp');

const Broadcast = mongoose.model('NalcoBroadcast', new mongoose.Schema({
  _id: String, runId: String, state: String, startedAt: Date, finishedAt: Date,
  nalcoPrice: Number, rateDate: Date, requestedBy: String,
  recipients: Number, accepted: Number, failed: Number, message: String,
}));

exports.getStatus = async (_req, res) => {
  try {
    const [rate, broadcast] = await Promise.all([
      Nalco.findOne().sort({ date: -1, _id: -1 }).lean(),
      Broadcast.findById('manual').lean(),
    ]);
    return res.json({ rate, broadcast });
  } catch (_error) {
    return res.status(500).json({ message: 'Unable to load NALCO broadcast status.' });
  }
};

exports.send = async (req, res) => {
  try {
    const rate = await Nalco.findOne().sort({ date: -1, _id: -1 }).lean();
    if (!rate || !Number.isFinite(rate.nalcoPrice) || rate.nalcoPrice <= 0) {
      return res.status(400).json({ message: 'No valid NALCO rate is available in the database.' });
    }
    if (String(rate._id) !== req.body.rateId) {
      return res.status(409).json({ message: 'The latest rate changed. Refresh and confirm the new rate.' });
    }
    if (!process.env.META_TOKEN || !process.env.META_NUMID) {
      return res.status(503).json({ message: 'WhatsApp sender configuration is missing.' });
    }
    const runId = randomUUID();
    let broadcast;
    try {
      broadcast = await Broadcast.findOneAndUpdate(
        { _id: 'manual', state: { $ne: 'running' } },
        { $set: { runId, state: 'running', startedAt: new Date(), finishedAt: null,
          nalcoPrice: rate.nalcoPrice, rateDate: rate.date,
          requestedBy: String(req.user.userId || req.user.email || 'admin'),
          recipients: 0, accepted: 0, failed: 0, message: '' } },
        { upsert: true, new: true }
      );
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ message: 'A manual broadcast is already running. Check its status before retrying.' });
      throw error;
    }
    res.status(202).json({ broadcast });
    // Persist the result independently of the browser/proxy connection.
    setImmediate(async () => {
      try {
        const result = await sendNalcoMessageToUsers(rate.nalcoPrice);
        await Broadcast.updateOne({ _id: 'manual', runId }, { $set: {
          state: 'completed', finishedAt: new Date(), recipients: result.recipients,
          accepted: result.sent, failed: result.failed,
        } });
      } catch (error) {
        console.error('Manual NALCO broadcast failed:', error.message);
        await Broadcast.updateOne({ _id: 'manual', runId }, { $set: {
          state: 'failed', finishedAt: new Date(),
          message: 'Broadcast interrupted. Some requests may have been accepted; check server logs before sending again.',
        } }).catch(() => console.error('Could not persist NALCO broadcast failure'));
      }
    });
  } catch (_error) {
    return res.status(500).json({ message: 'Unable to start NALCO broadcast. Check status before retrying.' });
  }
};
