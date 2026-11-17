// Take Pulse Radar's three screenshots from the built output in out/ using Playwright Chromium.
// Serves out/ locally, loads dashboard/ at 1440x900, waits for window.__shotReady, saves JPEGs
// into screenshots/ (the source main.ts copies to /output).
//   node scripts/shots.mjs
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { join, resolve, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const root = join(repo, 'out');
const shots = [
  { name: '1-board.jpg', query: 'dashboard/?shot=board' },
  { name: '2-detail.jpg', query: 'dashboard/?shot=detail' },
  { name: '3-filtered.jpg', query: 'dashboard/?shot=filtered' },
];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
const server = createServer((req, res) => {
  let p = '/';
  try { p = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname); } catch {}
  if (p.endsWith('/')) p += 'index.html';
  const file = resolve(join(root, normalize(p)));
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end('forbidden'); return; }
  try {
    const s = statSync(file);
    if (!s.isFile()) throw new Error('nf');
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': s.size });
    createReadStream(file).pipe(res);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(8080, '127.0.0.1', r));
console.log('serving', root, 'on 8080');
const browser = await chromium.launch({ executablePath: '/home/hatch/workspace/makefun/tools/chrome-linux/chrome', args: ['--no-sandbox'] });
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (m) => console.log('console', s.name, m.type(), m.text().slice(0, 300)));
  page.on('pageerror', (e) => console.log('pageerror', s.name, String((e && e.stack) || e).slice(0, 2000)));
  await page.goto(`http://127.0.0.1:8080/${s.query}`, { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 20000 });
    console.log('ready', s.name);
  } catch (e) {
    console.log('NOT READY', s.name, String(e).slice(0, 200));
  }
  await page.screenshot({ path: join(repo, 'screenshots', s.name), type: 'jpeg', quality: 82 });
  console.log('shot', s.name, existsSync(join(repo, 'screenshots', s.name)));
  await page.close();
}
await browser.close();
server.close();
console.log('done');
