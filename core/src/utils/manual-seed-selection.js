function validateSeedIds(seedIds) {
  if (!Array.isArray(seedIds) || !seedIds.length || seedIds.length > 500
    || seedIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('请选择有效的背包种子');
  }
  return [...new Set(seedIds)];
}

module.exports = { validateSeedIds };
