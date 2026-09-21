const express = require('express');
const isUser = require('../middleware/userMiddleware');
const isAdmin = require('../middleware/adminMiddleware');
const controller = require('../controllers/paymentController');
const router = express.Router();
// Webhook bodies are untrusted. Controllers independently query Paysharp with the server token.
router.post('/webhooks/upi', controller.upiWebhook);
router.post('/webhooks/virtual-account', controller.bankWebhook);
router.post('/reconcile', isAdmin.withPermission('ORDERS'), controller.reconcile);
router.get('/config', isUser, controller.config);
router.get('/account', isUser, controller.account);
router.post('/quote', isUser, controller.quote);
router.get('/orders/:orderId', isUser, controller.status);
router.post('/orders/:orderId/refresh', isUser, controller.status);
router.post('/orders/:orderId/upi', isUser, controller.upi);
module.exports = router;
