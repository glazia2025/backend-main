const mongoose = require('mongoose');
const User = require('../models/User');
const { cleanPermissions } = require('../utils/businessAccess');

exports.list = async (req, res) => {
  res.json({ members: (req.business.members || []).map(member => ({ ...member, permissions: cleanPermissions(member.permissions) })), owner: { name: req.business.name, phoneNumber: req.business.phoneNumber } });
};
exports.save = async (req, res) => {
  try {
    const business = req.business;
    const members = (business.members || []).map(row => ({ ...row, _id: String(row._id) }));
    const memberId = req.params.memberId;
    const index = memberId ? members.findIndex(row => row._id === memberId) : -1;
    if (memberId && index < 0) return res.status(404).json({ message: 'Member not found' });
    if (req.method === 'DELETE') members.splice(index, 1);
    else {
      const phone = String(req.body.phoneNumber || '').trim();
      const name = String(req.body.name || '').trim();
      const role = String(req.body.role || 'Member').trim();
      if (!/^\d{10}$/.test(phone) || !name || name.length > 100 || !role || role.length > 80) {
        return res.status(400).json({ message: 'Enter a name, role and valid 10-digit phone number.' });
      }
      if (phone === business.phoneNumber || members.some(row => row._id !== memberId && row.phoneNumber === phone)) {
        return res.status(409).json({ message: 'This phone number already belongs to this business.' });
      }
      if (await User.exists({ _id: { $ne: business._id }, $or: [{ phoneNumber: phone }, { 'members.phoneNumber': phone }] })) {
        return res.status(409).json({ message: 'This phone number already belongs to another account.' });
      }
      const next = { _id: memberId || String(new mongoose.Types.ObjectId()), name, role, phoneNumber: phone, isActive: req.body.isActive !== false, permissions: cleanPermissions(req.body.permissions) };
      if (index < 0) members.push(next); else members[index] = next;
    }
    const updated = await User.findOneAndUpdate({ _id: business._id, __v: business.__v == null ? { $exists: false } : business.__v }, {
      $set: { members },
      $inc: { __v: 1 },
    }, { new: true, runValidators: true });
    if (!updated) return res.status(409).json({ message: 'Members changed while saving. Reload and try again.' });
    res.json({ members: updated.members });
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 500).json({ message: error.code === 11000 ? 'Phone number is already registered.' : 'Unable to save member.' });
  }
};
