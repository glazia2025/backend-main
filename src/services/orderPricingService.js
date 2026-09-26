const axios = require('axios');
const mongoose = require('mongoose');
const Hardware = require('../models/Hardware');
const Product = require('../models/Profiles/Product');
const SizeProduct = require('../models/Profiles/SizeProduct');
require('../models/Profiles/Size');
const Category = require('../models/Profiles/Category');
const ProfileOptions = require('../models/ProfileOptions');
const { Nalco, UserOrder } = require('../models/Order');
const { fail, paise, payable } = require('../utils/paymentRules');
const adjustment = (map, keys) => {
  for (const key of keys) {
    const n = Number(map?.[key]);
    if (map?.[key] !== undefined && Number.isFinite(n) && n !== 0) return n;
  }
  return 100;
};
async function priceOrder(body, user, token) {
  if (body.sourceOrderId) {
    if (user.accountType !== 'DEALERSHIP' || !mongoose.isValidObjectId(body.sourceOrderId)) throw fail('Invalid source order');
    const source = await UserOrder.findOne({ _id: body.sourceOrderId, dealership: user._id, 'fulfillment.status': 'GLAZIA_VIA_DEALER', isComplete: false }).lean();
    if (!source || !source.fulfillment.remainingProducts?.length) throw fail('No shortage order is available', 409);
    if (source.upstreamOrder) throw fail('A Glazia order already exists for this shortage', 409);
    const products = await catalogPrices(source.fulfillment.remainingProducts, user);
    return { products, ...payable(products), sourceOrder: source._id };
  }
  if (body.quotationId) {
    if (!mongoose.isValidObjectId(body.quotationId)) throw fail('Invalid quotation ID');
    const base = process.env.QUOTATION_API_BASE_URL || 'https://quotation-api.glazia.in';
    let data;
    try {
      const response = await axios.get(`${base.replace(/\/$/, '')}/api/quotations/${body.quotationId}/bom-data`, {
        headers: { Authorization: `Bearer ${token}` }, timeout: 60000, maxRedirects: 0,
      });
      data = response.data;
    } catch (_) { throw fail('Unable to price this quotation. Save it and retry.', 502); }
  
  const products = (data.rows || [])
  .map(row => ({
    productId: row.itemCode,
    description: row.description,
    quantity: Number(row.quantity),
    amount: Number(row.amount)
  }))
  .filter(product =>
    String(product.productId || '').trim() &&
    Number.isFinite(product.quantity) &&
    product.quantity > 0 &&
    Number.isFinite(product.amount) &&
    product.amount > 0
  );

return {
  products,
  ...payable(products),
  quotationId: body.quotationId,
  quotationCode: data.projectCode
};
  }
  const products = await catalogPrices(body.products, user);
  return { products, ...payable(products) };
}
async function catalogPrices(items, user) {
  if (!Array.isArray(items) || !items.length || items.length > 2000) throw fail('Select products to order');
  const [nalco, legacy] = await Promise.all([Nalco.findOne().sort({ date: -1 }).lean(), ProfileOptions.findOne().lean()]);
  const rows = [];
  for (const item of items) {
    const code = String(item.productId || '');
    const quantity = Number(item.quantity);
    if (!code || code.length > 100 || !Number.isFinite(quantity) || quantity <= 0) throw fail('Invalid product quantity');
    const hardware = await Hardware.findOne({ $or: [{ sapCode: code }, ...(/^\d+$/.test(code) ? [{ id: Number(code) }] : [])] }).lean();
    let unitPrice, description;
    if (hardware) {
      unitPrice = Number(hardware.rate);
      description = hardware.perticular;
    } else {
      let product = await Product.findOne({ sapCode: code }).lean();
      let categoryName, option;
      if (product) {
        const link = await SizeProduct.findOne({ productId: product._id }).populate('sizeId').lean();
        const category = link?.sizeId ? await Category.findById(link.sizeId.categoryId).lean() : null;
        if (!category || product.enabled === false || category.enabled === false || link.sizeId.enabled === false) throw fail(`Product ${code} is unavailable`);
        categoryName = category.name; option = link.sizeId.label;
      } else {
        for (const [name, category] of Object.entries(legacy?.categories || {})) {
          for (const [label, products] of Object.entries(category.products || {})) {
            const found = products.find(p => p.sapCode === code);
            if (found && found.isEnabled !== false && category.catEnabled !== false && category.enabled?.[label] !== false) {
              product = found; categoryName = name; option = label;
            }
          }
        }
      }
      if (!product || !nalco?.nalcoPrice) throw fail(`Unable to price product ${code}`);
      const length = Number(product.length), kgm = Number(product.kgm);
      if (!(length > 0 && kgm > 0)) throw fail(`Invalid catalog dimensions for ${code}`);
      unitPrice = (nalco.nalcoPrice / 1000 + adjustment(user.dynamicPricing?.profiles, [`${categoryName} - ${option}`, `${categoryName}-${option}`, categoryName])) * length / 1000 * kgm;
      description = product.description;
    }
    rows.push({ productId: hardware?.sapCode || code, description, quantity, amount: paise(unitPrice * quantity) / 100 });
  }
  return rows;
}
module.exports = { priceOrder, catalogPrices };
