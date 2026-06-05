// Supervisor for serve-web.mjs.
//
// Why this exists: long automated test runs (e.g. TestSprite) need the static
// server to stay up for the *entire* run. If the worker is ever killed — by an
// external reaper, an OOM, or any fault — every in-flight and subsequent test
// instantly fails with ERR_EMPTY_RESPONSE. This supervisor respawns the worker
// within 500ms of any exit, so a momentary death never cascades into blocked
// tests. Launch it detached (e.g. PowerShell Start-Process) so it is independent
// of any parent shell/task lifecycle.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const worker = join(here, 'serve-web.mjs');
const port = process.argv[2] || '3000';

let restarts = 0;
function start() {
  const ts = new Date().toISOString();
  console.log(`[daemon] ${ts} starting serve-web on :${port} (restart #${restarts})`);
  const child = spawn(process.execPath, [worker, port], {
    stdio: 'inherit',
    cwd: join(here, '..'),
  });
  child.on('exit', (code, sig) => {
    restarts += 1;
    console.error(`[daemon] serve-web exited code=${code} sig=${sig}; respawning in 500ms`);
    setTimeout(start, 500);
  });
  child.on('error', (err) => {
    console.error('[daemon] failed to spawn serve-web:', err);
    setTimeout(start, 1000);
  });
}

// Keep the supervisor itself alive through any local fault.
process.on('uncaughtException', (e) => console.error('[daemon] uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('[daemon] unhandledRejection:', e));

start();
