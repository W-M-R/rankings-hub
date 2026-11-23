import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { ROOT } from './lib/util.mjs';

const read = (p, fb = null) => { try { return JSON.parse(readFileSync(join(ROOT, 'data', p), 'utf8')); } catch { return fb; } };
const n = (v) => v == null ? '—' : (Math.abs(v) >= 10000 ? (v / 1000).toFixed(1) + 'k' : String(v));
const cell = (s, max = 60) => {
  const t = String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};
const table = (head, rows) =>
  [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

function pickRegion(platform) {
  const dir = join(ROOT, 'data/rising', platform);
  let list = [];
  try {
    list = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  } catch {
    return null;
  }
  if (list.includes('us')) return 'us';
  return list.sort()[0] ?? null;
}

export function generateReadme(manifest) {
  const v = manifest?.version ?? new Date().toISOString();
  const parts = [];
  parts.push('# rankings-hub');
  parts.push('');
  parts.push('Rising apps and GitHub repositories, rebuilt every day. The tables below are regenerated from the latest run.');
  parts.push('');
  parts.push(`**Last update:** ${v.replace('T', ' ').replace('Z', ' UTC')} · **[Open the site](https://w-m-r.github.io/rankings-hub/)**`);
  parts.push('');

  for (const w of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']) {
    const d = read(`github/${w}.json`);
    if (!d?.items?.length) continue;
    const rows = d.items.slice(0, 10).map((r) => [
      r.rank,
      `[${cell(r.fullName, 48)}](${r.url})`,
      n(r.stars),
      r.velocity != null ? (r.velocity > 0 ? `+${r.velocity}` : r.velocity) : '—',
      cell(r.language ?? '—', 16),
    ]);
    parts.push(`## GitHub · ${w}`);
    parts.push('');
    parts.push(table(['#', 'repository', 'stars', '+/day', 'lang'], rows));
    parts.push('');
  }

  for (const [platform, label] of [['apple', 'iOS'], ['google', 'Android']]) {
    const cc = pickRegion(platform);
    if (!cc) continue;
    const d = read(`rising/${platform}/${cc}.json`);
    if (!d) continue;
    for (const [key, title, extra] of [
      ['risingNow', 'Rising now', ['rank', 'app', 'rating', 'ratings', 'age']],
      ['justLaunched', 'Just launched', ['rank', 'app', 'rating', 'ratings', 'age']],
      ['hiddenGems', 'Hidden gems', ['rank', 'app', 'rating', 'ratings', 'rank?']],
    ]) {
      const items = (d[key] ?? []).slice(0, 10);
      if (!items.length) continue;
      const rows = items.map((a) => {
        const rank = a.bestRank ?? a.catalogRank ?? a.genreRank;
        return [
          a.rank,
          `[${cell(a.name, 42)}](${a.url})`,
          a.rating ? a.rating.toFixed(1) : '—',
          n(a.ratingCount),
          key === 'hiddenGems' ? (rank != null ? `#${rank}` : '—') : (a.ageDays != null ? `${a.ageDays}d` : '—'),
        ];
      });
      parts.push(`## ${label} · ${title} (${cc.toUpperCase()})`);
      parts.push('');
      parts.push(table(extra, rows));
      parts.push('');
    }
  }

  const g = read('global/risers.json');
  if (g?.items?.length) {
    parts.push('## Global risers');
    parts.push('');
    parts.push('Apps climbing in three or more storefronts at once.');
    parts.push('');
    parts.push(table(['#', 'app', 'regions'], g.items.slice(0, 10).map((x) => [x.rank, `[${cell(x.name, 42)}](${x.url})`, x.regionCount])));
    parts.push('');
  }

  const alt = read('alternatives.json');
  if (alt?.items?.length) {
    parts.push('## Open source alternatives');
    parts.push('');
    parts.push(table(['paid product', 'open source alternatives'], alt.items.slice(0, 12).map((c) => [
      cell(c.paid, 34),
      c.alternatives.slice(0, 3).map((a) => `[${cell(a.name, 22)}](${a.url})`).join(' · '),
    ])));
    parts.push('');
  }

  parts.push('---');
  parts.push('');
  parts.push('## How it works');
  parts.push('');
  parts.push('- Data source: Apple storefront RSS (charts, new releases, genre charts), Google Play top charts, GitHub Search API.');
  parts.push('- Neither store publishes download counts, so rising lists use **rank movement** and **rating deltas** as proxies; `is_new` stays off until a previous day exists.');
  parts.push('- Small means fewer than 5,000 ratings; big publishers, gambling, dating and VPN apps are filtered out.');
  parts.push('- GitHub windows are repositories created inside the window sorted by stars; the recent-creation feed is roughly 90% star-farm spam and is filtered.');
  parts.push('');
  parts.push('### Data files');
  parts.push('');
  parts.push('```');
  parts.push('data/manifest.json                 version + every shard (path, bytes, sha256)');
  parts.push('data/rising/{apple,google}/{cc}.json   risingNow / justLaunched / hiddenGems');
  parts.push('data/charts/{apple,google}/{cc}.json   mainstream charts for comparison');
  parts.push('data/mac/{cc}.json · data/podcasts/{cc}.json');
  parts.push('data/github/{daily,weekly,monthly,quarterly,yearly}.json');
  parts.push('data/global/risers.json · data/alternatives.json · data/health.json');
  parts.push('```');
  parts.push('');
  parts.push('## Run locally');
  parts.push('');
  parts.push('```bash');
  parts.push('npm install');
  parts.push('export GITHUB_TOKEN=$(gh auth token)');
  parts.push('ENABLE_GOOGLE_PLAY=true PLATFORMS=apple,mac,podcasts,google,github node tools/collect.mjs');
  parts.push('node tools/build.mjs && node tools/validate.mjs');
  parts.push('```');
  parts.push('');
  parts.push('Apple throttles bursts: requests are serialised at `APPLE_RPS` (default 3/s) and minor storefronts rotate over 3 days.');
  parts.push('');
  parts.push('## License');
  parts.push('');
  parts.push('Code MIT. App and repository metadata comes from Apple, Google and the respective GitHub projects; only structured fields, short snippets and links are stored.');
  parts.push('');

  return parts.join('\n');
}