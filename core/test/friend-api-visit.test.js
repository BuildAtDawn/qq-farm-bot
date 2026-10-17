const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');
const { normalizeVisitParams } = require('../src/services/farm-visit-params');

async function apiFixture(options = {}) {
  const protobuf = require('protobufjs');
  const root = await new protobuf.Root().load(path.join(__dirname, '../src/proto/visitpb.proto'), { keepCase: true });
  const types = Object.fromEntries(['EnterRequest', 'EnterReply', 'LeaveRequest', 'LeaveReply']
    .map(name => [`Visit${name}`, root.lookupType(`gamepb.visitpb.${name}`)]));
  let active = false;
  const calls = [];
  const requests = [];
  const mocks = {
    '../utils/proto': { types },
    '../models/store': { updateFriendDogInfoCache() {
      if (options.cacheError) throw new Error('cache failed');
    } },
    './interact': {},
    './friend-visit-session': {
      acquireFriendVisitSession: async () => { active = true; return {}; },
      releaseFriendVisitSession: token => { if (token) active = false; },
    },
    '../utils/network': {
      networkEvents: new (require('node:events').EventEmitter)(),
      async sendMsgAsync(service, method, payload) {
        const request = types[`Visit${method}Request`].decode(payload);
        requests.push(JSON.parse(JSON.stringify(request)));
        calls.push([service, method, Number(request.host_gid)]);
        if (options.fail === method) throw new Error(`${method} failed`);
        return { body: options.badEnter && method === 'Enter' ? Buffer.from([0xFF]) : Buffer.alloc(0) };
      },
    },
  };
  const filename = path.join(__dirname, '../src/services/friend-api.js');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, console, Date, Buffer, process: { env: {} },
    require: name => mocks[name] || localRequire(name),
  }, { filename });
  return { api: module.exports, calls, requests, types, active: () => active };
}

test('Leave releases the existing Enter session', async () => {
  const f = await apiFixture();
  await f.api.enterFriendFarm(123);
  assert.equal(f.active(), true);
  await f.api.leaveFriendFarm(123);
  assert.equal(f.active(), false);
  assert.deepEqual(f.calls, [
    ['gamepb.visitpb.VisitService', 'Enter', 123],
    ['gamepb.visitpb.VisitService', 'Leave', 123],
  ]);
});

test('Leave remains best-effort and releases the session on failure', async () => {
  const f = await apiFixture({ fail: 'Leave' });
  await f.api.enterFriendFarm(123);
  assert.equal(await f.api.leaveFriendFarm(123), undefined);
  assert.equal(f.active(), false);
});

test('failed Enter and undecodable replies never leave the shared visit lock occupied', async () => {
  for (const options of [{ fail: 'Enter' }, { badEnter: true }]) {
    const f = await apiFixture(options);
    await assert.rejects(() => f.api.enterFriendFarm(123));
    assert.equal(f.active(), false);
    assert.deepEqual(f.calls.map(call => call[1]), options.badEnter ? ['Enter', 'Leave'] : ['Enter']);
  }
});

test('post-Enter processing failure leaves the farm even if cleanup also fails', async () => {
  for (const fail of [undefined, 'Leave']) {
    const f = await apiFixture({ cacheError: true, fail });
    await assert.rejects(() => f.api.enterFriendFarm(123), /cache failed/);
    assert.equal(f.active(), false);
    assert.deepEqual(f.calls.map(call => call[1]), ['Enter', 'Leave']);
  }
});

test('all official Enter fields retain exact int64 values and opt-in defaults', async () => {
  const f = await apiFixture();
  const params = { reason: 0, host_type: 1, share_id: '9223372036854775807', share_cfg_id: '9007199254740993',
    share_open_id: 'test-open', share_key: 'test-key', msgboard_entry_id: 'test-entry' };
  await f.api.enterFriendFarm(123, { params });
  assert.deepEqual(f.requests[0], { host_gid: '123', ...params });
  await f.api.leaveFriendFarm(123, { host_type: 1 });
  assert.deepEqual(f.requests[1], { host_gid: '123', host_type: 1 });
  await f.api.enterFriendFarm(123);
  assert.deepEqual(f.requests[2], { host_gid: '123', reason: 2 });
  await f.api.leaveFriendFarm(123);
  assert.deepEqual(f.requests[3], { host_gid: '123' });
});

test('Enter matches the official encoder reconstruction for all eight fields', async () => {
  const { types } = await apiFixture();
  const sample = { host_gid: '9007199254740993', reason: 4, host_type: 1, share_id: '9223372036854775807',
    share_open_id: 'test-open', share_cfg_id: '9007199254740995', share_key: 'test-key', msgboard_entry_id: 'test-entry' };
  const bytes = types.VisitEnterRequest.encode(types.VisitEnterRequest.fromObject(sample)).finish();
  assert.equal(Buffer.from(bytes).toString('hex'),
    '0881808080808080101004180120ffffffffffffffff7f2a09746573742d6f70656e3083808080808080103a08746573742d6b6579420a746573742d656e747279');
  assert.deepEqual(JSON.parse(JSON.stringify(types.VisitEnterRequest.decode(bytes))), sample);
  const leave = types.VisitLeaveRequest.encode(types.VisitLeaveRequest.fromObject({ host_gid: '123', host_type: 19 })).finish();
  assert.equal(Buffer.from(leave).toString('hex'), '087b1013');
});

test('post-Enter failure preserves custom host_type in automatic cleanup', async () => {
  const f = await apiFixture({ cacheError: true });
  await assert.rejects(() => f.api.enterFriendFarm(123, { params: { host_type: 19 } }), /cache failed/);
  assert.deepEqual(f.requests[1], { host_gid: '123', host_type: 19 });
  assert.equal(f.active(), false);
});

test('invalid visit params fail before any WS operation', async () => {
  const f = await apiFixture();
  for (const params of [null, [], { reason: '4' }, { reason: 2147483648 }, { host_type: 1.5 },
    { share_id: '9223372036854775808' }, { share_id: 9007199254740992 }, { share_cfg_id: '1e3' },
    { share_key: {} }, { share_open_id: 'x'.repeat(4097) }, { shouldContinue: true }, { host_gid: '999' }]) {
    await assert.rejects(() => f.api.enterFriendFarm(123, { params }));
  }
  assert.throws(() => normalizeVisitParams({ reason: 2 }, 'home'));
  assert.equal(f.calls.length, 0);
  assert.deepEqual(normalizeVisitParams({ reason: -2147483648, host_type: 2147483647,
    share_id: '-9223372036854775808', share_cfg_id: '0' }),
  { reason: -2147483648, host_type: 2147483647, share_id: '-9223372036854775808', share_cfg_id: '0' });
});
