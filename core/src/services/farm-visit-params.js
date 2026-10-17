const ENTER_FIELDS = ['reason', 'host_type', 'share_id', 'share_open_id', 'share_cfg_id', 'share_key', 'msgboard_entry_id'];
const INT64_FIELDS = new Set(['share_id', 'share_cfg_id']);
const STRING_FIELDS = new Set(['share_open_id', 'share_key', 'msgboard_entry_id']);

function normalizeVisitParams(input = {}, action = 'enter') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('访问参数必须是对象');
  const allowed = action === 'home' ? ['host_type'] : ENTER_FIELDS;
  const params = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key)) throw new Error(`不支持的访问参数: ${key}`);
    if (STRING_FIELDS.has(key)) {
      if (typeof value !== 'string' || value.length > 4096) throw new Error(`${key} 必须是长度不超过 4096 的字符串`);
      params[key] = value;
    } else if (INT64_FIELDS.has(key)) {
      if ((typeof value !== 'string' && typeof value !== 'number')
        || (typeof value === 'number' && !Number.isSafeInteger(value))
        || !/^-?(?:0|[1-9]\d*)$/.test(String(value))
        || String(value).length > 20
        || BigInt(value) < -(2n ** 63n) || BigInt(value) > 2n ** 63n - 1n) {
        throw new Error(`${key} 必须是 int64 范围内的十进制整数`);
      }
      params[key] = String(value);
    } else {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
        throw new Error(`${key} 必须是 int32 范围内的整数`);
      }
      params[key] = value;
    }
  }
  if (action === 'enter' && params.reason === undefined) params.reason = 2;
  return params;
}

module.exports = { normalizeVisitParams };
