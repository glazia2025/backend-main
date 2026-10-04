const axios = require('axios');
const { fail } = require('../utils/paymentRules');
const request = async (kind, method, path, data) => {
  // The common root excludes /upi. Keep previous variables for existing deployments.
  const base = kind === 'upi' && process.env.PAYSHARP_BASE_URL
    ? `${process.env.PAYSHARP_BASE_URL.replace(/\/$/, '')}/upi`
    : process.env[kind === 'upi' ? 'PAYSHARP_UPI_BASE_URL' : 'PAYSHARP_VA_BASE_URL'];
  const token = process.env.PAYSHARP_API_TOKEN;
  if (!base || !token) throw fail('Payments are not configured. Please contact Glazia.', 503);
  if (new URL(base).protocol !== 'https:') throw fail('Paysharp requires an HTTPS API URL', 503);
  try {
    const response = await axios({ method, url: `${base.replace(/\/$/, '')}${path}`, data,
      timeout: 15000, maxRedirects: 0,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    if (response.data?.code !== 200 || !response.data?.data) {
      throw Object.assign(fail('Payment provider could not process the request', 502), { providerCode: response.data?.errorCode });
    }
    return response.data.data;
  } catch (error) {
    // Never propagate Axios config/headers (which contain the merchant token).
    throw Object.assign(fail(error.status ? error.message : 'Payment provider is unavailable. Please retry.', error.status || 502), {
      providerCode: error.providerCode || error.response?.data?.errorCode,
    });
  }
};
module.exports = { request };
