import { join } from 'node:path';
import { ROOT, today, daysBetween, readJson, writeJson, pool, pruneStateTree, latestSnapshot } from './lib/util.mjs';
import { GOOGLE_MARKETS, SELLER_BLOCKLIST } from './lib/regions.mjs';

const LIMIT = Number(process.env.REGIONS_LIMIT ?? 0);
const CONCURRENCY = Number(process.env.GOOGLE_CONCURRENCY ?? 4);
const DETAILS_LIMIT = Number(process.env.GOOGLE_DETAILS_LIMIT ?? 0);
const DATE = today();
const regions = LIMIT ? GOOGLE_MARKETS.slice(0, LIMIT) : GOOGLE_MARKETS;

const enabled = process.env.ENABLE_GOOGLE_PLAY === 'true';

const blockedSeller = (seller = '') => {
  const s = seller.toLowerCase();
  return SELLER_BLOCKLIST.some((b) => s.includes(b));
};

async function loadLib(health) {
  try {
    const mod = await import('google-play-scraper');
    const g = mod.default ?? mod;
    if (typeof g.list !== 'function') throw new Error('unexpected google-play-scraper API');
    return g;
  } catch (err) {
    health.push({ source: 'google', ok: false, skipped: true, error: String(err.message ?? err) });
    return null;
  }
}

const parseReleased = (released) => {
  if (!released) return null;
  const t = Date.parse(released);
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86400000)) : null;
};

/** "10,000,000+" -> 10000000。Play 的安装量是比评分数更可靠的体量信号。 */
const parseInstalls = (installs) => {
  if (!installs) return null;
  const m = /([\d,.]+)/.exec(String(installs));
  if (!m) return null;
  const n = Number(m[1].replace(/[,.]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const BIG_INSTALLS = 5_000_000;

const entryOf = (a) => ({
  id: a.appId,
  name: a.title,
  seller: a.developer,
  icon: a.icon,
  price: a.free ? 'Free' : null,
  genre: a.genre ?? null,
  url: `https://play.google.com/store/apps/details?id=${a.appId}`,
  rating: Number((a.score ?? 0).toFixed(2)),
  // fullDetail 一次就把 ratings / released / genre / installs 带回来，不用再逐条 app() 打详情
  ratingCount: a.ratings ?? null,
  installs: a.installs ?? null,
  installsNum: parseInstalls(a.installs),
  ageDays: parseReleased(a.released),
});

async function collectRegion(g, cc) {
  const list = (await g.list({
    collection: g.collection.TOP_FREE,
    category: g.category.APPLICATION,
    country: cc,
    lang: 'en',
    num: 100,
    fullDetail: true,
  })) ?? [];
  if (!list.length) throw new Error('empty collection');

  const prevSnap = latestSnapshot(join(ROOT, 'state/google', cc), DATE);
  const [prevDay, prev, gapDays] = prevSnap ?? [null, null, 1];
  const rankFree = new Map(list.map((a, i) => [a.appId, i + 1]));

  const items = list.map((a) => {
    const e = entryOf(a);
    const catalogRank = rankFree.get(e.id) ?? null;
    const prevRank = prev?.free?.[e.id] ?? null;
    const rankDelta = prevRank && catalogRank ? prevRank - catalogRank : 0;
    return {
      ...e,
      rankFree: catalogRank,
      catalogRank,
      newRank: null,
      rankDelta,
      rankPerDay: Number((rankDelta / gapDays).toFixed(2)),
      isNew: prev ? prevRank == null : false,
      ratingDelta: 0,
      deltaDays: prevSnap ? gapDays : null,
      bigPublisher: blockedSeller(e.seller) || (e.installsNum ?? 0) >= BIG_INSTALLS,
      platform: 'google',
      region: cc,
    };
  });

  let detailFails = 0;
  if (DETAILS_LIMIT > 0) {
    const fresh = items
      .filter((i) => (i.catalogRank ?? 999) >= 40)
      .slice(0, DETAILS_LIMIT);
    for (const item of fresh) {
      try {
        const d = await g.app({ appId: item.id, country: cc, lang: 'en' });
        item.installs = d.installs ?? item.installs;
        item.ageDays = parseReleased(d.released) ?? item.ageDays;
        item.genre = d.genre ?? item.genre;
        item.ratingCount = d.ratings ?? item.ratingCount;
        item.released = d.released ?? null;
      } catch {
        detailFails++;
      }
    }
  }

  const chartFree = list.slice(0, 30).map((a, i) => ({ ...entryOf(a), rank: i + 1 }));

  writeJson(join(ROOT, 'state/google', cc, `${DATE}.json`), {
    free: Object.fromEntries(items.filter((i) => i.catalogRank).map((i) => [i.id, i.catalogRank])),
  });

  return {
    region: cc,
    platform: 'google',
    generatedAt: new Date().toISOString(),
    items,
    chartFree,
    newCollectionAvailable: false,
    detailFails,
  };
}

export async function collectGoogle(health) {
  if (!enabled) {
    health.push({ source: 'google', ok: true, skipped: true, reason: 'ENABLE_GOOGLE_PLAY=false' });
    return;
  }
  const g = await loadLib(health);
  if (!g) return;

  const started = Date.now();
  const results = await pool(regions, CONCURRENCY, async (cc) => collectRegion(g, cc));
  let ok = 0;
  results.forEach((r, k) => {
    const cc = regions[k];
    if (!r || r.__error) {
      health.push({ source: `google:${cc}`, ok: false, error: r?.__error ?? 'unknown' });
      return;
    }
    ok++;
    if (r.detailFails) health.push({ source: `google:${cc}:details`, ok: false, error: `${r.detailFails} detail calls failed` });
    writeJson(join(ROOT, 'raw/google', `${cc}.json`), r);
  });
  health.push({ source: 'google', ok: true, regions: regions.length, succeeded: ok, ms: Date.now() - started });
  pruneStateTree(join(ROOT, 'state/google'), 35);
}
