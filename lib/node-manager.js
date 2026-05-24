'use strict';

const https        = require('https');
const http         = require('http');
const fs           = require('fs');
const path         = require('path');
const { spawnSync, execFileSync } = require('child_process');

const NODE_DIR    = path.join(__dirname, '..', 'node');
const ACTIVE_FILE = path.join(NODE_DIR, '.active');
const INDEX_URL   = 'https://nodejs.org/dist/index.json';

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function getActive() {
  return fs.existsSync(ACTIVE_FILE)
    ? fs.readFileSync(ACTIVE_FILE, 'utf8').trim()
    : null;
}

function setActive(folderName) {
  ensureDir(NODE_DIR);
  fs.writeFileSync(ACTIVE_FILE, folderName, 'utf8');
}

function listLocal() {
  ensureDir(NODE_DIR);
  return fs.readdirSync(NODE_DIR)
    .filter(e => /^node-v[\d.]+-win-x64$/.test(e) &&
                 fs.existsSync(path.join(NODE_DIR, e, 'node.exe')));
}

function folderVersion(folder) {
  const m = folder.match(/^node-(v[\d.]+)-win-x64$/);
  return m ? m[1] : null;
}

// ── Network ───────────────────────────────────────────────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { Accept: 'application/json' } }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function downloadFile(url, destPath, label) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location, destPath, label).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        return;
      }

      const total    = parseInt(res.headers['content-length'] || '0', 10);
      const totalMB  = total ? (total / 1024 / 1024).toFixed(1) : '?';
      let received   = 0;
      const out      = fs.createWriteStream(destPath);

      res.on('data', chunk => {
        out.write(chunk);
        received += chunk.length;
        const mb  = (received / 1024 / 1024).toFixed(1);
        const pct = total ? `${Math.round((received / total) * 100)}%` : '';
        process.stdout.write(`\r  ${label}  ${mb} / ${totalMB} MB  ${pct}   `);
      });

      res.on('end', () => out.end(() => { process.stdout.write('\n'); resolve(); }));
      res.on('error', err => { out.destroy(); reject(err); });
      out.on('error', reject);
    });

    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Download timed out')); });
    req.on('error', reject);
  });
}

// ── ZIP extraction (Windows PowerShell) ──────────────────────────────────────

function extractZip(zipPath, destDir) {
  process.stdout.write('  Extracting...');
  const r = spawnSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  if (r.status !== 0) {
    const msg = r.stderr ? r.stderr.toString().trim() : 'unknown error';
    throw new Error(`Extraction failed: ${msg}`);
  }
  process.stdout.write(' done\n');
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdDownload(args) {
  const input = args[0]; // e.g. "lts", "22", "22.14.0", undefined → latest LTS

  console.log('Fetching Node.js version list...');
  const index = await fetchJson(INDEX_URL);

  let target;
  if (!input || input === 'lts') {
    target = index.find(v => v.lts !== false);
  } else if (/^\d+$/.test(input)) {
    target = index.find(v => v.version.startsWith(`v${input}.`));
  } else {
    const want = input.startsWith('v') ? input : `v${input}`;
    target = index.find(v => v.version === want);
  }

  if (!target) {
    console.error(`No Node.js version matching "${input || 'lts'}" found.`);
    console.log('Run:  camel node versions   to browse available versions.');
    process.exit(1);
  }

  const ver        = target.version;                      // e.g.  v22.14.0
  const ltsName    = target.lts ? ` (LTS: ${target.lts})` : '';
  const folderName = `node-${ver}-win-x64`;
  const destFolder = path.join(NODE_DIR, folderName);

  if (fs.existsSync(path.join(destFolder, 'node.exe'))) {
    console.log(`Node.js ${ver}${ltsName} is already in the store.`);
    console.log(`  Path: ${destFolder}`);
  } else {
    const zipName = `${folderName}.zip`;
    const zipUrl  = `https://nodejs.org/dist/${ver}/${zipName}`;
    const tmpZip  = path.join(NODE_DIR, zipName);

    ensureDir(NODE_DIR);
    console.log(`\nDownloading Node.js ${ver}${ltsName} for Windows x64`);
    console.log(`  ${zipUrl}\n`);

    try {
      await downloadFile(zipUrl, tmpZip, zipName);
    } catch (e) {
      if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip);
      throw e;
    }

    extractZip(tmpZip, NODE_DIR);
    fs.unlinkSync(tmpZip);
    console.log(`  Stored at: ${destFolder}`);
  }

  if (!getActive()) {
    setActive(folderName);
    console.log(`\nActive version set to: ${folderName}`);
  } else {
    const current = getActive();
    if (current !== folderName) {
      console.log(`\nTo switch to this version: camel node use ${ver}`);
    }
  }
}

function cmdList() {
  const locals = listLocal();
  const active = getActive();

  if (locals.length === 0) {
    console.log('No Node.js versions in store.\n');
    console.log('  camel node download           Download latest LTS');
    console.log('  camel node download 22         Download latest Node.js 22.x');
    console.log('  camel node download 22.14.0    Download exact version');
    return;
  }

  console.log('Node.js versions in store:\n');
  for (const folder of locals) {
    const nodePath = path.join(NODE_DIR, folder, 'node.exe');
    let ver = '?';
    try { ver = execFileSync(nodePath, ['--version'], { encoding: 'utf8' }).trim(); } catch {}
    const isActive = folder === active;
    console.log(`  ${isActive ? '●' : '○'}  ${folder.padEnd(42)} ${ver}${isActive ? '  ◄ active' : ''}`);
  }

  console.log(`\nContainer: ${NODE_DIR}`);
}

async function cmdVersions(args) {
  const ltsOnly = args.includes('--lts');
  const countArg = args.find(a => a.startsWith('--count='));
  const count = countArg ? parseInt(countArg.slice(8)) : 20;

  console.log('Fetching available Node.js versions...\n');
  const index = await fetchJson(INDEX_URL);

  const localVersionSet = new Set(listLocal().map(folderVersion).filter(Boolean));
  const active = getActive();
  const activeVer = active ? folderVersion(active) : null;

  const list = (ltsOnly ? index.filter(v => v.lts !== false) : index).slice(0, count);

  console.log(`  ${'Version'.padEnd(12)} ${'Released'.padEnd(12)} ${'LTS'.padEnd(12)} Local`);
  console.log(`  ${'─'.repeat(50)}`);
  for (const v of list) {
    const lts    = v.lts ? String(v.lts) : '—';
    const local  = localVersionSet.has(v.version)
      ? (v.version === activeVer ? '● active' : '✓ stored')
      : '';
    console.log(`  ${v.version.padEnd(12)} ${v.date.padEnd(12)} ${lts.padEnd(12)} ${local}`);
  }

  if (index.length > count) {
    console.log(`\n  Showing ${count} of ${index.length}. Use --count=50 to see more.`);
  }
  console.log(`\nDownload: camel node download <version>`);
}

function cmdUse(args) {
  if (!args[0]) {
    console.error('Usage: camel node use <version>   e.g.  camel node use 22.14.0');
    return;
  }

  const locals = listLocal();
  const want   = args[0].startsWith('v') ? args[0] : `v${args[0]}`;
  const match  = locals.find(f => f.includes(want));

  if (!match) {
    console.error(`Node.js ${args[0]} is not in the store.`);
    console.log('Run:  camel node list');
    return;
  }

  setActive(match);
  console.log(`Active: ${match}`);
  console.log(`  ${path.join(NODE_DIR, match, 'node.exe')}`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

const NODE_HELP = `
Node.js management commands:

  node download [ver]   Download Node.js into the store (default: latest LTS)
                          camel node download
                          camel node download 22
                          camel node download 22.14.0

  node list             List downloaded Node.js versions
  node versions         List available versions from nodejs.org
    --lts               Show LTS releases only
    --count=N           How many to show (default: 20)
  node use <ver>        Set the active Node.js version
`.trimStart();

async function nodeCommand(args) {
  const sub  = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case 'download': await cmdDownload(rest); break;
    case 'list':           cmdList();         break;
    case 'versions': await cmdVersions(rest); break;
    case 'use':            cmdUse(rest);      break;
    default: process.stdout.write(NODE_HELP);
  }
}

module.exports = { nodeCommand, listLocal, getActive, folderVersion, NODE_DIR };
