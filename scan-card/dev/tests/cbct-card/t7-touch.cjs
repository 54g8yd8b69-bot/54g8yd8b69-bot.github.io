// t7-touch: a tablet in portrait (820 × 1180, touch) — the layout fits; a finger tap moves the cross-hair; a two-finger
// pinch zooms a slice about the fingers and a two-finger drag pans it (real touch events); the slice slider scrolls.
const { open, ok, OUT, screenOf } = require('./lib.cjs');
(async () => {
  const a = await open({ width: 820, height: 1180, touch: true }), { page } = a; await a.demo();
  await page.evaluate(() => APP.shell.goto('view')); await a.idle(); await page.waitForTimeout(500);
  const cells = await page.evaluate(() => ['ax', 'co', 'sa', 'r3'].map((id) => { const el = document.querySelector(`.vp[data-v=${id}]`), r = el.getBoundingClientRect(); return [id, Math.round(r.width), Math.round(r.height)]; }));
  ok(cells.every(([, w, h]) => w > 300 && h > 180), `four views fit on the tablet: ${cells.map((c) => c.join(' ')).join(' · ')}`);
  const P = [10, -15, -4];
  await page.evaluate((z) => { APP.S.cur[2] = Math.round(APP.D.voxelOf(APP.S.vol, 0, 0, z)[2]); APP.crossChanged(); }, P[2]); await page.waitForTimeout(300);
  const [x, y] = await screenOf(page, 'ax', P); await page.touchscreen.tap(x, y); await page.waitForTimeout(300);
  const w = await page.evaluate(() => APP.D.worldOf(APP.S.vol, ...APP.S.cur));
  ok(Math.abs(w[0] - P[0]) < 0.3 && Math.abs(w[1] - P[1]) < 0.3, `a finger tap on the axial slice moves the cross-hair there: ${w.map((v) => v.toFixed(2)).join(', ')}`);
  // a pinch: two fingers 60 px apart move to 150 px apart about the same centre
  const cdp = await page.context().newCDPSession(page), c = await page.evaluate(() => { const r = APP.views.co.cv.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; });
  const z0 = await page.evaluate(() => APP.views.co.z), anchor0 = await page.evaluate((c) => { const v = APP.views.co, r = v.cv.getBoundingClientRect(); return APP.fromScreen(v, c[0] - r.left, c[1] - r.top); }, c);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([px, py], id) => ({ x: px, y: py, id })) });
  await touch('touchStart', [[c[0] - 30, c[1]], [c[0] + 30, c[1]]]);
  for (let s = 1; s <= 6; s++) { const d = 30 + 45 * s / 6; await touch('touchMove', [[c[0] - d, c[1]], [c[0] + d, c[1]]]); await page.waitForTimeout(30); }
  await touch('touchEnd', []); await page.waitForTimeout(200);
  const z1 = await page.evaluate(() => APP.views.co.z), anchor1 = await page.evaluate((c) => { const v = APP.views.co, r = v.cv.getBoundingClientRect(); return APP.fromScreen(v, c[0] - r.left, c[1] - r.top); }, c);
  ok(Math.abs(z1 / z0 - 2.5) < 0.15 && Math.hypot(anchor1[0] - anchor0[0], anchor1[1] - anchor0[1]) < 0.3, `two-finger pinch (60 → 150 px) zooms the coronal slice ×${(z1 / z0).toFixed(2)} about the fingers (point under them moved ${Math.hypot(anchor1[0] - anchor0[0], anchor1[1] - anchor0[1]).toFixed(2)} mm)`);
  const cx0 = await page.evaluate(() => [APP.views.co.cx, APP.views.co.cy]);
  await touch('touchStart', [[c[0] - 30, c[1]], [c[0] + 30, c[1]]]); for (let s = 1; s <= 5; s++) { await touch('touchMove', [[c[0] - 30 + 8 * s, c[1] + 6 * s], [c[0] + 30 + 8 * s, c[1] + 6 * s]]); await page.waitForTimeout(30); } await touch('touchEnd', []); await page.waitForTimeout(200);
  const cx1 = await page.evaluate(() => [APP.views.co.cx, APP.views.co.cy, APP.views.co.z]);
  ok(Math.abs((cx0[0] - cx1[0]) * cx1[2] - 40) < 2 && Math.abs((cx0[1] - cx1[1]) * cx1[2] - 30) < 2, `two-finger drag pans it by the fingers' 40 × 30 px`);
  const k0 = await page.evaluate(() => Math.round(APP.S.cur[2]));
  await page.evaluate(() => { const s = APP.views.ax.slider; s.value = String(+s.value - 5); s.dispatchEvent(new Event('input')); }); await page.waitForTimeout(200);
  ok((await page.evaluate(() => Math.round(APP.S.cur[2]))) === k0 - 5, 'the slice slider (for fingers) moves the axial slice');
  await page.screenshot({ path: OUT + 't7-tablet.png' });
  const errs = a.errors.filter((e) => !/font/.test(e)); ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await a.close();
})().catch((e) => { console.error(e); process.exitCode = 1; });
