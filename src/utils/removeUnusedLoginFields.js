// One-time schema cleanup only. Never converts old login numbers into members.
async function removeUnusedLoginFields(collection, { apply = false } = {}) {
  const indexes = (await collection.indexes()).filter(index =>
    Object.keys(index.key).length === 1 && index.key.phoneNumbers === 1);
  const filter = { $or: [{ phoneNumbers: { $exists: true } }, { membersMigratedAt: { $exists: true } }] };
  const documents = await collection.countDocuments(filter);
  if (apply) {
    // Drop first: unsetting a field under its unique index would conflict.
    for (const index of indexes) await collection.dropIndex(index.name);
    await collection.updateMany(filter, { $unset: { phoneNumbers: '', membersMigratedAt: '' } });
  }
  return { mode: apply ? 'apply' : 'dry-run', documents, indexes: indexes.map(index => index.name) };
}
module.exports = { removeUnusedLoginFields };
