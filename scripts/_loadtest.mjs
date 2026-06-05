// Temporary load tester: reproduces TestSprite's concurrent burst against the
// local static server. Fires N concurrent NEW connections (stampede), each doing
// GET / then GET <bundle>, and tallies outcomes. Not committed.
import http from 'node:http';

const PORT = Number(process.argv[2] || 3000);
const CONCURRENCY = Number(process.argv[3] || 120);
const WAVES = Number(process.argv[4] || 6);

// discover the bundle path from index.html
function get(path, { keepAlive = false } = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path, method: 'GET',
        headers: { 'Accept-Encoding': 'gzip', Connection: keepAlive ? 'keep-alive' : 'close' },
        agent: false },
      (res) => {
        let bytes = 0;
        res.on('data', (c) => { bytes += c.length; });
        res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode, bytes }));
        res.on('error', (e) => resolve({ ok: false, err: e.code || e.message }));
      },
    );
    req.setTimeout(15000, () => { req.destroy(); resolve({ ok: false, err: 'TIMEOUT' }); });
    req.on('error', (e) => resolve({ ok: false, err: e.code || e.message }));
    req.end();
  });
}

const idx = await get('/');
const html = await new Promise((resolve) => {
  http.get({ host: '127.0.0.1', port: PORT, path: '/', headers: { 'Accept-Encoding': 'identity' }, agent: false }, (res) => {
    let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(d));
  });
});
const m = html.match(/\/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js/);
const BUNDLE = m ? m[0] : '/';
console.log(`bundle=${BUNDLE} indexStatus=${idx.status}`);

const tally = {};
let total = 0;
const t0 = Date.now();
for (let w = 0; w < WAVES; w++) {
  const jobs = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    jobs.push((async () => {
      const r1 = await get('/');
      const r2 = await get(BUNDLE);
      for (const r of [r1, r2]) {
        total++;
        const key = r.ok ? 'OK' : (r.err || `HTTP_${r.status}`);
        tally[key] = (tally[key] || 0) + 1;
      }
    })());
  }
  await Promise.all(jobs);
  process.stdout.write(`wave ${w + 1}/${WAVES} done\n`);
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n=== ${total} requests in ${secs}s @ concurrency ${CONCURRENCY} ===`);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
const fails = total - (tally.OK || 0);
console.log(`FAIL_TOTAL=${fails} (${((fails / total) * 100).toFixed(1)}%)`);
