import { readFileSync } from 'node:fs';

const truthy = (v) => /^(true|yes)$/i.test(v);

export function parseAlternatives(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const out = [];
  let cur = null;
  let inAlt = false;
  let alt = null;

  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^\s*/)[0].length;
    const text = raw.trim();

    if (indent === 0 && text.startsWith('- ')) {
      if (alt && cur) cur.alternatives.push(alt);
      alt = null;
      if (cur) out.push(cur);
      cur = { paid: null, category: null, alternatives: [] };
      inAlt = false;
      const kv = text.slice(2).split(/:\s*/);
      if (kv.length === 2) cur[kv[0]] = kv[1];
      continue;
    }
    if (!cur) continue;

    if (/^alternatives:/.test(text)) {
      inAlt = true;
      continue;
    }

    const [k, ...rest] = text.split(/:\s*/);
    const v = rest.join(': ').trim();

    if (inAlt && indent >= 4 && text.startsWith('- ')) {
      if (alt) cur.alternatives.push(alt);
      alt = {};
      const pair = text.slice(2).split(/:\s*/);
      if (pair.length === 2) alt[pair[0]] = pair[1];
      continue;
    }
    if (inAlt && indent >= 6 && alt) {
      if (k === 'selfHosted' || k === 'self_hosted') alt.selfHosted = truthy(v);
      else if (k === 'license') alt.license = v;
      else if (k === 'url') alt.url = v;
      else if (k === 'note') alt.note = v;
      else if (k === 'name') alt.name = v;
      continue;
    }
    if (!inAlt) {
      if (k === 'paid') cur.paid = v;
      else if (k === 'category') cur.category = v;
      else if (k === 'note') cur.note = v;
    }
  }
  if (alt && cur) cur.alternatives.push(alt);
  if (cur) out.push(cur);

  return out
    .filter((x) => x.paid && x.alternatives?.length)
    .map((x) => ({ ...x, alternatives: x.alternatives.filter((a) => a.name && a.url) }));
}