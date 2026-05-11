const Category = require("../models/Profiles/Category");
const Size = require("../models/Profiles/Size");
const Product = require("../models/Profiles/Product");
const CategorySize = require("../models/Profiles/CategorySize");
const SizeProduct = require("../models/Profiles/SizeProduct");

/* =====================================================
   CATEGORY CONTROLLERS
===================================================== */

// Create Category
exports.createCategory = async (req, res) => {
  try {
    const category = await Category.create(req.body);
    res.json(category);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get all categories
exports.getCategories = async (req, res) => {
  try {
    const categories = await Category.find({});
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update Category
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    if (!id) {
      return res.status(400).json({ error: "Category ID is required" });
    }

    const update = {};
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const category = await Category.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true
    });

    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }

    res.json(category);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Full category → sizes → products structured response
exports.getCategoryFull = async (req, res) => {
  try {
    const categoryId = req.params.id;

    const category = await Category.findById(categoryId);
    if (!category) return res.status(404).json({ error: "Category not found" });

    const categorySizeLinks = await CategorySize.find({ categoryId }).populate("sizeId");

    const sizeData = [];

    for (const link of categorySizeLinks) {
      const size = link.sizeId;

      const sizeProducts = await SizeProduct.find({ sizeId: size._id })
        .populate("productId");

      sizeData.push({
        size,
        products: sizeProducts.map(sp => sp.productId),
      });
    }

    res.json({
      category,
      sizes: sizeData
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


/* =====================================================
   SIZE CONTROLLERS
===================================================== */

// Create Size
exports.createSize = async (req, res) => {
  try {
    const size = await Size.create(req.body);

    // Auto-create CategorySize mapping
    if (req.body.categoryId) {
      await CategorySize.create({
        categoryId: req.body.categoryId,
        sizeId: size._id
      });
    }

    res.json(size);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get sizes belonging to a category
exports.getSizesByCategory = async (req, res) => {
  try {
    const sizes = await Size.find({ categoryId: req.params.categoryId });
    res.json(sizes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update Size
exports.updateSize = async (req, res) => {
  try {
    const { id } = req.params;
    const { label } = req.body;

    if (!id) {
      return res.status(400).json({ error: "Size ID is required" });
    }

    if (label === undefined) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const size = await Size.findByIdAndUpdate(
      id,
      { label },
      { new: true, runValidators: true }
    );

    if (!size) {
      return res.status(404).json({ error: "Size not found" });
    }

    res.json(size);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get products for a size
exports.getProductsForSize = async (req, res) => {
  try {
    const sizeId = req.params.sizeId;

    console.log(sizeId, "sizeId");

    const mappings = await SizeProduct.find({ sizeId })
        .populate("productId");

      console.log(mappings, "mappings");

    res.json(mappings.map(m => m.productId));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


/* =====================================================
   PRODUCT CONTROLLERS
===================================================== */

// Create Product
exports.createProduct = async (req, res) => {
  try {
    const product = await Product.create(req.body);

    // Auto-create mapping if sizeId is provided
    if (req.body.sizeId) {
      await SizeProduct.create({
        sizeId: req.body.sizeId,
        productId: product._id
      });
    }

    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// List all products
exports.getProducts = async (req, res) => {
  try {
    const products = await Product.find({});
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update Product
exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      sapCode,
      part,
      description,
      degree,
      per,
      kgm,
      length,
      image
    } = req.body;

    if (!id) {
      return res.status(400).json({ error: "Product ID is required" });
    }

    const update = {};
    if (sapCode !== undefined) update.sapCode = sapCode;
    if (part !== undefined) update.part = part;
    if (description !== undefined) update.description = description;
    if (degree !== undefined) update.degree = degree;
    if (per !== undefined) update.per = per;
    if (kgm !== undefined) update.kgm = kgm;
    if (length !== undefined) update.length = length;
    if (image !== undefined) update.image = image;

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const product = await Product.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true
    });

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


/* =====================================================
   MASTER API: FULL DATA STRUCTURE
===================================================== */

// Returns everything:
// Category → Sizes → Products
exports.getFullMasterData = async (req, res) => {
  try {
    const categories = await Category.find({});

    const output = [];

    for (const category of categories) {
      const categorySizes = await CategorySize.find({ categoryId: category._id })
        .populate("sizeId");

      const sizeBlocks = [];

      for (const cs of categorySizes) {
        const size = cs.sizeId;

        const sizeProducts = await SizeProduct.find({ sizeId: size._id })
          .populate("productId");

        sizeBlocks.push({
          size,
          products: sizeProducts.map(sp => sp.productId),
        });
      }

      output.push({
        category,
        sizes: sizeBlocks
      });
    }

    res.json(output);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


/* =====================================================
   TOGGLE ENABLED CONTROLLERS
===================================================== */

// Toggle Category enabled field
exports.toggleCategoryEnabled = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "Category ID is required" });
    }

    const category = await Category.findById(id);

    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }

    // Toggle the enabled field
    category.enabled = !category.enabled;
    await category.save();

    res.json({
      success: true,
      message: `Category enabled status toggled successfully`,
      category
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Toggle Product enabled field
exports.toggleProductEnabled = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "Product ID is required" });
    }

    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    // Toggle the enabled field
    product.enabled = !product.enabled;
    await product.save();

    res.json({
      success: true,
      message: `Product enabled status toggled successfully`,
      product
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Toggle Size enabled field
exports.toggleSizeEnabled = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "Size ID is required" });
    }

    const size = await Size.findById(id);

    if (!size) {
      return res.status(404).json({ error: "Size not found" });
    }

    // Toggle the enabled field
    size.enabled = !size.enabled;
    await size.save();

    res.json({
      success: true,
      message: `Size enabled status toggled successfully`,
      size
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
