'use strict';

const https = require('https');
const http  = require('http');
const tls   = require('tls');

const REGISTRY    = 'https://registry.npmjs.org';
const TIMEOUT_MS  = 30000;

// ── Proxy support ─────────────────────────────────────────────────────────────

function detectProxy() {
  // 1. Environment variables (most common in corporate networks)
  const env = process.env.HTTPS_PROXY || process.env.https_proxy
           || process.env.HTTP_PROXY  || process.env.http_proxy;
  if (env) return env;

  // 2. npm config
  try {
    const { execFileSync } = require('child_process');
    const npmExe = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    for (const key of ['https-proxy', 'proxy']) {
      const val = execFileSync(npmExe, ['config', 'get', key],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }
      ).trim();
      if (val && val !== 'null' && val !== 'undefined') return val;
    }
  } catch {}

  return null;
}

// HTTPS-through-HTTP-CONNECT proxy agent
class ProxyAgent extends https.Agent {
  constructor(proxyUrl) {
    super();
    this._proxy = new URL(proxyUrl);
  }

  createConnection(options, callback) {
    const proxy = this._proxy;
    const headers = { Host: `${options.host}:${options.port || 443}` };

    if (proxy.username) {
      const creds = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password || '')}`;
      headers['Proxy-Authorization'] = `Basic ${Buffer.from(creds).toString('base64')}`;
    }

    const connectReq = http.request({
      host:    proxy.hostname,
      port:    parseInt(proxy.port) || (proxy.protocol === 'https:' ? 443 : 80),
      method:  'CONNECT',
      path:    `${options.host}:${options.port || 443}`,
      headers,
    });

    connectReq.once('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        callback(new Error(`Proxy CONNECT failed: ${res.statusCode} ${res.statusMessage}`));
        return;
      }
      const tlsSocket = tls.connect(
        { socket, servername: options.servername || options.host },
        () => callback(null, tlsSocket)
      );
      tlsSocket.once('error', callback);
    });

    connectReq.once('error', callback);
    connectReq.setTimeout(TIMEOUT_MS, () => {
      connectReq.destroy(new Error('Proxy connect timed out'));
    });
    connectReq.end();
  }
}

// Lazy-init: detect proxy once per process
let _agent;
function getAgent() {
  if (_agent !== undefined) return _agent;
  const proxy = detectProxy();
  if (proxy) {
    console.error(`  [proxy] Using ${proxy}`);
    _agent = new ProxyAgent(proxy);
  } else {
    _agent = null;
  }
  return _agent;
}

// ── Human-readable error codes ────────────────────────────────────────────────

function describeError(err, url) {
  const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  switch (err.code) {
    case 'ENOTFOUND':    return `Cannot resolve "${host}" — no internet or DNS blocked`;
    case 'ECONNREFUSED': return `Connection refused by "${host}"`;
    case 'ETIMEDOUT':    return `TCP timeout to "${host}" — slow or blocked network`;
    case 'ECONNRESET':   return `Connection reset — firewall or proxy may be required`;
    case 'CERT_HAS_EXPIRED':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return `TLS certificate error for "${host}" — try setting NODE_TLS_REJECT_UNAUTHORIZED=0`;
    default:
      return err.message || String(err);
  }
}

// ── Core request function ─────────────────────────────────────────────────────

function get(url, retries = 3) {
  return new Promise((resolve, reject) => {
    const agent  = getAgent();
    const client = url.startsWith('https') ? https : http;
    const opts   = { headers: { Accept: 'application/json' } };
    if (agent && url.startsWith('https')) opts.agent = agent;

    let settled = false;
    const done = (fn, val) => { if (!settled) { settled = true; fn(val); } };

    function retry(err) {
      if (retries > 0) {
        get(url, retries - 1).then(v => done(resolve, v), e => done(reject, e));
      } else {
        done(reject, err);
      }
    }

    const req = client.get(url, opts, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        done(() => {}, null); // mark settled so outer promise won't double-fire
        settled = true;
        return get(res.headers.location, retries).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return retry(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const chunks = [];
      res.on('data',  c   => chunks.push(c));
      res.on('end',   ()  => done(resolve, Buffer.concat(chunks)));
      res.on('error', err => retry(new Error(describeError(err, url))));
    });

    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error(`Request timed out after ${TIMEOUT_MS / 1000}s — slow or blocked network`));
    });

    req.on('error', err => {
      retry(new Error(describeError(err, url)));
    });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

function encodeName(name) {
  if (name.startsWith('@')) {
    const slash = name.indexOf('/');
    if (slash !== -1) return name.slice(0, slash + 1) + encodeURIComponent(name.slice(slash + 1));
  }
  return encodeURIComponent(name);
}

async function fetchMetadata(name) {
  const buf = await get(`${REGISTRY}/${encodeName(name)}`);
  return JSON.parse(buf.toString('utf8'));
}

async function downloadTarball(url) {
  return get(url);
}

// Quick connectivity check — call this from "camel check"
async function checkConnectivity() {
  const proxyUrl = detectProxy();
  console.log(`Registry : ${REGISTRY}`);
  console.log(`Proxy    : ${proxyUrl || '(none detected)'}`);
  console.log('');

  const start = Date.now();
  try {
    const buf = await get(`${REGISTRY}/npm/latest`);
    const json = JSON.parse(buf.toString('utf8'));
    console.log(`OK — reached registry in ${Date.now() - start}ms`);
    console.log(`   npm@${json.version} is the latest`);
    return true;
  } catch (e) {
    console.error(`FAIL — ${e.message}`);
    console.error('');
    if (!proxyUrl) {
      console.error('If you are behind a corporate proxy, set one of:');
      console.error('  set HTTPS_PROXY=http://proxy-host:port');
      console.error('  npm config set https-proxy http://proxy-host:port');
    }
    return false;
  }
}

module.exports = { fetchMetadata, downloadTarball, checkConnectivity, detectProxy };
