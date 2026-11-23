import { join } from 'node:path';
import { readdirSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { ROOT, readJson, writeJson, writeBrotli, sha, bytes, ensureDir } from './lib/util.mjs';
import { selectLists, matrixPenalty } from './lib/score.mjs';
import { CONFIG } from './lib/regions.mjs';
import { generateReadme } from './readme.mjs';
import { generateCharts, snapshotSeries } from './charts.mjs';

rmSync(join(ROOT, 'data'), { recursive: true, force: true });
mkdirSync(join(ROOT, 'data'), { recursive: true });

const out = (p) => join(ROOT, 'data', p);
const list = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : []);
const readAll = (dir) => list(dir).map((f) => readJson(join(dir, f))).filter(Boolean);

const shards = [];
function emit(path, payload, count) {
  const text = JSON.stringify(payload);
  writeJson(out(path), payload);
  const brBytes = writeBrotli(out(`${path}.br`), text);
  shards.push({ path, count, bytes: text.length, brBytes, sha256: sha(text).slice(0, 16) });
}

const buckets = { apple: [], google: [], mac: [], podcasts: [] };

for (const r of readAll(join(ROOT, 'raw/apple'))) {
  const { risingNow, justLaunched, hiddenGems } = selectLists(matrixPenalty(r.items));
  emit(`rising/apple/${r.region}.json`, {
    region: r.region,
    platform: 'apple',
    generatedAt: r.generatedAt,
    risingNow,
    justLaunched,
    hiddenGems,
  }, risingNow.length);
  emit(`charts/apple/${r.region}.json`, { region: r.region, platform: 'apple', generatedAt: r.generatedAt, items: r.chart }, r.chart.length);
  buckets.apple.push({ region: r.region, risingNow });
}

for (const r of readAll(join(ROOT, 'raw/google'))) {
  const { risingNow, justLaunched, hiddenGems } = selectLists(matrixPenalty(r.items));
  emit(`rising/google/${r.region}.json`, {
    region: r.region,
    platform: 'google',
    generatedAt: r.generatedAt,
    risingNow,
    justLaunched,
    hiddenGems,
  }, risingNow.length);
  emit(`charts/google/${r.region}.json`, {
    region: r.region,
    platform: 'google',
    generatedAt: r.generatedAt,
    free: r.chartFree ?? [],
    new: r.chartNew ?? [],
  }, (r.chartFree?.length ?? 0) + (r.chartNew?.length ?? 0));
  buckets.google.push({ region: r.region, risingNow });
}

for (const r of readAll(join(ROOT, 'raw/mac'))) {
  emit(`mac/${r.region}.json`, { region: r.region, platform: 'mac', generatedAt: r.generatedAt, free: r.free, paid: r.paid }, r.free.length + r.paid.length);
  buckets.mac.push({ region: r.region });
}

for (const r of readAll(join(ROOT, 'raw/podcasts'))) {
  emit(`podcasts/${r.region}.json`, { region: r.region, platform: 'podcasts', generatedAt: r.generatedAt, items: r.items }, r.items.length);
  buckets.podcasts.push({ region: r.region });
}

const gh = readJson(join(ROOT, 'raw/github.json'), null);
if (gh) {
  const snaps = snapshotSeries();
  const { seriesFor } = await import('./charts.mjs');
  for (const [key, windowsItems] of Object.entries(gh.windows)) {
    const items = windowsItems.map((it) => ({ ...it, spark: seriesFor(it, snaps) }));
    emit(`github/${key}.json`, { window: key, generatedAt: gh.generatedAt, items }, items.length);
  }
  if (gh.tracked?.length) emit('github/tracked.json', { window: 'tracked', generatedAt: gh.generatedAt, items: gh.tracked }, gh.tracked.length);
}

function globalRisers(bucket, platform) {
  const map = new Map();
  for (const { region, risingNow } of bucket) {
    for (const item of risingNow ?? []) {
      const cur = map.get(item.id) ?? { item, regions: [] };
      cur.regions.push(region);
      if (item.riserScore > (cur.item.riserScore ?? 0)) cur.item = item;
      map.set(item.id, cur);
    }
  }
  return [...map.values()]
    .filter((v) => v.regions.length >= CONFIG.minGlobalRegions)
    .sort((a, b) => b.regions.length - a.regions.length || (b.item.riserScore ?? 0) - (a.item.riserScore ?? 0))
    .slice(0, 30)
    .map((v, i) => ({ rank: i + 1, ...v.item, platform, regionCount: v.regions.length, regions: v.regions.slice(0, 8) }));
}

const globalItems = [...globalRisers(buckets.apple, 'apple'), ...globalRisers(buckets.google, 'google')]
  .sort((a, b) => (b.regionCount ?? 0) - (a.regionCount ?? 0) || (b.riserScore ?? 0) - (a.riserScore ?? 0))
  .slice(0, 30)
  .map((it, i) => ({ ...it, rank: i + 1 }));
emit('global/risers.json', { generatedAt: new Date().toISOString(), items: globalItems }, globalItems.length);

const indie = readJson(join(ROOT, 'raw/indie.json'), null);
if (indie) {
  const history = {};
  try {
    const stDir = join(ROOT, 'state/indie');
    const fsMod = await import('node:fs');
    for (const f of fsMod.readdirSync(stDir).filter((x) => x.endsWith('.json')).sort()) {
      const day = f.slice(0, -5);
      const snap = readJson(join(stDir, f), {}) ?? {};
      for (const [source, map] of Object.entries(snap)) {
        history[source] ??= {};
        for (const [id, pair] of Object.entries(map)) {
          (history[source][id] ??= []).push([day, pair?.[1] ?? null]);
        }
      }
    }
  } catch {}
  for (const key of ['showhn', 'hf-spaces', 'hf-models', 'launch-hn', 'crates-new', 'github-indie', 'github-selfhosted', 'selfhosted', 'fdroid', 'izzy', 'lobsters', 'devto', 'obsidian-new', 'obsidian-top', 'firefox-new', 'firefox-top', 'producthunt']) {
    const items = (indie[key] ?? []).map((it) => ({
      ...it,
      spark: (history[key]?.[it.id] ?? []).slice(-60),
    }));
    if (!items.length) continue;
    emit(`indie/${key}.json`, { source: key, generatedAt: indie.generatedAt, items }, items.length);
  }
}

const altSource = join(ROOT, 'content/alternatives.yml');
let alternatives = [];
if (existsSync(altSource)) {
  const { parseAlternatives } = await import('./lib/yaml-lite.mjs');
  alternatives = parseAlternatives(altSource).map((a, i) => ({ id: i + 1, ...a }));
}
emit('alternatives.json', { generatedAt: new Date().toISOString(), items: alternatives }, alternatives.length);

const health = readJson(join(ROOT, 'raw/health.json'), { entries: [] });
writeJson(out('health.json'), health);

const rawBytes = shards.reduce((n, s) => n + s.bytes, 0);
const brBytes = shards.reduce((n, s) => n + s.brBytes, 0);
const version = new Date().toISOString().slice(0, 16) + 'Z';

const manifest = {
  version,
  generatedAt: new Date().toISOString(),
  counts: {
    appleRegions: buckets.apple.length,
    googleRegions: buckets.google.length,
    macRegions: buckets.mac.length,
    podcastRegions: buckets.podcasts.length,
    githubWindows: gh ? Object.keys(gh.windows).length : 0,
    globalRisers: globalItems.length,
    alternatives: alternatives.length,
    indie: indie
      ? ['showhn', 'hf-spaces', 'hf-models', 'launch-hn', 'crates-new', 'github-indie', 'github-selfhosted', 'selfhosted', 'fdroid', 'izzy', 'lobsters', 'devto', 'obsidian-new', 'obsidian-top', 'firefox-new', 'firefox-top', 'producthunt'].filter(
          (k) => (indie[k] ?? []).length,
        ).length
      : 0,
    shards: shards.length,
  },
  budget: { rawBytes, brBytes },
  shards,
};
writeJson(out('manifest.json'), manifest, true);
writeBrotli(out('manifest.json.br'), JSON.stringify(manifest, null, 2));

const chartInfo = generateCharts();
writeFileSync(join(ROOT, 'README.md'), generateReadme(manifest));

console.log(
  `build: shards=${shards.length} raw=${(rawBytes / 1048576).toFixed(2)}MB br=${(brBytes / 1024).toFixed(0)}KB ` +
    `apple=${buckets.apple.length} google=${buckets.google.length} mac=${buckets.mac.length} podcasts=${buckets.podcasts.length} charts=${chartInfo.count}`,
);