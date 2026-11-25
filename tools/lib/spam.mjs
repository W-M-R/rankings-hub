// GitHub 搜索结果里的垃圾项目识别。
// 关键教训：用裸子串匹配会大量误杀（' esp' 命中 ESP32、'macro' 命中 Rust macro library），
// 所以这里只用两类判断：
//   1) 单个词就足以定性的作弊/盗版特征
//   2) 游戏名 + 作弊词同时出现（单独出现都不算，避免误伤 "Rust macro library"）

const SPAM_PATTERNS = [
  /\b(aimbot|wallhack|colorbot|triggerbot|aim\s*assist|no\s*recoil)\b/i,
  /\b(keyless|robux\s*generator|unlimited\s*(cash|gems|coins|robux))\b/i,
  /\b(recoil\s*(script|macro|suite)|esp\s*(script|hack|macro))\b/i,
  /\b(cracked?|nulled|keygen|premium\s*unlocked|activation\s*key)\b/i,
  // 付费软件名 + 打包/破解词：盗版分发的典型形态
  /\b(fabfilter|izotope|omnisphere|serum|xfer|kontakt|nexus)\b[\s\S]{0,40}\b(bundle|crack|keygen|20\d\d)\b/i,
  /\b(vst3?|plugin)\b[\s\S]{0,40}\b(bundle|crack|keygen)\b/i,
  // "mod trainer" / "parry trainer" 这类游戏内作弊工具
  /\b(mod|parry|auto[- ]?farm|index|god\s*mode)\s*(trainer|script|macro)\b/i,
  /\b(script|macro)\b[\s\S]{0,20}\b(index|keyless|auto\s*farm|god\s*mode)\b/i,
];

const GAME_WORDS = /\b(roblox|valorant|fortnite|minecraft|gta|blox|brainrot|apex|cs2|csgo|clair\s*obscur)\b/i;
const CHEAT_WORDS = /\b(script|macro|mod|trainer|hack|cheat|executor|unlock|god\s*mode|auto\s*farm)\b/i;

// 只是「可疑信号」，命中后降权而不是直接丢弃 —— 很多正经项目也用自定义协议。
const SUSPICIOUS_SIGNALS = [
  (i) => (i.topics ?? []).length >= 15,
  (i) => !i.license,
  (i) => i.license?.spdx_id === 'NOASSERTION',
  (i) => (i.stargazers_count ?? 0) >= 100 && (i.forks_count ?? 0) === 0,
  (i) => (i.description ?? '').length < 40,
];

/** 返回命中的原因；null 表示通过。 */
export function spamReason(item) {
  const hay = `${item.full_name ?? item.fullName ?? ''} ${item.description ?? ''}`;
  const hit = SPAM_PATTERNS.find((re) => re.test(hay));
  if (hit) return `pattern:${hit.source.slice(0, 28)}`;
  if (GAME_WORDS.test(hay) && CHEAT_WORDS.test(hay)) return 'game-cheat-combo';
  if (item.fork) return 'fork';
  if ((item.description ?? '').trim().length < 20) return 'no-description';
  if (item.archived) return 'archived';
  return null;
}

export const spamScore = (item) => SUSPICIOUS_SIGNALS.reduce((n, test) => n + (test(item) ? 1 : 0), 0);
