const express = require('express');
const multer = require('multer');
const isUser = require('../middleware/userMiddleware');
const { listFabricators, registerFabricator, getFabricatorDynamicPricing, updateFabricatorDynamicPricing, listOrders, getInventory, listAdjustmentRequests, createInventoryItem, adjustInventory, deleteInventoryItem, decideFulfillment, getOrder } = require('../controllers/dealershipController');

const router = express.Router();
const agreementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(file.mimetype === 'application/pdf' ? null : new Error('Only PDF files are allowed'), file.mimetype === 'application/pdf'),
});
router.use(isUser);
router.get('/fabricators', listFabricators);
router.post('/fabricators', agreementUpload.single('paPdf'), registerFabricator);
router.get('/fabricators/:fabricatorId/dynamic-pricing', getFabricatorDynamicPricing);
router.put('/fabricators/:fabricatorId/dynamic-pricing', updateFabricatorDynamicPricing);
router.get('/orders', listOrders);
router.get('/orders/:orderId', getOrder);
router.get('/inventory', getInventory);
router.get('/stock-adjustment-requests', listAdjustmentRequests);
router.post('/inventory', createInventoryItem);
router.patch('/inventory/:productId', adjustInventory);
router.delete('/inventory/:productId', deleteInventoryItem);
router.patch('/orders/:orderId/fulfillment', decideFulfillment);

router.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ message: 'Partner agreement PDF must be 50MB or smaller' });
  }
  if (error.message === 'Only PDF files are allowed') return res.status(400).json({ message: error.message });
  return next(error);
});

module.exports = router;
