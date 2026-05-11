const express = require("express");
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
} = require("../controllers/hardwareController");
const { updateNalco, approvePayment, completeOrder, updatePaymentDueDate } = require("../controllers/orderController");
const { getNalco, getNalcoGraph, updateDynamicPricing, getDynamicPricing, listUsers } = require("../controllers/userController");
const { listLeads, updateLead, deleteLead } = require("../controllers/authcontroller");
const isUser = require("../middleware/userMiddleware");
const router = express.Router();

router.post("/add-product", isAdmin, addProduct);
router.post("/add-hardware", isAdmin, addHardware);
router.get("/getHardwares", getHardwares);
router.post("/add-all", isAdmin, addAllProducts);
router.get("/search-product", isUser, searchProduct);
router.get("/search-hardware", isUser, searchHardware);
router.get("/get-nalco", getNalco);
router.get("/get-nalco-graph", getNalcoGraph);
router.post(
  "/save-product-images",
  isAdmin,
  express.json({ limit: "50mb" }),
  saveProductImage
);

router.post("/update-tech-sheet", isAdmin, updateTechSheet);
router.put(
  "/edit-product/:category/:productType/:productId",
  isAdmin,
  editProduct
);
router.delete(
  "/delete-product/:category/:productType/:productId",
  isAdmin,
  deleteProduct
);
router.get("/getProducts", isAdmin, getProducts);
router.put("/edit-hardware/:option/:productId", isAdmin, editHardware);
router.delete("/delete-hardware/:option/:productId", isAdmin, deleteHardware);
router.post("/update-nalco", isAdmin, updateNalco);
router.get("/get-tech-sheet", isUser, getTechSheet);
router.post("/approve-payment", isAdmin, approvePayment);
router.post("/update-payment-due-date", isAdmin, updatePaymentDueDate);
router.post("/complete-order", isAdmin, express.json({ limit: "50mb" }), completeOrder);
router.post("/toggle-profile-availability", isAdmin, toggleProfileAvailability);
router.get('/get-profile-heirarchy', isAdmin, getProfileHierarchy);
router.post('/toggle-cat', toggleCatEnabled);

// Dynamic pricing routes
router.put('/update-dynamic-pricing/:userId', isAdmin, updateDynamicPricing);
router.get('/get-dynamic-pricing/:userId', isAdmin, getDynamicPricing);
router.get('/users', isAdmin, listUsers);
router.get('/leads', isAdmin, listLeads);
router.put('/leads/:leadId', isAdmin, updateLead);
router.delete('/leads/:leadId', isAdmin, deleteLead);

module.exports = router;
