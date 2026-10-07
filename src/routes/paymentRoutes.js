const express = require('express');
const isUser = require('../middleware/userMiddleware');
const isAdmin = require('../middleware/adminMiddleware');
const controller = require('../controllers/paymentController');
const router = express.Router();
// Webhook bodies are untrusted. Controllers independently query Paysharp with the server token.
router.post('/webhooks/upi', controller.upiWebhook);
router.post('/webhooks/virtual-account', controller.bankWebhook);
router.post('/reconcile', isAdmin.withPermission('ORDERS'), controller.reconcile);
router.get('/config', isUser, isUser.requireModule('orderPlacement'), controller.config);
router.get('/account', isUser, isUser.requireModule('orderPlacement'), controller.account);
router.post('/quote', isUser, isUser.requireModule('orderPlacement'), controller.quote);
router.get('/orders/:orderId', isUser, isUser.requireModule('orderHistory', 'orderPlacement'), controller.status);
router.post('/orders/:orderId/refresh', isUser, isUser.requireModule('orderHistory', 'orderPlacement'), controller.status);
router.post('/orders/:orderId/upi', isUser, isUser.requireModule('orderPlacement'), controller.upi);
module.exports = router;
