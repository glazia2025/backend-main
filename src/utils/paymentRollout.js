const normalizeMobile = value => {
  let digits = String(value || '').replace(/[^0-9]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9][0-9]{9}$/.test(digits) ? digits : null;
};
function paysharpEnabled(user, env = process.env, onDecision) {
  const flag = String(env.Paysharp_test_active ?? 'false').trim().toLowerCase();
  const allowed = new Set(String(env.Paysharp_Test_users || '').split(',').map(normalizeMobile).filter(Boolean));
  const normalized = normalizeMobile(user.phoneNumber);
  const matched = normalized !== null && allowed.has(normalized);
  // An invalid flag must not accidentally enable payments for everyone.
  const enabled = flag === 'false' || (flag === 'true' && matched);
  if (onDecision) onDecision({
    Paysharp_test_active: env.Paysharp_test_active ?? null,
    Paysharp_Test_users: env.Paysharp_Test_users ?? null,
    normalizedFlag: flag,
    ownerPhoneNumber: user.phoneNumber ?? null,
    normalizedOwnerPhoneNumber: normalized,
    normalizedTestUsers: [...allowed],
    ownerMatchesTestUsers: matched,
    rolloutEnabled: enabled,
    rolloutReason: flag === 'false' ? 'GLOBAL_ROLLOUT' : flag !== 'true' ? 'INVALID_TEST_FLAG' : matched ? 'OWNER_LISTED' : 'OWNER_NOT_LISTED',
  });
  return enabled;
}
module.exports = { paysharpEnabled, normalizeMobile };
