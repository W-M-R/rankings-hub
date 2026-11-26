export const APPLE_ALL = [
  'ae', 'ag', 'ai', 'al', 'am', 'ao', 'ar', 'at', 'au', 'az', 'ba', 'bb', 'be', 'bf', 'bg', 'bh',
  'bj', 'bm', 'bn', 'bo', 'br', 'bs', 'bt', 'bw', 'by', 'bz', 'ca', 'cg', 'ch', 'ci', 'cl', 'cm',
  'cn', 'co', 'cr', 'cv', 'cy', 'cz', 'de', 'dk', 'dm', 'do', 'dz', 'ec', 'ee', 'eg', 'es', 'fi',
  'fj', 'fm', 'fr', 'ga', 'gb', 'gd', 'ge', 'gh', 'gm', 'gr', 'gt', 'gw', 'gy', 'hk', 'hn', 'hr',
  'hu', 'id', 'ie', 'il', 'in', 'is', 'it', 'jm', 'jo', 'jp', 'ke', 'kg', 'kh', 'kn', 'kr', 'kw',
  'ky', 'kz', 'la', 'lb', 'lc', 'lk', 'lr', 'lt', 'lu', 'lv', 'ly', 'ma', 'md', 'me', 'mg', 'mk',
  'ml', 'mm', 'mn', 'mo', 'mr', 'ms', 'mt', 'mu', 'mv', 'mw', 'mx', 'my', 'mz', 'na', 'ne', 'ng',
  'ni', 'nl', 'no', 'np', 'nz', 'om', 'pa', 'pe', 'pg', 'ph', 'pk', 'pl', 'pt', 'pw', 'py', 'qa',
  'ro', 'rs', 'ru', 'rw', 'sa', 'sb', 'sc', 'se', 'sg', 'si', 'sk', 'sl', 'sn', 'sr', 'sv', 'sz',
  'tc', 'td', 'th', 'tj', 'tm', 'tn', 'tr', 'tt', 'tw', 'tz', 'ua', 'ug', 'us', 'uy', 'uz', 'vc',
  've', 'vg', 'vn', 'ye', 'za', 'zm', 'zw',
];

export const MAJOR_40 = [
  'us', 'cn', 'jp', 'kr', 'gb', 'de', 'fr', 'it', 'es', 'nl', 'se', 'no', 'dk', 'fi', 'pl', 'ru',
  'tr', 'il', 'sa', 'ae', 'in', 'id', 'th', 'vn', 'ph', 'my', 'sg', 'hk', 'tw', 'au', 'nz', 'ca',
  'mx', 'br', 'ar', 'cl', 'co', 'za', 'ng', 'eg',
];

export const GOOGLE_MARKETS = MAJOR_40.filter((cc) => cc !== 'cn');

export const SELLER_BLOCKLIST = [
  'google', 'meta platforms', 'facebook', 'instagram', 'bytedance', 'tiktok', 'tencent', 'alibaba',
  'alipay', 'microsoft', 'amazon', 'apple', 'netflix', 'spotify', 'uber', 'x corp', 'twitter',
  'snap inc', 'electronic arts', 'gameloft', 'supercell', 'zynga', 'king.com', 'playrix', 'voodoo',
  'saygames', 'applovin', 'unity technologies', 'niantic', 'activision', 'take-two', 'riot games',
  'moonton', 'netease', 'mihoyo', 'hoyoverse', 'kakao', 'naver', 'line corporation', 'yahoo',
  'booking.com', 'expedia', 'airbnb', 'shopify', 'paypal', 'visa', 'mastercard', 'binance',
  'disney', 'warner', 'paramount', 'nbcuniversal', 'sony', 'viacom', 'hulu', 'hbo', 'espn',
  'noon', 'careem', 'talabat', 'deliveroo', 'shopee', 'lazada', 'grab', 'gojek', 'mercadolibre',
];

export const CATEGORY_BLOCKLIST = [/casino/i, /gambling/i, /dating/i, /vpn/i, /betting/i];

export const CONFIG = {
  smallRatingCount: 5000,
  freshDays: 90,
  // 新上线应用通常还没有评分；只有在没有任何榜单名次时才回退到评分门槛
  freshRatingFloor: 5,
  // 新上榜只有在名次足够靠前时才算 "rising"；50 名开外多是长尾抖动
  newEntrantRank: 50,
  perList: 30,
  matrixSellerPerDay: 3,
  matrixPenalty: 0.5,
  minGlobalRegions: 3,
};