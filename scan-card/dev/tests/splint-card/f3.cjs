// FINAL browser test 3: touch.  node f3.cjs            (820×1180 tablet with touch, then 390×780 phone layout)
// Tablet: demo scans → lower, thin tray preset → margin control point dragged by touch → build → section → STL download.
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs');
const O = '/home/claude/suite/dev/out/splint-card/';
const run = async (W, H, tag) => {
  const { page, errors, shot, close } = await openApp('splint-card', { width: W, height: H, touch: true });
  await page.waitForFunction(() => window.APP, { timeout: 60000 });
  const cdp = await page.context().newCDPSession(page);
  const idle = async () => { await page.waitForTimeout(150); await page.waitForFunction(() => !document.querySelector('#busy.show'), { timeout: 240000 }); await page.waitForTimeout(200); };
  const built = async () => { await idle(); await page.waitForFunction(() => APP.D.res && !APP.D.dirty && !document.querySelector('#busy.show'), { timeout: 240000 }); await page.waitForTimeout(150); };
  const layout = async (where) => console.log(`[${tag}] layout at ${where}:`, await page.evaluate(() => { const r = APP.viewer.dom.getBoundingClientRect(), n = document.getElementById('bNext').getBoundingClientRect(); return JSON.stringify({ page: [innerWidth, innerHeight], scrollW: document.documentElement.scrollWidth, viewer: [Math.round(r.width), Math.round(r.height)], next: [Math.round(n.left), Math.round(n.top), Math.round(n.width), Math.round(n.height)], nextOnScreen: n.width > 0 && n.bottom <= innerHeight + 1 && n.right <= innerWidth + 1 }); }));
  await page.tap('[data-ss=demo]'); await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 60000 }); await layout('load');
  await page.evaluate(() => APP.shell.goto('appliance')); await page.waitForTimeout(300); await page.tap('#apJaw [data-v=lower]'); await page.tap('#apType [data-v=thin]'); await page.waitForTimeout(300);
  console.log(`[${tag}] thin tray preset →`, await page.evaluate(() => JSON.stringify({ thickness: APP.P.thickness, minThick: APP.P.minThick, buccal: APP.P.buccal, lingual: APP.P.lingual, edge: APP.P.edge })));
  await page.tap('#bNext'); await page.waitForTimeout(500); console.log(`[${tag}] "Next" tapped → step`, await page.evaluate(() => document.querySelector('.step.open, .step.active, [aria-expanded=true]') ? (document.querySelector('.step.open h3, .step.active h3, [aria-expanded=true]') || {}).textContent : '?'));
  await page.evaluate(() => APP.shell.goto('margin')); await page.waitForTimeout(600); await page.evaluate(() => APP.viewer.setView('left')); await page.waitForTimeout(400); await layout('margin');
  if (tag === 'tablet') {
    const dot = await page.evaluate(() => { const r = APP.viewer.dom.getBoundingClientRect(); let best = null; for (const d of APP.dots()) { if (d.side !== 'B') continue; const q = APP.viewer.toScreen(d.sprite.position); if (!q.visible) continue; const e = Math.hypot(q.x - r.width / 2, q.y - r.height / 2); if (!best || e < best.e) best = { e, x: q.x + r.left, y: q.y + r.top, k: d.k }; } return best; });
    const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1 }] });
    await tp('touchStart', dot.x, dot.y); for (let s = 1; s <= 6; s++) { await tp('touchMove', dot.x, dot.y + 4 * s); await page.waitForTimeout(30); } await tp('touchEnd'); await page.waitForTimeout(400);
    console.log(`[${tag}] buccal control point ${dot.k} dragged 24 px down by touch → adjB`, await page.evaluate(() => APP.P.adjB.join(','))); await shot(O + 'f3-touch-margin.png');
  }
  let t = Date.now(); await page.evaluate(() => APP.shell.goto('check')); await built(); console.log(`[${tag}] build`, Date.now() - t, 'ms');
  console.log(`[${tag}] summary:`, (await page.evaluate(() => document.getElementById('ckSummary').innerText)).replace(/\n+/g, ' | ').slice(0, 420));
  await layout('check'); await page.evaluate(() => APP.viewer.setView('front')); await page.waitForTimeout(400); await shot(O + `f3-${tag}-check.png`);
  await page.tap('#ckSec'); await page.waitForTimeout(700); await shot(O + `f3-${tag}-section.png`); await page.tap('#ckSec'); await page.waitForTimeout(200);
  await page.evaluate(() => APP.shell.goto('export')); await built(); await layout('export'); await shot(O + `f3-${tag}-export.png`);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.tap('#exStl')]); await dl.saveAs(O + `f3-${tag}-thin-lower.stl`); console.log(`[${tag}] STL by tap:`, dl.suggestedFilename(), (fs.statSync(O + `f3-${tag}-thin-lower.stl`).size / 1e6).toFixed(1), 'MB');
  console.log(`[${tag}] report`, await page.evaluate(() => JSON.stringify({ wt: APP.D.res.report.watertight, genus: APP.D.res.report.genus, vol: +(APP.D.res.report.volume / 1000).toFixed(2), wall: +APP.D.thick.wall.min.toFixed(3), occ: +APP.D.thick.occ.min.toFixed(3), edge: APP.D.res.report.edge })));
  console.log(`[${tag}] errors`, JSON.stringify(errors)); await close();
};
(async () => { const which = process.argv[2] || 'both'; if (which !== 'phone') await run(820, 1180, 'tablet'); if (which !== 'tablet') await run(390, 780, 'phone'); })();
