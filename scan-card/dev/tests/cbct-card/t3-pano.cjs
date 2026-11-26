// t3-pano: the panoramic on the demo CBCT — the proposed arch runs through every tooth in order; the rendered panoramic shows
// each crown bright at its place; a tap on it puts the cross-sections there and the middle one shows that tooth; the
// cross-section's millimetre scale (bone width measured in rendered pixels and with the Distance tool, ruler tick spacing)
// matches the phantom; vertical distances on the panoramic are true; the arch can be tapped and dragged by hand.
const { open, ok, OUT, screenOf } = require('./lib.cjs');
(async () => {
  const a = await open(), { page } = a; await a.demo();
  await page.click('.step[data-id=pano] h3'); await a.idle();
  await page.click('#pPropose'); await a.idle(); await page.waitForFunction(() => APP.S.pano && APP.S.xs.length === 3, null, { timeout: 60000 }); await page.waitForTimeout(500);
  const arch = await page.evaluate(() => {
    const c = APP.S.arch.curve, teeth = APP.S.demo.teeth.slice().sort((a, b) => a.s - b.s), proj = (p) => { let best = Infinity, bs = 0; for (let i = 0; i < c.pts.length; i++) { const d = Math.hypot(c.pts[i][0] - p[0], c.pts[i][1] - p[1]); if (d < best) { best = d; bs = c.s[i]; } } return { d: best, s: bs }; };
    return teeth.map((t) => ({ name: t.name, crown: t.crown, z: t.base[2], ...proj(t.base) }));
  });
  const inOrder = arch.every((t, i) => i === 0 || t.s > arch[i - 1].s), off = Math.max(...arch.map((t) => t.d));
  ok(inOrder && off < 2 && arch[0].name === 47 && arch[13].name === 37, `proposed arch: teeth in order ${arch.map((t) => t.name).join(' ')}; furthest tooth axis ${off.toFixed(2)} mm from the curve`);
  // the rendered panoramic (5 mm slab, set on the slider): every crown bright where it should be, darker between neighbours
  await page.evaluate(() => { const i = document.querySelector('#pSlab'); i.value = 5; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); });
  await page.waitForFunction(() => APP.S.pano && APP.S.pano.slab === 5, null, { timeout: 30000 }); await page.waitForTimeout(400);
  const pan = await page.evaluate((arch) => {
    const v = APP.views.pan, V = APP.S.vol, W = APP.S.win, cr = v.cv.getBoundingClientRect(), pr = v.cv.width / cr.width, grey = (val) => ((val - (W.l - W.w / 2)) / W.w) * 255;
    const px = (s, z) => { const b = (V.dims[2] - 1 - (z - V.origin[2]) / V.spacing[2] + 0.5) * V.spacing[2], [X, Y] = APP.toScreen(v, s, b); return v.ctx.getImageData(Math.round(X * pr), Math.round(Y * pr), 1, 1).data[0]; };
    const thr = grey((60 + 1700) / 2), res = arch.map((t) => px(t.s, t.z + 0.7 * t.crown)); let dark = 0;
    for (let i = 1; i < arch.length; i++) { const z = Math.min(arch[i].z + 0.7 * arch[i].crown, arch[i - 1].z + 0.7 * arch[i - 1].crown) + 0.6; if (px((arch[i].s + arch[i - 1].s) / 2, z) < Math.min(px(arch[i].s, z), px(arch[i - 1].s, z)) - 20) dark++; }
    return { bright: res.filter((g) => g > thr).length, res, thr, dark };
  }, arch);
  ok(pan.bright === 14 && pan.dark >= 12, `rendered panoramic: ${pan.bright} of 14 crowns brighter than ${pan.thr.toFixed(0)} grey at their place (${pan.res.join(' ')}); darker between ${pan.dark} of 13 neighbouring pairs (35|36 touch)`);
  await page.screenshot({ path: OUT + 't3-pano-proposed.png' });
  // tap the panoramic on 45: the cross-sections move there
  const t45 = arch.find((t) => t.name === 45), xy = await page.evaluate((t) => { const v = APP.views.pan, V = APP.S.vol, b = (V.dims[2] - 1 - (t.z + 4 - V.origin[2]) / V.spacing[2] + 0.5) * V.spacing[2], [X, Y] = APP.toScreen(v, t.s, b), r = v.cv.getBoundingClientRect(); return [r.left + X, r.top + Y]; }, t45);
  await page.click('#cbTool [data-v=browse]'); await page.mouse.click(xy[0], xy[1]); await page.waitForTimeout(500);
  const xs = await page.evaluate((t) => {
    const X = APP.S.xs[1], v = APP.views.xs1, V = APP.S.vol, W = APP.S.win, cr = v.cv.getBoundingClientRect(), pr = v.cv.width / cr.width;
    const b = (V.dims[2] - 1 - (t.z + 0.6 * t.crown - V.origin[2]) / V.spacing[2] + 0.5) * V.spacing[2], [Xs, Ys] = APP.toScreen(v, X.width / 2, b);
    return { s: X.s, ss: APP.S.xs.map((x) => x.s), g: v.ctx.getImageData(Math.round(Xs * pr), Math.round(Ys * pr), 1, 1).data[0], thr: ((880 - (W.l - W.w / 2)) / W.w) * 255 };
  }, t45);
  ok(Math.abs(xs.s - t45.s) < 0.5 && xs.g > xs.thr && Math.abs(xs.ss[0] - (xs.s - 2)) < 1e-6, `tap on 45 in the panoramic: cross-sections at ${xs.ss.map((s) => s.toFixed(1)).join(', ')} mm (45 at ${t45.s.toFixed(1)}); the middle one shows its crown (grey ${xs.g})`);
  // the cross-section's scale: the bone's width half way down, from rendered pixels, from the Distance tool, and the ruler ticks
  const zMid = -8.5;
  const sc = await page.evaluate((z) => {
    const v = APP.views.xs1, V = APP.S.vol, W = APP.S.win, cr = v.cv.getBoundingClientRect(), pr = v.cv.width / cr.width, kz = Math.round((z - V.origin[2]) / V.spacing[2]), b = (V.dims[2] - 1 - kz + 0.5) * V.spacing[2], [, Ys] = APP.toScreen(v, 0, b);
    const row = v.ctx.getImageData(0, Math.round(Ys * pr), v.cv.width, 1).data, g = []; for (let x = 0; x < v.cv.width; x++) g.push(row[4 * x]);
    const grey = (val) => ((val - (W.l - W.w / 2)) / W.w) * 255, half = (grey(1300) + grey(60)) / 2; let L = -1, R = -1;
    for (let x = 20; x < g.length; x++) if (g[x - 1] < half && g[x] >= half) { L = x - 1 + (half - g[x - 1]) / (g[x] - g[x - 1]); break; }
    for (let x = g.length - 2; x > 0; x--) if (g[x] < half && g[x - 1] >= half) { R = x - 1 + (g[x - 1] - half) / (g[x - 1] - g[x]); break; }
    // ruler ticks along the bottom edge: white columns two pixels up from the bottom
    const bot = v.ctx.getImageData(0, v.cv.height - Math.round(2 * pr), v.cv.width, 1).data, ticks = []; for (let x = 0; x < v.cv.width;) { if (bot[4 * x] > 40) { let sw = 0, sx = 0; while (x < v.cv.width && bot[4 * x] > 40) { sw += bot[4 * x]; sx += bot[4 * x] * x; x++; } ticks.push(sx / sw / pr); } else x++; }
    const gaps = []; for (let i = 1; i < ticks.length; i++) gaps.push(ticks[i] - ticks[i - 1]); gaps.sort((a, b) => a - b);
    return { widthPx: (R - L) / pr, z: v.z, L: L / pr + cr.left, R: R / pr + cr.left, Y: Ys + cr.top, tick: gaps[gaps.length >> 1], nt: ticks.length };
  }, zMid);
  ok(Math.abs(sc.widthPx / sc.z - 11.2) < 0.35 && Math.abs(sc.tick - sc.z) < 0.6, `cross-section: bone ${(sc.widthPx / sc.z).toFixed(2)} mm wide half way down in rendered pixels (true 11.2); ruler ticks every ${sc.tick.toFixed(2)} px = 1 mm at ${sc.z.toFixed(2)} px/mm (${sc.nt} ticks)`);
  await page.click('#cbTool [data-v=dist]'); await page.mouse.click(sc.L, sc.Y); await page.mouse.click(sc.R, sc.Y); await page.waitForTimeout(300);
  const m1 = await page.evaluate(() => APP.S.measures[APP.S.measures.length - 1]);
  ok(m1 && m1.view === 'xs1' && Math.abs(m1.value - 11.2) < 0.35, `Distance tool on the cross-section across the bone: ${m1 && m1.value.toFixed(2)} mm (true 11.2)`);
  // vertical distance on the panoramic: from z = 0 to z = −10 at 45
  const pz = await page.evaluate((s) => { const v = APP.views.pan, V = APP.S.vol, r = v.cv.getBoundingClientRect(), f = (z) => { const b = (V.dims[2] - 1 - (z - V.origin[2]) / V.spacing[2] + 0.5) * V.spacing[2], [X, Y] = APP.toScreen(v, s, b); return [r.left + X, r.top + Y]; }; return [f(0), f(-10)]; }, t45.s);
  for (const p of pz) { await page.mouse.click(p[0], p[1]); await page.waitForTimeout(80); }
  const m2 = await page.evaluate(() => APP.S.measures[APP.S.measures.length - 1]);
  ok(m2 && m2.view === 'pan' && Math.abs(m2.value - 10) < 0.05, `Distance tool on the panoramic, 10 mm straight down: ${m2 && m2.value.toFixed(2)} mm`);
  await page.click('#pCount [data-v="5"]'); await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + 't3-pano-xs.png' });
  ok((await page.evaluate(() => APP.S.xs.length + ':' + document.querySelectorAll('#xsRow .vp').length)) === '5:5', 'five cross-sections on request');
  // slab and mode change the panoramic
  const k1 = await page.evaluate(() => APP.S.pano.key); await page.click('#pMode [data-v=max]'); await page.waitForFunction((k) => APP.S.pano.key !== k, k1);
  ok(true, 'the slab shown as its brightest value recomputes the panoramic');
  // the arch by hand: five taps along the truth's arch line, then drag one point
  await page.click('#pClear'); await page.click('#cbTool [data-v=arch]'); await page.waitForTimeout(200);
  const line = await page.evaluate(() => { const A = APP.S.demo.arch, out = []; for (let q = 0; q < 5; q++) { const s = 12 + (A.length - 24) * q / 4; let i = 0; while (A.s[i] < s) i++; out.push(A.pts[i]); } return out; });
  const z0 = await page.evaluate(() => APP.D.worldOf(APP.S.vol, 0, 0, Math.round(APP.S.cur[2]))[2]);
  for (const p of [line[0], line[4], line[2], line[1], line[3]]) { const [x, y] = await screenOf(page, 'ax', [p[0], p[1], z0]); await page.mouse.click(x, y); await page.waitForTimeout(120); }
  await page.waitForFunction(() => APP.S.pano && APP.S.arch.points.length === 5, null, { timeout: 30000 });
  const order = await page.evaluate((line) => APP.S.arch.points.map((p) => line.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.3)), line);
  ok(order.join() === '0,1,2,3,4', `five taps in any order are put in order along the arch: ${order.join(',')}`);
  const [px1, py1] = await screenOf(page, 'ax', [line[2][0], line[2][1], z0]);
  await page.mouse.move(px1, py1); await page.mouse.down(); await page.mouse.move(px1, py1 + 40, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(300);
  const moved = await page.evaluate((p) => { const q = APP.S.arch.points[2]; return [q[0] - p[0], q[1] - p[1]]; }, line[2]);
  ok(Math.abs(moved[0]) < 0.3 && moved[1] > 3, `dragging the middle point moves it ${moved[1].toFixed(1)} mm back`);
  await page.waitForTimeout(300); await page.screenshot({ path: OUT + 't3-pano-hand.png' });
  const errs = a.errors.filter((e) => !/font/.test(e)); ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await a.close();
})().catch((e) => { console.error(e); process.exitCode = 1; });
