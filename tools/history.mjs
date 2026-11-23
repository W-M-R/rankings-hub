// Backfill real star history from the GitHub stargazers API (starred_at timestamps),
// then merge monthly points with our own daily snapshots.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.STAR_TOKEN ?? '';
const LIMIT = Number(process.env.HISTORY_LIMIT ?? 60);
const MAX_STARS = Number(process.env.HISTORY_MAX_STARS ?? 20000);
const MAX_PAGES = Number(process.env.HISTORY_MAX_PAGES ?? 30);
const REFRESH_DAYS = Number(process.env.HISTORY_REFRESH_DAYS ?? 7);

const HIST = join(ROOT, 'history/stars');
mkdirSync(HIST, { recursive: true });

const today = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p, fb = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fb; } };
const writeJson = (p, d) => writeFileSync(p, JSON.stringify(d));

function repoList() {
  const seen = new Map();
  for (const w of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']) {
    const d = readJson(join(ROOT, `data/github/${w}.json`));
    for (const it of d?.items ?? []) if (!seen.has(it.fullName)) seen.set(it.fullName, it);
  }
  return [...seen.values()];
}

function snapshotSeries() {
  const dir = join(ROOT, 'state/github');
  const series = {};
  if (!existsSync(dir)) return series;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const day = f.slice(0, -5);
    const snap = readJson(join(dir, f), {}) ?? {};
    for (const [repo, stars] of Object.entries(snap)) (series[repo] ??= []).push([day, stars]);
  }
  return series;
}

async function gh(path) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/vnd.github.star+json',
      'user-agent': 'rankings-hub-history',
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}`);
  return { data: await r.json(), link: r.headers.get('link') ?? '' };
}

async function backfill(repo) {
  const points = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const { data } = await gh(`/repos/${repo}/stargazers?per_page=100&page=${page}`);
    if (!Array.isArray(data) || !data.length) break;
    for (const s of data) if (s.starred_at) points.push(s.starred_at.slice(0, 10));
    if (data.length < 100) break;
    page++;
    await sleep(120);
  }
  if (!points.length) return null;
  const byMonth = new Map();
  for (const d of points) byMonth.set(d.slice(0, 7), (byMonth.get(d.slice(0, 7)) ?? 0) + 1);
  let cum = 0;
  const monthly = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, n]) => { cum += n; return [m, cum]; });
  return { total: points.length, firstStar: points[points.length - 1], monthly };
}

function stale(file) {
  if (!existsSync(file)) return true;
  const d = readJson(file);
  if (!d?.updatedAt) return true;
  return (Date.now() - Date.parse(d.updatedAt)) / 86400000 > REFRESH_DAYS;
}

async function main() {
  const repos = repoList().filter((r) => (r.stars ?? 0) <= MAX_STARS);
  const snaps = snapshotSeries();
  let done = 0;
  let skipped = 0;

  for (const repo of repos.slice(0, LIMIT)) {
    const slug = repo.fullName.replace('/', '__');
    const file = join(HIST, `${slug}.json`);
    let entry = readJson(file);

    if (TOKEN && stale(file)) {
      try {
        const res = await backfill(repo.fullName);
        if (res) {
          entry = { repo: repo.fullName, updatedAt: new Date().toISOString(), ...res };
          done++;
        }
      } catch (e) {
        skipped++;
        console.warn(`history skip ${repo.fullName}: ${e.message}`);
      }
    }

    const daily = snaps[repo.fullName] ?? [];
    const merged = mergePoints(entry, daily, repo);
    if (merged) writeJson(file, merged);
    if (entry) writeJson(file, { ...entry, points: merged?.points ?? [] });
  }
  console.log(`history: backfilled ${done}, skipped ${skipped}, tracked ${repos.length}`);
}

function mergePoints(entry, daily, repo) {
  const map = new Map();
  for (const [m, v] of entry?.monthly ?? []) map.set(`${m}-01`, v);
  for (const [d, v] of daily) map.set(d, v);
  if (!map.size) return null;
  const base = entry?.monthly?.length ? entry.monthly : null;
  const points = [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  return {
    repo: repo.fullName,
    stars: repo.stars,
    language: repo.language,
    description: (repo.description ?? '').slice(0, 160),
    monthly: entry?.monthly ?? null,
    points,
    updatedAt: new Date().toISOString(),
  };
}

main().catch((e) => { console.error(e); process.exit(1); });