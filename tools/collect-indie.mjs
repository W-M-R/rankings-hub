import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { getJson } from './lib/http.mjs';
import { ROOT, writeJson } from './lib/util.mjs';

const LIMIT = Number(process.env.INDIE_LIMIT ?? 30);
const HN_WINDOW_HOURS = Number(process.env.HN_WINDOW_HOURS ?? 48);
const FDROID_MIRRORS = (process.env.FDROID_MIRRORS ??
  'https://mirrors.tuna.tsinghua.edu.cn/fdroid/repo/index-v2.json,https://mirrors.nju.edu.cn/fdroid/repo/index-v2.json')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const BIG_ORGS = [
  'google', 'meta', 'facebook', 'microsoft', 'openai', 'nvidia', 'amazon', 'apple', 'tencent',
  'alibaba', 'baidu', 'bytedance', 'salesforce', 'huggingface', 'stabilityai', 'minimax',
  'deepseek', 'moonshotai', 'thudm', 'qwen', 'internlm', 'baichuan-inc', '01-ai', 'xai',
  'anthropic', 'mistralai', 'cohere', 'ai21labs', 'runwayml', 'midjourney',
];

const localized = (v) => (typeof v === 'string' ? v : (v?.['en-US'] ?? (v ? Object.values(v)[0] : '') ?? ''));

const isBigOrg = (id = '') => BIG_ORGS.some((b) => id.toLowerCase().startsWith(b + '/') || id.toLowerCase() === b);

async function showHn(health) {
  const started = Date.now();
  const j = await getJson(`https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=200`);
  const cutoff = Date.now() - HN_WINDOW_HOURS * 3600 * 1000;
  const items = (j.hits ?? [])
    .filter((h) => Date.parse(h.created_at) >= cutoff)
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || (b.num_comments ?? 0) - (a.num_comments ?? 0))
    .slice(0, LIMIT)
    .map((h, i) => ({
      rank: i + 1,
      id: h.objectID,
      title: h.title,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      hnUrl: `https://news.ycombinator.com/item?id=${h.objectID}`,
      points: h.points ?? 0,
      comments: h.num_comments ?? 0,
      author: h.author,
      createdAt: h.created_at,
    }));
  health.push({ source: 'showhn', ok: true, items: items.length, ms: Date.now() - started });
  return items;
}

async function hfSpaces(health) {
  const started = Date.now();
  let items = [];
  try {
    const j = await getJson('https://huggingface.co/api/spaces?sort=trendingScore&limit=100&full=true');
    items = (j ?? [])
      .filter((s) => !isBigOrg(s.id))
      .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
      .slice(0, LIMIT)
      .map((s, i) => ({
        rank: i + 1,
        id: s.id,
        title: s.id.split('/')[1] ?? s.id,
        author: s.id.split('/')[0],
        url: `https://huggingface.co/spaces/${s.id}`,
        likes: s.likes ?? 0,
        sdk: s.sdk ?? null,
        updatedAt: s.lastModified ?? null,
      }));
    health.push({ source: 'hf-spaces', ok: true, items: items.length, ms: Date.now() - started });
  } catch (e) {
    health.push({ source: 'hf-spaces', ok: false, error: String(e.message ?? e) });
  }
  return items;
}

const FDROID_CACHE = join(ROOT, 'raw/fdroid-index.json');

function fetchFdroidIndex() {
  if (existsSync(FDROID_CACHE) && Date.now() - statSync(FDROID_CACHE).mtimeMs < 6 * 3600 * 1000) {
    const cached = readFileSync(FDROID_CACHE, 'utf8');
    if (cached.length > 1e6) return cached;
  }
  let lastErr;
  for (const url of FDROID_MIRRORS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        execFileSync('curl', ['-sSL', '--max-time', '300', '-o', FDROID_CACHE, url], { stdio: 'pipe' });
        const text = readFileSync(FDROID_CACHE, 'utf8');
        if (text.length > 1e6) return text;
        throw new Error('index too small');
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr ?? new Error('no fdroid mirror reachable');
}

async function fdroid(health) {
  const started = Date.now();
  try {
    const raw = await fetchFdroidIndex();
    const j = JSON.parse(raw);
    const pkgs = Object.entries(j.packages ?? {});
    const items = pkgs
      .map(([id, p]) => ({
        id,
        name: localized(p.metadata?.name) || id,
        summary: localized(p.metadata?.summary),
        added: p.metadata?.added ?? null,
        categories: (p.metadata?.categories ?? []).slice(0, 3),
        license: p.metadata?.license ?? null,
        url: `https://f-droid.org/packages/${id}/`,
      }))
      .filter((x) => x.added && x.summary)
      .sort((a, b) => b.added - a.added)
      .slice(0, LIMIT)
      .map((x, i) => ({
        rank: i + 1,
        ...x,
        addedAt: new Date(x.added).toISOString().slice(0, 10),
      }));
    health.push({ source: 'fdroid', ok: true, items: items.length, bytes: raw.length, ms: Date.now() - started });
    return items;
  } catch (e) {
    health.push({ source: 'fdroid', ok: false, error: String(e.message ?? e) });
    return [];
  }
}

async function productHunt(health) {
  const token = process.env.PH_TOKEN;
  if (!token) {
    health.push({ source: 'producthunt', ok: true, skipped: true, reason: 'PH_TOKEN not set' });
    return [];
  }
  try {
    const res = await fetch('https://api.producthunt.com/v2/api/graphql', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query($n:Int){ posts(order:RANKING, first:$n){ edges{ node{ id name tagline votesCount url createdAt } } } }`,
        variables: { n: LIMIT },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const items = (j.data?.posts?.edges ?? []).map((e, i) => ({
      rank: i + 1,
      id: e.node.id,
      title: e.node.name,
      summary: e.node.tagline,
      votes: e.node.votesCount,
      url: e.node.url,
      createdAt: e.node.createdAt,
    }));
    health.push({ source: 'producthunt', ok: true, items: items.length });
    return items;
  } catch (e) {
    health.push({ source: 'producthunt', ok: false, error: String(e.message ?? e) });
    return [];
  }
}

export async function collectIndie(health) {
  const [hn, hf, fd, ph] = [
    await showHn(health),
    await hfSpaces(health),
    await fdroid(health),
    await productHunt(health),
  ];
  writeJson(join(ROOT, 'raw/indie.json'), {
    generatedAt: new Date().toISOString(),
    showhn: hn,
    'hf-spaces': hf,
    fdroid: fd,
    producthunt: ph,
  });
  return { showhn: hn.length, hf: hf.length, fdroid: fd.length, ph: ph.length };
}