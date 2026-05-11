const express = require("express");
const router = express.Router();
const master = require("../controllers/profileController");

// CATEGORY APIs
router.post("/category", master.createCategory);
router.get("/categories", master.getCategories);
router.put("/category/:id", master.updateCategory);
router.get("/category/:id/full", master.getCategoryFull);

// SIZE APIs
router.post("/size", master.createSize);
router.get("/sizes/category/:categoryId", master.getSizesByCategory);
router.put("/size/:id", master.updateSize);
router.get("/size/:sizeId/products", master.getProductsForSize);

// PRODUCT APIs
router.post("/product", master.createProduct);
router.get("/products", master.getProducts);
router.put("/product/:id", master.updateProduct);

// MASTER STRUCTURED DATA
router.get("/full", master.getFullMasterData);

// TOGGLE ENABLED APIs
router.put("/category/:id/toggle-enabled", master.toggleCategoryEnabled);
router.put("/product/:id/toggle-enabled", master.toggleProductEnabled);
router.put("/size/:id/toggle-enabled", master.toggleSizeEnabled);

module.exports = router;
