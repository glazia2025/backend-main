// controllers/hardwareController.js
const mongoose = require('mongoose');
const HardwareOptions = require('../models/Hardware'); // single product per doc

// Add a single product document
const addHardware = async (req, res) => {
  const { option, product } = req.body;
  if (!option || !product) {
    return res.status(400).json({ message: 'option and product are required' });
  }

  try {
    // ensure product has subCategory (consistent field)
    const productDoc = {
      ...product,
      subCategory: option
    };

    const created = await HardwareOptions.create(productDoc);
    res.status(201).json({ message: 'Product created', product: created });
  } catch (err) {
    console.error('Error creating product:', err);
    res.status(500).json({ message: 'Error creating product', error: err.message });
  }
};

// Get products by category (reqOption) or return all if not provided
const getHardwares = async (req, res) => {
  const { reqOption } = req.query;
  try {
    let query = {};
    if (reqOption) query.subCategory = reqOption;

    const products = await HardwareOptions.find(query).lean();

    // build options list (distinct subCategory values) for frontend
    const options = await HardwareOptions.distinct('subCategory');

    res.status(200).json({
      options,
      products: {[reqOption]: products} // array of product docs
    });
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ message: 'Error fetching products', error: err.message });
  }
};

// Bulk add multiple product documents (expects array of items; optionally { option, items })
const addAllProducts = async (req, res) => {
  try {
    // Accept either: req.body = [{...}, {...}] OR { option: "HANDLES", items: [{...}] }
    let items = [];
    if (Array.isArray(req.body)) {
      items = req.body;
    } else if (req.body && Array.isArray(req.body.items)) {
      // attach subCategory if option provided
      const { option, items: bodyItems } = req.body;
      items = bodyItems.map(it => (option ? { ...it, subCategory: option } : it));
    } else {
      return res.status(400).json({ message: 'Invalid payload. Provide array of products or { option, items }' });
    }

    if (!items.length) {
      return res.status(400).json({ message: 'No items provided' });
    }

    const result = await HardwareOptions.insertMany(items);
    res.status(201).json({ message: 'Products added', insertedCount: result.length, products: result });
  } catch (err) {
    console.error('Error inserting products:', err);
    res.status(500).json({ message: 'Error inserting products', error: err.message });
  }
};

// Edit a product by its _id
const editHardware = async (req, res) => {
  const { productId } = req.params;
  const updatedData = req.body;

  // Mandatory fields check (optional — keep if you require)
  const mandatoryFields = ["sapCode", "perticular", "subCategory", "rate", "system", "moq"];
  const missing = mandatoryFields.filter(f => !(f in updatedData));
  if (missing.length > 0) {
    return res.status(400).json({ message: `Missing mandatory fields: ${missing.join(', ')}` });
  }

  try {
    const result = await HardwareOptions.findByIdAndUpdate(productId, updatedData, { new: true });
    if (!result) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.status(200).json({ message: 'Product updated', product: result });
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ message: 'Error updating product', error: err.message });
  }
};

// Delete a product by its _id
const deleteHardware = async (req, res) => {
  const { productId } = req.params;

  try {
    const result = await HardwareOptions.findByIdAndDelete(productId);
    if (!result) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.status(200).json({ message: 'Product deleted', productId });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ message: 'Error deleting product', error: err.message });
  }
};

// Search products by sapCode or perticular, optional category filter
const searchHardware = async (req, res) => {
  const { sapCode, perticular, option } = req.query;
  if ((!sapCode || !sapCode.trim()) && (!perticular || !perticular.trim()) && !option) {
    return res.status(400).json({ message: 'Provide sapCode, perticular, or option to search' });
  }

  try {
    const query = {};
    if (sapCode && sapCode.trim()) {
      query.sapCode = { $regex: sapCode.trim(), $options: 'i' };
    }
    if (perticular && perticular.trim()) {
      query.perticular = { $regex: perticular.trim(), $options: 'i' };
    }
    if (option) {
      query.subCategory = option;
    }

    // If both sapCode and perticular present, we combine with $or to allow either to match
    let products;
    if (query.sapCode && query.perticular) {
      products = await HardwareOptions.find({ $and: [ { subCategory: option || { $exists: true } }, { $or: [{ sapCode: query.sapCode }, { perticular: query.perticular }] } ] }).lean();
    } else {
      products = await HardwareOptions.find(query).lean();
    }

    res.status(200).json({ products });
  } catch (err) {
    console.error('Error searching products:', err);
    res.status(500).json({ message: 'Error searching products', error: err.message });
  }
};

// Update images for multiple products by sapCode
const saveProductImage = async (req, res) => {
  try {
    const productImagesData = req.body; // array of { productCode, image }
    if (!Array.isArray(productImagesData) || productImagesData.length === 0) {
      return res.status(400).json({ message: 'Provide an array of { productCode, image }' });
    }

    const updatedProducts = [];
    const notFoundProducts = [];

    // Process each image update (bulk approach with updateOne per item)
    for (const imgData of productImagesData) {
      const { productCode, image } = imgData;
      if (!productCode) continue;

      const result = await HardwareOptions.findOneAndUpdate(
        { sapCode: productCode },
        { $set: { image } },
        { new: true }
      );

      if (result) {
        updatedProducts.push({ sapCode: productCode, _id: result._id, perticular: result.perticular });
      } else {
        notFoundProducts.push(productCode);
      }
    }

    res.json({
      success: true,
      updated: updatedProducts.length,
      updatedProducts,
      notFound: notFoundProducts.length,
      notFoundProducts
    });
  } catch (err) {
    console.error('Error saving product images:', err);
    res.status(500).json({ message: 'Failed to save product images', error: err.message });
  }
};

// Return distinct categories (hierarchy)
const getHardwareHeirarchy = async (req, res) => {
  try {
    const options = await HardwareOptions.distinct('subCategory');
    res.status(200).json({ products: options });
  } catch (err) {
    console.error('Error getting categories:', err);
    res.status(500).json({ message: 'Error getting categories', error: err.message });
  }
};

module.exports = {
  addHardware,
  getHardwares,
  addAllProducts,
  editHardware,
  deleteHardware,
  searchHardware,
  saveProductImage,
  getHardwareHeirarchy
};
