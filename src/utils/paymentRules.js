const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const paise = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(Math.round(n * 100))) throw fail('Invalid monetary amount');
  return Math.round(n * 100);
};
const rupees = (value) => value / 100;
const upiAllowed = (totalPaise) => totalPaise > 0 && totalPaise < 10000000;
const payable = (products) => {
  if (!Array.isArray(products) || !products.length || products.length > 2000) throw fail('Select products to order');
  const subtotal = products.reduce((sum, p) => {
    if (!p.productId || !Number.isFinite(Number(p.quantity)) || Number(p.quantity) <= 0 || paise(p.amount) <= 0) throw fail('Invalid product quantity or price');
    return sum + paise(p.amount);
  }, 0);
  // Retain existing whole-rupee GST rounding, calculated on the server.
  const tax = Math.round(subtotal / 100 * 0.18) * 100;
  if (!Number.isSafeInteger(subtotal + tax)) throw fail('Order total is too large');
  return { subtotalPaise: subtotal, taxPaise: tax, totalPaise: subtotal + tax };
};
module.exports = { fail, paise, rupees, upiAllowed, payable };
