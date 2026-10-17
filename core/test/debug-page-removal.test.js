const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { registerAdminFarmOperationRoutes } = require('../src/controllers/admin-farm-operation-routes');
const { createDataProvider } = require('../src/runtime/data-provider');

test('farm operation routes no longer expose page-only debug endpoints', () => {
  const routes = new Map();
  registerAdminFarmOperationRoutes({ app: { post: (route, handler) => routes.set(route, handler) } });
  assert.equal(routes.has('/api/debug/farm-visit'), false);
  assert.equal(routes.has('/api/debug/newbie-open'), false);
  assert.equal(routes.has('/api/farm/operate'), true);
  assert.equal(routes.has('/api/land/fertilize'), true);
});

test('provider and worker no longer dispatch page-only debug methods', () => {
  const provider = createDataProvider({});
  assert.equal('debugFarmVisit' in provider, false);
  assert.equal('debugNewbieOpen' in provider, false);
  const worker = fs.readFileSync(path.join(__dirname, '../src/core/worker.js'), 'utf8');
  assert.doesNotMatch(worker, /debugFarmVisit|debugNewbieOpen|services\/(?:farm-visit|newbie-open)-debug/);
});

test('shared protobuf definitions load without the deleted debug schema', async () => {
  const { loadProto, types } = require('../src/utils/proto');
  await loadProto();
  for (const name of ['VisitEnterRequest', 'VisitLeaveReply', 'ActivityListReply',
    'MilkTeaOperateRequest', 'PetDiaryOperateRequest', 'GetMonthCardInfosReply']) {
    assert.ok(types[name], name);
  }
  assert.equal(Object.keys(types).some(name => name.startsWith('NewbieDebug')), false);
});
