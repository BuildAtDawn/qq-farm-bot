const { normalizeAutoCodeRefresh } = require('./account-maintenance');

const DEFAULT_SYSTEM_SETTINGS = Object.freeze({
    organicFertilizerDelayMinMs: 200,
    organicFertilizerDelayMaxMs: 300,
    publicWebOrigin: '',
    autoCodeRefresh: Object.freeze(normalizeAutoCodeRefresh())
});
const MAX_FERTILIZER_DELAY_MS = 60000;

function normalizePublicWebOrigin(value = '') {
    if (typeof value !== 'string') throw new Error('公网地址前缀必须是 HTTP/HTTPS 域名');
    const text = value.trim();
    if (!text) return '';
    let url;
    try { url = new URL(text); } catch { throw new Error('公网地址前缀必须是 HTTP/HTTPS 域名'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('公网地址前缀仅允许 HTTP/HTTPS 域名，不包含路径、参数或账号密码');
    }
    return url.origin;
}

function getMaturityReminderUrl(settings) {
    try {
        const origin = normalizePublicWebOrigin(settings?.publicWebOrigin);
        return origin ? `${origin}/open-weixin.html` : undefined;
    } catch { return undefined; }
}

function validateSystemSettings(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('系统设置格式无效');
    }
    const min = input.organicFertilizerDelayMinMs;
    const max = input.organicFertilizerDelayMaxMs;
    if (![min, max].every(value => Number.isInteger(value) && value >= 0 && value <= MAX_FERTILIZER_DELAY_MS)) {
        throw new Error('施肥间隔必须是 0～60000 毫秒的整数');
    }
    if (min > max) throw new Error('施肥间隔下限不能大于上限');
    const refresh = input.autoCodeRefresh;
    if (refresh !== undefined && (!refresh || typeof refresh !== 'object' || Array.isArray(refresh)
        || typeof refresh.enabled !== 'boolean' || typeof refresh.offlineEnabled !== 'boolean'
        || !Number.isInteger(refresh.intervalMinutes) || refresh.intervalMinutes < 1 || refresh.intervalMinutes > 1440
        || !Number.isInteger(refresh.offlineDelaySeconds) || refresh.offlineDelaySeconds < 1 || refresh.offlineDelaySeconds > 86400)) {
        throw new Error('账号保活设置无效：重登间隔为 1～1440 分钟，掉线等待为 1～86400 秒');
    }
    return {
        organicFertilizerDelayMinMs: min,
        organicFertilizerDelayMaxMs: max,
        publicWebOrigin: normalizePublicWebOrigin(input.publicWebOrigin),
        autoCodeRefresh: normalizeAutoCodeRefresh(refresh)
    };
}

function normalizeSystemSettings(input) {
    try {
        return validateSystemSettings(input);
    } catch {
        try {
            return validateSystemSettings({ ...input, publicWebOrigin: '' });
        } catch { return { ...DEFAULT_SYSTEM_SETTINGS, autoCodeRefresh: normalizeAutoCodeRefresh() }; }
    }
}

module.exports = {
    DEFAULT_SYSTEM_SETTINGS,
    validateSystemSettings,
    normalizeSystemSettings,
    normalizePublicWebOrigin,
    getMaturityReminderUrl
};
