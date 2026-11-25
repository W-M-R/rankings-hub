import { CONFIG, SELLER_BLOCKLIST, CATEGORY_BLOCKLIST } from './regions.mjs';
import { norm } from './util.mjs';

const sellerBlocked = (seller = '') => {
  const s = seller.toLowerCase();
  return SELLER_BLOCKLIST.some((b) => s.includes(b));
};

const categoryBlocked = (genre = '') => CATEGORY_BLOCKLIST.some((re) => re.test(genre));

/**
 * 打分 + 矩阵刷榜惩罚，一次算完。
 * 旧实现先 matrixPenalty 再 selectLists，而 selectLists 内部又 scoreRisers 重算一遍，
 * 惩罚被整个覆盖掉，防护等于不存在。
 */
export function scoreRisers(items) {
  if (!items.length) return items;

  const rd = norm(items.map((i) => Math.max(0, i.rankDelta ?? 0)));
  const rg = norm(items.map((i) => Math.max(0, i.ratingDelta ?? 0)));
  const fresh = norm(items.map((i) => 1 / Math.max(i.ageDays ?? 999, 1)));

  const newPerSeller = new Map();
  for (const i of items) if (i.isNew) newPerSeller.set(i.seller, (newPerSeller.get(i.seller) ?? 0) + 1);

  return items.map((item, k) => {
    const base = 0.45 * rd[k] + 0.25 * (item.isNew ? 1 : 0) + 0.2 * rg[k] + 0.1 * fresh[k];
    const matrix = (newPerSeller.get(item.seller) ?? 0) >= CONFIG.matrixSellerPerDay;
    return {
      ...item,
      riserScore: Number((matrix ? base * CONFIG.matrixPenalty : base).toFixed(4)),
      ...(matrix ? { matrix: true } : {}),
    };
  });
}

/** 纯筛选 + 排序，不再改动 riserScore。 */
export function selectLists(scored, { smallOnly = true } = {}) {
  // 注意：base 里不再按 ageDays 过滤。"Rising now" 说的是名次在涨，
  // 而实测 95% 的名次上升来自上线 180 天以上的老应用（中位年龄 7.8 年），
  // 用长尾天数卡会把真实的翻红案例全部筛掉。年龄只在 justLaunched 里作为条件。
  const base = scored.filter(
    (i) =>
      !sellerBlocked(i.seller) &&
      !i.bigPublisher &&
      !categoryBlocked(i.genre ?? '') &&
      (!smallOnly || (i.ratingCount ?? 0) < CONFIG.smallRatingCount || i.catalogRank != null),
  );

  const charted = base.filter(
    (i) =>
      (i.catalogRank != null || i.genreRank != null || i.bestRank != null) &&
      ((i.ratingCount ?? 0) >= 10 || (i.rankDelta ?? 0) >= 5) &&
      (!smallOnly || (i.ratingCount ?? 0) < CONFIG.smallRatingCount) &&
      // "Rising now" 必须是真的在涨：名次前进，或首次进榜且落在可见名次内
      ((i.rankDelta ?? 0) > 0 || (i.isNew && (i.bestRank ?? 9999) <= CONFIG.newEntrantRank)),
  );
  const small = base.filter((i) => !smallOnly || (i.ratingCount ?? 0) < CONFIG.smallRatingCount);

  const byMovement = (a, b) =>
    (b.rankDelta ?? 0) - (a.rankDelta ?? 0) ||
    (b.ratingDelta ?? 0) - (a.ratingDelta ?? 0) ||
    (a.bestRank ?? a.catalogRank ?? 9999) - (b.bestRank ?? b.catalogRank ?? 9999) ||
    (b.rating ?? 0) - (a.rating ?? 0);

  const withRank = (list) => list.map((x, i) => ({ rank: i + 1, ...x }));

  const risingNow = withRank([...charted].sort(byMovement).slice(0, CONFIG.perList));

  const justLaunched = withRank(
    small
      .filter(
        (i) =>
          (i.ageDays ?? 999) <= CONFIG.freshDays &&
          (i.ratingCount ?? 0) >= 10 &&
          (i.catalogRank != null || i.genreRank != null || (i.ratingCount ?? 0) >= 50),
      )
      .sort((a, b) => b.riserScore - a.riserScore || byMovement(a, b))
      .slice(0, CONFIG.perList),
  );

  // Hidden gems 的定位是「名次不显眼但口碑好」，必须排除已经在 risingNow 里的，
  // 否则两个榜单 83% 重合，等于同一个列表换个标题。
  const risingIds = new Set(risingNow.map((i) => i.id));
  const hiddenGems = withRank(
    base
      .filter(
        (i) =>
          !risingIds.has(i.id) &&
          (i.rating ?? 0) >= 4.5 &&
          (i.ratingCount ?? 0) >= 5 &&
          (i.ratingCount ?? 0) <= CONFIG.smallRatingCount &&
          ((i.bestRank ?? i.catalogRank) == null || (i.bestRank ?? i.catalogRank) >= 20),
      )
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.ratingCount ?? 0) - (a.ratingCount ?? 0))
      .slice(0, CONFIG.perList),
  );

  return { risingNow, justLaunched, hiddenGems };
}

/** 同一条新闻会带出一串同主题仓库（GTA VI 移植那次 19 条里占 7 条），按 owner/主题词限流。 */
export function diversify(items, { maxPerOwner = 1, maxPerTopic = 3 } = {}) {
  const TOPIC_RULES = [
    { re: /\b(gta|leonida|victory|vice city|recomp|recompil|xbox|ps5|emulator|port)\b/i, key: 'game-port' },
  ];
  const owners = new Map();
  const topics = new Map();
  const out = [];

  for (const item of items) {
    const owner = String(item.fullName ?? '').split('/')[0].toLowerCase();
    if ((owners.get(owner) ?? 0) >= maxPerOwner) continue;

    const hay = `${item.fullName ?? ''} ${item.description ?? ''}`;
    const topic = TOPIC_RULES.find((r) => r.re.test(hay))?.key ?? null;
    if (topic && (topics.get(topic) ?? 0) >= maxPerTopic) continue;

    owners.set(owner, (owners.get(owner) ?? 0) + 1);
    if (topic) topics.set(topic, (topics.get(topic) ?? 0) + 1);
    out.push(item);
  }
  return out;
}
