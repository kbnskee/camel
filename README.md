# camel — Offline Node Package Manager

> carry your npm packages across the air gap.

`camel` solves one problem: **getting npm packages onto a machine that has no internet access.**

The workflow is always two steps:
1. **Online machine** — download packages (and all their dependencies) into the local store.
2. **Offline machine** — copy the entire `camel` folder over, then install from the store.

---

## How to run camel

Open a terminal in `C:\camel` and run:

```
camel <command>
```

`camel.cmd` is the launcher. It finds a bundled `node.exe` automatically — you do not need Node.js installed on your system path.

---

## Step 1 — Get a Node.js runtime (first time only)

camel bundles and manages Node.js versions for you.

```
camel node download              # download the latest LTS version
camel node download 22           # download the latest Node.js 22.x
camel node download 22.14.0      # download an exact version
```

Check what you have downloaded:

```
camel node list                  # shows all stored versions, marks the active one
camel node versions              # browse what is available on nodejs.org
camel node versions --lts        # show LTS releases only
camel node versions --count=50   # show more entries (default: 20)
```

Switch between versions:

```
camel node use 22.14.0
```

Node.js binaries are stored in `camel\node\` and the active version is tracked in `camel\node\.active`.

---

## Step 2 — Download packages while online

Pull a package and **all of its transitive dependencies** into the store in one command:

```
camel download express
camel download express@4.18.2         # pin to an exact version
camel download react react-dom        # multiple packages at once
camel download @types/node            # scoped packages work too
```

Downloads run up to 8 at a time. Already-cached packages are skipped automatically.

Progress is shown live:

```
  + express@4.18.2                                  57.3 KB
  + body-parser@1.20.2                              22.1 KB
  [34/34] 34 downloaded, 0 cached, 0 failed...

Done in 4.2s — 34 downloaded, 0 already cached, 0 failed.
```

The store lives in `camel\store\`:
- `store\index.json` — package index (which packages and versions are stored)
- `store\packages\` — `.tgz` tarballs
- `store\meta\` — per-version metadata JSON

---

## Step 3 — Transfer to the offline machine

Copy the entire `camel` folder (including `store\` and `node\`) to the target machine. A USB drive, network share, or zip file all work.

---

## Step 4 — Install packages offline

### Option A — camel install (simplest)

camel starts a local registry server internally, runs npm against it, then shuts it down:

```
camel install express
camel install express@4.18.2
camel install react react-dom --target=C:\myapp
camel install jest --save-dev --target=C:\myapp
camel install pm2 --global
```

**Flags:**

| Flag | Short | Description |
|------|-------|-------------|
| `--target=<dir>` | `-t` | Install into this directory (default: current directory) |
| `--port=<n>` | `-p` | Registry port (default: 4873) |
| `--save-dev` | `-D` | Install as a dev dependency |
| `--global` | `-g` | Install globally |

If the target directory has no `package.json`, one is created automatically.

### Option B — camel serve (for advanced use)

Run a persistent local npm registry that any npm client on the machine can point to:

```
camel serve                      # starts on port 4873
camel serve --port=5000          # custom port
```

While the server is running, install packages using npm directly:

```
npm install express --registry http://localhost:4873
```

Or set it as the default registry for a project:

```
npm config set registry http://localhost:4873
npm install express
npm config delete registry      # restore to npmjs.org when done
```

Press `Ctrl+C` to stop the server.

---

## Managing the store

List everything in the store:

```
camel list                        # all packages, latest version of each
camel list express                # versions of a specific package
```

Remove a specific version:

```
camel remove express@4.18.2
```

---

## Test connectivity

Before downloading, verify you can reach the npm registry:

```
camel check
```

This also detects and displays any proxy settings in use.

### Proxy support

camel reads proxy settings automatically from:
1. Environment variables: `HTTPS_PROXY`, `https_proxy`, `HTTP_PROXY`, `http_proxy`
2. npm config: `https-proxy`, `proxy`

To set a proxy manually:

```
set HTTPS_PROXY=http://proxy-host:3128
```

---

## Quick reference

```
camel node download [ver]        Download Node.js (default: latest LTS)
camel node list                  List local Node.js versions
camel node versions [--lts]      Browse available Node.js versions
camel node use <ver>             Switch active Node.js version

camel download <pkg[@ver]> ...   Download packages + all dependencies (online)
camel install  <pkg[@ver]> ...   Install packages from store (offline)
camel serve    [--port=4873]     Run a local npm registry server
camel list     [<pkg>]           Show stored packages
camel remove   <pkg@ver>         Delete a package version from store
camel check                      Test connectivity to npm registry
```

---

## Typical offline deployment workflow

```
# --- ONLINE MACHINE ---
camel node download                      # get Node.js LTS
camel download express pm2 typescript    # download everything you need

# Copy the camel folder to a USB drive or network share

# --- OFFLINE MACHINE ---
# Paste the camel folder anywhere, e.g. D:\camel

D:\camel\camel install express --target=D:\myapp
D:\camel\camel install typescript --global
```

---

## Folder layout

```
camel\
  camel.cmd         launcher (finds node.exe, runs index.js)
  index.js          CLI entry point
  lib\
    downloader.js   fetches packages + deps from registry
    installer.js    runs npm against the local server
    node-manager.js download/switch Node.js versions
    registry.js     HTTP client for registry.npmjs.org (proxy-aware)
    server.js       local npm registry HTTP server
    store.js        read/write the package store on disk
    semver.js       version range resolution
  node\
    .active         name of the currently selected Node.js folder
    node-v22.14.0-win-x64\
      node.exe      ...
  store\
    index.json      package index
    packages\       .tgz tarballs
    meta\           per-version metadata
```

---

## License

MIT © 2026 Karl Kevin D. Domingo
