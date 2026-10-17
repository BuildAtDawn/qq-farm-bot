const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getDataFile } = require('./runtime-paths');

function isValidAccessCode(code) {
  return typeof code === 'string' && code.trim().length > 0 && code.length <= 128;
}

function createAdminAccessCodeStore(filePath = getDataFile('admin-access-code.json')) {
  let code = '';
  try {
    const config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (typeof config.accessCode !== 'string'
      || (config.accessCode !== '' && !isValidAccessCode(config.accessCode)))
      throw new Error('Invalid access code configuration');
    code = config.accessCode;
  }
  catch (error) {
    // A damaged/unreadable file must never reopen first-time setup.
    if (error.code !== 'ENOENT') throw error;
  }

  return {
    isConfigured: () => code !== '',
    matches(candidate) {
      if (!code || !isValidAccessCode(candidate)) return false;
      const digest = value => crypto.createHash('sha256').update(value).digest();
      return crypto.timingSafeEqual(digest(code), digest(candidate));
    },
    set(nextCode) {
      if (!isValidAccessCode(nextCode)) throw new Error('访问 Code 必须为 1～128 个字符，且不能全为空格');
      if (nextCode === code) return false;
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${crypto.randomBytes(8).toString('hex')}.tmp`;
      try {
        fs.writeFileSync(tempPath, `${JSON.stringify({ accessCode: nextCode }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        fs.renameSync(tempPath, filePath);
      }
      finally {
        fs.rmSync(tempPath, { force: true });
      }
      code = nextCode;
      return true;
    },
  };
}

module.exports = { createAdminAccessCodeStore, isValidAccessCode };
