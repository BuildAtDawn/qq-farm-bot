const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { getDataFile } = require('../config/runtime-paths');
const { initialStages, stageChanges, stageStatistics } = require('./mutation-stages');

function accountFile(accountId, name) {
  if (!String(accountId || '').trim()) throw new Error('缺少账号');
  return getDataFile(path.join('mutations', Buffer.from(String(accountId)).toString('hex'), name));
}

// Each account has one writer (its Worker). Complete newline-delimited transactions
// are visible to readers; fsync completes before a successful write is reported.
function createMutationRepository(accountId) {
  const filename = accountFile(accountId, 'records.jsonl');
  const rows = new Map();
  const stages = new Map();
  const discoveries = new Map();
  const operations = new Map();
  const tables = { stages, discoveries, operations };
  let offset = 0;
  let nextId = 1;
  let fileIdentity = '';
  function refresh() {
    if (!fs.existsSync(filename)) return;
    const fd = fs.openSync(filename, 'r');
    let bytes;
    try {
      const stat = fs.fstatSync(fd);
      const identity = `${stat.dev}:${stat.ino}`;
      // Clearing replaces the journal atomically; cached readers must replay it.
      if (fileIdentity && fileIdentity !== identity) {
        rows.clear();
        for (const table of Object.values(tables)) table.clear();
        offset = 0;
        nextId = 1;
      }
      fileIdentity = identity;
      if (stat.size < offset) throw new Error('变异记录文件被截断');
      if (stat.size === offset) return;
      bytes = Buffer.alloc(stat.size - offset);
      fs.readSync(fd, bytes, 0, bytes.length, offset);
    }
    finally { fs.closeSync(fd); }
    const end = bytes.lastIndexOf(10);
    if (end < 0) return;
    for (const line of bytes.subarray(0, end).toString('utf8').split('\n')) {
      const transaction = JSON.parse(line);
      if (!Array.isArray(transaction.rows)) throw new Error('变异记录格式错误');
      if (transaction.nextId !== undefined) {
        if (!Number.isSafeInteger(transaction.nextId) || transaction.nextId < 1) throw new Error('变异记录序号错误');
        nextId = Math.max(nextId, transaction.nextId);
      }
      for (const row of transaction.rows) {
        if (!Number.isSafeInteger(row.id) || row.id < 1) throw new Error('变异记录序号错误');
        rows.set(row.id, row);
        nextId = Math.max(nextId, row.id + 1);
      }
      for (const [name, table] of Object.entries(tables)) {
        for (const item of transaction[name] || []) table.set(item.id, item);
      }
    }
    offset += end + 1;
  }
  function commit(changes, related = {}) {
    if (!changes.length && !Object.values(related).some(items => items.length)) return;
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    // Never append past an incomplete write: it needs explicit operator inspection.
    if (fs.existsSync(filename) && fs.statSync(filename).size !== offset) {
      throw new Error('变异记录存在未完成写入，已停止记录');
    }
    const bytes = Buffer.from(`${JSON.stringify({ rows: changes, ...related })}\n`);
    const fd = fs.openSync(filename, 'a');
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
      const stat = fs.fstatSync(fd);
      fileIdentity = `${stat.dev}:${stat.ino}`;
    }
    finally { fs.closeSync(fd); }
    offset += bytes.length;
    for (const row of changes) rows.set(row.id, row);
    for (const [name, table] of Object.entries(tables)) {
      for (const item of related[name] || []) table.set(item.id, item);
    }
  }
  function active(landId) {
    return [...rows.values()].find(row => row.landId === landId && row.status === 'growing');
  }
  function statistics(parents = [...rows.values()]) {
    let completedRecords = 0;
    let mutatedRecords = 0;
    const types = new Map();
    for (const row of parents) {
      if (row.status !== 'harvested' || !Array.isArray(row.mutations)
        || !Number.isSafeInteger(row.mutationCount) || row.mutationCount < 0) continue;
      completedRecords++;
      const unique = new Map(row.mutations.map(item => [item.id, item]));
      if (unique.size) mutatedRecords++;
      for (const item of unique.values()) {
        const type = types.get(item.id) || { id: item.id, name: item.name, count: 0 };
        type.count++;
        types.set(item.id, type);
      }
    }
    return {
      completedRecords,
      mutatedRecords,
      mutationRate: completedRecords ? mutatedRecords / completedRecords * 100 : null,
      types: [...types.values()].sort((a, b) => b.count - a.count || a.id - b.id)
        .map(item => ({ ...item, percentage: item.count / completedRecords * 100 })),
    };
  }
  return {
    clear() {
      refresh();
      const deleted = rows.size;
      const temporary = `${filename}.${randomUUID()}.tmp`;
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      try {
        const fd = fs.openSync(temporary, 'wx', 0o600);
        try {
          fs.writeFileSync(fd, `${JSON.stringify({ rows: [], nextId })}\n`);
          fs.fsyncSync(fd);
        } finally { fs.closeSync(fd); }
        fs.renameSync(temporary, filename);
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
      refresh();
      return { deleted };
    },
    insert(data) {
      refresh();
      const old = active(data.landId);
      const row = {
        ...data, id: nextId++, accountId: String(accountId), status: 'growing',
        harvestedAt: null, mutations: null, mutationCount: null,
      };
      commit([...(old ? [{ ...old, status: 'unknown' }] : []), row], { stages: initialStages(row) });
      return row;
    },
    capture(landId, identity) {
      refresh();
      const row = active(landId);
      if (!row) return null;
      if (!identity || row.identity !== identity) {
        commit([{ ...row, status: 'unknown' }]);
        return null;
      }
      return { ...row };
    },
    observe(observations) {
      refresh();
      const changes = [];
      const related = { stages: [], discoveries: [] };
      for (const observed of observations) {
        const row = active(observed.landId);
        if (!row) continue;
        if (observed.recordId && observed.recordId !== row.id) continue;
        if (observed.requestedAt && row.lastObservationRequestAt && observed.requestedAt < row.lastObservationRequestAt) continue;
        const previousStage = stages.get(`${row.id}:${row.currentStage}`);
        // Fertilizer actions have their own evidence rows. Repeated unchanged
        // background reads should not expand the journal on every farm poll.
        if (observed.source === 'lands' && previousStage?.sources.includes('lands')
          && row.identity === observed.identity && row.phaseCount === observed.phaseCount && row.phaseBegin === observed.phaseBegin
          && JSON.stringify(previousStage.latestMutations) === JSON.stringify(observed.mutationsKnown ? observed.mutations : null)) {
          rows.set(row.id, { ...row, lastObservationRequestAt: observed.requestedAt ?? row.lastObservationRequestAt });
          continue;
        }
        const replaced = row.identity !== observed.identity || !observed.phaseCount
          || observed.phaseCount > row.phaseCount
          || (observed.phaseCount === row.phaseCount && observed.phaseBegin > row.phaseBegin);
        if (replaced) changes.push({ ...row, status: 'unknown' });
        else {
          let next = { ...row, phaseCount: observed.phaseCount, phaseBegin: observed.phaseBegin };
          if (row.schemaVersion === 2 && observed.observedAt) {
            const change = stageChanges(next, observed, stages, discoveries);
            next = change.row;
            changes.push(next);
            related.stages.push(...change.stages);
            related.discoveries.push(...change.discoveries);
          } else if (observed.phaseCount !== row.phaseCount || observed.phaseBegin !== row.phaseBegin) {
            changes.push(next);
          }
        }
      }
      commit(changes, related);
    },
    activeRecord(landId) {
      refresh();
      const row = active(landId);
      return row ? { ...row } : null;
    },
    recordOperation(operation) {
      refresh();
      // Never resurrect a record deleted while the game request was in flight.
      if (!rows.has(operation.recordId)) return false;
      commit([], { operations: [operation] });
      return true;
    },
    finish(id, mutations, harvestedAt) {
      refresh();
      const row = rows.get(id);
      if (!row || !['growing', 'harvesting'].includes(row.status)) return false;
      const unique = [...new Map(mutations.map(item => [item.id, item])).values()];
      commit([{ ...row, status: 'harvested', harvestedAt, mutations: unique, mutationCount: unique.length }]);
      return true;
    },
    prepareHarvest(captures) {
      refresh();
      commit(captures.flatMap(capture => {
        const row = rows.get(capture.id);
        return row?.status === 'growing'
          ? [{ ...row, status: 'harvesting', pendingMutations: capture.mutations }]
          : [];
      }));
    },
    abandonHarvest(ids) {
      refresh();
      commit(ids.flatMap(id => {
        const row = rows.get(id);
        return row?.status === 'harvesting' ? [{ ...row, status: 'unknown' }] : [];
      }));
    },
    invalidate(landIds, status = 'removed') {
      refresh();
      commit([...rows.values()].filter(row => row.status === 'growing' && landIds.includes(row.landId))
        .map(row => ({ ...row, status })));
    },
    list({ mutation = '', status = '', seedId = '', testId = '', view = 'records', recordId = '', page = 1, pageSize = 50, all = false } = {}) {
      refresh();
      const parents = [...rows.values()].filter(row => (!seedId || row.seedId === Number(seedId))
        && (!testId || row.testId === testId) && (!recordId || row.id === Number(recordId)));
      const selected = parents.filter(row =>
        (!status || row.status === status)
        && (view !== 'records' || !mutation || (mutation === 'none' ? row.mutationCount === 0 : row.mutations?.some(item => item.id === Number(mutation)))));
      const byId = new Map(selected.map(row => [row.id, row]));
      const detailTable = tables[view];
      const filtered = detailTable
        ? [...detailTable.values()].filter(item => byId.has(item.recordId))
          .map(item => ({ ...byId.get(item.recordId), ...item }))
          .filter(item => !mutation || (view === 'stages'
            ? mutation === 'none' ? item.checked && !item.newMutations.length : item.newMutations.some(m => m.id === Number(mutation))
            : view === 'discoveries' ? item.mutationId === Number(mutation) : true))
        : selected;
      filtered.sort((a, b) => a.plantedAt - b.plantedAt || (a.recordId || a.id) - (b.recordId || b.id)
        || (a.stage || 0) - (b.stage || 0) || (a.firstObservedAt || a.requestedAt || 0) - (b.firstObservedAt || b.requestedAt || 0)
        || String(a.id).localeCompare(String(b.id)));
      const types = [...new Map([
        ...[...rows.values()].flatMap(row => row.mutations || []),
        ...[...discoveries.values()].map(item => ({ id: item.mutationId, name: item.name })),
      ].map(item => [item.id, item])).values()];
      const size = Math.min(200, Math.max(1, Number(pageSize) || 50));
      const current = Math.max(1, Number(page) || 1);
      return {
        rows: all ? filtered : filtered.reverse().slice((current - 1) * size, current * size),
        total: filtered.length, page: current, pageSize: size, mutationTypes: types,
        statistics: statistics(parents),
        stageStatistics: stageStatistics(parents, stages),
        seeds: [...new Map([...rows.values()].map(row => [row.seedId, { id: row.seedId, name: row.seedName }])).values()],
        tests: [...new Set([...rows.values()].map(row => row.testId).filter(Boolean))],
      };
    },
  };
}

const repositories = new Map();
function getMutationRepository(accountId) {
  const key = accountFile(accountId, 'records.jsonl');
  if (!repositories.has(key)) repositories.set(key, createMutationRepository(accountId));
  return repositories.get(key);
}

function exportMutationCsv(rows) {
  const cell = value => `"${String(value ?? '').replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;
  const date = value => value ? new Date(value).toISOString() : '';
  const headers = ['ID', '账号', '种子ID', '种子', '土地', '种植时间(UTC)', '收获时间(UTC)', '状态', '变异种数', '变异ID', '最终变异', '来源', '测试任务', '轮次', '作物ID', '总阶段', '阶段配置快照', '阶段数据质量'];
  const csv = [headers, ...[...rows].sort((a, b) => a.plantedAt - b.plantedAt || a.id - b.id).map(row => [
    row.id, row.accountId, row.seedId, row.seedName, row.landId, date(row.plantedAt), date(row.harvestedAt),
    row.status, row.mutationCount, row.mutations?.map(item => item.id).join('|'),
    row.mutations?.map(item => item.name).join('、'), row.source, row.testId, row.round,
    row.plantId, row.totalStages, row.stagePlan ? JSON.stringify(row.stagePlan) : '', row.stageQuality,
  ])].map(row => row.map(cell).join(',')).join('\r\n');
  return `\uFEFF${csv}`;
}

function exportMutationDetailsCsv(rows, view) {
  if (view === 'records') return exportMutationCsv(rows);
  const date = value => value ? new Date(value).toISOString() : '';
  const names = items => items?.map(item => `${item.id}:${item.name}`).join('|');
  const definitions = {
    stages: [
      ['阶段', r => r.stage], ['总阶段', r => r.totalStages], ['阶段名称', r => r.name],
      ['已检查', r => r.checked], ['服务端阶段开始(UTC)', r => date(r.serverEnteredAt)],
      ['首次观察(UTC)', r => date(r.firstObservedAt)], ['最近留存观察(UTC)', r => date(r.lastObservedAt)],
      ['首次发现变异', r => r.checked ? names(r.newMutations) : null],
      ['观察到的变异', r => r.checked ? names(r.observedMutations) : null],
      ['观测来源', r => r.sources.join('|')], ['留存快照数', r => r.observationCount],
    ],
    discoveries: [
      ['变异ID', r => r.mutationId], ['变异名称', r => r.name], ['首次发现阶段', r => r.stage],
      ['总阶段', r => r.totalStages], ['首次发现(UTC)', r => date(r.firstObservedAt)],
      ['服务端变异时间(UTC)', r => date(r.serverMutationAt)], ['天气ID', r => r.weatherId],
      ['来源', r => r.source], ['施肥操作ID', r => r.operationId], ['阶段归属', r => r.attribution],
    ],
    operations: [
      ['施肥操作ID', r => r.id], ['肥料ID', r => r.fertilizerId],
      ['施肥前阶段', r => r.beforeStage], ['施肥后阶段', r => r.afterStage], ['总阶段', r => r.totalStages],
      ['请求时间(UTC)', r => date(r.requestedAt)], ['响应时间(UTC)', r => date(r.finishedAt)],
      ['实际消耗秒数', r => r.consumedSeconds], ['消耗物品ID', r => r.consumedItemId],
      ['剩余肥料秒数', r => r.remainingSeconds], ['请求已发送', r => r.requestSent],
      ['结果', r => r.status], ['数据质量', r => r.quality], ['错误', r => r.error],
    ],
  };
  const columns = [
    ['种植记录ID', r => r.recordId], ['账号', r => r.accountId], ['作物ID', r => r.plantId],
    ['种子ID', r => r.seedId], ['种子', r => r.seedName], ['土地', r => r.landId],
    ['种植时间(UTC)', r => date(r.plantedAt)], ['测试任务', r => r.testId], ['轮次', r => r.round],
    ...(definitions[view] || []),
  ];
  const cell = value => `"${String(value ?? '').replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;
  const sorted = [...rows].sort((a, b) => a.plantedAt - b.plantedAt || a.recordId - b.recordId
    || (a.stage || 0) - (b.stage || 0) || (a.firstObservedAt || a.requestedAt || 0) - (b.firstObservedAt || b.requestedAt || 0));
  return `\uFEFF${[columns.map(([label]) => label), ...sorted.map(row => columns.map(([, get]) => get(row)))]
    .map(row => row.map(cell).join(',')).join('\r\n')}`;
}

module.exports = { accountFile, createMutationRepository, getMutationRepository, exportMutationCsv, exportMutationDetailsCsv };
