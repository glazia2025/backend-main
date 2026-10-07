const normalizeMobile = value => {
  let digits = String(value || '').replace(/[^0-9]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9][0-9]{9}$/.test(digits) ? digits : null;
};
function paysharpEnabled(user, env = process.env) {
  const flag = String(env.Paysharp_test_active ?? 'false').trim().toLowerCase();
  if (flag === 'false') return true;
  // An invalid flag must not accidentally enable payments for everyone.
  if (flag !== 'true') return false;
  const allowed = new Set(String(env.Paysharp_Test_users || '').split(',').map(normalizeMobile).filter(Boolean));
  const normalized = normalizeMobile(user.phoneNumber);
  return normalized !== null && allowed.has(normalized);
}
module.exports = { paysharpEnabled, normalizeMobile };
