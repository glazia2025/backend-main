const test = require('node:test');
const assert = require('node:assert/strict');
const Hardware = require('../models/Hardware');
const Product = require('../models/Profiles/Product');
const ProfileOptions = require('../models/ProfileOptions');
const { Nalco } = require('../models/Order');
const { catalogPrices } = require('../services/orderPricingService');

test('checkout hardware uses catalog rates despite legacy adjustments; profile adjustments still apply', async (t) => {
  t.mock.method(Nalco, 'findOne', () => ({ sort: () => ({ lean: async () => ({ nalcoPrice: 250000 }) }) }));
  t.mock.method(ProfileOptions, 'findOne', () => ({ lean: async () => ({ categories: {
    Sliding: { products: { Eco: [{ sapCode: 'P', length: 5000, kgm: 2, description: 'Frame' }] } },
  } }) }));
  t.mock.method(Product, 'findOne', () => ({ lean: async () => null }));
  t.mock.method(Hardware, 'findOne', (query) => ({ lean: async () => query.$or[0].sapCode === 'H'
    ? { sapCode: 'H', rate: 25, subCategory: 'Locks', perticular: 'Lock' } : null }));
  for (const hardware of [{}, { Locks: 0 }, { Locks: 900 }]) {
    const result = await catalogPrices([{ productId: 'H', quantity: 3 }, { productId: 'P', quantity: 1 }], {
      dynamicPricing: { hardware, profiles: { 'Sliding - Eco': 150 } },
    });
    assert.equal(result[0].amount, 75);
    assert.equal(result[1].amount, 4000);
  }
});
