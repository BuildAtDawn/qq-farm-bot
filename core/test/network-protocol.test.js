const assert = require('node:assert/strict');
const test = require('node:test');

const { DEFAULT_CLIENT_VERSION, resolveClientVersion } = require('../src/config/config');
const { loadProto } = require('../src/utils/proto');
const { buildHeartbeatBody, buildLoginBody } = require('../src/utils/network');

const EXPECTED_LOGIN_BODY =
  '180022002a1c0a11312e31352e302e325f3230323631303031120757696e646f777330003a0731323334353637'
  + '42180a0012001a0022002a086f746865722d717130023a0042004a00';
const EXPECTED_HEARTBEAT_BODY = '08f9d6ffc5041211312e31352e302e325f32303236313030311800';

test.before(async () => loadProto());

test('default client protocol is upgraded without replacing custom versions', () => {
  assert.equal(DEFAULT_CLIENT_VERSION, '1.15.0.2_20261001');
  assert.equal(resolveClientVersion('1.3.0_20260101'), DEFAULT_CLIENT_VERSION);
  assert.equal(resolveClientVersion('1.13.0.5_20260723'), DEFAULT_CLIENT_VERSION);
  assert.equal(resolveClientVersion('1.13.2.9_20260723'), DEFAULT_CLIENT_VERSION);
  assert.equal(resolveClientVersion('1.14.0.4_20260911'), DEFAULT_CLIENT_VERSION);
  assert.equal(resolveClientVersion('1.15.0.1_20261001'), DEFAULT_CLIENT_VERSION);
  assert.equal(resolveClientVersion('1.15.0.2_20261001'), '1.15.0.2_20261001');
  assert.equal(resolveClientVersion('1.15.0.3_20261001'), '1.15.0.3_20261001');
  assert.equal(resolveClientVersion('custom-build'), 'custom-build');
});

test('default login request keeps the captured layout with the updated client version', () => {
  assert.equal(buildLoginBody().toString('hex'), EXPECTED_LOGIN_BODY);
});

test('custom device protocol keeps its explicit fingerprint fields', () => {
  const body = buildLoginBody({
    enabled: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14)',
    deviceBrand: 'Xiaomi',
    deviceModel: 'Xiaomi 14 Ultra',
    deviceId: 'device-14-ultra',
  });
  assert.notEqual(body.toString('hex'), EXPECTED_LOGIN_BODY);
});

test('heartbeat request keeps the captured layout with the updated client version', () => {
  assert.equal(buildHeartbeatBody(1220537209).toString('hex'), EXPECTED_HEARTBEAT_BODY);
});
