// Robust, dependency-free static server for the Expo web build (dist/).
//
// Why this exists: `npx serve dist` cold-downloads the package on each run and
// `serve-handler` drops connections under concurrent load, surfacing as
// ERR_EMPTY_RESPONSE in automated browsers (e.g. TestSprite) and blocking every
// test. This server pre-loads and gzip-compresses dist/ into memory once, then
// answers from RAM, so it stays responsive under many parallel requests.
//
// Features:
//  - In-memory cache of every file in dist/ (no per-request disk I/O)
//  - gzip negotiation (4.5MB bundle -> ~1MB on the wire)
//  - SPA fallback: unknown, non-file routes return index.html (sub-routes work)
//  - Correct Content-Type per extension
//  - Keep-alive + large backlog for concurrent automated clients

import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';

const DIST = join(process.cwd(), 'dist');
const PORT = Number(process.env.PORT || process.argv[2] || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.svg', '.txt', '.wasm']);

/** @type {Map<string, {type:string, raw:Buffer, gz:Buffer|null}>} */
const cache = new Map();

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    const rel = '/' + relative(DIST, full).split(sep).join('/');
    const ext = extname(full).toLowerCase();
    const raw = readFileSync(full);
    cache.set(rel, {
      type: MIME[ext] || 'application/octet-stream',
      raw,
      gz: COMPRESSIBLE.has(ext) ? gzipSync(raw, { level: 6 }) : null,
    });
  }
}

try {
  statSync(join(DIST, 'index.html'));
} catch {
  console.error(`[serve-web] dist/index.html not found. Run "npm run build:web" first.`);
  process.exit(1);
}

walk(DIST);
const index = cache.get('/index.html');
console.log(`[serve-web] cached ${cache.size} files from dist/`);

function send(req, res, asset, status = 200) {
  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const useGzip = acceptsGzip && asset.gz;
  const body = useGzip ? asset.gz : asset.raw;
  const headers = {
    'Content-Type': asset.type,
    'Content-Length': body.length,
    'Cache-Control': asset.type.startsWith('text/html') ? 'no-cache' : 'public, max-age=31536000',
    Vary: 'Accept-Encoding',
  };
  if (useGzip) headers['Content-Encoding'] = 'gzip';
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  res.end(body);
}

function handle(req, res) {
  try {
    let pathname = decodeURIComponent((req.url || '/').split('?')[0]);

    // Cheap liveness probe: lets the test harness / tunnel confirm the server is
    // up without pulling the 4.5MB bundle. Always answers instantly from RAM.
    if (pathname === '/__health') {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      return res.end('ok');
    }

    if (pathname.endsWith('/')) pathname += 'index.html';

    const asset = cache.get(pathname);
    if (asset) return send(req, res, asset);

    // SPA fallback: a request without a file extension is a client-side route.
    if (!extname(pathname)) return send(req, res, index, 200);

    // A missing asset with an extension is a genuine 404.
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    // A malformed URL (e.g. bad %-escape) or any per-request failure must never
    // bubble up — answer with a 500 and keep the server alive.
    try {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error');
    } catch { /* socket already gone */ }
    console.error('[serve-web] request error:', err);
  }
}

const server = http.createServer(handle);

// Disable Nagle's algorithm on every accepted socket so response bytes flush
// immediately. Under an automated browser driving requests through a tunnel,
// Nagle batching can leave a connection looking idle long enough to be reset
// before any bytes arrive — surfacing as ERR_EMPTY_RESPONSE / a blank page.
server.on('connection', (socket) => {
  socket.setNoDelay(true);
});

// A single malformed request (bad HTTP framing, a probe, a half-open socket from
// a headless browser under load) makes Node emit 'clientError'. The default
// behavior destroys the socket with no response, which the client surfaces as
// ERR_EMPTY_RESPONSE and a blank page — the exact symptom that blocked automated
// tests. Reply with a proper 400 instead of silently dropping the connection.
server.on('clientError', (err, socket) => {
  if (err?.code === 'ECONNRESET' || !socket.writable) return;
  try {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  } catch {
    socket.destroy();
  }
});

// Hold keep-alive connections open longer so a remote tunnel/browser reuses one
// socket for many requests instead of churning new connections (each new TCP
// handshake is another chance to be dropped). headersTimeout must stay greater
// than keepAliveTimeout to avoid Node's keep-alive race.
server.keepAliveTimeout = 75000;
server.headersTimeout = 90000;
server.requestTimeout = 0;
// Allow unlimited requests per keep-alive socket (0 = no cap). The default in
// recent Node is high but explicit here so a long test run never forces a
// reconnect mid-stream.
server.maxRequestsPerSocket = 0;
// Note: leave server.maxConnections unset — Node treats it as unlimited by
// default. Setting it to 0 would reject every connection (ERR_EMPTY_RESPONSE).

// Crash guards: an uncaught exception or unhandled rejection anywhere would
// otherwise tear down the whole process, and every subsequent test would get
// ERR_EMPTY_RESPONSE / connection refused. Log and stay up instead.
process.on('uncaughtException', (err) => {
  console.error('[serve-web] uncaughtException (kept alive):', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[serve-web] unhandledRejection (kept alive):', err);
});

// Larger listen backlog so bursts of parallel connections from automated
// browsers queue instead of being refused.
server.listen(PORT, HOST, 1024, () => {
  console.log(`[serve-web] serving dist/ at http://localhost:${PORT}`);
});
