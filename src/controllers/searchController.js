const Product = require("../models/Profiles/Product");
const HardwareOptions = require("../models/Hardware");
const { escapeRegExp } = require("../utils/common");

const buildSapRegex = (value) => {
  return new RegExp(`^${escapeRegExp(value)}`, "i");
};

const globalSearch = async (req, res) => {
  const { search } = req.query;
  const term = search.trim();

  if (!term) {
    return res
      .status(400)
      .json({ message: "Provide q, name, or sapCode to search" });
  }

  const parsedLimit = Math.min(Number(4));
  const useText = true;

  const orProduct = [
    { $text: { $search: term } },
    { sapCode: buildSapRegex(term) }
  ];
  const orHardware = [
    { $text: { $search: term } },
    { sapCode: buildSapRegex(term) }
  ];

  const productQuery = orProduct.length === 1 ? orProduct[0] : { $or: orProduct };
  const hardwareQuery = orHardware.length === 1 ? orHardware[0] : { $or: orHardware };

  const productSelect = useText
    ? { score: { $meta: "textScore" }, sapCode: 1, part: 1, description: 1, image: 1, enabled: 1 }
    : { sapCode: 1, part: 1, description: 1, image: 1, enabled: 1 };
  const hardwareSelect = useText
    ? { score: { $meta: "textScore" }, sapCode: 1, perticular: 1, subCategory: 1, rate: 1, system: 1, moq: 1, image: 1 }
    : { sapCode: 1, perticular: 1, subCategory: 1, rate: 1, system: 1, moq: 1, image: 1 };

  const productQueryBuilder = Product.find(productQuery).select(productSelect).limit(parsedLimit).lean();
  const hardwareQueryBuilder = HardwareOptions.find(hardwareQuery).select(hardwareSelect).limit(parsedLimit).lean();

  if (useText) {
    productQueryBuilder.sort({ score: { $meta: "textScore" } });
    hardwareQueryBuilder.sort({ score: { $meta: "textScore" } });
  }

  try {
    const [products, hardware] = await Promise.all([
      productQueryBuilder,
      hardwareQueryBuilder
    ]);

    res.status(200).json({
      products,
      hardware,
      counts: {
        products: products.length,
        hardware: hardware.length,
        total: products.length + hardware.length
      }
    });
  } catch (error) {
    console.error("Error in global search:", error);
    res.status(500).json({ message: "Error performing global search" });
  }
};

module.exports = { globalSearch };
