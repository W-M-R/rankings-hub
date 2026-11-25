import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const OUT = join(ROOT, 'charts/spark');
const READ_JSON = (p, fb = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fb; } };
const slugOf = (fullName) => fullName.replace('/', '__');

// GitHub 的 stargazers 接口已对所有 token 返回 404，没有历史可回填。
// 这里只用自己的每日快照，序列随天数自然变长。
function seriesFor(repo, snapshots) {
  return snapshots[repo.fullName] ?? [];
}

function sparkSvg(points, stars, { w = 120, h = 36 } = {}) {
  const vals = points.map((p) => p[1]).filter((v) => v != null);
  const pad = 3;
  if (vals.length < 2) {
    const value = stars ?? vals[0] ?? 0;
    const ratio = Math.min(1, Math.log10(1 + value) / 4.3);
    const bw = Math.max(6, (w - pad * 2) * ratio);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${value} stars"><rect x="${pad}" y="${h / 2 - 5}" width="${w - pad * 2}" height="10" rx="5" fill="#e4e4e7"/><rect x="${pad}" y="${h / 2 - 5}" width="${bw.toFixed(1)}" height="10" rx="5" fill="#3451b2"/></svg>`;
  }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pts = points.map((p, i) => {
    if (p[1] == null) return null;
    const x = pad + (i / Math.max(1, points.length - 1)) * (w - pad * 2);
    const y = h - pad - ((p[1] - min) / span) * (h - pad * 2);
    return [x, y];
  }).filter(Boolean);
  const up = vals[vals.length - 1] >= vals[0];
  const color = up ? '#18794e' : '#b8272c';
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h - pad} L${pts[0][0].toFixed(1)},${h - pad} Z`;
  const last = pts[pts.length - 1];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${area}" fill="${color}" fill-opacity="0.10"/><path d="${line}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.2" fill="${color}"/></svg>`;
}

export function snapshotSeries() {
  const dir = join(ROOT, 'state/github');
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const day = f.slice(0, -5);
    const snap = READ_JSON(join(dir, f), {}) ?? {};
    for (const [repo, stars] of Object.entries(snap)) (out[repo] ??= []).push([day, stars]);
  }
  return out;
}

export function generateCharts() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const snaps = snapshotSeries();
  const seen = new Set();
  let count = 0;

  for (const w of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']) {
    const d = READ_JSON(join(ROOT, `data/github/${w}.json`));
    for (const item of d?.items ?? []) {
      if (seen.has(item.fullName)) continue;
      seen.add(item.fullName);
      const points = seriesFor(item, snaps);
      writeFileSync(join(OUT, `${slugOf(item.fullName)}.svg`), sparkSvg(points, item.stars));
      count++;
    }
  }
  return { count };
}

export { slugOf, seriesFor };