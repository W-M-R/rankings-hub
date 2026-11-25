import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { ROOT } from './lib/util.mjs';
import { slugOf } from './charts.mjs';

const read = (p, fb = null) => { try { return JSON.parse(readFileSync(join(ROOT, 'data', p), 'utf8')); } catch { return fb; } };
const n = (v) => v == null ? '—' : (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 10000 ? (v / 1000).toFixed(1) + 'k' : String(v));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, max) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max - 1) + '…' : t; };
const md = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

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

const dlt = (v) => (v == null ? '—' : v > 0 ? `+${v}` : String(v));

const daysSince = (iso) => Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 86400000));

function githubSection(w) {
  const d = read(`github/${w}.json`);
  if (!d?.items?.length) return '';
  const rows = d.items.map((r) => {
    const avg = r.stars != null && r.createdAt ? Math.round(r.stars / daysSince(r.createdAt)) : null;
    const perDay = r.velocity != null ? (r.velocity > 0 ? `+${r.velocity}` : String(r.velocity)) : null;
    const trendLabel = perDay ?? (avg != null ? `~${avg}` : '—');
    const spark = `<img src="charts/spark/${slugOf(r.fullName)}.svg" width="120" height="36" alt="star trend">`;
    return `<tr>
<td align="right">${r.rank}</td>
<td><a href="${esc(r.url)}"><b>${esc(r.fullName)}</b></a><br><code>${esc(r.language ?? '—')}</code>${r.license ? ` · ${esc(r.license)}` : ''}</td>
<td>${esc(clip(r.description ?? '—', 150))}</td>
<td align="right"><b>${n(r.stars)}</b><br><sub>${trendLabel}/day${perDay == null && avg != null ? ' avg' : ''}</sub></td>
<td>${spark}</td>
</tr>`;
  });
  return [
    `## GitHub · ${w}`,
    '',
    `<table><thead><tr><th>#</th><th>Repository</th><th>What it does</th><th align="right">Stars</th><th>Star trend</th></tr></thead><tbody>`,
    ...rows,
    '</tbody></table>',
    '',
  ].join('\n');
}

function appsSection(platform, label) {
  const cc = pickRegion(platform);
  if (!cc) return '';
  const d = read(`rising/${platform}/${cc}.json`);  if (!d) return '';
  const out = [];
  for (const [key, title] of [['risingNow', 'Rising now'], ['justLaunched', 'Just launched'], ['hiddenGems', 'Hidden gems']]) {
    const items = (d[key] ?? []).slice(0, 15);
    if (!items.length) continue;
    const rows = items.map((a) => [
      a.rank,
      `[${md(clip(a.name, 40))}](${a.url})`,
      md(clip(a.seller, 30)),
      a.rating ? a.rating.toFixed(1) : '—',
      n(a.ratingCount),
      a.ageDays != null ? `${a.ageDays}d` : '—',
      (a.bestRank ?? a.catalogRank ?? a.genreRank) != null ? `#${a.bestRank ?? a.catalogRank ?? a.genreRank}` : '—',
    ]);
    out.push(`### ${label} · ${title} (${cc.toUpperCase()})`, '', table(['#', 'app', 'developer', 'rating', 'ratings', 'age', 'chart'], rows), '');
  }
  return out.join('\n');
}

export function generateReadme(manifest) {
  const v = manifest?.version ?? new Date().toISOString();
  const parts = [];
  parts.push('# rankings-hub');
  parts.push('');
  parts.push('Rising apps and GitHub repositories, rebuilt every day. Tables and star charts below are regenerated from the latest run.');
  parts.push('');
  parts.push(`**Last update:** ${v.replace('T', ' ').replace('Z', ' UTC')} · **[Open the site](https://w-m-r.github.io/rankings-hub/)**`);
  parts.push('');

  for (const w of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']) {
    const s = githubSection(w);
    if (s) parts.push(s);
  }

  for (const [platform, label] of [['apple', 'iOS'], ['google', 'Android']]) {
    const s = appsSection(platform, label);
    if (s) parts.push(s);
  }

  const g = read('global/risers.json');
  if (g?.items?.length) {
    parts.push('## Global risers');
    parts.push('');
    parts.push('Apps climbing in three or more storefronts at once.');
    parts.push('');
    parts.push(table(['#', 'app', 'regions'], g.items.slice(0, 15).map((x) => [x.rank, `[${md(clip(x.name, 42))}](${x.url})`, x.regionCount])));
    parts.push('');
  }

  const showhn = read('indie/showhn.json');
  if (showhn?.items?.length) {
    parts.push('## Indie · Show HN');
    parts.push('');
    parts.push('Things people built and posted themselves in the last 48 hours, ranked by points.');
    parts.push('');
    parts.push(table(['#', 'project', 'points', 'Δ', 'comments', 'by'], showhn.items.slice(0, 20).map((x) => [
      x.rank, `[${md(clip(x.title, 70))}](${x.url})`, x.points, dlt(x.delta), x.comments, md(x.author),
    ])));
    parts.push('');
  }

  const hf = read('indie/hf-spaces.json');
  if (hf?.items?.length) {
    parts.push('## Indie · Hugging Face Spaces');
    parts.push('');
    parts.push('Trending demos and small AI apps, mostly built by individuals.');
    parts.push('');
    parts.push(table(['#', 'space', 'likes', 'Δ', 'sdk', 'updated'], hf.items.slice(0, 20).map((x) => [
      x.rank, `[${md(clip(x.id, 46))}](${x.url})`, x.likes, dlt(x.delta), x.sdk ?? '—', (x.updatedAt ?? '').slice(0, 10),
    ])));
    parts.push('');
  }

  const fd = read('indie/fdroid.json');
  if (fd?.items?.length) {
    parts.push('## Indie · F-Droid latest');
    parts.push('');
    parts.push('Newest open source Android apps added to F-Droid.');
    parts.push('');
    parts.push(table(['#', 'app', 'added', 'what it does'], fd.items.slice(0, 20).map((x) => [
      x.rank, `[${md(clip(x.name, 30))}](${x.url})`, x.addedAt, md(clip(x.summary, 80)),
    ])));
    parts.push('');
  }

  const more = [];
  const lob = read('indie/lobsters.json');
  if (lob?.items?.length) {
    more.push('### Lobsters hottest', '', table(['#', 'post', 'score', 'Δ', 'comments'], lob.items.slice(0, 15).map((x) => [x.rank, `[${md(clip(x.title, 66))}](${x.url})`, x.points, dlt(x.delta), x.comments])), '');
  }
  const dev = read('indie/devto.json');
  if (dev?.items?.length) {
    more.push('### Dev.to #showdev', '', table(['#', 'article', 'reactions', 'Δ', 'comments'], dev.items.slice(0, 15).map((x) => [x.rank, `[${md(clip(x.title, 66))}](${x.url})`, x.reactions, dlt(x.delta), x.comments])), '');
  }
  const obsNew = read('indie/obsidian-new.json');
  const obsTop = read('indie/obsidian-top.json');
  if (obsNew?.items?.length) {
    more.push('### Obsidian plugins · recently updated', '', table(['#', 'plugin', 'downloads', 'updated'], obsNew.items.slice(0, 15).map((x) => [x.rank, `[${md(clip(x.name, 30))}](${x.url})`, n(x.downloads), x.addedAt])), '');
  }
  if (obsTop?.items?.length) {
    more.push('### Obsidian plugins · most downloaded', '', table(['#', 'plugin', 'downloads', 'Δ'], obsTop.items.slice(0, 15).map((x) => [x.rank, `[${md(clip(x.name, 34))}](${x.url})`, n(x.downloads), dlt(x.delta)])), '');
  }
  const fxNew = read('indie/firefox-new.json');
  const fxTop = read('indie/firefox-top.json');
  if (fxNew?.items?.length) {
    more.push('### Firefox extensions · newest', '', table(['#', 'extension', 'daily users', 'created'], fxNew.items.slice(0, 15).map((x) => [x.rank, `[${md(clip(x.title, 40))}](${x.url})`, n(x.users), x.createdAt ?? '—'])), '');
  }
  if (fxTop?.items?.length) {
    more.push('### Firefox extensions · most used', '', table(['#', 'extension', 'daily users', 'Δ'], fxTop.items.slice(0, 15).map((x) => [x.rank, `[${md(clip(x.title, 44))}](${x.url})`, n(x.users), dlt(x.delta)])), '');
  }
  const hfm = read('indie/hf-models.json');
  if (hfm?.items?.length) {
    more.push('### Hugging Face models · trending', '', table(['#', 'model', 'likes', 'Δ', 'downloads', 'task'], hfm.items.slice(0, 15).map((x) => [x.rank, `[${md(clip(x.id, 42))}](${x.url})`, n(x.likes), dlt(x.delta), n(x.downloads), md(x.sdk ?? '—')])), '');
  }
  const lnch = read('indie/launch-hn.json');
  if (lnch?.items?.length) {
    more.push('### Launch HN', '', table(['#', 'launch', 'points', 'comments'], lnch.items.slice(0, 12).map((x) => [x.rank, `[${md(clip(x.title, 70))}](${x.url})`, x.points, x.comments])), '');
  }
  const crt = read('indie/crates-new.json');
  if (crt?.items?.length) {
    more.push('### New Rust crates', '', table(['#', 'crate', 'published', 'what it does'], crt.items.slice(0, 15).map((x) => [x.rank, `[${md(clip(x.title, 26))}](${x.url})`, x.addedAt ?? '—', md(clip(x.summary, 70))])), '');
  }
  const gi = read('indie/github-indie.json');
  if (gi?.items?.length) {
    more.push('### GitHub · topic:indie', '', table(['#', 'repo', 'stars', 'Δ', 'about'], gi.items.slice(0, 15).map((x) => [x.rank, `[${md(clip(x.title, 40))}](${x.url})`, n(x.stars), dlt(x.delta), md(clip(x.summary, 60))])), '');
  }
  const gs = read('indie/github-selfhosted.json');
  if (gs?.items?.length) {
    more.push('### GitHub · topic:self-hosted', '', table(['#', 'repo', 'stars', 'Δ', 'about'], gs.items.slice(0, 15).map((x) => [x.rank, `[${md(clip(x.title, 40))}](${x.url})`, n(x.stars), dlt(x.delta), md(clip(x.summary, 60))])), '');
  }
  const sh = read('indie/selfhosted.json');
  if (sh?.items?.length) {
    more.push('### Self-hosted catalog (awesome-selfhosted)', '', table(['#', 'project', 'category', 'what it does'], sh.items.slice(0, 20).map((x) => [x.rank, `[${md(clip(x.title, 28))}](${x.url})`, md(clip(x.category, 26)), md(clip(x.summary, 60))])), '');
  }
  const iz = read('indie/izzy.json');
  if (iz?.items?.length) {
    more.push('### IzzyOnDroid · newest', '', table(['#', 'app', 'added', 'what it does'], iz.items.slice(0, 15).map((x) => [x.rank, `[${md(clip(x.name, 30))}](${x.url})`, x.addedAt, md(clip(x.summary, 70))])), '');
  }
  if (more.length) {
    parts.push('<details>');
    parts.push('<summary><b>More indie rankings</b> — Lobsters, Dev.to, Obsidian plugins, Firefox extensions, IzzyOnDroid</summary>');
    parts.push('');
    parts.push(...more);
    parts.push('</details>');
    parts.push('');
  }

  const alt = read('alternatives.json');
  if (alt?.items?.length) {
    parts.push('## Open source alternatives');
    parts.push('');
    parts.push(table(['paid product', 'open source alternatives'], alt.items.slice(0, 20).map((c) => [
      md(clip(c.paid, 30)),
      c.alternatives.slice(0, 3).map((a) => `[${md(clip(a.name, 22))}](${a.url})`).join(' · '),
    ])));
    parts.push('');
  }

  parts.push('---');
  parts.push('');
  parts.push('## How it works');
  parts.push('');
  parts.push('- Apple storefront RSS (charts, new releases, genre charts), Google Play top charts, GitHub Search API.');
  parts.push('- Stores do not publish download counts: rising lists use **rank movement** and **rating deltas**; `+/day` switches on once two daily snapshots exist, until then the table shows the lifetime **avg/day**.');
  parts.push('- Star charts are built from our daily snapshots; on day one they show a size bar and switch to a line as soon as a second snapshot exists. The GitHub `stargazers` endpoint now returns 404 for everyone, so there is no historic backfill.');
  parts.push('- Rotating storefronts are sampled every few days; rank and rating deltas are normalised per day so regions with a 2–3 day gap stay comparable.');
  parts.push('- Small = fewer than 5,000 ratings; big publishers, gambling, dating and VPN apps are filtered. GitHub recent-creation results are ~90% star-farm spam and are filtered.');
  parts.push('');
  parts.push('### Files');
  parts.push('');
  parts.push('```');
  parts.push('data/manifest.json                    version + every shard (path, bytes, sha256)');
  parts.push('data/rising/{apple,google}/{cc}.json  risingNow / justLaunched / hiddenGems');
  parts.push('data/charts/{apple,google}/{cc}.json  mainstream charts');
  parts.push('data/mac/{cc}.json · data/podcasts/{cc}.json');
  parts.push('data/github/{daily,weekly,monthly,quarterly,yearly,tracked}.json');
  parts.push('data/global/risers.json · data/alternatives.json · data/health.json');
  parts.push('charts/spark/{owner__repo}.svg       star history per repository');
  parts.push('```');
  parts.push('');
  parts.push('## License');
  parts.push('');
  parts.push('Code MIT. App and repository metadata comes from Apple, Google and the respective GitHub projects; only structured fields, short snippets and links are stored.');
  parts.push('');

  return parts.join('\n');
}