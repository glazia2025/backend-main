const mongoose = require('mongoose');
const { PaymentAccount, PaymentReceipt, PaymentAttempt } = require('../models/Payment');
const { UserOrder } = require('../models/Order');
const User = require('../models/User');
const provider = require('./paysharpClient');
const { fail, paise, rupees, upiAllowed } = require('../utils/paymentRules');
const { consumeStock } = require('./dealershipInventoryService');

// Local ledger only: UPI customer IDs do not require virtual-account provisioning.
async function ensureLedger(user) {
  try {
    return await PaymentAccount.findOneAndUpdate({ user: user._id },
      { $setOnInsert: { externalCustomerId: String(user._id) } }, { upsert: true, new: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    return PaymentAccount.findOne({ user: user._id });
  }
}

async function ensureAccount(user) {
  let account = await PaymentAccount.findOne({ user: user._id });
  if (account?.virtualAccountNo) return account;
  const id = String(user._id);
  let data;
  try { data = await provider.request('va', 'GET', `/customers/${id}`); }
  catch (error) {
    if (Number(error.providerCode) !== 2001) throw error;
    const mobileNo = String(user.phoneNumber).replace(/\D/g, '').slice(-10);
    if (mobileNo.length !== 10) throw fail('A valid mobile number is required for payments');
    try {
      data = await provider.request('va', 'POST', '/customers', {
        externalCustomerId: id, name: user.name, mobileNo, email: user.email || '', whitelistedRemitters: [],
      });
    } catch (createError) {
      if (Number(createError.providerCode) !== 2002) throw createError;
      data = await provider.request('va', 'GET', `/customers/${id}`);
    }
  }
  if (data.externalCustomerId !== id || !data.virtualAccountNo || !data.ifscCode || !data.beneficiaryName) throw fail('Invalid virtual account response', 502);
  const details = Object.fromEntries(['virtualAccountNo', 'ifscCode', 'beneficiaryName', 'bankName'].map(key => [key, data[key]]));
  try {
    account = await PaymentAccount.findOneAndUpdate({ user: user._id }, { $set: details, $setOnInsert: { externalCustomerId: id } }, { upsert: true, new: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    account = await PaymentAccount.findOne({ user: user._id });
  }
  return account;
}

async function activatePaidOrder(order, session) {
  if (order.paymentStatus !== 'PAID' || order.paymentActivatedAt) return;
  if (order.dealership && String(order.dealership) !== String(order.user.userId)) {
    const result = await consumeStock(order.dealership, order.products, order._id, session);
    order.fulfillment.status = result.fulfilledFromStock ? 'DEALER_STOCK' : 'GLAZIA_VIA_DEALER';
    order.fulfillment.remainingProducts = result.remainingProducts;
    order.fulfillment.decidedAt = new Date();
    order.fulfillment.decidedBy = order.dealership;
    if (result.consumedProducts.length) order.inventoryDisposition = 'CONSUMED_FROM_DEALER_STOCK';
  }
  order.paymentActivatedAt = new Date();
}

// Account revision writes serialize all credits/allocations for a customer.
// The receipt, order balances and inventory movements commit together.
async function allocateCredit(account, session, preferredOrderId) {
  const receipts = await PaymentReceipt.find({ user: account.user, unallocatedPaise: { $gt: 0 } }).sort({ createdAt: 1, _id: 1 }).session(session);
  const orders = await UserOrder.find({ 'user.userId': account.user, paymentProvider: 'PAYSHARP', paymentStatus: { $ne: 'PAID' }, isComplete: false }).sort({ createdAt: 1, _id: 1 }).session(session);
  if (preferredOrderId) orders.sort((a, b) => Number(String(b._id) === String(preferredOrderId)) - Number(String(a._id) === String(preferredOrderId)));
  for (const order of orders) {
    for (const receipt of receipts) {
      const amount = Math.min(receipt.unallocatedPaise, order.totalPaise - order.paidPaise);
      if (amount <= 0) continue;
      receipt.unallocatedPaise -= amount;
      receipt.allocations.push({ order: order._id, amountPaise: amount });
      order.paidPaise += amount;
      order.payments.push({ amount: rupees(amount), depositedAmount: rupees(amount), cycle: order.payments.length + 1,
        isApproved: true, proofAdded: false, provider: 'PAYSHARP', method: receipt.method, reference: receipt.reference, utr: receipt.utr, receivedAt: receipt.receivedAt });
    }
    order.paymentStatus = order.paidPaise >= order.totalPaise ? 'PAID' : order.paidPaise > 0 ? 'PARTIALLY_PAID' : 'AWAITING_PAYMENT';
    await activatePaidOrder(order, session);
    await order.save({ session });
  }
  for (const receipt of receipts) await receipt.save({ session });
  account.creditPaise = receipts.reduce((sum, r) => sum + r.unallocatedPaise, 0);
  await account.save({ session });
}
async function recordReceipt(data, method, attempt) {
  const customerId = method === 'UPI' ? data.customerId : data.externalCustomerId;
  const account = await PaymentAccount.findOne({ externalCustomerId: String(customerId) });
  if (!account) throw fail('Payment account not found', 404);
  if (method === 'BANK_TRANSFER' && data.virtualAccountNo !== account.virtualAccountNo) throw fail('Virtual account mismatch', 409);
  const amount = paise(data.amount);
  if (!amount || !data.paysharpReferenceNo || !data.utrNumber || !Number.isFinite(Date.parse(data.transactionDate))) throw fail('Incomplete payment confirmation', 502);
  if (attempt && (String(attempt.user) !== String(account.user) || amount !== attempt.amountPaise || data.orderId !== String(attempt._id))) throw fail('Payment confirmation does not match the payment request', 409);
  await mongoose.connection.transaction(async session => {
    const locked = await PaymentAccount.findOneAndUpdate({ _id: account._id }, { $inc: { revision: 1 } }, { new: true, session });
    const existing = await PaymentReceipt.findOne({ reference: data.paysharpReferenceNo }).session(session);
    if (existing) {
      if (String(existing.user) !== String(account.user) || existing.amountPaise !== amount || existing.method !== method) throw fail('Conflicting payment reference', 409);
      return;
    }
    await PaymentReceipt.create([{
      reference: data.paysharpReferenceNo, user: account.user, method, amountPaise: amount,
      feePaise: paise(data.totalFee || 0), netPaise: paise(data.netAmount ?? data.amount),
      utr: data.utrNumber, receivedAt: new Date(data.transactionDate), unallocatedPaise: amount,
    }], { session });
    if (attempt) await PaymentAttempt.updateOne({ _id: attempt._id }, { $set: { status: 'SUCCESS', reference: data.paysharpReferenceNo } }, { session });
    await allocateCredit(locked, session, attempt?.order);
  });
}
async function verifyUpi(attempt) {
  const data = await provider.request('upi', 'GET', `/order/${attempt._id}`);
  if (data.orderId !== String(attempt._id) || data.customerId !== String(attempt.user)) throw fail('Payment identity mismatch', 409);
  if (data.status === 'SUCCESS') await recordReceipt(data, 'UPI', attempt);
  else if (['PENDING', 'ON PROGRESS', 'FAILED', 'EXPIRED'].includes(data.status)) {
    await PaymentAttempt.updateOne({ _id: attempt._id, status: { $ne: 'SUCCESS' } }, { $set: { status: data.status } });
  } else throw fail('Unknown payment status', 502);
  return data;
}
async function verifyBank(reference) {
  if (typeof reference !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(reference)) throw fail('Invalid payment reference');
  const data = await provider.request('va', 'GET', `/transactions/${encodeURIComponent(reference)}`);
  if (data.paysharpReferenceNo !== reference) throw fail('Payment reference mismatch', 409);
  await recordReceipt(data, 'BANK_TRANSFER');
}
async function createUpi(order, user, kind = 'qr') {
  if (!['qr', 'intent'].includes(kind)) throw fail('Invalid UPI payment method');
  if (!upiAllowed(order.totalPaise)) throw fail('Orders of ₹1,00,000 or more require bank transfer');
  if (order.totalPaise - order.paidPaise < 100) throw fail('UPI requires at least ₹1 outstanding. Please contact Glazia.');
  if (order.paymentStatus === 'PAID') throw fail('This order is already paid', 409);
  let attempt = await PaymentAttempt.findOne({ order: order._id, active: true });
  if (attempt && ['FAILED', 'EXPIRED'].includes(attempt.status)) {
    await verifyUpi(attempt);
    attempt = await PaymentAttempt.findById(attempt._id);
    if (attempt.status === 'SUCCESS') return attempt;
    if (['FAILED', 'EXPIRED'].includes(attempt.status)) {
      await PaymentAttempt.updateOne({ _id: attempt._id, status: { $in: ['FAILED', 'EXPIRED'] } }, { $set: { active: false } });
      attempt = null;
    }
  }
  if (!attempt) {
    try {
      attempt = await PaymentAttempt.create({ order: order._id, user: user._id, amountPaise: order.totalPaise - order.paidPaise, kind });
    } catch (error) {
      if (error.code !== 11000) throw error;
      attempt = await PaymentAttempt.findOne({ order: order._id, active: true });
    }
  }
  // A durable attempt ID makes retries safe even if the provider response is lost.
  if ((attempt.qrCode || attempt.intentUrl) && !['FAILED', 'EXPIRED', 'SUCCESS'].includes(attempt.status)) return attempt;
  try {
    await verifyUpi(attempt);
    attempt = await PaymentAttempt.findById(attempt._id);
    if (attempt.status === 'SUCCESS') return attempt;
    if (['FAILED', 'EXPIRED'].includes(attempt.status)) throw fail('This UPI request has ended. Please retry the UPI payment.', 409);
    if (attempt.qrCode || attempt.intentUrl) return attempt;
    throw fail('UPI request exists but its QR is unavailable. Please contact Glazia.', 409);
  } catch (error) {
    if (Number(error.providerCode) !== 6002) throw error;
  }
  const data = await provider.request('upi', 'POST', attempt.kind === 'intent' ? '/order/intent' : '/order/qrcode', {
    orderId: String(attempt._id), amount: rupees(attempt.amountPaise), customerId: String(user._id),
    customerName: user.name, customerMobileNo: String(user.phoneNumber).replace(/\D/g, '').slice(-10),
    customerEmail: user.email || '', remarks: `Glazia order ${order.orderId}`.slice(0, 35),
  });
  if (data.orderId !== String(attempt._id) || data.customerId !== String(user._id) || paise(data.amount) !== attempt.amountPaise || (attempt.kind === 'qr' ? !/^data:image\/(png|jpeg);base64,[a-zA-Z0-9+/=]+$/.test(data.qrCode || '') : !/^upi:\/\/pay\?/.test(data.intentUrl || ''))) throw fail('Invalid UPI QR response', 502);
  attempt.qrCode = data.qrCode; attempt.intentUrl = data.intentUrl; attempt.reference = data.paysharpReferenceNo;
  await attempt.save();
  return attempt;
}
const accountView = (account) => ({ virtualAccountNo: account.virtualAccountNo, ifscCode: account.ifscCode, beneficiaryName: account.beneficiaryName, bankName: account.bankName, creditPaise: account.creditPaise });
module.exports = { ensureLedger, ensureAccount, allocateCredit, recordReceipt, verifyUpi, verifyBank, createUpi, accountView };
