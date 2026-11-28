// Shared headless-Chrome test harness for the Notile 3D suite.
//
//   const { openApp } = require('/home/claude/suite/dev/pw.cjs');
//   const { page, errors, close, shot } = await openApp('model-card', { width: 1400, height: 900 });
//   await page.evaluate(() => window.APP.something());
//   await shot('/home/claude/suite/dev/out/x.png');
//   await close();
//
// What it does:
//  * starts a private static server (random port) rooted at /home/claude/suite
//    - /<app>/core.js, /<app>/solid.js, /<app>/manifold-wasm.js fall back to /shared/<file> when the app
//      folder has no copy of its own (so there is one source of truth while developing)
//  * maps https://cdn.jsdelivr.net/npm/<pkg>@<ver>/<path> to node_modules/<pkg>/<path> (the sandbox has no CDN access)
//  * stubs Google Fonts, blocks every other external request
//  * serves pages under a Content-Security-Policy close to the one a published artifact gets, so a blocked script,
//    fetch or image shows up as an error here rather than only after publishing
//  * collects console errors and uncaught page errors in `errors`
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright');   // PLAYWRIGHT=playwright to use one found on NODE_PATH

const ROOT = '/home/claude/suite';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.stl': 'model/stl', '.ply': 'application/octet-stream',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.zip': 'application/zip', '.obj': 'text/plain' };
const SHARED = new Set(['core.js', 'solid.js', 'manifold-wasm.js', 'dicom.js']);   // dicom.js: the CBCT tab's DICOM reader (added for cbct-card)

// An approximation of the policy a published artifact page runs under (see the artifact guide): own files and inline code,
// libraries only from the allowed CDNs, no network requests to other hosts, images only from data:/blob:.
// A violation shows up in `errors` as a console error starting "Refused to …". Set NO_CSP=1 to switch it off.
const CSP = ["default-src 'self'", "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net/npm/ https://cdnjs.cloudflare.com https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src https://fonts.gstatic.com data:", "img-src 'self' data: blob:", "media-src data: blob:",
  "connect-src 'self'", "worker-src 'self' blob:", "object-src 'none'", "frame-src 'self'"].join('; ');

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      let f = path.join(ROOT, p);
      if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      if (!fs.existsSync(f) && SHARED.has(path.basename(f))) f = path.join(ROOT, 'shared', path.basename(f));
      fs.readFile(f, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found: ' + p); }
        const head = { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
        if (path.extname(f) === '.html' && !process.env.NO_CSP) head['Content-Security-Policy'] = CSP;
        res.writeHead(200, head);
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

async function openApp(app, opts = {}) {
  const { srv, port } = await startServer();
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true,
    args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({
    viewport: { width: opts.width || 1400, height: opts.height || 900 },
    deviceScaleFactor: opts.dpr || 1, hasTouch: !!opts.touch, acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); if (opts.log) console.log('[page]', m.type(), m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(`http://127.0.0.1:${port}/`) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    const m = url.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.*)$/);
    if (m) {
      const f = path.join(ROOT, 'node_modules', m[1], m[2].split('?')[0]);
      if (fs.existsSync(f)) return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f), headers: { 'Access-Control-Allow-Origin': '*' } });
      errors.push('cdn file missing locally: ' + url);
      return route.fulfill({ status: 404, body: '' });
    }
    if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    errors.push('blocked external request: ' + url);
    return route.abort();
  });
  if (opts.init) await ctx.addInitScript(opts.init.fn || opts.init, opts.init.arg);   // a script run in the page before its own (opts.init: a function, or { fn, arg })
  const url = `http://127.0.0.1:${port}/${app}/${opts.file || 'index.html'}${opts.hash || ''}`;
  await page.goto(url, { waitUntil: 'load' });
  const shot = (file, o = {}) => page.screenshot({ path: file, ...o });
  const close = async () => { await browser.close(); srv.close(); };
  return { page, ctx, browser, errors, shot, close, port, url };
}

module.exports = { openApp, startServer, ROOT };
