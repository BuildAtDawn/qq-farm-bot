const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-wx-status-'));
process.env.FARM_DATA_DIR = dataDir;
const store = require('../src/models/store');
const { WxLoginService } = require('../src/services/wx-login/service');
const adapter = require('../src/services/wx-login-adapter');
const { createDataProvider } = require('../src/runtime/data-provider');
const { registerAdminAccountRoutes } = require('../src/controllers/admin-account-routes');
test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('credential renewal records success and failure, retaining rotated tokens without advancing success timestamp', async (t) => {
  const original = WxLoginService.prototype.refreshLoginBuffer;
  t.after(() => { WxLoginService.prototype.refreshLoginBuffer = original; });
  store.addOrUpdateAccount({ name: 'fixture', platform: 'wx', wxid: 'openid', loginBuffer: 'old-buffer', refreshtoken: 'old-refresh', accesstoken: 'old-access' });
  const account = store.getAccounts().accounts[0];
  WxLoginService.prototype.refreshLoginBuffer = async () => ({ loginBuffer: 'new-buffer', refreshtoken: 'new-refresh', accesstoken: 'new-access' });
  const before = Date.now();
  assert.equal((await adapter.keepWxCredentialAlive(account)).Success, true);
  const renewed = store.getAccounts().accounts[0];
  assert.ok(renewed.wxCredentialRefreshedAt >= before);
  assert.equal(renewed.wxCredentialRefreshError, '');
  assert.equal(renewed.refreshtoken, 'new-refresh');
  assert.equal(renewed.expires_in, 7200);
  assert.ok(renewed.expires_at >= before + 7200000);
  WxLoginService.prototype.refreshLoginBuffer = async () => { throw Object.assign(new Error('fixture buffer error'), { refreshtoken: 'rotated-refresh', accesstoken: 'rotated-access' }); };
  assert.equal((await adapter.keepWxCredentialAlive(renewed)).Success, false);
  const failed = store.getAccounts().accounts[0];
  assert.equal(failed.wxCredentialRefreshedAt, renewed.wxCredentialRefreshedAt);
  assert.ok(failed.wxCredentialLastAttemptAt >= renewed.wxCredentialLastAttemptAt);
  assert.match(failed.wxCredentialRefreshError, /续期失败/);
  assert.equal(failed.refreshtoken, 'rotated-refresh');
});

test('authorization-only provider refresh never requests Code or restarts a worker', async (t) => {
  const original = adapter.keepWxCredentialAlive;
  t.after(() => { adapter.keepWxCredentialAlive = original; });
  let renewals = 0;
  adapter.keepWxCredentialAlive = async account => { assert.equal(account.id, '1'); renewals++; return { Success: true }; };
  const provider = createDataProvider({ store, getAccounts: () => store.getAccounts(), workers: {}, refreshAccountCode: () => assert.fail('must not issue Code'), restartWorker: () => assert.fail('must not restart') });
  assert.deepEqual(await provider.refreshWxCredential('1'), { ok: true });
  assert.equal(renewals, 1);
  const publicAccount = provider.getAccounts().accounts[0];
  assert.equal(publicAccount.refreshtoken, undefined);
  assert.equal(publicAccount.accesstoken, undefined);
  assert.ok(publicAccount.expires_at);
  assert.ok(publicAccount.wxCredentialRefreshedAt);
});

test('valid access token requests Code directly; rejected or expired credentials refresh once', async (t) => {
  const originalRefresh = WxLoginService.prototype.refreshLoginBuffer;
  const originalIssue = WxLoginService.prototype.issueCode;
  t.after(() => {
    WxLoginService.prototype.refreshLoginBuffer = originalRefresh;
    WxLoginService.prototype.issueCode = originalIssue;
  });
  let renewals = 0;
  let issues = 0;
  WxLoginService.prototype.refreshLoginBuffer = async () => {
    renewals++;
    return { loginBuffer: 'fresh', refreshtoken: 'rolling', accesstoken: 'access', expires_in: 3600 };
  };
  WxLoginService.prototype.issueCode = async () => { issues++; return 'code'; };
  store.addOrUpdateAccount({ id: '1', expires_at: Date.now() + 60000 });
  assert.equal((await adapter.getFarmCode('openid', { accountId: '1' })).Success, true);
  assert.equal(renewals, 0);
  assert.equal(issues, 1);
  store.addOrUpdateAccount({ id: '1', expires_at: Date.now() - 1 });
  assert.equal((await adapter.getFarmCode('openid', { accountId: '1' })).Success, true);
  assert.equal(renewals, 1);
  assert.equal(issues, 2);
  assert.equal(store.getAccounts().accounts[0].expires_in, 3600);
  WxLoginService.prototype.issueCode = async () => {
    if (++issues === 3) throw new Error('ManualAuth rejected');
    return 'retry-code';
  };
  assert.equal((await adapter.getFarmCode('openid', { accountId: '1' })).Success, true);
  assert.equal(renewals, 2);
  assert.equal(issues, 4);
  WxLoginService.prototype.issueCode = async () => { throw new Error('socket read timeout'); };
  assert.equal((await adapter.getFarmCode('openid', { accountId: '1' })).Success, false);
  assert.equal(renewals, 2);
});

test('keepalive skips fresh tokens, rechecks inside credential lock, and backs off failures', async (t) => {
  const original = WxLoginService.prototype.refreshLoginBuffer;
  t.after(() => { WxLoginService.prototype.refreshLoginBuffer = original; });
  let calls = 0;
  WxLoginService.prototype.refreshLoginBuffer = async () => {
    calls++;
    return { loginBuffer: 'buffer', refreshtoken: 'rolling', accesstoken: 'access' };
  };
  store.addOrUpdateAccount({ id: '1', expires_at: Date.now() + 7200000, wxCredentialRefreshError: '' });
  let account = store.getAccounts().accounts[0];
  assert.equal((await adapter.keepWxCredentialAlive(account, { onlyIfDue: true })).skipped, true);
  assert.equal(calls, 0);
  store.addOrUpdateAccount({ id: '1', expires_at: Date.now() + 45 * 60000 });
  account = store.getAccounts().accounts[0];
  await Promise.all([adapter.keepWxCredentialAlive(account, { onlyIfDue: true }), adapter.keepWxCredentialAlive(account, { onlyIfDue: true })]);
  assert.equal(calls, 1);
  store.addOrUpdateAccount({ id: '1', expires_at: Date.now() - 1 });
  WxLoginService.prototype.refreshLoginBuffer = async () => { calls++; throw new Error('network'); };
  assert.equal((await adapter.keepWxCredentialAlive(account, { onlyIfDue: true })).Success, false);
  assert.equal((await adapter.keepWxCredentialAlive(account, { onlyIfDue: true })).skipped, true);
  assert.equal(calls, 2);
});

test('successful credential renewal is persisted even if issuing farm Code subsequently fails', async (t) => {
  const originalRefresh = WxLoginService.prototype.refreshLoginBuffer;
  const originalIssue = WxLoginService.prototype.issueCode;
  t.after(() => {
    WxLoginService.prototype.refreshLoginBuffer = originalRefresh;
    WxLoginService.prototype.issueCode = originalIssue;
  });
  let calls = 0;
  WxLoginService.prototype.issueCode = async () => { throw new Error(++calls === 1 ? 'ManualAuth rejected' : 'fixture farm code failure'); };
  WxLoginService.prototype.refreshLoginBuffer = async () => ({ loginBuffer: 'renewed-before-code', refreshtoken: 'renewed-token', accesstoken: 'renewed-access' });
  const result = await adapter.getFarmCode('openid', { accountId: '1' });
  assert.equal(result.Success, false);
  assert.match(result.Message, /授权已续期/);
  const saved = store.getAccounts().accounts[0];
  assert.equal(saved.loginBuffer, 'renewed-before-code');
  assert.equal(saved.refreshtoken, 'renewed-token');
  assert.equal(saved.wxCredentialRefreshError, '');
  assert.ok(saved.wxCredentialRefreshedAt);
});

test('batch credential and Code routes are separate and obey account ownership', async () => {
  const routes = new Map();
  const accounts = [
    { id: '1', platform: 'wx', wxid: 'wx1', username: 'alice' },
    { id: '2', platform: 'wx', wxid: 'wx2', username: 'bob' },
    { id: '3', platform: 'qq', username: 'alice' },
  ];
  const renewed = [];
  const relogins = [];
  registerAdminAccountRoutes({
    app: Object.fromEntries(['get', 'post', 'delete'].map(method => [method, (url, handler) => routes.set(`${method} ${url}`, handler)])),
    getAccountsForUser: () => accounts,
    provider: { refreshWxCredential: async id => { renewed.push(id); return { ok: true }; }, refreshAccountCode: async id => { relogins.push(id); return { ok: true }; } },
  });
  async function invoke(pathname, currentUser) {
    let status = 200;
    let body;
    const res = { status: value => { status = value; return res; }, json: value => { body = value; return res; } };
    await routes.get(`post ${pathname}`)({ currentUser }, res);
    return { status, body };
  }
  assert.equal((await invoke('/api/accounts/refresh-wx-credentials')).status, 401);
  const result = await invoke('/api/accounts/refresh-wx-credentials', { username: 'alice', role: 'user' });
  assert.equal(result.body.data.success, 1);
  assert.deepEqual(renewed, ['1']);
  assert.deepEqual(relogins, []);
  await invoke('/api/accounts/refresh-wx-codes', { username: 'alice', role: 'user' });
  assert.deepEqual(relogins, ['1']);
  await invoke('/api/accounts/refresh-wx-credentials', { username: 'admin', role: 'admin' });
  assert.deepEqual(renewed, ['1', '1', '2']);
});
