import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { ROOT, readJson, sha, bytes } from './lib/util.mjs';

const problems = [];
const dataDir = join(ROOT, 'data');
const manifest = readJson(join(dataDir, 'manifest.json'), null);

if (!manifest) problems.push('manifest.json 缺失');

const seen = new Set();
for (const shard of manifest?.shards ?? []) {
  if (seen.has(shard.path)) problems.push(`重复分片 ${shard.path}`);
  seen.add(shard.path);
  const p = join(dataDir, shard.path);
  if (!existsSync(p)) {
    problems.push(`缺文件 ${shard.path}`);
    continue;
  }
  const text = readFileSync(p, 'utf8');
  try {
    JSON.parse(text);
  } catch {
    problems.push(`JSON 解析失败 ${shard.path}`);
    continue;
  }
  if (sha(text).slice(0, 16) !== shard.sha256) problems.push(`sha256 不匹配 ${shard.path}`);
  const actual = bytes(p);
  if (actual === 0) problems.push(`空文件 ${shard.path}`);
  if (shard.bytes != null && actual !== shard.bytes) problems.push(`字节数不符 ${shard.path} (${shard.bytes} vs ${actual})`);
}

const required = ['github/daily.json'];
for (const r of required) if (!seen.has(r)) problems.push(`缺必需分片 ${r}`);
if (![...seen].some((p) => p.startsWith('rising/apple/'))) problems.push('缺 rising/apple 分片');
const platforms = (process.env.PLATFORMS ?? 'apple,mac,podcasts,github').split(',');
if (platforms.includes('google') && ![...seen].some((p) => p.startsWith('rising/google/'))) {
  problems.push('缺 rising/google 分片');
}

for (const name of ['github/daily.json', 'github/weekly.json', 'github/monthly.json', 'github/quarterly.json', 'github/yearly.json']) {
  if (!seen.has(name)) continue;
  const j = readJson(join(dataDir, name));
  const min = name.endsWith('daily.json') ? 5 : 8;
  if ((j.items?.length ?? 0) < min) problems.push(`${name} 条目过少 (${j.items?.length ?? 0} < ${min})`);
}

const appleRising = [...seen].filter((p) => p.startsWith('rising/apple/'));
const minApple = Number(process.env.REGIONS_LIMIT ?? 0) || 20;
if (manifest && appleRising.length < minApple) problems.push(`iOS 地区过少：${appleRising.length} < ${minApple}`);

// 预算用真实文件字节数，不再读 manifest 自己报的数（自证循环永远不会触发）
const rawTotal = [...seen].reduce((n, p) => n + bytes(join(dataDir, p)), 0);
if (rawTotal > 12_000_000) problems.push(`分片总量超预算：${(rawTotal / 1048576).toFixed(2)}MB`);

// README 里引用的星标图必须真实存在。charts/ 现在只发布到 gh-pages，
// 所以同时校验本地文件（构建期）和线上 URL（发布后由 CI 的第二步兜底）。
const readmePath = join(ROOT, 'README.md');
if (existsSync(readmePath)) {
  const readme = readFileSync(readmePath, 'utf8');
  // 代码块里的 charts/spark/{owner__repo}.svg 是文件名说明，不是真实引用
  const outsideCode = readme.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  const refs = [...new Set([...outsideCode.matchAll(/src="([^"]*charts\/spark\/[^"]+\.svg)"/g)].map((m) => m[1]))];
  const local = refs.filter((p) => !/^https?:/.test(p));
  const remote = refs.filter((p) => /^https?:/.test(p));
  const missingLocal = local.filter((p) => !existsSync(join(ROOT, p)));
  if (missingLocal.length) problems.push(`README 引用了 ${missingLocal.length} 个本地不存在的图表（例：${missingLocal[0]}）`);

  // 绝对 URL 指向线上站点：逐条 HEAD 太重，抽 3 个 + 检查域名是否与 SITE_BASE 一致
  const siteBase = process.env.SITE_BASE ?? 'https://w-m-r.github.io/rankings-hub';
  const wrongHost = remote.filter((p) => !p.startsWith(siteBase));
  if (wrongHost.length) problems.push(`README 有 ${wrongHost.length} 个图表指向了非站点域名（例：${wrongHost[0]}）`);
  if (process.env.CHECK_REMOTE_CHARTS === '1' && remote.length) {
    const sample = remote.slice(0, 3);
    for (const url of sample) {
      const ok = await fetch(url, { method: 'HEAD' })
        .then((r) => r.ok)
        .catch(() => false);
      if (!ok) problems.push(`README 的线上图表不可访问：${url}`);
    }
  }
}

// 榜单里出现 spark 字段但序列为空，说明 state 历史没接上
for (const name of [...seen].filter((p) => p.startsWith('rising/apple/')).slice(0, 5)) {
  const j = readJson(join(dataDir, name));
  const rows = j?.risingNow ?? [];
  if (rows.length && rows.every((r) => !(r.spark?.length > 1))) {
    problems.push(`${name} 的 spark 序列全空（state 历史未接上）`);
  }
}

const health = readJson(join(dataDir, 'health.json'), { entries: [] });
const sources = health.entries?.filter((e) => e.ok).length ?? 0;
if (sources === 0) problems.push('health.json 没有任何成功源');

if (problems.length) {
  console.error(`❌ validate 失败 ${problems.length} 项`);
  for (const p of problems.slice(0, 25)) console.error('  - ' + p);
  process.exit(1);
}

console.log(
  `✅ validate 通过：${seen.size} 个分片，raw ${(rawTotal / 1048576).toFixed(2)}MB，版本 ${manifest.version}`,
);
