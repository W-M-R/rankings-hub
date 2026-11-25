import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreRisers, selectLists, diversify } from '../tools/lib/score.mjs';
import { spamReason } from '../tools/lib/spam.mjs';
import { byteLength, pruneStateTree, latestSnapshot, norm } from '../tools/lib/util.mjs';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const mk = (over = {}) => ({
  id: 'x',
  seller: 'Dev',
  rankDelta: 10,
  ratingDelta: 1,
  isNew: false,
  ageDays: 30,
  ratingCount: 100,
  catalogRank: 10,
  bestRank: 10,
  rating: 4.6,
  genre: 'Utilities',
  ...over,
});

test('byteLength 按 UTF-8 计，text.length 会算小', () => {
  assert.equal(byteLength('abc'), 3);
  assert.equal(byteLength('中文'), 6);
  assert.equal('中文'.length, 2);
});

test('矩阵刷榜：同一 seller 多个新品被降权，且分数不会被 selectLists 重算覆盖', () => {
  const items = [
    mk({ id: 'a', seller: 'Matrix Co', rankDelta: 60 }),
    mk({ id: 'b', seller: 'Matrix Co', rankDelta: 58 }),
    mk({ id: 'c', seller: 'Matrix Co', rankDelta: 56 }),
    mk({ id: 'd', seller: 'Solo', rankDelta: 54 }),
  ].map((i) => ({ ...i, isNew: true }));

  const scored = scoreRisers(items);
  const matrix = scored.filter((i) => i.seller === 'Matrix Co');
  assert.ok(matrix.every((i) => i.matrix), '同 seller 三个新品都应打上 matrix');
  assert.equal(scored.find((i) => i.seller === 'Solo').matrix, undefined);

  const { risingNow } = selectLists(scored);
  for (const row of risingNow) {
    const before = scored.find((s) => s.id === row.id);
    assert.equal(row.riserScore, before.riserScore, 'selectLists 不应改写 riserScore');
  }
});

test('risingNow 只收真的在涨的条目', () => {
  const scored = scoreRisers([
    mk({ id: 'up', rankDelta: 20 }),
    mk({ id: 'down', rankDelta: -8 }),
    mk({ id: 'flat', rankDelta: 0 }),
  ]);
  const ids = selectLists(scored).risingNow.map((i) => i.id);
  assert.ok(ids.includes('up'));
  assert.ok(!ids.includes('down'), '名次下降不应进 risingNow');
  assert.ok(!ids.includes('flat'), '名次不变不应进 risingNow');
});

test('新上榜只有在名次靠前时才算 rising', () => {
  const scored = scoreRisers([
    mk({ id: 'front', isNew: true, rankDelta: 0, bestRank: 12 }),
    mk({ id: 'tail', isNew: true, rankDelta: 0, bestRank: 300 }),
  ]);
  const ids = selectLists(scored).risingNow.map((i) => i.id);
  assert.ok(ids.includes('front'));
  assert.ok(!ids.includes('tail'), '300 名的「新出现」是长尾抖动');
});

test('老应用翻红不应被年龄过滤掉', () => {
  // 实测 95% 的名次上升来自上线 180 天以上的应用
  const scored = scoreRisers([mk({ id: 'old', ageDays: 2800, rankDelta: 25 })]);
  assert.equal(selectLists(scored).risingNow.length, 1);
});

test('Android 侧不套 smallRatingCount 门槛', () => {
  const big = [mk({ id: 'g', ratingCount: 900_000, rankDelta: 12, ageDays: null })];
  assert.equal(selectLists(scoreRisers(big)).risingNow.length, 0, 'iOS 默认过滤大评分量');
  assert.equal(selectLists(scoreRisers(big), { smallOnly: false }).risingNow.length, 1);
});

test('diversify 限制同 owner 与同主题', () => {
  const items = [
    { fullName: 'a/gta-port', description: 'GTA VI recomp' },
    { fullName: 'b/gta-port2', description: 'GTA VI recomp' },
    { fullName: 'c/gta-port3', description: 'GTA VI recomp' },
    { fullName: 'd/gta-port4', description: 'GTA VI recomp' },
    { fullName: 'e/unrelated', description: 'A JSON parser' },
  ];
  const out = diversify(items, { maxPerOwner: 1, maxPerTopic: 3 });
  assert.equal(out.length, 4, '第 4 条同主题应被丢弃');
  assert.ok(out.some((i) => i.fullName === 'e/unrelated'));
});

test('latestSnapshot 回看到最近一份快照并算出间隔天数', () => {
  const dir = join('/tmp', `rh-snap-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '2026-11-22.json'), JSON.stringify({ all: { a: 5 }, ratings: { a: 1 } }));
  writeFileSync(join(dir, '2026-11-20.json'), JSON.stringify({ all: {}, ratings: {} }));

  const snap = latestSnapshot(dir, '2026-11-25');
  assert.equal(snap[0], '2026-11-22');
  assert.equal(snap[2], 3, 'gapDays 应为 3');
  rmSync(dir, { recursive: true, force: true });
});

test('pruneStateTree 递归删除过期快照，并清掉空目录', () => {
  const root = join('/tmp', `rh-prune-${process.pid}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'us'), { recursive: true });
  mkdirSync(join(root, 'old'), { recursive: true });
  writeFileSync(join(root, 'us', '2026-09-01.json'), '{}');
  writeFileSync(join(root, 'us', '2999-01-01.json'), '{}');
  writeFileSync(join(root, 'old', '2026-09-01.json'), '{}');

  const res = pruneStateTree(root, 35);
  assert.equal(res.files, 2, '两个过期文件都应删除');
  assert.equal(existsSync(join(root, 'us', '2026-09-01.json')), false);
  assert.equal(existsSync(join(root, 'us', '2999-01-01.json')), true);
  assert.equal(existsSync(join(root, 'old')), false, '清空后的目录应被移除');
  rmSync(root, { recursive: true, force: true });
});

test('hiddenGems 不与 risingNow 重复', () => {
  const scored = scoreRisers([
    mk({ id: 'rising', rankDelta: 30, rating: 4.8, ratingCount: 50, bestRank: 30 }),
    mk({ id: 'gem', rankDelta: 0, rating: 4.9, ratingCount: 40, bestRank: 60 }),
  ]);
  const { risingNow, hiddenGems } = selectLists(scored);
  assert.ok(risingNow.some((i) => i.id === 'rising'));
  assert.ok(hiddenGems.every((i) => i.id !== 'rising'), 'hiddenGems 不应包含已在 risingNow 的条目');
});

test('反垃圾：作弊/盗版仓库被拦截，正常项目不被误杀', () => {
  const bad = [
    ['HoangMinh-sikula/rob-run-mod-trainer', 'Rob Run Mod Trainer: Shape Your Run, Bend the Rules'],
    ['Norao01/fabfilter-total-bundle-2026-vst3-pc', 'iZotope Ozone 11 & FabFilter Total Bundle [2026] — VST3'],
    ['YutozeXesi67/clair-obscur-expedition-33-parry-trainer-mod', 'Clair Obscur: Expedition 33 Parry Timing Trainer'],
    ['henkbonnet297/steal-a-brainrot-roblox-index-macro', 'Steal a Brainrot Script & Roblox Index Macro [2026]'],
    ['kprice417/rust-recoil-script-esp-macro-2026', 'Rust Recoil Script & Rust Macro Suite [2026]'],
    ['JisungDiaz447/blox-fruits-script-keyless-2026', 'Blox Fruits Script [2026] — Keyless Auto Farm'],
    ['KimberlyReddy52140/valorant-colorbot-triggerbot', 'Valorant Colorbot & Arduino Pixel Triggerbot [2026]'],
  ];
  for (const [full_name, description] of bad) {
    assert.ok(spamReason({ full_name, description }), `${full_name} 应被拦截`);
  }

  // 这些曾经被裸子串规则误杀（' esp' / 'macro' / 'generator'）
  const good = [
    ['foo/esp32-firmware', 'Firmware for ESP32 boards with WiFi and BLE support'],
    ['foo/rust-macro-lib', 'A fast procedural macro library for Rust'],
    ['foo/openapi-gen', 'OpenAPI client generator for TypeScript'],
    ['foo/task-executor', 'A tiny task executor with cancellation support'],
    ['foo/torrent-client', 'A BitTorrent client written in Rust'],
    ['foo/hackathon-kit', 'Hackathon starter kit with auth and billing'],
    ['foo/crack-detect', 'Crack detection in concrete using computer vision'],
    ['foo/game-mod-manager', 'Free Windows game mod manager to discover and install mods'],
    ['foo/model-trainer', 'A training engine for your local model using idle compute'],
    ['foo/vst3-synth', 'A polyphonic VST3 synthesizer built with JUCE'],
    ['foo/roblox-api-wrapper', 'Unofficial Roblox API wrapper for game stats'],
    ['foo/parry', 'A 3D collision detection library in Rust'],
  ];
  for (const [full_name, description] of good) {
    assert.equal(
      spamReason({ full_name, description, license: { spdx_id: 'MIT' }, topics: ['x'], stargazers_count: 500, forks_count: 10 }),
      null,
      `${full_name} 不应被误杀`,
    );
  }
});

test('norm 对全等输入返回 0.5 而不是 NaN', () => {
  assert.deepEqual(norm([3, 3, 3]), [0.5, 0.5, 0.5]);
});
