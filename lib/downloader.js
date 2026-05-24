'use strict';

const { fetchMetadata, downloadTarball } = require('./registry');
const { resolve: resolveVer }            = require('./semver');
const store                              = require('./store');

const CONCURRENCY = 8; // simultaneous tarball downloads

// Simple semaphore to cap concurrent HTTP downloads
class Semaphore {
  constructor(n) { this.n = n; this.q = []; }
  acquire() {
    if (this.n > 0) { this.n--; return Promise.resolve(); }
    return new Promise(r => this.q.push(r));
  }
  release() { if (this.q.length) this.q.shift()(); else this.n++; }
}

function parsePkg(str) {
  if (str.startsWith('@')) {
    const slash = str.indexOf('/');
    if (slash === -1) return { name: str, range: 'latest' };
    const at = str.indexOf('@', slash);
    return at === -1
      ? { name: str, range: 'latest' }
      : { name: str.slice(0, at), range: str.slice(at + 1) };
  }
  const at = str.indexOf('@');
  return at === -1
    ? { name: str, range: 'latest' }
    : { name: str.slice(0, at), range: str.slice(at + 1) };
}

async function download(pkgStrings) {
  const list = Array.isArray(pkgStrings) ? pkgStrings : [pkgStrings];
  const sem = new Semaphore(CONCURRENCY);

  // metaCache  : name        → Promise<fullMeta | null>   (one fetch per package name)
  // rangeCache : "name@range"   → Promise<void>           (dedup by requested range)
  // versionSeen: "name@version" Set                        (dedup by resolved version)
  const metaCache    = new Map();
  const rangeCache   = new Map();
  const versionSeen  = new Set();

  let total = 0, newPkgs = 0, cached = 0, failed = 0;
  const start = Date.now();

  // Fetch (and cache) full package metadata
  function getMeta(name) {
    if (!metaCache.has(name)) {
      metaCache.set(name,
        fetchMetadata(name).catch(e => {
          console.warn(`\n  [WARN] metadata fetch failed for "${name}": ${e.message}`);
          return null;
        })
      );
    }
    return metaCache.get(name);
  }

  // Ensure a package (by range) and all its transitive deps are in the store.
  // Returns a Promise; identical calls share the same Promise — no duplicate work.
  function ensurePackage(name, range) {
    const rk = `${name}@${range}`;
    if (rangeCache.has(rk)) return rangeCache.get(rk);

    const p = (async () => {
      const meta = await getMeta(name);
      if (!meta) return;

      const distTags  = meta['dist-tags'] || {};
      const allVer    = Object.keys(meta.versions || {});
      const version   = distTags[range] || resolveVer(allVer, range);

      if (!version) {
        console.warn(`\n  [WARN] no version satisfies "${name}@${range}"`);
        return;
      }

      const vk = `${name}@${version}`;

      // JS is single-threaded: this check+add is atomic relative to other microtasks
      if (versionSeen.has(vk)) return;
      versionSeen.add(vk);
      total++;

      const vMeta = meta.versions[version];
      if (!vMeta) return;

      // ── Download tarball (concurrency-limited) ──────────────────────────
      if (store.hasPackage(name, version)) {
        cached++;
        showProgress();
      } else {
        await sem.acquire();
        try {
          if (!store.hasPackage(name, version)) {        // re-check after acquiring
            const buf = await downloadTarball(vMeta.dist.tarball);
            store.saveTarball(name, version, buf);
            store.saveMeta(name, version, vMeta);
            store.register(name, version);
            newPkgs++;
            // Print download line above the progress indicator
            clearProgress();
            console.log(`  + ${vk.padEnd(48)} ${(buf.length / 1024).toFixed(1)} KB`);
          } else {
            cached++;
          }
        } catch (e) {
          failed++;
          clearProgress();
          console.warn(`  ! ${vk}: ${e.message}`);
        } finally {
          sem.release();
          showProgress();
        }
      }

      // ── Recurse into production deps — all in parallel ──────────────────
      const deps = vMeta.dependencies || {};
      await Promise.all(
        Object.entries(deps).map(([n, r]) => ensurePackage(n, r))
      );
    })();

    rangeCache.set(rk, p);
    return p;
  }

  // ── Progress line ─────────────────────────────────────────────────────────
  let progressVisible = false;

  function showProgress() {
    const done = newPkgs + cached + failed;
    const line = `  [${done}/${total}] ${newPkgs} downloaded, ${cached} cached, ${failed} failed...`;
    process.stdout.write(`\r${line.padEnd(72)}`);
    progressVisible = true;
  }

  function clearProgress() {
    if (progressVisible) {
      process.stdout.write(`\r${' '.repeat(72)}\r`);
      progressVisible = false;
    }
  }

  // ── Run ───────────────────────────────────────────────────────────────────
  console.log(`Downloading: ${list.join(', ')}  (up to ${CONCURRENCY} parallel)\n`);

  await Promise.all(list.map(str => {
    const { name, range } = parsePkg(str);
    return ensurePackage(name, range);
  }));

  clearProgress();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `\nDone in ${elapsed}s — ${newPkgs} downloaded, ${cached} already cached, ${failed} failed.`
  );
}

module.exports = { download, parsePkg };
