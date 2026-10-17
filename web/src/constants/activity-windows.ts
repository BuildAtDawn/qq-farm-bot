export const RAIN_POEM_ACTIVITY_WINDOW = {
  startMs: 1787709600 * 1000,
  endMs: 1788883199 * 1000,
  updatedMs: 1787709600 * 1000,
}

export const CHARITY_FLOWER_ACTIVITY_WINDOW = {
  startMs: 1788192000 * 1000,
  endMs: 1788969599 * 1000,
  updatedMs: 1788220800 * 1000,
}

// 萌宠日记（S3 比熊萌宠主题赛季）。时间窗取自官方 activity_windows 登记，
// 服务端时间为 UTC+8 秒级时间戳。
// 同步点：core/src/models/store.js 的 TIMED_ACTIVITY_AUTOMATION_GROUPS 有同一份字面量，
// 改这里必须同时改那里，否则设置页会显示后端已强制关闭的自动化开关。
export const PET_DIARY_ACTIVITY_WINDOW = {
  startMs: 1789005600 * 1000,
  endMs: 1791820799 * 1000,
  updatedMs: 1789005600 * 1000,
}

export const WISH_SIGN_ACTIVITY_WINDOW = {
  startMs: 1790179200 * 1000,
  endMs: 1791388799 * 1000,
  updatedMs: 1790179200 * 1000,
}

export const SHARE_REWARD_ACTIVITY_WINDOW = {
  startMs: 1790179200 * 1000,
  endMs: 1791820799 * 1000,
  updatedMs: 1790179200 * 1000,
}

export function isWithinActivityWindowMs(window: { startMs: number, endMs: number }, nowMs = Date.now()) {
  return nowMs >= window.startMs && nowMs <= window.endMs
}

export const MILK_TEA_ACTIVITY_WINDOW = { startMs: 1792029600000, endMs: 1794844799000, updatedMs: 1792029600000 }
export const MILK_TEA_BUSINESS_WINDOW = { ...MILK_TEA_ACTIVITY_WINDOW, endMs: 1794671998000 }

export const MILK_TEA_AUTOMATION_OPTIONS = [
  { key: 'mall_coupon_gift_buy', label: '自动购买点券礼包', businessOnly: false },
  { key: 'milk_tea_cashier', label: '自动领取收益', businessOnly: false },
  { key: 'milk_tea_wages', label: '自动领取工资', businessOnly: false },
  { key: 'milk_tea_share_daily', label: '自动领取每日快乐值', businessOnly: false },
  { key: 'milk_tea_share_rewards', label: '自动领取快乐值奖励', businessOnly: false },
  { key: 'milk_tea_fund_rewards', label: '自动领取成长基金奖励', businessOnly: false },
  { key: 'milk_tea_upgrade', label: '自动升级店铺', businessOnly: true },
  { key: 'milk_tea_craft', label: '自动制作奶茶', businessOnly: true },
  { key: 'milk_tea_boost', label: '自动使用宣传喇叭', businessOnly: true },
  { key: 'milk_tea_hire', label: '自动雇佣员工', businessOnly: true },
  { key: 'milk_tea_interact', label: '自动工作互动', businessOnly: true },
  { key: 'milk_tea_seed_buy', label: '自动购买已解锁种子', businessOnly: true },
] as const
