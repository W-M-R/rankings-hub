import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');

export const today = (d = new Date()) => d.toISOString().slice(0, 10);

export function daysBetween(a, b) {
  return Math.floor((Date.parse(b) - Date.parse(a)) / 86400000);
}

export function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

export function readJson(p, fallback = null) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(p, data, pretty = false) {
  ensureDir(dirname(p));
  const text = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  writeFileSync(p, text);
  return text;
}

export const sha = (text) => createHash('sha256').update(text).digest('hex');

export const bytes = (p) => {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
};

/** 真实 UTF-8 字节数。`text.length` 数的是 UTF-16 码元，CJK/emoji 会偏小。 */
export const byteLength = (text) => Buffer.byteLength(text, 'utf8');

export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try {
        out[k] = await fn(items[k], k);
      } catch (err) {
        out[k] = { __error: String(err && err.message ? err.message : err) };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

/** 平铺目录里的 YYYY-MM-DD.json 快照，按日期淘汰。 */
export function pruneDir(dir, keepDays, dateField = (name) => name) {
  if (!existsSync(dir)) return 0;
  const cutoff = Date.now() - keepDays * 86400000;
  let removed = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const d = Date.parse(dateField(name));
    if (Number.isFinite(d) && d < cutoff) {
      rmSync(p, { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}

/**
 * 递归淘汰 `<dir>/<cc>/YYYY-MM-DD.json` 形态的状态树，并清掉空目录。
 * 旧实现把国家目录名喂给 Date.parse，结果恒为 NaN，35 天清理从未生效。
 */
export function pruneStateTree(root, keepDays) {
  if (!existsSync(root)) return { files: 0, dirs: 0 };
  const cutoff = Date.now() - keepDays * 86400000;
  const stats = { files: 0, dirs: 0 };

  const walk = (dir) => {
    let newest = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = walk(p);
        if (sub === 0) {
          rmSync(p, { recursive: true, force: true });
          stats.dirs++;
        }
        newest = Math.max(newest, sub);
        continue;
      }
      const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(entry.name);
      if (!m) continue;
      const t = Date.parse(m[1]);
      if (Number.isFinite(t) && t < cutoff) {
        rmSync(p, { force: true });
        stats.files++;
        continue;
      }
      newest = Math.max(newest, Number.isFinite(t) ? t : 0);
    }
    return newest;
  };

  walk(root);
  return stats;
}

/** 目录里最新的一个 YYYY-MM-DD.json，返回 [day, payload, gapDays]。 */
export function latestSnapshot(dir, beforeDay = today()) {
  if (!existsSync(dir)) return null;
  const days = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.slice(0, 10) < beforeDay)
    .sort();
  if (!days.length) return null;
  const day = days[days.length - 1].slice(0, 10);
  const payload = readJson(join(dir, days[days.length - 1]), null);
  if (!payload) return null;
  return [day, payload, Math.max(1, daysBetween(day, beforeDay))];
}

export const norm = (values) => {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return values.map((v) => (span === 0 ? 0.5 : (v - min) / span));
};
