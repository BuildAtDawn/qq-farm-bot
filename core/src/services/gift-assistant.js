/**
 * 礼包助手：自动开启背包中的指定活动礼包。
 * - 目标礼包：同气连枝 / SVIP特权 / 千星游记 / 化肥 / 有机化肥
 * - 幂等账本：按日期记录每次开启（背包实际数量为开启依据，开完即止，天然幂等）
 * - 分批开启：单次请求最多 20 个，防止单请求过大
 * - 遵守运行时段：仅在 bot 运行期间由定时循环触发，不做任何额外消费
 */
const fs = require('node:fs');
const path = require('node:path');
const { log, logWarn, toNum } = require('../utils/utils');

const GIFT_TARGETS = [
  { id: 101351, name: '同气连枝礼包' },
  { id: 101301, name: 'SVIP特权礼包' },
  { id: 101304, name: '千星游记礼包' },
  { id: 100003, name: '化肥礼包' },
  { id: 100004, name: '有机化肥礼包' },
];
const BATCH_SIZE = 20;

function dateKey(now = Date.now()) {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}

function ledgerPath(accountId) {
  const dataDir = process.env.FARM_DATA_DIR || path.join(__dirname, '../../data');
  const dir = path.join(dataDir, 'gift-assistant');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${String(accountId || 'default').replace(/[^\w.-]/g, '_')}.json`);
}

function readLedger(accountId) {
  const today = dateKey();
  try {
    const raw = JSON.parse(fs.readFileSync(ledgerPath(accountId), 'utf8'));
    if (raw.date !== today) return { date: today, entries: [], totals: raw.totals || {} };
    return { date: today, entries: Array.isArray(raw.entries) ? raw.entries : [], totals: raw.totals || {} };
  }
  catch {
    return { date: today, entries: [], totals: {} };
  }
}

function writeLedger(accountId, ledger) {
  try {
    fs.writeFileSync(ledgerPath(accountId), JSON.stringify(ledger, null, 2));
  }
  catch (error) {
    logWarn('礼包助手', `账本写入失败: ${error.message}`);
  }
}

async function collectGiftItems() {
  const warehouse = require('./warehouse');
  const bag = warehouse.getBagItems(await warehouse.getBag());
  return GIFT_TARGETS.map((target) => {
    const stacks = bag.filter(item => toNum(item && item.id) === target.id);
    const count = stacks.reduce((sum, item) => sum + Math.max(0, toNum(item && item.count)), 0);
    return { ...target, count };
  });
}

/** 礼包助手面板数据：库存 + 今日/累计已开 + 今日账本 */
async function getGiftAssistantState(enabled) {
  const accountId = process.env.FARM_ACCOUNT_ID || '';
  const items = await collectGiftItems();
  const ledger = readLedger(accountId);
  return {
    enabled: enabled === true,
    date: ledger.date,
    items: items.map((item) => {
      const openedToday = ledger.entries.filter(entry => entry.itemId === item.id).reduce((sum, entry) => sum + entry.count, 0);
      return {
        id: item.id,
        name: item.name,
        count: item.count,
        openedToday,
        openedTotal: Math.max(0, toNum(ledger.totals[item.id])) + openedToday,
      };
    }),
    entries: ledger.entries.slice(-50).reverse(),
  };
}

/** 自动开启一轮：背包里有的目标礼包全部开启，账本记录；单礼包失败不阻塞其它 */
async function runGiftAssistantOnce() {
  const accountId = process.env.FARM_ACCOUNT_ID || '';
  const warehouse = require('./warehouse');
  const items = await collectGiftItems();
  const ledger = readLedger(accountId);
  const opened = [];
  const failures = [];
  for (const gift of items) {
    if (gift.count <= 0) continue;
    let done = 0;
    try {
      while (done < gift.count) {
        const batch = Math.min(BATCH_SIZE, gift.count - done);
        await warehouse.useItem(gift.id, batch);
        done += batch;
      }
    }
    catch (error) {
      const message = `开启 ${gift.name} 中断（已开 ${done}/${gift.count}）：${error.message}`;
      logWarn('礼包助手', message);
      failures.push(message);
      if (done > 0) {
        ledger.entries.push({ itemId: gift.id, name: gift.name, count: done, at: Date.now() });
        ledger.totals[gift.id] = Math.max(0, toNum(ledger.totals[gift.id])) + done;
        writeLedger(accountId, ledger);
      }
      continue;
    }
    if (done > 0) {
      ledger.entries.push({ itemId: gift.id, name: gift.name, count: done, at: Date.now() });
      ledger.totals[gift.id] = Math.max(0, toNum(ledger.totals[gift.id])) + done;
      opened.push({ itemId: gift.id, name: gift.name, count: done });
      log('礼包助手', `已开启 ${gift.name} x${done}`);
    }
  }
  writeLedger(accountId, ledger);
  return { opened, failures };
}

module.exports = { GIFT_TARGETS, getGiftAssistantState, runGiftAssistantOnce };
