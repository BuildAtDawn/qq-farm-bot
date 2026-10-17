const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenExpiry, getAccessTokenExpiresAt, shouldRefreshWxCredential } = require('../src/config/wx-credentials');
const { WxLoginService } = require('../src/services/wx-login/service');

test('token lifetime defaults to two hours and renewal starts at the 45-minute boundary', () => {
  for (const input of [undefined, null, '', 0, -1, Infinity, 'bad']) {
    assert.deepEqual(tokenExpiry(input, 1000), { expires_in: 7200, expires_at: 7201000 });
  }
  assert.deepEqual(tokenExpiry('3600', 1000), { expires_in: 3600, expires_at: 3601000 });
  const now = 10000000;
  assert.equal(shouldRefreshWxCredential({ expires_at: now + 2700001 }, now), false);
  for (const expires_at of [now + 2700000, now, now - 1, 0]) {
    assert.equal(shouldRefreshWxCredential({ expires_at }, now), true);
  }
  assert.equal(getAccessTokenExpiresAt({ wxCredentialRefreshedAt: 1000 }), 7201000);
  assert.equal(getAccessTokenExpiresAt({ refresh_token_observed_at: now }), 0);
});

test('refresh parses upstream TTL and retains expiry with rotated tokens when buffer retrieval fails', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  for (const camel of [false, true]) {
    for (const failBuffer of [false, true]) {
      global.fetch = async url => new Response(JSON.stringify(
        String(url).includes('refresh_token')
          ? { code: 0, [camel ? 'userInfo' : 'user_info']: camel
              ? { accessToken: 'access', refreshToken: 'refresh', expiresIn: 3600 }
              : { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 } }
          : failBuffer ? { code: -1 }
            : { code: 0, ext_info: { list_s: { login_buffer: { value: ['buffer'] } } } },
      ));
      const session = { openid: 'openid', refreshtoken: 'old', cookies: new Map(), refresh_token_observed_at: 1000 };
      const before = Date.now();
      const service = new WxLoginService();
      if (failBuffer) {
        await assert.rejects(service.refreshLoginBuffer(session), error => {
          assert.equal(error.accesstoken, 'access');
          assert.equal(error.refreshtoken, 'refresh');
          assert.equal(error.expires_in, 3600);
          assert.ok(error.expires_at >= before + 3600000);
          return true;
        });
      } else {
        const result = await service.refreshLoginBuffer(session);
        assert.equal(result.expires_in, 3600);
        assert.ok(result.expires_at >= before + 3600000);
      }
      assert.equal(session.refresh_token_observed_at, 1000);
    }
  }
});

test('QR confirmation records callback TTL and scan observation independently', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  for (const expires_in of [3600, undefined]) {
    global.fetch = async url => new Response(JSON.stringify(String(url).includes('pcyyb_oauth')
      ? { expires_in }
      : { code: 0, ext_info: { list_s: { login_buffer: { value: ['buffer'] } } } }));
    const session = { oauthCode: 'oauth', cookies: new Map([['openid', 'wx'], ['accesstoken', 'access'], ['refreshtoken', 'refresh']]) };
    const before = Date.now();
    await new WxLoginService().confirm(session);
    assert.equal(session.expires_in, expires_in || 7200);
    assert.ok(session.expires_at >= before + (expires_in || 7200) * 1000);
    assert.ok(session.refresh_token_observed_at >= before);
  }
});
