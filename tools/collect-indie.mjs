import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getJson } from './lib/http.mjs';
import { ROOT, writeJson } from './lib/util.mjs';

const LIMIT = Number(process.env.INDIE_LIMIT ?? 30);
const HN_WINDOW_HOURS = Number(process.env.HN_WINDOW_HOURS ?? 48);

const FDROID_MIRRORS = (process.env.FDROID_MIRRORS ??
  'https://mirrors.tuna.tsinghua.edu.cn/fdroid/repo/index-v2.json,https://mirrors.nju.edu.cn/fdroid/repo/index-v2.json')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const IZZY_URL = process.env.IZZY_URL ?? 'https://apt.izzysoft.de/fdroid/repo/index-v2.json';

const BIG_ORGS = [
  'google', 'meta', 'facebook', 'microsoft', 'openai', 'nvidia', 'amazon', 'apple', 'tencent',
  'alibaba', 'baidu', 'bytedance', 'salesforce', 'huggingface', 'stabilityai', 'minimax',
  'deepseek', 'moonshotai', 'thudm', 'qwen', 'internlm', 'baichuan-inc', '01-ai', 'xai',
  'anthropic', 'mistralai', 'cohere', 'ai21labs', 'runwayml', 'midjourney',
];

const localized = (v) => (typeof v === 'string' ? v : (v?.['en-US'] ?? (v ? Object.values(v)[0] : '') ?? ''));
const isBigOrg = (id = '') => BIG_ORGS.some((b) => id.toLowerCase().startsWith(b + '/') || id.toLowerCase() === b);
const short = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

async function showHn(health) {
  const started = Date.now();
  try {
    const j = await getJson('https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=200');
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
  } catch (e) {
    health.push({ source: 'showhn', ok: false, error: String(e.message ?? e) });
    return [];
  }
}

async function hfSpaces(health) {
  const started = Date.now();
  try {
    const j = await getJson('https://huggingface.co/api/spaces?sort=trendingScore&limit=100&full=true');
    const items = (j ?? [])
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
    return items;
  } catch (e) {
    health.push({ source: 'hf-spaces', ok: false, error: String(e.message ?? e) });
    return [];
  }
}

const FDROID_CACHE = join(ROOT, 'raw/fdroid-index.json');
const IZZY_CACHE = join(ROOT, 'raw/izzy-index.json');

function downloadCached(url, file, mirrors = null) {
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < 6 * 3600 * 1000) {
    const cached = readFileSync(file, 'utf8');
    if (cached.length > 1e6) return cached;
  }
  const urls = mirrors ?? [url];
  let lastErr;
  for (const u of urls) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        execFileSync('curl', ['-sSL', '--max-time', '300', '-o', file, u], { stdio: 'pipe' });
        const text = readFileSync(file, 'utf8');
        if (text.length > 1e6) return text;
        throw new Error('index too small');
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr ?? new Error('download failed');
}

function repoApps(raw, limit) {
  const j = JSON.parse(raw);
  return Object.entries(j.packages ?? {})
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
    .slice(0, limit)
    .map((x, i) => ({ rank: i + 1, ...x, addedAt: new Date(x.added).toISOString().slice(0, 10) }));
}

async function fdroid(health) {
  const started = Date.now();
  try {
    const raw = downloadCached(null, FDROID_CACHE, FDROID_MIRRORS);
    const items = repoApps(raw, LIMIT);
    health.push({ source: 'fdroid', ok: true, items: items.length, bytes: raw.length, ms: Date.now() - started });
    return items;
  } catch (e) {
    health.push({ source: 'fdroid', ok: false, error: String(e.message ?? e) });
    return [];
  }
}

async function izzy(health) {
  const started = Date.now();
  try {
    const raw = downloadCached(IZZY_URL, IZZY_CACHE);
    const items = repoApps(raw, LIMIT).map((x) => ({ ...x, url: `https://apt.izzysoft.de/fdroid/index/apk/${x.id}` }));
    health.push({ source: 'izzy', ok: true, items: items.length, bytes: raw.length, ms: Date.now() - started });
    return items;
  } catch (e) {
    health.push({ source: 'izzy', ok: false, error: String(e.message ?? e) });
    return [];
  }
}

async function lobsters(health) {
  const started = Date.now();
  try {
    const j = await getJson('https://lobste.rs/hottest.json');
    const items = (j ?? []).slice(0, LIMIT).map((x, i) => ({
      rank: i + 1,
      id: x.short_id,
      title: x.title,
      url: x.comments_url || x.url,
      link: x.url,
      points: x.score ?? 0,
      comments: x.comment_count ?? 0,
      author: x.submitter_user?.username ?? null,
      tags: (x.tags ?? []).slice(0, 3),
      createdAt: x.created_at,
    }));
    health.push({ source: 'lobsters', ok: true, items: items.length, ms: Date.now() - started });
    return items;
  } catch (e) {
    health.push({ source: 'lobsters', ok: false, error: String(e.message ?? e) });
    return [];
  }
}

async function devto(health) {
  const started = Date.now();
  try {
    const j = await getJson('https://dev.to/api/articles?tag=showdev&per_page=30&top=7');
    const items = (j ?? []).slice(0, LIMIT).map((a, i) => ({
      rank: i + 1,
      id: a.id,
      title: a.title,
      summary: short(a.description ?? '', 120),
      url: a.url,
      reactions: a.positive_reactions_count ?? 0,
      comments: a.comments_count ?? 0,
      author: a.user?.name ?? null,
      tags: (a.tag_list ?? []).slice(0, 3),
      createdAt: a.published_at,
    }));
    health.push({ source: 'devto', ok: true, items: items.length, ms: Date.now() - started });
    return items;
  } catch (e) {
    health.push({ source: 'devto', ok: false, error: String(e.message ?? e) });
    return [];
  }
}

const OBSIDIAN_PLUGINS =
  'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json';
const OBSIDIAN_STATS =
  'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json';

async function obsidian(health) {
  const started = Date.now();
  const out = { new: [], top: [] };
  try {
    const [plugins, stats] = await Promise.all([getJson(OBSIDIAN_PLUGINS), getJson(OBSIDIAN_STATS)]);
    const rows = (plugins ?? []).map((p) => {
      const s = stats?.[p.id] ?? {};
      return {
        id: p.id,
        name: p.name,
        author: p.author,
        summary: short(p.description ?? '', 120),
        url: p.repo ? `https://github.com/${p.repo}` : null,
        downloads: s.downloads ?? null,
        updated: s.updated ?? null,
      };
    });
    const recent = rows
      .filter((r) => r.updated && Date.now() - r.updated < 21 * 86400000)
      .sort((a, b) => b.updated - a.updated)
      .slice(0, LIMIT)
      .map((r, i) => ({ rank: i + 1, ...r, addedAt: new Date(r.updated).toISOString().slice(0, 10) }));
    const top = rows
      .filter((r) => r.downloads)
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, LIMIT)
      .map((r, i) => ({ rank: i + 1, ...r }));
    out.new = recent;
    out.top = top;
    health.push({ source: 'obsidian', ok: true, plugins: rows.length, new: recent.length, top: top.length, ms: Date.now() - started });
  } catch (e) {
    health.push({ source: 'obsidian', ok: false, error: String(e.message ?? e) });
  }
  return out;
}

const AMO = 'https://addons.mozilla.org/api/v5/addons/search/';

async function amo(sort, health, label) {
  const started = Date.now();
  try {
    const j = await getJson(`${AMO}?sort=${sort}&page_size=${LIMIT}`);
    const items = (j.results ?? []).slice(0, LIMIT).map((a, i) => ({
      rank: i + 1,
      id: a.guid,
      title: localized(a.name),
      summary: short(localized(a.summary ?? ''), 120),
      author: a.authors?.[0]?.name ?? null,
      url: `https://addons.mozilla.org/firefox/addon/${a.slug}/`,
      users: a.average_daily_users ?? 0,
      rating: a.ratings?.average ?? null,
      createdAt: (a.created ?? '').slice(0, 10) || null,
      updatedAt: (a.last_updated ?? '').slice(0, 10) || null,
    }));
    health.push({ source: `amo-${label}`, ok: true, items: items.length, ms: Date.now() - started });
    return items;
  } catch (e) {
    health.push({ source: `amo-${label}`, ok: false, error: String(e.message ?? e) });
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
      points: e.node.votesCount,
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
  const [hn, hf, fd, iz, lb, dt, ob, fxNew, fxTop, ph] = [
    await showHn(health),
    await hfSpaces(health),
    await fdroid(health),
    await izzy(health),
    await lobsters(health),
    await devto(health),
    await obsidian(health),
    await amo('created', health, 'new'),
    await amo('users', health, 'top'),
    await productHunt(health),
  ];

  writeJson(join(ROOT, 'raw/indie.json'), {
    generatedAt: new Date().toISOString(),
    showhn: hn,
    'hf-spaces': hf,
    fdroid: fd,
    izzy: iz,
    lobsters: lb,
    devto: dt,
    'obsidian-new': ob.new,
    'obsidian-top': ob.top,
    'firefox-new': fxNew,
    'firefox-top': fxTop,
    producthunt: ph,
  });

  return {
    showhn: hn.length,
    hf: hf.length,
    fdroid: fd.length,
    izzy: iz.length,
    lobsters: lb.length,
    devto: dt.length,
    obsidian: ob.new.length + ob.top.length,
    firefox: fxNew.length + fxTop.length,
    ph: ph.length,
  };
}