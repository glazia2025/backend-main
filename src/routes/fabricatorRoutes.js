const express = require('express');
const isUser = require('../middleware/userMiddleware');
const inventory = require('../controllers/fabricatorInventoryController');

const router = express.Router();
router.use(isUser, inventory.requireFabricator);
router.get('/inventory', inventory.listInventory);
router.post('/inventory', inventory.createInventoryItem);
router.patch('/inventory/:productId', inventory.updateInventoryItem);
router.delete('/inventory/:productId', inventory.deleteInventoryItem);

module.exports = router;
