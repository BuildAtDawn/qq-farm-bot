const fs = require('node:fs');
const { getDataFile } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('./json-db');

function statePath(accountId) {
  const safe = String(accountId || '').replace(/[^\w-]/g, '_');
  if (!safe) throw new Error('Missing monitor account id');
  return getDataFile(`friend_monitor/${safe}.json`);
}

function readMonitorState(accountId) {
  const data = readJsonFile(statePath(accountId), { friends: {} });
  return data && data.friends && typeof data.friends === 'object' ? data : { friends: {} };
}

function writeMonitorState(accountId, state) {
  writeJsonFileAtomic(statePath(accountId), state);
}

function deleteMonitorState(accountId) {
  const file = statePath(accountId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

module.exports = { readMonitorState, writeMonitorState, deleteMonitorState };
