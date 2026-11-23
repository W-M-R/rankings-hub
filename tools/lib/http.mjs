const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createLimiter(perSecond) {
  const interval = 1000 / Math.max(1, perSecond);
  let next = Date.now();
  return async function gate() {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + interval;
    if (at > now) await sleep(at - now);
  };
}

export async function getJson(url, { retries = 4, timeoutMs = 12000, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'user-agent': UA, accept: 'application/json', ...headers },
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${url}`);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      clearTimeout(timer);
      const rateLimited = err?.status === 403 || err?.status === 429;
      if (attempt < retries) await sleep((rateLimited ? 1500 : 400) * 2 ** attempt);
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error(`fetch failed ${url}`);
}

export async function getText(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': UA, ...(opts.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export { sleep, UA };