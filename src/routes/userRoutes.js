const express = require('express');
const multer = require('multer');
const { getProducts, getProfileHierarchy, testRun } = require('../controllers/productController');
const { globalSearch } = require('../controllers/searchController');
const { createUser, getUser, updateUser } = require('../controllers/userController');
const { createOrder, getOrders, sendEmail, createPayment, uploadPaymentProof } = require('../controllers/orderController');
const { getHardwareHeirarchy } = require('../controllers/hardwareController');
const isUser = require('../middleware/userMiddleware');
const { trackPhone } = require('../controllers/authcontroller');
const { shareQuotationOnWhatsApp } = require('../controllers/quotationShareController');
const router = express.Router();

const PA_PDF_MAX_SIZE_MB = Number(process.env.PA_PDF_MAX_SIZE_MB || 50);
const PA_PDF_MAX_SIZE_BYTES = PA_PDF_MAX_SIZE_MB * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PA_PDF_MAX_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are allowed'));
    }
    return cb(null, true);
  },
});

const quotationPdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') return cb(new Error('Only PDF files are allowed'));
    return cb(null, true);
  },
});

router.post('/register', upload.single('paPdf'), createUser);
router.get('/getUser', isUser, getUser);
router.put('/updateUser', isUser, isUser.ownerOnly, updateUser);
const members = require('../controllers/businessMembersController');
router.get('/members', isUser, isUser.ownerOnly, members.list);
router.post('/members', isUser, isUser.ownerOnly, members.save);
router.put('/members/:memberId', isUser, isUser.ownerOnly, members.save);
router.delete('/members/:memberId', isUser, isUser.ownerOnly, members.save);
router.post('/pi-generate', isUser, isUser.requireModule('orderPlacement'), express.json({ limit: "50mb" }), require('../controllers/paymentController').createOrder);
router.post('/add-payment', isUser, isUser.requireModule('orderPlacement'), express.json({ limit: "50mb" }), createPayment);
router.get('/getOrders', isUser.withAdminPermission('ORDERS'), isUser.requireModule('orderHistory'), getOrders);
router.get('/get-profile-heirarchy', isUser, getProfileHierarchy);
router.get('/get-hardware-heirarchy', isUser, getHardwareHeirarchy);
router.get('/global-search', globalSearch);
router.post('/send-email', isUser, isUser.requireModule('orderPlacement'), sendEmail);
router.post('/share-quotation', isUser, isUser.requireModule('QUOTATION_ERP', 'SURVEY_APP'), quotationPdfUpload.single('quotationPdf'), shareQuotationOnWhatsApp);
router.post('/upload-payment-proof', isUser.withAdminPermission('ORDERS'), isUser.requireModule('orderPlacement'), express.json({ limit: "50mb" }), uploadPaymentProof)
router.get('/getProducts', getProducts);
router.post('/track-phone', trackPhone);

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      message: req.path.includes('share-quotation')
        ? 'Quotation PDF must be 25MB or smaller'
        : `Partner agreement PDF must be ${PA_PDF_MAX_SIZE_MB}MB or smaller`,
    });
  }

  if (error.message === 'Only PDF files are allowed') {
    return res.status(400).json({ message: error.message });
  }

  return next(error);
});

module.exports = router;
