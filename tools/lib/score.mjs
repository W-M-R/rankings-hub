import { CONFIG, SELLER_BLOCKLIST, CATEGORY_BLOCKLIST } from './regions.mjs';
import { norm } from './util.mjs';

const sellerBlocked = (seller = '') => {
  const s = seller.toLowerCase();
  return SELLER_BLOCKLIST.some((b) => s.includes(b));
};

const categoryBlocked = (genre = '') => CATEGORY_BLOCKLIST.some((re) => re.test(genre));

export function scoreRisers(items) {
  if (!items.length) return items;
  const rd = norm(items.map((i) => Math.max(0, i.rankDelta ?? 0)));
  const rg = norm(items.map((i) => Math.max(0, i.ratingDelta ?? 0)));
  const fresh = norm(items.map((i) => 1 / Math.max(i.ageDays ?? 999, 1)));
  return items.map((item, k) => ({
    ...item,
    riserScore: Number(
      (0.45 * rd[k] + 0.25 * (item.isNew ? 1 : 0) + 0.2 * rg[k] + 0.1 * fresh[k]).toFixed(4),
    ),
  }));
}

export function selectLists(items) {
  const scored = scoreRisers(items);
  const base = scored.filter(
    (i) =>
      !sellerBlocked(i.seller) &&
      !categoryBlocked(i.genre ?? '') &&
      (i.ageDays ?? 0) <= CONFIG.longTailDays &&
      ((i.ratingCount ?? 0) < CONFIG.smallRatingCount || i.catalogRank != null),
  );

  const charted = base.filter(
    (i) =>
      (i.catalogRank != null || i.genreRank != null || i.bestRank != null) &&
      ((i.ratingCount ?? 0) >= 10 || (i.rankDelta ?? 0) >= 5) &&
      (i.ratingCount ?? 0) < CONFIG.smallRatingCount,
  );
  const small = base.filter((i) => (i.ratingCount ?? 0) < CONFIG.smallRatingCount);

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

  const hiddenGems = withRank(
    base
      .filter(
        (i) =>
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

export function matrixPenalty(items) {
  const counts = new Map();
  for (const i of items) if (i.isNew) counts.set(i.seller, (counts.get(i.seller) ?? 0) + 1);
  return items.map((i) => {
    const n = counts.get(i.seller) ?? 0;
    if (n < CONFIG.matrixSellerPerDay) return i;
    return { ...i, riserScore: Number(((i.riserScore ?? 0) * CONFIG.matrixPenalty).toFixed(4)), matrix: true };
  });
}