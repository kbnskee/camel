'use strict';

const http  = require('http');
const store = require('./store');
const { cmp } = require('./semver');

function parsePath(urlStr) {
  // Strip query string
  const pathname = urlStr.split('?')[0];
  // Decode percent-encoding so %2F → / and %40 → @
  const decoded = decodeURIComponent(pathname);
  const parts = decoded.split('/').filter(Boolean);

  if (parts.length === 0) return null;

  // Scoped: @scope/name  or  @scope/name/-/file.tgz
  if (parts[0].startsWith('@') && parts.length >= 2) {
    const name = `${parts[0]}/${parts[1]}`;
    if (parts[2] === '-' && parts[3]) return { name, tarball: parts[3] };
    return { name, tarball: null };
  }

  // Regular: name  or  name/-/file.tgz
  const name = parts[0];
  if (parts[1] === '-' && parts[2]) return { name, tarball: parts[2] };
  return { name, tarball: null };
}

function buildMetadata(name, port) {
  const versions = store.getVersions(name);
  if (versions.length === 0) return null;

  const baseName = name.includes('/') ? name.split('/')[1] : name;
  const versionsMap = {};

  for (const v of versions) {
    const meta = store.getMeta(name, v);
    if (!meta) continue;
    const localTarball =
      `http://localhost:${port}/${encodeURIComponent(name)}/-/${baseName}-${v}.tgz`;
    versionsMap[v] = {
      ...meta,
      dist: { ...meta.dist, tarball: localTarball },
    };
  }

  const latest = [...versions].sort((a, b) => -cmp(a, b))[0];
  return { name, 'dist-tags': { latest }, versions: versionsMap };
}

function serve(port = 4873) {
  const server = http.createServer((req, res) => {
    const parsed = parsePath(req.url);

    if (!parsed) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const { name, tarball } = parsed;

    // ── Tarball request ────────────────────────────────────────────────────
    if (tarball) {
      const baseName = name.includes('/') ? name.split('/')[1] : name;
      // filename is  <baseName>-<version>.tgz
      const prefix = `${baseName}-`;
      if (!tarball.startsWith(prefix) || !tarball.endsWith('.tgz')) {
        res.writeHead(404); res.end('Not found'); return;
      }
      const version = tarball.slice(prefix.length, -4);
      const buf = store.getTarball(name, version);
      if (!buf) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': buf.length,
      });
      res.end(buf);
      return;
    }

    // ── Metadata request ───────────────────────────────────────────────────
    const meta = buildMetadata(name, port);
    if (!meta) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Package "${name}" not in local store` }));
      return;
    }
    const body = JSON.stringify(meta);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Try --port=<other>`);
    } else {
      console.error('Server error:', err.message);
    }
    process.exit(1);
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`\nLocal npm registry listening on http://localhost:${port}`);
    console.log('\nUsage on this machine:');
    console.log(`  npm install --registry http://localhost:${port} <package>`);
    console.log('\nOr set it as default for a project:');
    console.log(`  npm config set registry http://localhost:${port}`);
    console.log(`  npm config delete registry        (to restore npmjs.org)`);
    console.log('\nPress Ctrl+C to stop.\n');
  });

  return server;
}

module.exports = { serve };
