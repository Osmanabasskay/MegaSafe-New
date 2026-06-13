#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const adminRoot = resolve(scriptDir, '..');
const canonicalAdminRoot = realpathSync.native(adminRoot);
const nextBin = join(canonicalAdminRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: node scripts/next-canonical-cwd.mjs <dev|build|start> [...next args]');
  process.exit(1);
}

const previousCwd = process.cwd();
process.chdir(canonicalAdminRoot);

if (previousCwd !== canonicalAdminRoot && existsSync(join(canonicalAdminRoot, '.next', 'cache', 'webpack'))) {
  rmSync(join(canonicalAdminRoot, '.next', 'cache', 'webpack'), { recursive: true, force: true });
}

const child = spawn(process.execPath, [nextBin, ...args], {
  cwd: canonicalAdminRoot,
  env: {
    ...process.env,
    INIT_CWD: canonicalAdminRoot,
    PWD: canonicalAdminRoot,
  },
  stdio: 'inherit',
  windowsHide: true,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
