import { join } from 'node:path';
import { ROOT, today, readJson, writeJson, pool, pruneDir } from './lib/util.mjs';
import { GOOGLE_MARKETS } from './lib/regions.mjs';

const LIMIT = Number(process.env.REGIONS_LIMIT ?? 0);
const CONCURRENCY = Number(process.env.GOOGLE_CONCURRENCY ?? 4);
const DETAILS_LIMIT = Number(process.env.GOOGLE_DETAILS_LIMIT ?? 0);
const DATE = today();
const YESTERDAY = today(new Date(Date.now() - 86400000));
const regions = LIMIT ? GOOGLE_MARKETS.slice(0, LIMIT) : GOOGLE_MARKETS;

const enabled = process.env.ENABLE_GOOGLE_PLAY === 'true';

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

const entryOf = (a) => ({
  id: a.appId,
  name: a.title,
  seller: a.developer,
  icon: a.icon,
  price: a.free ? 'Free' : null,
  genre: null,
  url: `https://play.google.com/store/apps/details?id=${a.appId}`,
  rating: Number((a.score ?? 0).toFixed(2)),
  ratingCount: null,
});

async function collectRegion(g, cc) {
  const list = (await g.list({
    collection: g.collection.TOP_FREE,
    category: g.category.APPLICATION,
    country: cc,
    lang: 'en',
    num: 100,
  })) ?? [];
  if (!list.length) throw new Error('empty collection');

  const prev = readJson(join(ROOT, 'state/google', cc, `${YESTERDAY}.json`), null);
  const rankFree = new Map(list.map((a, i) => [a.appId, i + 1]));

  const items = list.map((a) => {
    const e = entryOf(a);
    const catalogRank = rankFree.get(e.id) ?? null;
    const prevRank = prev?.free?.[e.id] ?? null;
    return {
      ...e,
      rankFree: catalogRank,
      catalogRank,
      newRank: null,
      rankDelta: prevRank && catalogRank ? prevRank - catalogRank : 0,
      isNew: prev ? prevRank == null : false,
      ratingDelta: 0,
      ageDays: null,
      platform: 'google',
      region: cc,
    };
  });

  if (DETAILS_LIMIT > 0) {
    const fresh = items
      .filter((i) => (i.catalogRank ?? 999) >= 40)
      .slice(0, DETAILS_LIMIT);
    for (const item of fresh) {
      try {
        const d = await g.app({ appId: item.id, country: cc, lang: 'en' });
        item.installs = d.installs ?? null;
        item.ageDays = d.released ? Math.max(0, Math.floor((Date.now() - Date.parse(d.released)) / 86400000)) : null;
        item.genre = d.genre ?? null;
        item.ratingCount = d.ratings ?? null;
        item.released = d.released ?? null;
      } catch {
        /* detail optional */
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
    writeJson(join(ROOT, 'raw/google', `${cc}.json`), r);
  });
  health.push({ source: 'google', ok: true, regions: regions.length, succeeded: ok, ms: Date.now() - started });
  pruneDir(join(ROOT, 'state/google'), 35, (name) => name.replace(/\.json$/, ''));
}