export type MilkTeaPhase = 'upcoming' | 'business' | 'settling' | 'ended'
export type TeaAmount = string | number
export interface TeaItem {
  id?: TeaAmount
  itemId?: TeaAmount
  count: TeaAmount
  name?: string
  image?: string
  imageUrl?: string
  rarity?: number
  uid?: string
}
export interface TeaRecipe {
  recipe_id: TeaAmount
  recipe_name: string
  unlocked: boolean
  is_advanced: boolean
  token_price: TeaAmount
  coin_price: TeaAmount
  stock_cups: TeaAmount
  clear_coin_price?: TeaAmount
  clear_coin_total?: TeaAmount
  config?: { image?: string, drink_desc?: string }
  fruits?: TeaItem[]
}
export interface TeaGoods {
  id: TeaAmount
  name: string
  desc?: string
  category_tag?: string
  items: TeaItem[]
  costs: TeaItem[]
  purchase_limit: TeaAmount
  remaining: number
  restriction_type?: TeaAmount
  unlocked: boolean
  affordable: boolean
  paid: boolean
  maxPurchasable: number
  cond_hints?: { satisfied: boolean, target?: TeaAmount, cond_type?: string }[]
}
export interface TeaLevel {
  level: number
  revenue_required: TeaAmount
  base_popularity: number
  advanced_price_percent: number
  employee_slot_count: number
  recipe_names: string[]
  rewards: TeaItem[]
  shop_item_string?: string
}
export interface TeaPlayer { gid: TeaAmount, name: string, avatar?: string, level?: TeaAmount }
export interface TeaSlot {
  slot_index: number
  employee: TeaPlayer
  talent_name: string
  begin_at: TeaAmount
  end_at: TeaAmount
}
export interface TeaInteraction {
  type: number
  success: boolean
  friend?: { taste_cups?: TeaAmount, bonus_amount?: TeaAmount }
}
export interface TeaShift {
  shift_id: TeaAmount
  employer: TeaPlayer
  shop_name: string
  talent_name: string
  begin_at: TeaAmount
  end_at: TeaAmount
  interact_count: number
  interact_limit: number
  wage_total: TeaAmount
  interact?: TeaInteraction
}
export interface TeaWorkSlip {
  shift_id: TeaAmount
  employer: TeaPlayer
  shop_name: string
  begin_at: TeaAmount
  end_at: TeaAmount
  work_sec: TeaAmount
  wages?: { final_wage?: TeaAmount }
  interact?: TeaInteraction
}
export interface TeaCandidate {
  friend: TeaPlayer
  is_robot: boolean
  talent_name: string
  state: number
  state_until_at?: TeaAmount
  rehire_available_at?: TeaAmount
}
export interface TeaHireRecords {
  duration_id: number
  wage_total: TeaAmount
  friends: TeaCandidate[]
  robots: TeaCandidate[]
}
export interface TeaDuration {
  duration_id: number
  duration_sec: number
  duration_cost: string
  min_remaining_business_sec: number
}
export interface TeaState {
  id: TeaAmount
  title: string
  startTime: number
  settleTime: number
  endTime: number
  serverTime: number
  phase: MilkTeaPhase
  rules?: string
  summary: {
    shop_open_at: TeaAmount
    shop_name: string
    rename_cd_until_at: TeaAmount
    can_upgrade: boolean
    has_unclaimed_wage: boolean
    hire_disabled: boolean
    cashier_full?: boolean
    cashier_warning?: boolean
    opening_gift_preview?: TeaItem[]
  }
  shop: null | {
    level: number
    total_revenue: TeaAmount
    next_level_revenue: TeaAmount
    effective_cups_per_hour: TeaAmount
    slots: TeaSlot[]
    pending_rewards: TeaItem[]
    sales_item_id: TeaAmount
    boost_cups_per_use: TeaAmount
    boost_preview_rewards: TeaItem[]
    next_full_at?: TeaAmount
  }
  recipes: TeaRecipe[]
  goods: TeaGoods[]
  balances: TeaItem[]
  levels: TeaLevel[]
  durations: TeaDuration[]
  interactions: { interaction_id: number, name: string, des?: string }[]
  work: { my_shift: TeaShift | null, slips: TeaWorkSlip[], interact_done: boolean, talent_name?: string }
  share: null | {
    current_score: TeaAmount
    daily?: { daily_reward_claimed: boolean }
    my_pool?: { claimed_count: number, claim_limit: number }
    milestones: { tier_id: number, threshold: TeaAmount, state: number, rewards: TeaItem[] }[]
  }
  fund: null | {
    unlocked: boolean
    unlock_cost: TeaItem[]
    tiers: { tier_id: number, state: number, conditions?: { target_value: TeaAmount, reached: boolean }[], reward: TeaItem[] }[]
  }
}

export const teaImage = (name: string) => `/activity/milk-tea/${name}.png`
export function teaInteger(value: unknown): bigint {
  const text = String(value ?? '')
  return /^\d+$/.test(text) ? BigInt(text) : 0n
}
export function teaNumber(value: unknown, fallback = '—') {
  const text = String(value ?? '')
  if (/^-?\d+$/.test(text))
    return BigInt(text).toLocaleString('en-US')
  const amount = Number(value)
  return text && Number.isFinite(amount) ? amount.toLocaleString('en-US', { maximumFractionDigits: 2 }) : fallback
}
export function teaDate(seconds: unknown) {
  const time = Number(seconds)
  if (!Number.isFinite(time) || time <= 0 || !Number.isFinite(new Date(time * 1000).getTime()))
    return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(time * 1000))
}
export function teaDuration(seconds: unknown) {
  const value = Number(seconds)
  if (!Number.isFinite(value))
    return '—'
  const total = Math.max(0, Math.floor(value))
  return `${Math.floor(total / 3600).toString().padStart(2, '0')}:${Math.floor(total % 3600 / 60).toString().padStart(2, '0')}`
}
export function teaCurrencyImage(item: Partial<TeaItem>) {
  const id = String(item.id ?? item.itemId)
  return ({ 1001: '/game-config/resource-icons/gold.png', 1004: '/game-config/resource-icons/diamond.png', 1041: teaImage('icon_s4_ticket'), 1042: teaImage('icon_s4_boost') } as Record<string, string>)[id] || item.image || item.imageUrl || ''
}
export function teaItemName(item: Partial<TeaItem>) {
  return item.name || ({ 1001: '金币', 1004: '钻石', 1041: '奶茶券', 1042: '宣传喇叭' } as Record<string, string>)[String(item.id ?? item.itemId)]
    || (item.id ?? item.itemId ? `物品 ${item.id ?? item.itemId}` : '奖励')
}
export function teaBalance(state: TeaState, id: TeaAmount) {
  return state.balances?.find(item => String(item.itemId ?? item.id) === String(id))?.count
}
export function teaInventoryEstimate(state: TeaState, now: number) {
  const recipes = (state.recipes || []).filter(recipe => recipe.unlocked && recipe.is_advanced)
  const valid = recipes.every(recipe => /^\d+$/.test(String(recipe.stock_cups)) && /^\d+$/.test(String(recipe.token_price)))
  if (!valid)
    return { cups: null, tokens: null, seconds: null, until: null, capped: false }
  const cups = recipes.reduce((sum, recipe) => sum + teaInteger(recipe.stock_cups), 0n)
  const tokens = recipes.reduce((sum, recipe) => sum + teaInteger(recipe.stock_cups) * teaInteger(recipe.token_price), 0n)
  const speed = Number(state.shop?.effective_cups_per_hour)
  const seconds = cups <= BigInt(Number.MAX_SAFE_INTEGER) && Number.isFinite(speed) && speed > 0 ? Number(cups) / speed * 3600 : null
  const rawUntil = seconds !== null && Number.isFinite(seconds) && Number.isFinite(now) ? now + seconds : null
  const until = rawUntil !== null && Number.isFinite(state.settleTime) && state.settleTime > now
    && Number.isFinite(new Date(Math.min(rawUntil, state.settleTime) * 1000).getTime())
    ? Math.min(rawUntil, state.settleTime)
    : null
  return { cups: cups.toString(), tokens: tokens.toString(), seconds, until, capped: rawUntil !== null && rawUntil > state.settleTime }
}
export function teaQuickEntries(state: TeaState, now: number) {
  const shift = state.work?.my_shift
  const working = !!shift && Number(shift.begin_at) <= now && Number(shift.end_at) > now
  const daily = state.share?.daily && !state.share.daily.daily_reward_claimed ? 1 : 0
  const rewards = (state.share?.milestones || []).filter(tier => Number(tier.state) === 2).length + daily
  const fund = state.fund?.unlocked ? state.fund.tiers.filter(tier => Number(tier.state) === 2).length : 0
  const begin = Number(shift?.begin_at)
  const end = Number(shift?.end_at)
  const shiftProgress = shift && Number.isFinite(begin) && end > begin ? Math.min(100, Math.max(0, (now - begin) / (end - begin) * 100)) : null
  const thresholds = (state.share?.milestones || []).map(tier => Number(tier.threshold)).filter(value => Number.isFinite(value) && value > 0)
  const target = thresholds.length ? Math.max(...thresholds) : null
  const score = Number(state.share?.current_score)
  const fundProgress = state.fund?.unlocked && state.fund.tiers.length ? state.fund.tiers.filter(tier => [2, 3].includes(Number(tier.state))).length / state.fund.tiers.length * 100 : null
  return [
    { key: 'work', name: '我的工作', icon: 'i-carbon-portfolio', text: state.summary.has_unclaimed_wage ? '工资待领取' : working ? teaCanInteract(state, now) ? '工作中 · 可互动' : '工作中 · 本班已互动' : state.summary.hire_disabled ? '空闲 · 已暂停雇佣' : '空闲 · 可被雇佣', attention: state.summary.has_unclaimed_wage || teaCanInteract(state, now), progress: shiftProgress },
    { key: 'rewards', name: '活动奖励', icon: 'i-carbon-gift', text: state.share ? rewards ? `${rewards} 项可领取` : `${teaNumber(state.share.current_score)} 快乐值` : '尚未读取', attention: rewards > 0, progress: target && Number.isFinite(score) ? Math.min(100, Math.max(0, score / target * 100)) : null },
    { key: 'fund', name: '成长基金', icon: 'i-carbon-growth', text: !state.fund ? '尚未读取' : !state.fund.unlocked ? '未购买' : fund ? `${fund} 档可领取` : '暂无可领取奖励', attention: fund > 0, progress: fundProgress },
    { key: 'exchange', name: '兑换商店', icon: 'i-carbon-shopping-cart', text: `${(state.goods || []).filter(good => !teaGoodsReason(good, teaPhase(state, now))).length} 种可兑换`, attention: false, progress: null },
  ]
}
export function teaPhase(state: Pick<TeaState, 'startTime' | 'settleTime' | 'endTime'>, now: number): MilkTeaPhase {
  const { startTime, settleTime, endTime } = state
  if (![startTime, settleTime, endTime, now].every(Number.isFinite)
    || startTime <= 0 || settleTime < startTime || endTime < settleTime) {
    return 'ended'
  }
  return now < startTime ? 'upcoming' : now > endTime ? 'ended' : now >= settleTime ? 'settling' : 'business'
}
export function teaFruits(recipe: TeaRecipe): TeaItem[] {
  if (!recipe.unlocked || !recipe.is_advanced)
    return []
  return (recipe.fruits || []).filter(item => teaInteger(item.uid) > 0n && teaInteger(item.count) > 0n)
}
export function teaFruitUids(recipes: TeaRecipe[]) {
  return [...new Set(recipes.flatMap(recipe => teaFruits(recipe).map(item => String(item.uid))))]
}
export function teaPurchaseMax(goods?: TeaGoods) {
  if (!goods || goods.paid || !goods.costs?.length || goods.affordable === false
    || goods.costs.some(item => String(item.id ?? item.itemId) === '1004' || teaInteger(item.count) <= 0n) || !goods.unlocked) {
    return 0
  }
  const maximum = Number(goods.maxPurchasable)
  return Number.isSafeInteger(maximum) && maximum > 0 ? Math.min(maximum, Math.max(0, Math.floor(Number(goods.remaining) || 0))) : 0
}
export function teaGoodsReason(goods: TeaGoods, phase: MilkTeaPhase) {
  if (!['business', 'settling'].includes(phase))
    return '活动未开始或已结束'
  if (goods.paid || goods.costs?.some(item => String(item.id ?? item.itemId) === '1004'))
    return '不支持钻石购买'
  if (!goods.unlocked) {
    const condition = goods.cond_hints?.find(item => !item.satisfied)
    return condition?.cond_type === 'milk_tea_store_level' && condition.target
      ? `店铺 ${condition.target} 级解锁`
      : '解锁条件未达成'
  }
  if (phase === 'settling' && goods.category_tag === 'seed')
    return '结算期不可兑换种子'
  if (Number(goods.remaining) <= 0)
    return '限购已用完'
  if (!teaPurchaseMax(goods))
    return '资源不足'
  return ''
}
export function teaOpenSlots(state: TeaState, now: number) {
  if (!state.shop || teaPhase(state, now) !== 'business')
    return []
  const capacity = state.levels?.find(level => Number(level.level) === Number(state.shop?.level))?.employee_slot_count || 0
  const occupied = new Set((state.shop.slots || []).filter(slot => Number(slot.end_at) > now).map(slot => Number(slot.slot_index)))
  return Array.from({ length: capacity }, (_, index) => index).filter(index => !occupied.has(index))
}
export function teaHireReason(state: TeaState, duration: TeaDuration | undefined, now: number) {
  if (teaPhase(state, now) !== 'business')
    return '仅营业期可雇佣'
  if (!duration || state.settleTime - now < duration.min_remaining_business_sec)
    return '剩余营业时间不足'
  if (!teaOpenSlots(state, now).length)
    return '员工位已满'
  return ''
}
export function teaCandidateAvailable(candidate: TeaCandidate, now: number) {
  return !!candidate.friend?.gid && Number(candidate.state) === 0
    && Number(candidate.state_until_at || 0) <= now && Number(candidate.rehire_available_at || 0) <= now
}
export function teaCanInteract(state: TeaState, now: number) {
  const shift = state.work?.my_shift
  return teaPhase(state, now) === 'business' && !!shift
    && Number(shift.begin_at) <= now && Number(shift.end_at) > now && !state.work.interact_done
    && Number(shift.interact_count) < Number(shift.interact_limit)
}
export function teaCanUpgrade(state: TeaState, now: number) {
  return teaPhase(state, now) === 'business' && !!state.shop && state.summary.can_upgrade === true
    && teaInteger(state.shop.next_level_revenue) > 0n
    && teaInteger(state.shop.total_revenue) >= teaInteger(state.shop.next_level_revenue)
}
export function teaNameValid(name: string) {
  const value = name.trim()
  return [...value].length >= 2 && [...value].length <= 8 && !/[<>]/.test(value)
    && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}
export function teaInteractionReward(interaction?: TeaInteraction) {
  if (!Number(interaction?.type))
    return '无互动'
  if (teaInteger(interaction?.friend?.taste_cups) > 0n)
    return `奶茶 +${teaNumber(interaction?.friend?.taste_cups)} 杯`
  if (teaInteger(interaction?.friend?.bonus_amount) > 0n)
    return `奶茶券 +${teaNumber(interaction?.friend?.bonus_amount)}`
  return interaction?.success ? '互动成功' : '互动未成功'
}
export function teaPlainText(value: unknown) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
}
export function teaRecentLogs(logs: any[], accountId: string) {
  return logs
    .filter(log => (!log.accountId || String(log.accountId) === accountId)
      && String(log.meta?.module || '') === 'activity'
      && /奶茶热销中/.test(`${log.meta?.event || ''} ${log.msg || ''}`))
    .slice()
    .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))
    .slice(0, 6)
}

export function teaActionReason(state: TeaState | null, action: string, params: Record<string, any>, now: number) {
  if (!state)
    return '尚未读取到活动数据'
  const phase = teaPhase(state, now)
  if (!['business', 'settling'].includes(phase))
    return '活动未开始或已结束'
  const settlementActions = ['cashier', 'wages', 'buy', 'shareDaily', 'shareRewards', 'fundRewards']
  if (phase !== 'business' && !settlementActions.includes(action))
    return '结算期不支持此操作'
  const opened = teaInteger(state.summary.shop_open_at) > 0n
  if (!opened && !['create', 'shareDaily', 'shareRewards', 'fundRewards'].includes(action))
    return '请先开店营业'
  if (action === 'create' || action === 'rename') {
    if (!teaNameValid(String(params.shopName || '')))
      return '店名需为 2–8 个有效字符'
    if (action === 'create' && opened)
      return '店铺已开业'
    return action === 'rename' && now < Number(state.summary.rename_cd_until_at) ? '店名修改冷却中' : ''
  }
  if (action === 'cashier')
    return state.shop?.pending_rewards?.some(item => teaInteger(item.count) > 0n) ? '' : '暂无可领取收益'
  if (action === 'wages')
    return state.summary.has_unclaimed_wage ? '' : '暂无可领取工资'
  if (action === 'upgrade')
    return teaCanUpgrade(state, now) ? '' : '尚未达到升级条件'
  if (action === 'boost')
    return state.shop && teaInteger(teaBalance(state, state.shop.sales_item_id)) > 0n ? '' : '宣传喇叭不足'
  if (action === 'craft') {
    const available = teaFruitUids(state.recipes || [])
    return Array.isArray(params.fruitUids) && params.fruitUids.length > 0 && params.fruitUids.every((uid: unknown) => available.includes(String(uid))) ? '' : '没有可制作的已解锁果实批次'
  }
  if (action === 'buy') {
    const goods = state.goods?.find(item => String(item.id) === String(params.goodsId))
    if (!goods)
      return '商品不可用'
    const reason = teaGoodsReason(goods, phase)
    if (reason)
      return reason
    return Number.isSafeInteger(params.count) && params.count >= 1 && params.count <= teaPurchaseMax(goods) ? '' : '兑换数量超出可购买范围'
  }
  if (action === 'hire') {
    const duration = state.durations?.find(item => Number(item.duration_id) === Number(params.durationId))
    const reason = teaHireReason(state, duration, now)
    if (reason)
      return reason
    return teaOpenSlots(state, now).includes(Number(params.slotIndex)) && teaInteger(params.targetGid) > 0n ? '' : '员工或位置不可用'
  }
  if (action === 'interact')
    return teaCanInteract(state, now) && state.interactions?.some(item => Number(item.interaction_id) === Number(params.interactionType)) ? '' : '当前班次不可互动'
  if (action === 'hireDisabled')
    return typeof params.disabled === 'boolean' ? '' : '雇佣状态无效'
  if (action === 'shareDaily')
    return state.share?.daily && !state.share.daily.daily_reward_claimed ? '' : '今日无可领取快乐值'
  if (action === 'shareRewards')
    return state.share?.milestones?.some(tier => Number(tier.state) === 2) ? '' : '暂无可领取快乐值奖励'
  if (action === 'fundRewards')
    return state.fund?.unlocked && state.fund.tiers?.some(tier => Number(tier.state) === 2) ? '' : '暂无可领取基金奖励'
  return '活动操作无效'
}
