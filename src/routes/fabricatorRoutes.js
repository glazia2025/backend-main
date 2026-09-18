const multer = require('multer');
const express = require('express');
const isUser = require('../middleware/userMiddleware');
const inventory = require('../controllers/fabricatorInventoryController');

const router = express.Router();
const inventoryImageUpload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 5 * 1024 * 1024,
  },

  fileFilter: (_req, file, callback) => {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
    ];

    if (allowedTypes.includes(file.mimetype)) {
      return callback(null, true);
    }

    return callback(
      new Error('Only JPG, PNG and WEBP images are allowed')
    );
  },
});
router.use(isUser, inventory.requireFabricator);
router.get('/inventory', inventory.listInventory);
router.post(
  '/inventory',
  inventoryImageUpload.single('image'),
  inventory.createInventoryItem
);
router.patch(
  '/inventory/:productId',
  inventoryImageUpload.single('image'),
  inventory.updateInventoryItem
);
router.delete('/inventory/:productId', inventory.deleteInventoryItem);

module.exports = router;
