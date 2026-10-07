const mongoose = require('mongoose');
const crypto = require('crypto');
const User = require('../models/User');
const { UserOrder } = require('../models/Order');
const { PaymentAccount, PaymentReceipt, PaymentAttempt, PaymentCheckout } = require('../models/Payment');
const payments = require('../services/paymentService');
const { priceOrder } = require('../services/orderPricingService');
const { extractAuthToken } = require('../utils/authCookies');
const { paysharpEnabled } = require('../utils/paymentRollout');
const { consumeStock } = require('../services/dealershipInventoryService');
const { fail, rupees, upiAllowed } = require('../utils/paymentRules');
const wrap = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (error) {
    console.error('Payment operation failed:', error.status || 500, error.providerCode || error.name);
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Unable to process payment. Please retry.' });
  }
};
const visibleAccount = (account, access) => {
  if (!account) return null;
  const view = payments.accountView(account);
  if (!access?.isOwner) delete view.creditPaise;
  return view;
};
const buyer = async req => {
  const user = await User.findOne({ _id: req.user.userId, accountType: { $in: ['FABRICATOR', 'DEALERSHIP'] }, isActive: { $ne: false } }).lean();
  if (!user) throw fail('An active fabricator or dealership account is required', 403);
  return user;
};
const ownedOrder = async req => {
  if (!mongoose.isValidObjectId(req.params.orderId)) throw fail('Invalid order ID');
  const order = await UserOrder.findOne({ _id: req.params.orderId, 'user.userId': req.user.userId, paymentProvider: 'PAYSHARP' });
  if (order) return order;
  const checkout = await PaymentCheckout.findOne({ _id: req.params.orderId, user: req.user.userId, status: 'PENDING' });
  if (!checkout) throw fail('Order or checkout not found', 404);
  return { ...checkout.orderSnapshot, _id: checkout._id, isCheckout: true };
};
const upiCheckoutEnabled = (user, totalPaise) => paysharpEnabled(user) && totalPaise >= 100 && upiAllowed(totalPaise);
const pendingSummary = checkout => summary({ ...checkout.orderSnapshot, _id: checkout._id });
const resultBody = result => result.orderSnapshot ? { order: null, checkout: pendingSummary(result) } : { order: summary(result) };
const summary = order => ({ paymentProvider: order.paymentProvider || 'LEGACY', _id: order._id, orderId: order.orderId, totalPaise: order.totalPaise, paidPaise: order.paidPaise,
  paymentStatus: order.paymentStatus, upiAllowed: upiAllowed(order.totalPaise) && order.totalPaise - order.paidPaise >= 100, isComplete: order.isComplete });
exports.config = wrap(async (req, res) => {
  res.json({ paymentProvider: paysharpEnabled(await buyer(req)) ? 'PAYSHARP' : 'LEGACY', virtualAccountEnabled: false });
});
// exports.account = wrap(async (req, res) => {
//   await buyer(req);
//   throw fail('Virtual-account payments are not available during the UPI-only rollout', 403);
// });

exports.account = wrap(async (req, res) => {
  const user = await buyer(req);

  const account = await payments.ensureAccount(user);

  res.json({
    account: visibleAccount(account, req.access),
  });
});
exports.quote = wrap(async (req, res) => {
  const user = await buyer(req);
  const pricing = await priceOrder(req.body, user, extractAuthToken(req));
  res.json({ ...pricing, paymentProvider: upiCheckoutEnabled(user, pricing.totalPaise) ? 'PAYSHARP' : 'LEGACY', upiAllowed: upiAllowed(pricing.totalPaise) });
});
exports.createOrder = wrap(async (req, res) => {
  const user = await buyer(req);
  const key = req.body.checkoutKey;
  if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{16,64}$/.test(key)) throw fail('A checkout key is required');
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ products: req.body.products, quotationId: req.body.quotationId, sourceOrderId: req.body.sourceOrderId })).digest('hex');
  const existing = await UserOrder.findOne({ 'user.userId': user._id, checkoutKey: key });
  if (existing) {
    if (existing.checkoutFingerprint !== fingerprint) throw fail('Checkout key belongs to a different order', 409);
    return res.json({ order: summary(existing) });
  }
  const pending = await PaymentCheckout.findOne({ user: user._id, checkoutKey: key, status: 'PENDING' });
  if (pending) {
    if (pending.checkoutFingerprint !== fingerprint) throw fail('Checkout key belongs to a different order', 409);
    return res.json(resultBody(pending));
  }
  const pricing = await priceOrder(req.body, user, extractAuthToken(req));
  if (pricing.totalPaise !== req.body.expectedTotalPaise) throw fail('Prices have changed. Review the updated total and try again.', 409);
  const enabled = upiCheckoutEnabled(user, pricing.totalPaise);
  const mode = enabled ? 'PAYSHARP' : 'LEGACY';
  if (req.body.paymentProvider && req.body.paymentProvider !== mode) throw fail('Payment options have changed. Review checkout and try again.', 409);
  const proof = req.body.payment?.proof;
  if (enabled && proof) throw fail('This account uses Paysharp. Refresh checkout to pay through Paysharp.', 409);
  if (!enabled && (typeof proof !== 'string' || !/^data:(image\/(png|jpeg|webp)|application\/pdf);base64,[A-Za-z0-9+/]+={0,2}$/.test(proof) || Buffer.byteLength(proof.split(',')[1] || '', 'base64') > 5 * 1024 * 1024)) {
    throw fail('Upload a PNG, JPEG, WebP image or PDF payment proof up to 5 MB');
  }
  const account = enabled ? await payments.ensureLedger(user) : null;
  let result;
  await mongoose.connection.transaction(async session => {
    if (account) await PaymentAccount.findOneAndUpdate({ _id: account._id }, { $inc: { revision: 1 } }, { session, new: true });
    await User.updateOne({ _id: user._id }, { $inc: { paymentRevision: 1 } }, { session });
    const retry = await UserOrder.findOne({ 'user.userId': user._id, checkoutKey: key }).session(session);
    if (retry) {
      if (retry.checkoutFingerprint !== fingerprint) throw fail('Checkout key belongs to a different order', 409);
      result = retry; return;
    }
    const pendingRetry = await PaymentCheckout.findOne({ user: user._id, checkoutKey: key, status: 'PENDING' }).session(session);
    if (pendingRetry) {
      if (pendingRetry.checkoutFingerprint !== fingerprint) throw fail('Checkout key belongs to a different order', 409);
      result = pendingRetry; return;
    }
    let source;
    if (pricing.sourceOrder) {
      if (await PaymentCheckout.exists({ sourceOrder: pricing.sourceOrder, status: 'PENDING' }).session(session)) {
        throw fail('A payment checkout already exists for this shortage. Resume that checkout.', 409);
      }
      source = await UserOrder.findOne({ _id: pricing.sourceOrder, dealership: user._id, upstreamOrder: null, 'fulfillment.status': 'GLAZIA_VIA_DEALER', isComplete: false }).session(session);
      if (!source) throw fail('A Glazia order already exists or this shortage is no longer available', 409);
      if (source.paymentProvider === 'PAYSHARP' && source.paymentStatus !== 'PAID') throw fail('The original order must be paid first', 409);
    }
    const dealership = user.accountType === 'DEALERSHIP' ? user._id : user.dealership;
    const order = new UserOrder({
      user: { userId: user._id, name: user.name, city: user.city || '-', phoneNumber: user.phoneNumber },
      products: pricing.products, totalAmount: rupees(pricing.totalPaise), ...Object.fromEntries(['totalPaise', 'subtotalPaise', 'taxPaise'].map(k => [k, pricing[k]])),
      paymentProvider: enabled ? 'PAYSHARP' : undefined, paymentStatus: enabled ? 'AWAITING_PAYMENT' : undefined, paidPaise: 0,
      payments: enabled ? [] : [{ amount: rupees(pricing.totalPaise), proof, proofAdded: true, cycle: 1, isApproved: false }],
      checkoutKey: key, checkoutFingerprint: fingerprint, quotationId: pricing.quotationId, quotationCode: pricing.quotationCode,
      deliveryType: 'SELF', dealership: dealership || null,
      fulfillment: { status: user.accountType !== 'DEALERSHIP' && dealership ? 'AWAITING_DEALER' : 'GLAZIA_DIRECT' },
      orderChannel: source ? 'DEALER_DIRECT_FULFILLMENT' : 'CUSTOMER', sourceOrder: source?._id,
      inventoryDisposition: user.accountType === 'DEALERSHIP' ? 'ADD_TO_DEALER_STOCK' : 'DIRECT_TO_FABRICATOR',
      deliveryAddress: { name: user.name, phoneNumber: user.phoneNumber, address: user.address, city: user.city, state: user.state, pincode: user.pincode },
    });
    if (enabled) {
      // Validation runs now, but no order number, stock movement or order is saved.
      await order.validate();
      const [checkout] = await PaymentCheckout.create([{
        _id: order._id, user: user._id, checkoutKey: key, checkoutFingerprint: fingerprint,
        orderSnapshot: order.toObject(), sourceOrder: source?._id,
      }], { session });
      result = checkout; return;
    }
    await order.save({ session });
    if (source) { source.upstreamOrder = order._id; await source.save({ session }); }
    if (user.accountType !== 'DEALERSHIP' && dealership) {
      const stock = await consumeStock(dealership, order.products, order._id, session);
      order.fulfillment.status = stock.fulfilledFromStock ? 'DEALER_STOCK' : 'GLAZIA_VIA_DEALER';
      order.fulfillment.remainingProducts = stock.remainingProducts;
      order.fulfillment.decidedAt = new Date();
      order.fulfillment.decidedBy = dealership;
      if (stock.consumedProducts.length) order.inventoryDisposition = 'CONSUMED_FROM_DEALER_STOCK';
      await order.save({ session });
    }
    result = await UserOrder.findById(order._id).session(session);
  });
  res.status(201).json(resultBody(result));
});
exports.status = wrap(async (req, res) => {
  let order = await ownedOrder(req);
  if (req.method === 'POST' && order.paymentStatus !== 'PAID') {
    const attempt = await PaymentAttempt.findOne({ order: order._id, active: true, status: { $ne: 'SUCCESS' } });
    if (attempt) {
      try { await payments.verifyUpi(attempt); }
      catch (error) { if (Number(error.providerCode) !== 6002) throw error; }
    }
    order = await ownedOrder(req);
  }
  const account = await PaymentAccount.findOne({ user: req.user.userId });
  const receipts = await PaymentReceipt.find({ 'allocations.order': order._id }).select('reference method utr receivedAt allocations amountPaise').lean();
  const latestAttempt = await PaymentAttempt.findOne({ order: order._id, active: true }).select('status').lean();
  res.json({ order: order.isCheckout ? null : summary(order), ...(order.isCheckout ? { checkout: summary(order) } : {}), upiStatus: latestAttempt?.status, account: visibleAccount(account, req.access),
    receipts: receipts.map(r => ({ reference: r.reference, method: r.method, utr: r.utr, receivedAt: r.receivedAt,
      amountPaise: r.allocations.filter(a => String(a.order) === String(order._id)).reduce((sum, a) => sum + a.amountPaise, 0) })) });
});
exports.upi = wrap(async (req, res) => {
  const order = await ownedOrder(req);
  const attempt = await payments.createUpi(order, await buyer(req), req.body.kind || 'qr');
  res.json({ qrCode: attempt.qrCode, intentUrl: attempt.intentUrl, status: attempt.status, amountPaise: attempt.amountPaise });
});
exports.upiWebhook = wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.body.orderId)) throw fail('Invalid payment request');
  const attempt = await PaymentAttempt.findById(req.body.orderId);
  if (!attempt) throw fail('Payment request not found', 404);
  // Payload is only a lookup hint. Never credit webhook-supplied amounts/status.
  await payments.verifyUpi(attempt);
  res.json({ code: 200, message: 'success' });
});
exports.bankWebhook = wrap(async (req, res) => {
  console.log("========== PAYSHARP BANK WEBHOOK HIT ==========");
  console.log("WEBHOOK BODY:", JSON.stringify(req.body, null, 2));
  await payments.verifyBank(req.body.paysharpReferenceNo);
  console.log("========== BANK WEBHOOK PROCESSED ==========");
  res.json({ code: 200, message: 'success' });
});
exports.reconcile = exports.bankWebhook;
