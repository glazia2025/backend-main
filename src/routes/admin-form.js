const express = require("express");
const multer = require('multer');
const isAdmin = require("../middleware/adminMiddleware");
const {
  addProduct,
  getProducts,
  editProduct,
  deleteProduct,
  searchProduct,
  updateTechSheet,
  getTechSheet,
  toggleProfileAvailability,
  getProfileHierarchy,
  toggleCatEnabled
} = require("../controllers/productController");
const {
  addHardware,
  getHardwares,
  addAllProducts,
  editHardware,
  deleteHardware,
  searchHardware,
  saveProductImage,
  listHardwareCategories,
  createHardwareCategory,
  updateHardwareCategory,
  deleteHardwareCategory,
} = require("../controllers/hardwareController");
const { updateNalco, approvePayment, completeOrder, updatePaymentDueDate } = require("../controllers/orderController");
const { getNalco, getNalcoGraph, updateDynamicPricing, getDynamicPricing, listUsers } = require("../controllers/userController");
const { listLeads, updateLead, deleteLead } = require("../controllers/authcontroller");
const isUser = require("../middleware/userMiddleware");
const { assignDealership, promoteToDealership } = require('../controllers/dealershipController');
const { listRequests: listStockAdjustmentRequests, reviewRequest: reviewStockAdjustmentRequest } = require('../controllers/stockAdjustmentAdminController');
const {
  listInventory,
  listMovements,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
} = require('../controllers/glaziaInventoryController');
const { listAdminAccounts, createAdminAccount, updateAdminAccount } = require('../controllers/adminAccountController');
const router = express.Router();
const can = isAdmin.withPermission;
const agreementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(file.mimetype === 'application/pdf' ? null : new Error('Only PDF files are allowed'), file.mimetype === 'application/pdf'),
});

router.post("/add-product", can('PRODUCTS'), addProduct);
router.post("/add-hardware", can('PRODUCTS'), addHardware);
router.get("/getHardwares", getHardwares);
router.get("/hardware-categories", can('PRODUCTS'), listHardwareCategories);
router.post("/hardware-categories", can('PRODUCTS'), createHardwareCategory);
router.put("/hardware-categories/:id", can('PRODUCTS'), updateHardwareCategory);
router.delete("/hardware-categories/:id", can('PRODUCTS'), deleteHardwareCategory);
router.post("/add-all", can('PRODUCTS'), addAllProducts);
router.get("/search-product", isUser, searchProduct);
router.get("/search-hardware", isUser, searchHardware);
router.get("/get-nalco", getNalco);
router.get("/get-nalco-graph", getNalcoGraph);
router.post(
  "/save-product-images",
  can('PRODUCTS'),
  express.json({ limit: "50mb" }),
  saveProductImage
);

router.post("/update-tech-sheet", can('PRODUCTS'), updateTechSheet);
router.put(
  "/edit-product/:category/:productType/:productId",
  can('PRODUCTS'),
  editProduct
);
router.delete(
  "/delete-product/:category/:productType/:productId",
  can('PRODUCTS'),
  deleteProduct
);
router.get("/getProducts", can('PRODUCTS'), getProducts);
router.put("/edit-hardware/:option/:productId", can('PRODUCTS'), editHardware);
router.delete("/delete-hardware/:option/:productId", can('PRODUCTS'), deleteHardware);
router.post("/update-nalco", can('PRODUCTS'), updateNalco);
router.get("/get-tech-sheet", isUser, getTechSheet);
// router.post("/approve-payment", can('ORDERS'), approvePayment);
router.post(
  "/approve-payment",
  isAdmin.isAdminOrDealership,
  approvePayment
);
router.post("/update-payment-due-date", can('ORDERS'), updatePaymentDueDate);
router.post("/complete-order", can('ORDERS'), express.json({ limit: "50mb" }), completeOrder);
router.post("/toggle-profile-availability", can('PRODUCTS'), toggleProfileAvailability);
router.get('/get-profile-heirarchy', can('PRODUCTS'), getProfileHierarchy);
router.post('/toggle-cat', can('PRODUCTS'), toggleCatEnabled);

// Dynamic pricing routes
router.put('/update-dynamic-pricing/:userId', can('USERS'), updateDynamicPricing);
router.get('/get-dynamic-pricing/:userId', can('USERS'), getDynamicPricing);
router.get('/users', can('USERS'), listUsers);
router.put('/users/:userId/dealership', can('USERS'), assignDealership);
router.post('/users/:userId/promote-dealership', can('USERS'), agreementUpload.single('paPdf'), promoteToDealership);
router.get('/stock-adjustment-requests', can('STOCK_APPROVALS'), listStockAdjustmentRequests);
router.patch('/stock-adjustment-requests/:requestId', can('STOCK_APPROVALS'), reviewStockAdjustmentRequest);
router.get('/inventory', can('INVENTORY'), listInventory);
router.get('/inventory-movements', can('INVENTORY'), listMovements);
router.post('/inventory', can('INVENTORY'), createInventoryItem);
router.patch('/inventory/:inventoryId', can('INVENTORY'), updateInventoryItem);
router.delete('/inventory/:inventoryId', can('INVENTORY'), deleteInventoryItem);
router.get('/leads', can('USERS'), listLeads);
router.put('/leads/:leadId', can('USERS'), updateLead);
router.delete('/leads/:leadId', can('USERS'), deleteLead);
router.get('/admin-accounts', can('ADMIN_ACCOUNTS'), listAdminAccounts);
router.post('/admin-accounts', can('ADMIN_ACCOUNTS'), createAdminAccount);
router.patch('/admin-accounts/:adminId', can('ADMIN_ACCOUNTS'), updateAdminAccount);

router.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError || error.message === 'Only PDF files are allowed') {
    return res.status(400).json({ message: error.message });
  }
  return next(error);
});

module.exports = router;
