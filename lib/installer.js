'use strict';

const { spawnSync } = require('child_process');
const path          = require('path');
const fs            = require('fs');
const { serve }     = require('./server');

function findNpm() {
  // Prefer npm next to the node.exe that is running this script
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, 'npm.cmd'),
    path.join(nodeDir, 'npm'),
    'npm.cmd',
    'npm',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'npm'; // rely on PATH
}

function parseArgs(args) {
  const packages = [];
  let target = process.cwd();
  let port = 4873;
  let saveDev = false;
  let global = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--target='))     target  = a.slice('--target='.length);
    else if (a === '--target' || a === '-t') target = args[++i];
    else if (a.startsWith('--port='))  port    = parseInt(a.slice('--port='.length));
    else if (a === '--port' || a === '-p')   port = parseInt(args[++i]);
    else if (a === '--save-dev' || a === '-D') saveDev = true;
    else if (a === '--global' || a === '-g')   global  = true;
    else if (!a.startsWith('-'))        packages.push(a);
  }

  return { packages, target, port, saveDev, global };
}

async function install(args) {
  const { packages, target, port, saveDev, global: isGlobal } = parseArgs(args);

  if (packages.length === 0) {
    console.error('No packages specified.');
    return;
  }

  // Ensure target directory has a package.json (prevents npm warning)
  if (!isGlobal) {
    const pkgJson = path.join(target, 'package.json');
    if (!fs.existsSync(pkgJson)) {
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(pkgJson, JSON.stringify({ name: 'app', version: '1.0.0', private: true }, null, 2));
      console.log(`Created ${pkgJson}`);
    }
  }

  // Start the local registry
  const server = serve(port);
  // Give the server a moment to start
  await new Promise(r => setTimeout(r, 300));

  const npmExe = findNpm();
  const npmArgs = [
    'install',
    '--registry', `http://localhost:${port}`,
    '--prefer-offline',
    '--no-audit',
    '--no-fund',
    '--legacy-peer-deps',
  ];
  if (saveDev)  npmArgs.push('--save-dev');
  if (isGlobal) npmArgs.push('--global');
  else          npmArgs.push('--prefix', target);
  npmArgs.push(...packages);

  console.log(`\nRunning: npm ${npmArgs.join(' ')}\n`);

  const result = spawnSync(npmExe, npmArgs, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, npm_config_registry: `http://localhost:${port}` },
  });

  server.close();

  if (result.status !== 0) {
    console.error(`\nnpm exited with code ${result.status}`);
    process.exit(result.status);
  } else {
    console.log('\nInstallation complete.');
  }
}

module.exports = { install };
