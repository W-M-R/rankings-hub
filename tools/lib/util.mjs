import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { brotliCompressSync, constants as zc } from 'node:zlib';

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

export function writeBrotli(p, text) {
  ensureDir(dirname(p));
  const buf = brotliCompressSync(Buffer.from(text), {
    params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_SIZE_HINT]: text.length },
  });
  writeFileSync(p, buf);
  return buf.length;
}

export const sha = (text) => createHash('sha256').update(text).digest('hex');

export const bytes = (p) => {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
};

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

export function pruneDir(dir, keepDays, dateField = (name) => name) {
  if (!existsSync(dir)) return;
  const cutoff = Date.now() - keepDays * 86400000;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const d = Date.parse(dateField(name));
    if (Number.isFinite(d) && d < cutoff) rmSync(p, { recursive: true, force: true });
  }
}

export const norm = (values) => {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return values.map((v) => (span === 0 ? 0.5 : (v - min) / span));
};