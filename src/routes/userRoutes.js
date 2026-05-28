const express = require('express');
const multer = require('multer');
const { getProducts, getProfileHierarchy, testRun } = require('../controllers/productController');
const { globalSearch } = require('../controllers/searchController');
const { createUser, getUser, updateUser } = require('../controllers/userController');
const { createOrder, getOrders, sendEmail, createPayment, uploadPaymentProof } = require('../controllers/orderController');
const { getHardwareHeirarchy } = require('../controllers/hardwareController');
const isUser = require('../middleware/userMiddleware');
const { trackPhone } = require('../controllers/authcontroller');
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

router.post('/register', upload.single('paPdf'), createUser);
router.get('/getUser', isUser, getUser);
router.put('/updateUser', isUser, updateUser);
router.post('/pi-generate', isUser, express.json({ limit: "50mb" }), createOrder);
router.post('/add-payment', isUser, express.json({ limit: "50mb" }), createPayment);
router.get('/getOrders', isUser, getOrders);
router.get('/get-profile-heirarchy', isUser, getProfileHierarchy);
router.get('/get-hardware-heirarchy', isUser, getHardwareHeirarchy);
router.get('/global-search', globalSearch);
router.post('/send-email', isUser, sendEmail);
router.post('/upload-payment-proof', express.json({ limit: "50mb" }), uploadPaymentProof)
router.get('/getProducts', getProducts);
router.post('/track-phone', trackPhone);

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      message: `Partner agreement PDF must be ${PA_PDF_MAX_SIZE_MB}MB or smaller`,
    });
  }

  if (error.message === 'Only PDF files are allowed') {
    return res.status(400).json({ message: error.message });
  }

  return next(error);
});

module.exports = router;
