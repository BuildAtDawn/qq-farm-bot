function stageNumber(row, observation) {
  if (!row.totalStages || !Array.isArray(row.stagePlan) || row.stagePlan.length !== row.totalStages) return null;
  const count = observation.phaseCount;
  if (!Number.isInteger(count) || count < 1 || count > row.totalStages) return null;
  const stage = row.totalStages - count + 1;
  if (observation.dead || (observation.mature && stage !== row.totalStages)) return null;
  return stage;
}

function initialStages(row) {
  return (row.stagePlan || []).map((phase, index) => ({
    id: `${row.id}:${index + 1}`, recordId: row.id, stage: index + 1,
    totalStages: row.totalStages, name: phase.name, checked: false,
    serverEnteredAt: null, firstObservedAt: null, lastObservedAt: null,
    observedMutations: [], newMutations: [], sources: [], observationCount: 0,
  }));
}

function stageChanges(row, observed, stages, discoveries) {
  const stage = stageNumber(row, observed);
  const time = observed.observedAt;
  const source = observed.source || 'lands';
  const stageRow = stage ? stages.get(`${row.id}:${stage}`) : null;
  const mutations = [...new Map((observed.mutations || []).map(item => [item.id, item])).values()];
  const added = [];
  if (observed.mutationsKnown) {
    for (const item of mutations) {
      const id = `${row.id}:${item.id}`;
      if (!discoveries.has(id)) added.push({
        id, recordId: row.id, mutationId: item.id, name: item.name,
        stage, totalStages: row.totalStages || null, firstObservedAt: time,
        serverMutationAt: item.serverMutationAt ?? null, weatherId: item.weatherId ?? null,
        source, operationId: observed.operationId || '', attribution: stage ? 'first_observed' : 'stage_unknown',
      });
    }
  }
  const changes = [];
  if (stageRow) {
    const next = {
      ...stageRow,
      checked: stageRow.checked || observed.mutationsKnown,
      serverEnteredAt: stageRow.serverEnteredAt ?? (observed.phaseBegin > 0 ? observed.phaseBegin * 1000 : null),
      latestServerBeginAt: observed.phaseBegin > 0 ? observed.phaseBegin * 1000 : null,
      firstObservedAt: stageRow.firstObservedAt ?? time, lastObservedAt: time,
      sources: [...new Set([...stageRow.sources, source])],
      observationCount: stageRow.observationCount + 1,
      observedMutations: [...new Map([...stageRow.observedMutations, ...mutations].map(item => [item.id, item])).values()],
      latestMutations: observed.mutationsKnown ? mutations : null,
      newMutations: [...stageRow.newMutations, ...added.map(item => ({ id: item.mutationId, name: item.name }))],
    };
    changes.push(next);
  }
  return {
    row: { ...row, currentStage: stage, stageQuality: stage ? 'known' : 'unknown',
      lastObservationAt: time, lastObservationRequestAt: observed.requestedAt ?? time },
    stages: changes, discoveries: added,
  };
}

function stageStatistics(parents, stages) {
  const groups = new Map();
  const byId = new Map(parents.map(row => [row.id, row]));
  for (const stage of stages.values()) {
    const parent = byId.get(stage.recordId);
    if (!parent) continue;
    const key = `${parent.plantId}:${stage.totalStages}:${stage.stage}:${stage.name}`;
    const item = groups.get(key) || {
      plantId: parent.plantId, seedName: parent.seedName, stage: stage.stage, totalStages: stage.totalStages,
      name: stage.name, eligible: 0, checked: 0, withNewMutation: 0, types: new Map(),
    };
    item.eligible++;
    if (stage.checked) {
      item.checked++;
      if (stage.newMutations.length) item.withNewMutation++;
      for (const mutation of stage.newMutations) {
        const type = item.types.get(mutation.id) || { id: mutation.id, name: mutation.name, count: 0 };
        type.count++;
        item.types.set(mutation.id, type);
      }
    }
    groups.set(key, item);
  }
  return [...groups.values()].sort((a, b) => a.plantId - b.plantId || a.stage - b.stage).map(item => ({
    ...item, coverage: item.checked / item.eligible * 100,
    mutationRate: item.checked ? item.withNewMutation / item.checked * 100 : null,
    types: [...item.types.values()].map(type => ({ ...type, percentage: type.count / item.checked * 100 })),
  }));
}

module.exports = { stageNumber, initialStages, stageChanges, stageStatistics };
