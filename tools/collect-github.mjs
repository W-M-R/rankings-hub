import { join } from 'node:path';
import { getJson, sleep } from './lib/http.mjs';
import { ROOT, today, readJson, writeJson, pruneDir, daysBetween } from './lib/util.mjs';

const WINDOWS = [
  { key: 'daily', days: 3, minStars: 2, pages: 4 },
  { key: 'weekly', days: 7, minStars: 10, pages: 2 },
  { key: 'monthly', days: 30, minStars: 300, pages: 1 },
  { key: 'quarterly', days: 90, minStars: 1000, pages: 1 },
  { key: 'yearly', days: 365, minStars: 5000, pages: 1 },
];

const TOKEN = process.env.GITHUB_TOKEN || '';

const SPAM_WORDS = [
  'cheat', 'hack', 'crack', 'spoofer', 'keygen', 'autofarm', 'exploit', 'bypass',
  'free account', 'premium unlocked', 'mod apk', 'nulled', 'torrent', 'x64 script',
  'script hub', 'aimbot', 'wallhack', 'generator', 'robux', 'netflix cookie',
  'keyless', 'injector', 'executor', 'mod menu', 'mod loader', 'no recoil', ' esp',
  'aim assist', 'unlimited cash', 'bootstrapper', 'auto-dungeon', 'auto-spin', 'macro',
];

function looksLikeSpam(item) {
  const hay = `${item.full_name} ${item.description ?? ''}`.toLowerCase();
  if (SPAM_WORDS.some((w) => hay.includes(w))) return true;
  if (item.fork) return true;
  if ((item.description ?? '').trim().length < 20) return true;

  const stars = item.stargazers_count ?? 0;
  if (stars >= 100) {
    if (item.forks_count === 0) return true;
    if (item.license?.spdx_id === 'NOASSERTION') return true;
    if ((item.topics ?? []).length >= 15) return true;
    if (!item.license && (item.topics ?? []).length === 0) return true;
  }
  return false;
}
const PER_PAGE = 100;
const KEEP = 30;
const DATE = today();
const MIN_GAP = TOKEN ? 2100 : 6300;

const isoDaysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function normalize(item) {
  return {
    id: item.id,
    fullName: item.full_name,
    description: (item.description ?? '').slice(0, 200),
    url: item.html_url,
    stars: item.stargazers_count,
    forks: item.forks_count,
    language: item.language,
    topics: (item.topics ?? []).slice(0, 6),
    license: item.license?.spdx_id ?? null,
    createdAt: item.created_at,
    pushedAt: item.pushed_at,
    avatar: item.owner?.avatar_url ?? null,
    archived: !!item.archived,
  };
}

function previousSnapshots(keepDays = 14) {
  const snaps = [];
  for (let d = 1; d <= keepDays; d++) {
    const day = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const s = readJson(join(ROOT, 'state/github', `${day}.json`), null);
    if (s) snaps.push({ day, stars: s });
  }
  return snaps;
}

export async function collectGithub(health) {
  const started = Date.now();
  const headers = TOKEN ? { authorization: `Bearer ${TOKEN}` } : {};
  const windows = {};
  const all = new Map();

  for (const w of WINDOWS) {
    const q = encodeURIComponent(`created:>${isoDaysAgo(w.days)} stars:>${w.minStars}`);
    const raw = [];
    for (let page = 1; page <= (w.pages ?? 1); page++) {
      const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${PER_PAGE}&page=${page}`;
      const j = await getJson(url, { headers, retries: 2 });
      raw.push(...(j.items ?? []));
      const seen = new Set();
      if ((j.items ?? []).length < PER_PAGE) break;
      await sleep(MIN_GAP);
    }
    const items = raw.filter((it) => !looksLikeSpam(it)).map(normalize);
    const filtered = raw.length - items.length;
    for (const it of items) if (!all.has(it.fullName)) all.set(it.fullName, it);
    windows[w.key] = items;
    if (filtered) health.push({ source: `github:${w.key}`, ok: true, filtered });
    await sleep(MIN_GAP);
  }

  const snaps = previousSnapshots();
  const velocityFor = (fullName) => {
    for (const s of snaps) {
      if (s.stars[fullName] != null) {
        const days = Math.max(1, daysBetween(s.day, DATE));
        return { velocity: Number(((0 - 0 + (all.get(fullName).stars - s.stars[fullName])) / days).toFixed(2)), since: s.day };
      }
    }
    return { velocity: null, since: null };
  };

  for (const key of Object.keys(windows)) {
    windows[key] = windows[key]
      .map((it) => ({ ...it, ...velocityFor(it.fullName) }))
      .map((it) => ({
        ...it,
        hot: Number(
          (
            0.6 * Math.min(1, (it.velocity ?? 0) / Math.max(1, it.stars / 30)) +
            0.3 * Math.min(1, Math.log10(1 + it.stars) / 5) +
            0.1 * Math.min(1, 30 / Math.max(1, daysBetween(it.createdAt, new Date().toISOString())))
          ).toFixed(4),
        ),
      }))
      .sort((a, b) => b.hot - a.hot)
      .slice(0, KEEP)
      .map((it, i) => ({ ...it, rank: i + 1 }));
  }

  const tracked = [...all.values()]
    .map((it) => ({ ...it, ...velocityFor(it.fullName) }))
    .filter((it) => it.velocity != null && it.velocity > 0)
    .sort((a, b) => b.velocity - a.velocity)
    .slice(0, 30)
    .map((it, i) => ({ ...it, rank: i + 1 }));

  const snapshot = Object.fromEntries([...all.values()].map((it) => [it.fullName, it.stars]));
  writeJson(join(ROOT, 'state/github', `${DATE}.json`), snapshot);
  pruneDir(join(ROOT, 'state/github'), 40, (n) => n.replace(/\.json$/, ''));

  writeJson(join(ROOT, 'raw/github.json'), {
    generatedAt: new Date().toISOString(),
    windows,
    tracked,
    trackedSupported: snaps.length > 0,
  });

  health.push({ source: 'github', ok: true, windows: WINDOWS.length, tracked: tracked.length, ms: Date.now() - started });
}