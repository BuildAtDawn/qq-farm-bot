const test = require('node:test');
const assert = require('node:assert/strict');
const protobuf = require('protobufjs');
const { createSolarTermsService } = require('../src/services/activity-solar-terms');
const { solarTermsConfig, isSolarQuizActive, parseSolarTime } = require('../src/config/solar-terms');
const root = new protobuf.Root();
root.loadSync([require.resolve('../src/proto/corepb.proto'), require.resolve('../src/proto/solarterms.proto')], { keepCase: true });
const types = Object.fromEntries(['GetSolarTermsV2Request', 'GetSolarTermsV2Reply', 'AnswerSolarTermsRequest', 'AnswerSolarTermsReply']
  .map(name => [name, root.lookupType(`gamepb.solartermspb.${name}`)]));

function fixture(overrides = {}) {
  let time = solarTermsConfig.get(401).startTime;
  let connected = true;
  let state = {
    id: 401, window_status: 2, open_start_time: time, open_end_time: solarTermsConfig.get(401).endTime,
    rewards: [{ id: 20165, count: 20 }], question_rewards: [{ id: 20165, count: 10 }, { id: 1002, count: 100 }],
    ...overrides,
  };
  const calls = [];
  let failRefresh = false;
  let failAnswer = false;
  let reads = 0;
  let onRead = () => {};
  const service = createSolarTermsService({
    types, now: () => time, mapItem: item => ({ id: Number(item.id), count: Number(item.count) }),
    assertConnected: () => { if (!connected) throw new Error('连接已断开'); },
    send: async (serviceName, method, bytes) => {
      assert.equal(serviceName, 'gamepb.solartermspb.SolarTermsV2Service');
      calls.push(method);
      if (method === 'GetSolarTermsV2') {
        if (failRefresh && reads++) throw new Error('fixture refresh failed');
        const serverTime = time;
        onRead();
        return { body: types.GetSolarTermsV2Reply.encode({ events: [state], server_time: serverTime }).finish() };
      }
      const request = types.AnswerSolarTermsRequest.decode(bytes);
      assert.equal(Number(request.id), Number(state.id));
      if (failAnswer) throw new Error('fixture transport failed');
      const correct = request.option_index === solarTermsConfig.get(Number(state.id)).correctOptionIndex;
      state = { ...state, quiz_claimed: correct, quiz_wrong_today: !correct, wrong_options: correct ? [] : [request.option_index] };
      return { body: types.AnswerSolarTermsReply.encode({ correct, rewards: correct ? state.question_rewards : [], updated_event: state }).finish() };
    },
  });
  return { ...service, calls, setTime: value => { time = value; }, disconnect: () => { connected = false; },
    failRefresh: () => { failRefresh = true; }, failAnswer: () => { failAnswer = true; }, onRead: callback => { onRead = callback; } };
}

test('official SolarTermsV2 answer request encodes id and zero-based option', () => {
  const root = new protobuf.Root();
  root.loadSync([
    require.resolve('../src/proto/corepb.proto'),
    require.resolve('../src/proto/solarterms.proto'),
  ], { keepCase: true });
  const Type = root.lookupType('gamepb.solartermspb.AnswerSolarTermsRequest');
  assert.equal(Buffer.from(Type.encode(Type.create({ id: 7, option_index: 1 })).finish()).toString('hex'), '08071001');
  assert.equal(Buffer.from(Type.encode(Type.create({ id: 401, option_index: 0 })).finish()).toString('hex'), '0891031000');
  assert.equal(Buffer.from(Type.encode(Type.create({ id: 402, option_index: 2 })).finish()).toString('hex'), '0892031002');
});

test('SolarTermsV2 event keeps separate base and quiz claim state', () => {
  const { normalizeSolarTermsV2Event } = require('../src/services/activity');
  const term = normalizeSolarTermsV2Event({
    id: 7,
    window_status: 2,
    open_start_time: 100,
    open_end_time: 200,
    direct_claimed: true,
    quiz_claimed: false,
    quiz_wrong_today: true,
    wrong_options: [2],
    rewards: [{ id: 1001, count: 1 }],
    question_rewards: [{ id: 1002, count: 2 }],
  });
  assert.equal(term.directClaimed, true);
  assert.equal(term.quizClaimed, false);
  assert.equal(term.quizWrongToday, true);
  assert.deepEqual(term.wrongOptions, [2]);
  assert.equal(term.claimable, false);
  assert.equal(term.questionRewards[0].count, 2);
});

test('bundled official questions preserve four options, zero answer, timezone and old names', () => {
  assert.equal(solarTermsConfig.size, 13);
  assert.equal(solarTermsConfig.get(101).name, '端午');
  assert.equal(solarTermsConfig.get(401).correctOptionIndex, 0);
  assert.equal(solarTermsConfig.get(401).options[0], 'A.敬老节');
  assert.equal(solarTermsConfig.get(402).options[2], 'C.最后一个');
  assert.equal(solarTermsConfig.get(304).correctOptionIndex, null);
  assert.equal(parseSolarTime('2026-10-18 0:00:00'), Date.parse('2026-10-17T16:00:00Z') / 1000);
  assert.equal(parseSolarTime(''), 0);
});

test('manual correct answer grants only returned rewards and leaves base gift independent', async () => {
  const f = fixture();
  const before = await f.getInfo();
  assert.equal(before.terms[0].answerable, true);
  assert.equal(before.terms[0].options.length, 4);
  const result = await f.answer(401, 0);
  assert.equal(result.correct, true);
  assert.equal(result.solarTerms.terms[0].quizClaimed, true);
  assert.equal(result.solarTerms.terms[0].claimable, true);
  assert.deepEqual(result.rewards, [{ id: 20165, count: 10 }, { id: 1002, count: 100 }]);
  await assert.rejects(f.answer(401, 0), /已领取/);
  assert.equal(f.calls.filter(method => method === 'AnswerSolarTerms').length, 1);
});

test('wrong answer is preserved and another attempt is blocked for today', async () => {
  const f = fixture();
  const result = await f.answer(401, 1);
  assert.equal(result.correct, false);
  assert.deepEqual(result.rewards, []);
  assert.equal(result.solarTerms.terms[0].quizWrongToday, true);
  assert.deepEqual(result.solarTerms.terms[0].wrongOptions, [1]);
  await assert.rejects(f.answer(401, 0), /今日答错/);
});

test('claim guards reject unavailable server states, absent config and previous wrong options without mutation', async () => {
  for (const overrides of [
    { window_status: 0 }, { window_status: 1 }, { window_status: 3 }, { open_start_time: 0 },
    { open_end_time: 1 }, { quiz_claimed: true }, { quiz_wrong_today: true },
    { id: 999 }, { id: 304 }, { wrong_options: [0] },
  ]) {
    const f = fixture(overrides);
    await assert.rejects(f.answer(overrides.id || 401, 0));
    assert.deepEqual(f.calls, ['GetSolarTermsV2'], JSON.stringify(overrides));
  }
  for (const value of [null, '', undefined, '0', NaN, -1, 4, 0.5]) {
    const f = fixture();
    await assert.rejects(f.answer(401, value), /参数无效/);
    assert.deepEqual(f.calls, []);
  }
});

test('server and official date boundaries are inclusive and enforced before sending', async () => {
  const config = solarTermsConfig.get(401);
  for (const [time, allowed] of [[config.startTime - 1, false], [config.startTime, true], [config.endTime, true], [config.endTime + 1, false]]) {
    const f = fixture();
    f.setTime(time);
    if (allowed) assert.equal((await f.answer(401, 0)).correct, true);
    else await assert.rejects(f.answer(401, 0), /时间/);
  }
  const f = fixture();
  f.onRead(() => f.setTime(config.endTime + 1));
  await assert.rejects(f.answer(401, 0), /活动时间/);
  assert.deepEqual(f.calls, ['GetSolarTermsV2']);
});

test('manual and automatic submissions share a concurrency guard', async () => {
  const f = fixture();
  const first = f.answer(401, 0);
  await assert.rejects(f.answer(401, 0), /正在提交/);
  const errors = [];
  await f.autoClaim({ enabled: () => true, onResult() {}, onError: error => errors.push(error) });
  await first;
  assert.equal(f.calls.filter(method => method === 'AnswerSolarTerms').length, 1);
});

test('successful mutation remains successful with patched state if subsequent refresh fails', async () => {
  const f = fixture();
  f.failRefresh();
  const result = await f.answer(401, 0);
  assert.equal(result.ok, true);
  assert.match(result.solarTerms.warning, /刷新失败/);
  assert.equal(result.solarTerms.terms[0].quizClaimed, true);
  assert.equal(result.solarTerms.terms[0].answerable, false);
  assert.equal(f.calls.filter(method => method === 'AnswerSolarTerms').length, 1);
});

test('automation uses configured answer including zero and observes disabled/changed/disconnected state', async () => {
  for (const id of [401, 402]) {
    const config = solarTermsConfig.get(id);
    const f = fixture({ id, direct_claimed: true, open_start_time: config.startTime, open_end_time: config.endTime });
    f.setTime(config.startTime);
    const results = [];
    await f.autoClaim({ enabled: () => true, onResult: result => results.push(result), onError: error => { throw error; } });
    assert.equal(results[0].correct, true);
    assert.equal(results[0].solarTerms.terms[0].claimable, false);
  }
  const f = fixture();
  await f.autoClaim({ enabled: () => false, onResult() {}, onError() {} });
  assert.deepEqual(f.calls, []);
  let enabled = true;
  f.onRead(() => { enabled = false; });
  await assert.rejects(f.answer(401, 0, () => enabled), /已关闭/);
  assert.deepEqual(f.calls, ['GetSolarTermsV2']);
  const disconnected = fixture();
  disconnected.onRead(disconnected.disconnect);
  await assert.rejects(disconnected.answer(401, 0), /连接已断开/);
  assert.deepEqual(disconnected.calls, ['GetSolarTermsV2']);
});

test('uncertain mutation failure is not retried and automatic failures are observable', async () => {
  const f = fixture();
  f.failAnswer();
  const errors = [];
  await f.autoClaim({ enabled: () => true, onResult() { assert.fail('unexpected success'); }, onError: error => errors.push(error.message) });
  assert.deepEqual(errors, ['fixture transport failed']);
  assert.equal(f.calls.filter(method => method === 'AnswerSolarTerms').length, 1);
});

test('quiz automation defaults off, survives overlapping windows and clears after all quizzes expire', () => {
  const store = require('../src/models/store');
  const first = solarTermsConfig.get(401);
  const last = solarTermsConfig.get(402);
  assert.equal(store.getDefaultAccountConfig().automation.star_solar_quiz_claim, false);
  for (const [now, expected] of [[first.startTime - 1, false], [first.startTime, true], [first.endTime, true],
    [first.endTime + 1, true], [last.endTime, true], [last.endTime + 1, false]]) {
    const automation = { star_solar_claim: true, star_solar_quiz_claim: true };
    store._test.disableHiddenActivityAutomation(automation, now);
    assert.equal(isSolarQuizActive(now), expected);
    assert.equal(automation.star_solar_quiz_claim, expected);
    assert.equal(automation.star_solar_claim, true);
  }
});

test('quiz automation expiry is persisted on startup and while running without clearing base gift', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const start = solarTermsConfig.get(401).startTime;
  const end = solarTermsConfig.get(402).endTime;
  for (const startup of [true, false]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solar-quiz-expiry-'));
    try {
      fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ accountConfigs: {
        fixture: { automation: { star_solar_quiz_claim: true, star_solar_claim: true } },
      } }));
      execFileSync(process.execPath, ['-e', `
        Date.now = () => ${startup ? end + 1 : start} * 1000;
        const store = require('./src/models/store');
        Date.now = () => ${end + 1} * 1000;
        store.persistInactiveActivityAutomation();
      `], { cwd: path.join(__dirname, '..'), env: { ...process.env, FARM_DATA_DIR: dir }, stdio: 'pipe' });
      const saved = JSON.parse(fs.readFileSync(path.join(dir, 'store.json')));
      assert.equal(saved.accountConfigs.fixture.automation.star_solar_quiz_claim, false);
      assert.equal(saved.accountConfigs.fixture.automation.star_solar_claim, true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});
