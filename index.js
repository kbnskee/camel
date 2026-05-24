#!/usr/bin/env node
'use strict';

const { download }                      = require('./lib/downloader');
const { serve }                         = require('./lib/server');
const { install }                       = require('./lib/installer');
const { nodeCommand }                   = require('./lib/node-manager');
const { checkConnectivity, detectProxy }= require('./lib/registry');
const store                             = require('./lib/store');
const { cmp }                           = require('./lib/semver');
const path                              = require('path');

const HELP = `
camel — Offline Node Package Manager
=====================================

  node download [ver]        Download Node.js into the store
  node list                  List downloaded Node.js versions
  node versions [--lts]      Browse available versions on nodejs.org
  node use <ver>             Switch active Node.js version

  download <pkg[@ver]> ...   Download npm packages + all dependencies
  install  <pkg[@ver]> ...   Install packages from store (offline)
  serve    [--port=4873]     Start local npm registry server
  list     [<pkg>]           List stored npm packages
  remove   <pkg@ver>         Remove a package version from store

  check                      Test connectivity to the npm registry

Run  camel <command> --help  or  camel node  for per-command details.
`.trimStart();

async function main() {
  const [,, cmd, ...args] = process.argv;

  switch (cmd) {

    // ── Node.js management ───────────────────────────────────────────────────
    case 'node': {
      await nodeCommand(args);
      break;
    }

    // ── npm package download ─────────────────────────────────────────────────
    case 'download': {
      if (args.length === 0) {
        console.error('Usage: camel download <pkg[@ver]> [<pkg2>...]');
        process.exit(1);
      }
      await download(args);
      break;
    }

    // ── npm package install ──────────────────────────────────────────────────
    case 'install': {
      if (args.length === 0) {
        console.error('Usage: camel install <pkg[@ver]> [--target=<dir>] [--port=4873]');
        process.exit(1);
      }
      await install(args);
      break;
    }

    // ── local registry server ────────────────────────────────────────────────
    case 'serve': {
      let port = 4873;
      for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--port='))                          port = parseInt(args[i].slice(7));
        else if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) port = parseInt(args[++i]);
      }
      serve(port);
      break;
    }

    // ── list npm packages ────────────────────────────────────────────────────
    case 'list': {
      const filter  = args[0];
      const all     = store.listAll();
      const entries = Object.entries(all);

      if (entries.length === 0) {
        console.log('npm package store is empty. Run "camel download <pkg>" first.');
        break;
      }

      if (filter) {
        const versions = all[filter];
        if (!versions || versions.length === 0) {
          console.log(`"${filter}" not found in store.`);
        } else {
          console.log(`${filter}:`);
          versions.sort((a, b) => -cmp(a, b)).forEach(v => console.log(`  ${v}`));
        }
      } else {
        let total = 0;
        for (const [name, versions] of entries.sort(([a], [b]) => a.localeCompare(b))) {
          const latest = [...versions].sort((a, b) => -cmp(a, b))[0];
          const extra  = versions.length > 1 ? `  (+${versions.length - 1} more)` : '';
          console.log(`  ${name.padEnd(40)} ${latest}${extra}`);
          total += versions.length;
        }
        console.log(`\n${entries.length} packages, ${total} versions total`);
        console.log(`Store: ${path.resolve(store.STORE_ROOT)}`);
      }
      break;
    }

    // ── remove npm package ───────────────────────────────────────────────────
    case 'remove': {
      if (!args[0]) { console.error('Usage: camel remove <pkg@version>'); process.exit(1); }
      const at = args[0].lastIndexOf('@');
      if (at <= 0) { console.error('Specify an exact version, e.g.  camel remove express@4.18.2'); process.exit(1); }
      const name    = args[0].slice(0, at);
      const version = args[0].slice(at + 1);
      console.log(store.removePackage(name, version)
        ? `Removed ${name}@${version}`
        : `${name}@${version} was not in the store`);
      break;
    }

    case 'check': {
      await checkConnectivity();
      break;
    }

    default:
      process.stdout.write(HELP);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
