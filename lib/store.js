'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT      = path.join(__dirname, '..', 'store');
const PKGS_DIR  = path.join(ROOT, 'packages');
const META_DIR  = path.join(ROOT, 'meta');
const IDX_FILE  = path.join(ROOT, 'index.json');

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

// index: { "name": ["version", ...] }
function loadIndex() {
  if (!fs.existsSync(IDX_FILE)) return {};
  return JSON.parse(fs.readFileSync(IDX_FILE, 'utf8'));
}
function saveIndex(idx) {
  ensureDir(ROOT);
  fs.writeFileSync(IDX_FILE, JSON.stringify(idx, null, 2));
}

function hasPackage(name, version) {
  const idx = loadIndex();
  return !!(idx[name] && idx[name].includes(version));
}

// Scoped packages: @scope/name → store/packages/@scope/name/version.tgz
function tarballPath(name, version) {
  return path.join(PKGS_DIR, ...name.split('/'), `${version}.tgz`);
}
function metaPath(name, version) {
  return path.join(META_DIR, ...name.split('/'), `${version}.json`);
}

function saveTarball(name, version, buf) {
  const p = tarballPath(name, version);
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, buf);
}
function getTarball(name, version) {
  const p = tarballPath(name, version);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

function saveMeta(name, version, meta) {
  const p = metaPath(name, version);
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(meta, null, 2));
}
function getMeta(name, version) {
  const p = metaPath(name, version);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function getVersions(name) {
  return loadIndex()[name] || [];
}

function register(name, version) {
  const idx = loadIndex();
  if (!idx[name]) idx[name] = [];
  if (!idx[name].includes(version)) idx[name].push(version);
  saveIndex(idx);
}

function listAll() {
  return loadIndex();
}

function removePackage(name, version) {
  const idx = loadIndex();
  if (!idx[name]) return false;
  idx[name] = idx[name].filter(v => v !== version);
  if (idx[name].length === 0) delete idx[name];
  saveIndex(idx);
  const tp = tarballPath(name, version);
  const mp = metaPath(name, version);
  if (fs.existsSync(tp)) fs.unlinkSync(tp);
  if (fs.existsSync(mp)) fs.unlinkSync(mp);
  return true;
}

module.exports = {
  hasPackage, saveTarball, getTarball,
  saveMeta, getMeta, getVersions,
  register, listAll, removePackage,
  STORE_ROOT: ROOT,
};
