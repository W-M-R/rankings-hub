import { join } from 'node:path';
import { getJson, createLimiter } from './lib/http.mjs';
import { ROOT, today, daysBetween, ensureDir, readJson, writeJson, pool, pruneDir } from './lib/util.mjs';
import { APPLE_ALL, MAJOR_40 } from './lib/regions.mjs';

const LIMIT = Number(process.env.REGIONS_LIMIT ?? 0);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8);
const RPS = Number(process.env.APPLE_RPS ?? 6);
const gate = createLimiter(RPS);
let consecutive403 = 0;
let tripped = false;
const DATE = today();
const YESTERDAY = today(new Date(Date.now() - 86400000));

const REGIONS_LIST = (process.env.REGIONS_LIST ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const MINOR = APPLE_ALL.filter((c) => !MAJOR_40.includes(c));
const SLICE = Number(process.env.MINOR_SLICES ?? 3);
const dayIndex = Math.floor(Date.now() / 86400000) % SLICE;
const rotated = [...MAJOR_40, ...MINOR.filter((_, i) => i % SLICE === dayIndex)];
const regionsAll = REGIONS_LIST.length ? REGIONS_LIST : LIMIT ? APPLE_ALL.slice(0, LIMIT) : rotated;
const regionsMajor = REGIONS_LIST.length
  ? REGIONS_LIST.filter((c) => MAJOR_40.includes(c))
  : LIMIT
    ? MAJOR_40.slice(0, LIMIT)
    : MAJOR_40;

const pick = (arr, height = '100') => {
  if (!Array.isArray(arr)) return null;
  const hit = arr.find((x) => x.attributes?.height === height) ?? arr[arr.length - 1];
  return hit?.label ?? null;
};

const entryOf = (e) => ({
  id: e.id?.attributes?.['im:id'] ?? e.id?.label ?? null,
  name: e['im:name']?.label ?? null,
  seller: e['im:artist']?.label ?? null,
  icon: pick(e['im:image'], '100'),
  price: e['im:price']?.label ?? null,
  currency: e['im:price']?.attributes?.currency ?? null,
  genre: e.category?.attributes?.label ?? null,
  url: e.link?.attributes?.href ?? null,
});

const GENRES = [
  { id: 6002, name: 'Utilities' },
  { id: 6007, name: 'Productivity' },
  { id: 6013, name: 'Health & Fitness' },
  { id: 6015, name: 'Finance' },
  { id: 6017, name: 'Education' },
  { id: 6008, name: 'Photo & Video' },
  { id: 6011, name: 'Music' },
  { id: 6012, name: 'Lifestyle' },
  { id: 6024, name: 'Shopping' },
];
const GENRE_REGIONS = new Set(MAJOR_40.slice(0, 20));
const GENRE_LIMIT = 50;
const MAJOR = new Set(MAJOR_40);

const rss = async (kind, cc, limit, genre) => {
  if (tripped) throw new Error('apple rate-limited (circuit open)');
  await gate();
  try {
    const j = await getJson(
      `https://itunes.apple.com/${cc}/rss/${kind}/limit=${limit}${genre ? `/genre=${genre}` : ''}/json`,
    );
    consecutive403 = 0;
    return (j.feed?.entry ?? []).map(entryOf);
  } catch (err) {
    if (err?.status === 403 || /HTTP 403/.test(String(err.message))) {
      if (++consecutive403 >= 8) tripped = true;
    }
    throw err;
  }
};

function previousState(cc) {
  const dir = join(ROOT, 'state/apple', cc);
  const prev = readJson(join(dir, `${YESTERDAY}.json`), null);
  if (prev) return prev;
  return null;
}

async function lookupBatch(ids, cc) {
  if (!ids.length) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += 140) {
    const chunk = ids.slice(i, i + 140);
    const url = `https://itunes.apple.com/lookup?id=${chunk.join(',')}&country=${cc}&entity=software`;
    await gate();
    const j = await getJson(url);
    out.push(...(j.results ?? []));
  }
  return out;
}

async function topGrossingArtists(cc) {
  try {
    const list = await rss('topgrossingapplications', cc, 50);
    const ids = list.map((e) => e.id).filter(Boolean);
    if (!ids.length) return new Set();
    const details = await lookupBatch(ids, cc);
    return new Set(details.map((d) => d.artistId).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function collectAppleRegion(cc) {
  const [free, fresh] = await Promise.all([
    rss('topfreeapplications', cc, 100),
    rss('newfreeapplications', cc, 200),
  ]);
  if (!free.length && !fresh.length) throw new Error('empty feeds');

  const bigArtists = MAJOR.has(cc) ? await topGrossingArtists(cc) : new Set();

  const genreFeeds = GENRE_REGIONS.has(cc)
    ? await Promise.all(GENRES.map((g) => rss('topfreeapplications', cc, GENRE_LIMIT, g.id).catch(() => [])))
    : [];

  const rankFree = new Map(free.map((e, i) => [e.id, i + 1]));
  const rankNew = new Map(fresh.map((e, i) => [e.id, i + 1]));
  const rankGenre = new Map();
  genreFeeds.forEach((list) => {
    list.forEach((e, i) => {
      if (!e.id) return;
      const prev = rankGenre.get(e.id);
      if (prev == null || i + 1 < prev) rankGenre.set(e.id, i + 1);
    });
  });

  const base = new Map();
  for (const e of [...free, ...fresh, ...genreFeeds.flat()]) if (e.id && !base.has(e.id)) base.set(e.id, e);

  const details = await lookupBatch([...base.keys()], cc);
  const prev = previousState(cc);
  const prevRatings = prev?.ratings ?? {};

  const items = [];
  for (const d of details) {
    const id = String(d.trackId);
    const b = base.get(id);
    if (!b) continue;
    const catalogRank = rankFree.get(id) ?? null;
    const genreRank = rankGenre.get(id) ?? null;
    const bestRank = Math.min(catalogRank ?? 9999, genreRank ?? 9999);
    const prevAll = prev?.all ?? prev?.free ?? null;
    const prevRank = prevAll ? (prevAll[id] ?? null) : null;
    const rankDelta = prevRank && bestRank < 9999 ? prevRank - bestRank : 0;
    const ratingCount = d.userRatingCount ?? 0;
    const ratingDelta = prevRatings[id] != null ? ratingCount - prevRatings[id] : 0;
    items.push({
      id,
      name: d.trackName ?? b.name,
      seller: d.sellerName ?? b.seller,
      artistId: d.artistId ?? null,
      icon: d.artworkUrl100 ?? b.icon,
      price: d.formattedPrice ?? b.price,
      genre: d.primaryGenreName ?? b.genre,
      url: d.trackViewUrl ?? b.url,
      catalogRank,
      genreRank,
      bestRank: bestRank < 9999 ? bestRank : null,
      newRank: rankNew.get(id) ?? null,
      rankDelta,
      isNew: prev ? prevRank == null : false,
      rating: Number((d.averageUserRating ?? 0).toFixed(2)),
      ratingCount,
      ratingDelta,
      ageDays: d.releaseDate ? Math.max(0, daysBetween(d.releaseDate, new Date().toISOString())) : null,
      platform: 'apple',
      region: cc,
    });
  }

  const artistCount = new Map();
  for (const it of items) {
    if (it.catalogRank != null && it.artistId) artistCount.set(it.artistId, (artistCount.get(it.artistId) ?? 0) + 1);
  }
  for (const it of items) {
    const n = artistCount.get(it.artistId) ?? 0;
    it.bigPublisher = (it.artistId != null && bigArtists.has(it.artistId)) || n >= 3;
  }

  const chart = free.slice(0, 30).map((e, i) => ({ ...e, rank: i + 1 }));

  const state = {
    all: Object.fromEntries(items.filter((i) => i.bestRank).map((i) => [i.id, i.bestRank])),
    free: Object.fromEntries(items.filter((i) => i.catalogRank).map((i) => [i.id, i.catalogRank])),
    genre: Object.fromEntries(items.filter((i) => i.genreRank).map((i) => [i.id, i.genreRank])),
    new: Object.fromEntries(items.filter((i) => i.newRank).map((i) => [i.id, i.newRank])),
    ratings: Object.fromEntries(items.map((i) => [i.id, i.ratingCount])),
  };
  writeJson(join(ROOT, 'state/apple', cc, `${DATE}.json`), state);

  return { region: cc, platform: 'apple', generatedAt: new Date().toISOString(), items, chart };
}

async function collectMacRegion(cc) {
  const [free, paid] = await Promise.all([
    rss('topfreemacapps', cc, 30),
    rss('toppaidmacapps', cc, 30),
  ]);
  if (!free.length && !paid.length) throw new Error('empty feeds');
  return {
    region: cc,
    platform: 'mac',
    generatedAt: new Date().toISOString(),
    free: free.map((e, i) => ({ ...e, rank: i + 1 })),
    paid: paid.map((e, i) => ({ ...e, rank: i + 1 })),
  };
}

async function collectPodcastsRegion(cc) {
  const list = await rss('toppodcasts', cc, 30);
  if (!list.length) throw new Error('empty feed');
  return {
    region: cc,
    platform: 'podcasts',
    generatedAt: new Date().toISOString(),
    items: list.map((e, i) => ({ ...e, rank: i + 1 })),
  };
}

export async function collectItunes(health) {
  const run = async (label, regions, fn) => {
    const started = Date.now();
    const results = await pool(regions, CONCURRENCY, async (cc) => fn(cc));
    let ok = 0;
    results.forEach((r, k) => {
      const cc = regions[k];
      if (!r || r.__error) {
        health.push({ source: `${label}:${cc}`, ok: false, error: r?.__error ?? 'unknown', ms: 0 });
        return;
      }
      ok++;
      writeJson(join(ROOT, 'raw', label, `${cc}.json`), r);
    });
    health.push({ source: label, ok: true, regions: regions.length, succeeded: ok, ms: Date.now() - started });
  };

  await run('apple', regionsAll, collectAppleRegion);
  await run('mac', regionsMajor, collectMacRegion);
  await run('podcasts', regionsMajor, collectPodcastsRegion);

  pruneDir(join(ROOT, 'state/apple'), 35, (name) => name.replace(/\.json$/, ''));
  ensureDir(join(ROOT, 'raw/apple'));
}