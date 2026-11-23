import { writeJson, ROOT, ensureDir } from './lib/util.mjs';
import { join } from 'node:path';
import { collectItunes } from './collect-itunes.mjs';
import { collectGithub } from './collect-github.mjs';
import { collectGoogle } from './collect-google.mjs';
import { collectIndie } from './collect-indie.mjs';

const platforms = (process.env.PLATFORMS ?? 'apple,mac,podcasts,github,indie')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const health = [];
const started = Date.now();

if (platforms.includes('apple') || platforms.includes('mac') || platforms.includes('podcasts')) {
  await collectItunes(health).catch((err) => health.push({ source: 'itunes', ok: false, error: String(err) }));
}
if (platforms.includes('google')) {
  await collectGoogle(health).catch((err) => health.push({ source: 'google', ok: false, error: String(err) }));
}
if (platforms.includes('github')) {
  await collectGithub(health).catch((err) => health.push({ source: 'github', ok: false, error: String(err) }));
}
if (platforms.includes('indie')) {
  await collectIndie(health)
    .then((r) => console.log(`indie: showhn=${r.showhn} hf=${r.hf} hfModels=${r.hfModels} launch=${r.launch} crates=${r.crates} ghIndie=${r.ghIndie} ghSelf=${r.ghSelfhosted} selfhosted=${r.selfhosted} fdroid=${r.fdroid} izzy=${r.izzy} lobsters=${r.lobsters} devto=${r.devto} obsidian=${r.obsidian} firefox=${r.firefox} ph=${r.ph}`))
    .catch((err) => health.push({ source: 'indie', ok: false, error: String(err) }));
}

ensureDir(join(ROOT, 'raw'));
writeJson(
  join(ROOT, 'raw/health.json'),
  { generatedAt: new Date().toISOString(), ms: Date.now() - started, platforms, entries: health },
  true,
);

const failed = health.filter((h) => !h.ok && !h.skipped);
const succeeded = health.filter((h) => h.ok).length;
console.log(`collect: ${platforms.join(',')} in ${((Date.now() - started) / 1000).toFixed(1)}s  ok=${succeeded} failures=${failed.length}`);
if (succeeded === 0) process.exitCode = 1;
for (const f of failed.slice(0, 10)) console.log(`  fail ${f.source}: ${f.error}`);
