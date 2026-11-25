import { join } from 'node:path';
import { readdirSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { ROOT, readJson, writeJson, sha, byteLength, ensureDir } from './lib/util.mjs';
import { scoreRisers, selectLists } from './lib/score.mjs';
import { CONFIG } from './lib/regions.mjs';
import { generateReadme } from './readme.mjs';
import { generateCharts, snapshotSeries, seriesFor } from './charts.mjs';

rmSync(join(ROOT, 'data'), { recursive: true, force: true });
mkdirSync(join(ROOT, 'data'), { recursive: true });

const out = (p) => join(ROOT, 'data', p);
const list = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : []);
const readAll = (dir) => list(dir).map((f) => readJson(join(dir, f))).filter(Boolean);

const shards = [];
function emit(path, payload, count) {
  const text = JSON.stringify(payload);
  writeJson(out(path), payload);
  // 用真实 UTF-8 字节数：text.length 数的是 UTF-16 码元，中文/emoji 会算小
  shards.push({ path, count, bytes: byteLength(text), sha256: sha(text).slice(0, 16) });
}

const buckets = { apple: [], google: [], mac: [], podcasts: [] };

/** 榜单里每一条都带上同一份 region/platform，属于纯冗余；字段名写死在代码里，去掉能省体积。 */
function slimRows(items) {
  return items.map(({ region: _r, platform: _p, newRank: _n, bigPublisher: _b, ...rest }) => rest);
}

/** 榜单里每条都带上自己的历史序列，前端 sparkline 才有数据可画。 */
function withSparks(items, series) {
  // spark 用 [day, rank, ratings] 三元组；day 只保留 MM-DD（同一年内足够，
  // 跨年由 chart 端点自己补齐），能把每条从 3×11 字节压到 3×5 字节。
  return items.map((it) => ({
    ...it,
    spark: (series[it.id] ?? []).map(([d, r, n]) => [String(d).slice(5), r, n]),
  }));
}

/** 从 state/<platform>/<cc>/<day>.json 还原每个地区的榜单名次序列。 */
function appSeriesFrom(platform) {
  const series = {};
  const root = join(ROOT, `state/${platform}`);
  if (!existsSync(root)) return series;
  for (const cc of readdirSync(root)) {
    const dir = join(root, cc);
    if (!existsSync(dir) || !readdirSync(dir).some((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))) continue;
    const byId = (series[`${platform}:${cc}`] ??= {});
    for (const f of readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort()) {
      const day = f.slice(0, 10);
      const snap = readJson(join(dir, f), null) ?? {};
      const ranks = platform === 'google' ? snap.free : snap.all;
      for (const [id, rank] of Object.entries(ranks ?? {})) {
        (byId[id] ??= []).push([day, rank, snap.ratings?.[id] ?? null]);
      }
    }
  }
  return series;
}

const appSeries = { apple: appSeriesFrom('apple'), google: appSeriesFrom('google') };

for (const r of readAll(join(ROOT, 'raw/apple'))) {
  const scored = scoreRisers(r.items);
  const { risingNow, justLaunched, hiddenGems } = selectLists(scored);
  const series = appSeries.apple[`apple:${r.region}`] ?? {};
  emit(`rising/apple/${r.region}.json`, {
    region: r.region,
    platform: 'apple',
    generatedAt: r.generatedAt,
    risingNow: slimRows(withSparks(risingNow, series)),
    justLaunched: slimRows(withSparks(justLaunched, series)),
    hiddenGems: slimRows(withSparks(hiddenGems, series)),
  }, risingNow.length);
  buckets.apple.push({ region: r.region, risingNow });
}

for (const r of readAll(join(ROOT, 'raw/google'))) {
  const scored = scoreRisers(r.items);
  // Play 的 Top Free 100 里只有约 3% 的应用评分数 < 5000，"小应用"前提在 Android 不成立，
  // 所以 Android 侧只按名次变化 + 大厂过滤来选，不再套 iOS 的 smallRatingCount 门槛。
  const { risingNow, justLaunched, hiddenGems } = selectLists(scored, { smallOnly: false });
  const series = appSeries.google[`google:${r.region}`] ?? {};
  emit(`rising/google/${r.region}.json`, {
    region: r.region,
    platform: 'google',
    generatedAt: r.generatedAt,
    risingNow: slimRows(withSparks(risingNow, series)),
    justLaunched: slimRows(withSparks(justLaunched, series)),
    hiddenGems: slimRows(withSparks(hiddenGems, series)),
  }, risingNow.length);
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

// iOS/Android 每个地区的榜单条目的历史（用于站点详情弹窗）
const gh = readJson(join(ROOT, 'raw/github.json'), null);if (gh) {
  const snaps = snapshotSeries();
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
  budget: { rawBytes },
  shards,
};
writeJson(out('manifest.json'), manifest, true);

const chartInfo = generateCharts();
writeFileSync(join(ROOT, 'README.md'), generateReadme(manifest));

console.log(
  `build: shards=${shards.length} raw=${(rawBytes / 1048576).toFixed(2)}MB ` +
    `apple=${buckets.apple.length} google=${buckets.google.length} mac=${buckets.mac.length} podcasts=${buckets.podcasts.length} charts=${chartInfo.count}`,
);
