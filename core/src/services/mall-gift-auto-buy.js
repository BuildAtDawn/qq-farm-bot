const { getAutomation } = require('../models/store');
const { getUserState } = require('../utils/network');
const { log, toNum } = require('../utils/utils');
const mall = require('./mall');

// 仅接受服务端明确启用、有结束时间且有限购数量的点券礼包。
function getCouponGiftPurchase(goods, balance, now = Date.now() / 1000) {
  const price = mall.parseMallPriceInfo(goods.price);
  const limit = mall.parseMallLimitInfo(goods.limit);
  if (Number(goods.goods_id) !== 1061 || now < 1792029600 || now > 1794844799 || Number(goods.type) !== 5 || goods.enabled !== true || goods.is_activity !== true
    || !(toNum(goods.end_time) > now) || price.currencyId !== 1002 || price.price <= 0
    || goods.is_limited !== true || limit.limitCount <= 0) return 0;
  const remaining = Math.max(0, limit.limitCount - limit.boughtNum);
  return balance >= remaining * price.price ? remaining : 0;
}

function createCouponGiftBuyer({ getAutomation, getBalance, getGoods, purchase, report, now = Date.now }) {
  let busy = false;
  let lastCheck = -Infinity;
  return async function autoBuyCouponGifts(force = false) {
    if (now() < 1792029600000 || now() > 1794844799000) return 0;
    if (busy || getAutomation().mall_coupon_gift_buy !== true || (!force && now() - lastCheck < 600000)) return 0;
    busy = true;
    lastCheck = now();
    let bought = 0;
    try {
      const goods = await getGoods();
      let balance = getBalance();
      for (const item of goods) {
        if (getAutomation().mall_coupon_gift_buy !== true) break;
        const count = getCouponGiftPurchase(item, balance, now() / 1000);
        if (!count) {
          const requiredCount = getCouponGiftPurchase(item, Number.MAX_SAFE_INTEGER, now() / 1000);
          if (requiredCount > 0) report(`点券礼包购买已跳过：需要 ${mall.parseMallPriceInfo(item.price).price * requiredCount} 点券，当前 ${balance}`, 'skip');
          continue;
        }
        await purchase(Number(item.goods_id), count);
        balance -= mall.parseMallPriceInfo(item.price).price * count;
        bought += count;
        report(`自动购买点券限时礼包：${item.name} x${count}`, 'success');
      }
    } catch (error) {
      report(`自动购买点券限时礼包失败：${error.message}`, 'error');
    } finally {
      busy = false;
    }
    return bought;
  };
}

function getCouponGiftBalance(state) {
  return Math.max(0, toNum(state?.coupon));
}

const autoBuyCouponGifts = createCouponGiftBuyer({
  getAutomation,
  getBalance: () => getCouponGiftBalance(getUserState()),
  getGoods: () => mall.getMallGoodsList(5),
  purchase: mall.purchaseMallGoods,
  report: (message, result) => log('商城', message, { module: 'shop', event: '点券限时礼包自动购买', result }),
});
module.exports = { getCouponGiftBalance, getCouponGiftPurchase, createCouponGiftBuyer, autoBuyCouponGifts };
