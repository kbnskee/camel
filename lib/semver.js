'use strict';

function parse(v) {
  const m = (v || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

function cmp(a, b) {
  const pa = parse(a), pb = parse(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

function satisfies(version, range) {
  if (!range || range === '*' || range === '') return true;
  // Named tags — treated as "any" since we already resolved via dist-tags
  if (!/\d/.test(range)) return true;

  // OR
  if (range.includes('||')) return range.split('||').some(r => satisfies(version, r.trim()));

  // AND (space-separated)
  const parts = range.trim().split(/\s+/);
  if (parts.length > 1) return parts.every(r => satisfies(version, r.trim()));

  const v = parse(version);
  if (!v) return false;

  let m;

  // Caret ^1.2.3
  m = range.match(/^\^(\d+)\.(\d+)\.(\d+)/);
  if (m) {
    const [, maj, min, pat] = m.map(Number);
    if (cmp(version, `${maj}.${min}.${pat}`) < 0) return false;
    if (maj > 0) return v[0] === maj;
    if (min > 0) return v[0] === 0 && v[1] === min;
    return v[0] === 0 && v[1] === 0 && v[2] >= pat;
  }
  m = range.match(/^\^(\d+)\.(\d+)$/);
  if (m) { const [, maj, min] = m.map(Number); return v[0] === maj && v[1] >= min; }
  m = range.match(/^\^(\d+)$/);
  if (m) return v[0] === +m[1];

  // Tilde ~1.2.3
  m = range.match(/^~(\d+)\.(\d+)\.(\d+)/);
  if (m) {
    const [, maj, min, pat] = m.map(Number);
    return v[0] === maj && v[1] === min && v[2] >= pat;
  }
  m = range.match(/^~(\d+)\.(\d+)$/);
  if (m) { const [, maj, min] = m.map(Number); return v[0] === maj && v[1] === min; }

  // Comparators >=, >, <=, <
  m = range.match(/^(>=|>|<=|<)(\d+\.\d+\.\d+)/);
  if (m) {
    const c = cmp(version, m[2]);
    return m[1] === '>=' ? c >= 0 : m[1] === '>' ? c > 0 : m[1] === '<=' ? c <= 0 : c < 0;
  }

  // X-ranges  1.x  1.2.x
  m = range.match(/^(\d+)\.(\d+)\.x/i);
  if (m) return v[0] === +m[1] && v[1] === +m[2];
  m = range.match(/^(\d+)\.x/i);
  if (m) return v[0] === +m[1];

  // Exact  1.2.3
  if (/^\d+\.\d+\.\d+/.test(range)) return cmp(version, range) === 0;

  return true; // unknown format — assume compatible
}

function resolve(versions, range) {
  const clean = (range || '*').trim();
  const semverOnly = versions.filter(v => parse(v));
  const latest = [...semverOnly].sort((a, b) => -cmp(a, b))[0];
  if (!clean || clean === '*' || clean === 'latest' || !/\d/.test(clean)) return latest;
  const compat = semverOnly.filter(v => satisfies(v, clean));
  return compat.length ? compat.sort((a, b) => -cmp(a, b))[0] : latest;
}

module.exports = { satisfies, resolve, cmp, parse };
