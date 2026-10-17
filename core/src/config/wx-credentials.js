const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 7200;
const WX_CREDENTIAL_REFRESH_WINDOW_MS = 45 * 60000;
const WX_CREDENTIAL_RETRY_MS = 5 * 60000;

function tokenExpiry(expiresIn, acquiredAt = Date.now()) {
  const seconds = Number(expiresIn);
  const expires_in = Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
  return { expires_in, expires_at: acquiredAt + expires_in * 1000 };
}

function getAccessTokenExpiresAt(account) {
  const expiresAt = Number(account?.expires_at);
  if (Number.isFinite(expiresAt) && expiresAt > 0) return expiresAt;
  // Historical accounts only recorded the last successful credential update.
  const refreshedAt = Number(account?.wxCredentialRefreshedAt);
  return Number.isFinite(refreshedAt) && refreshedAt > 0
    ? tokenExpiry(account?.expires_in, refreshedAt).expires_at : 0;
}

function shouldRefreshWxCredential(account, now = Date.now()) {
  const expiresAt = getAccessTokenExpiresAt(account);
  return !expiresAt || expiresAt - now <= WX_CREDENTIAL_REFRESH_WINDOW_MS;
}

module.exports = {
  tokenExpiry, getAccessTokenExpiresAt, shouldRefreshWxCredential,
  WX_CREDENTIAL_RETRY_MS,
};
