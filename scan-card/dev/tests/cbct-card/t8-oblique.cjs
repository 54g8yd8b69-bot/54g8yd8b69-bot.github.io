// t8-oblique: turning the cross-hair on the demo CBCT. Dragging a round handle in the axial slice by 30° turns the coronal and
// sagittal planes by 30° about the axial normal (the axial slice itself stays; the three stay square; the cross-hair stays put
// on every screen); the turned slices are the volume sampled on those planes (checked against a trilinear look-up pixel by
// pixel); a tap, scrolling and the slider move the cross-hair in and through a turned slice; a distance measured across the
// jaw on a turned slice matches the phantom's true width along that line; [ and ] turn by 1° and 0.1°; a second turn in the
// coronal slice tilts the axial one; the tooth found shows on turned slices where the true tooth is; the angles are kept in a
// saved case; dragging back settles on straight exactly, and Straighten puts every slice back as it was. With a finger too.
const { open, ok, OUT, screenOf } = require('./lib.cjs');
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], deg = Math.PI / 180;
(async () => {
  const a = await open(), { page } = a; await a.demo();
  await page.evaluate(() => APP.shell.goto('view')); await a.idle(); await page.waitForTimeout(300);
  const state = () => page.evaluate(() => ({ fr: JSON.parse(JSON.stringify(APP.S.fr)), ang: { ax: APP.lineAngle('ax'), co: APP.lineAngle('co'), sa: APP.lineAngle('sa') }, lab: { ax: APP.views.ax.lab.textContent, co: APP.views.co.lab.textContent, sa: APP.views.sa.lab.textContent }, w: APP.D.worldOf(APP.S.vol, ...APP.S.cur),
    scr: Object.fromEntries(['ax', 'co', 'sa'].map((k) => { const v = APP.views[k]; return [k, APP.toScreen(v, ...APP.fromVox(v, ...APP.S.cur))]; })), btn: !document.querySelector('#cbStraight').hidden, n: Object.fromEntries(['ax', 'co', 'sa', 'pan'].map((k) => [k, APP.views[k].kind === 'pan' ? 0 : APP.handles(APP.views[k]).length])) }));
  const handlesOf = (view) => page.evaluate((view) => { const v = APP.views[view], r = v.cv.getBoundingClientRect(), c = APP.toScreen(v, ...APP.fromVox(v, ...APP.S.cur)); return { c: [r.left + c[0], r.top + c[1]], h: APP.handles(v).map((h) => ({ kind: h.kind, p: [r.left + h.p[0], r.top + h.p[1]] })) }; }, view);
  /** drag a handle round the cross-hair by d degrees (clockwise on the screen) */
  const turn = async (view, d, hi = 0) => {
    const H = await handlesOf(view), h = H.h[hi], R = Math.hypot(h.p[0] - H.c[0], h.p[1] - H.c[1]), a0 = Math.atan2(h.p[1] - H.c[1], h.p[0] - H.c[0]), n = Math.max(6, Math.ceil(Math.abs(d) / 2));
    await page.mouse.move(h.p[0], h.p[1]); await page.mouse.down();
    for (let i = 1; i <= n; i++) { const t = a0 + d * deg * i / n; await page.mouse.move(H.c[0] + R * Math.cos(t), H.c[1] + R * Math.sin(t)); }
    await page.mouse.up(); await page.waitForTimeout(400);
  };
  const hashOf = (view) => page.evaluate((view) => { const v = APP.views[view], d = v.off.getContext('2d').getImageData(0, 0, v.off.width, v.off.height).data; return `${v.off.width}x${v.off.height}:${APP.N.crc32(new Uint8Array(d.buffer))}`; }, view);
  const P0 = [8.1, -12.3, -6];
  await page.evaluate((p) => { APP.S.cur = APP.D.voxelOf(APP.S.vol, ...p).map(Math.round); APP.crossChanged(); }, P0); await page.waitForTimeout(300);
  const s0 = await state(), h0 = { ax: await hashOf('ax'), co: await hashOf('co'), sa: await hashOf('sa') };
  ok(s0.n.ax === 4 && s0.n.co === 4 && s0.n.sa === 4 && !s0.btn && !/oblique|lines/.test(Object.values(s0.lab).join()), `straight to start with: four handles on each slice, no Straighten button, labels “${s0.lab.ax}” · “${s0.lab.co}” · “${s0.lab.sa}”`);

  // ── turn by 30° in the axial slice ──
  await turn('ax', 30);
  const s1 = await state(), c = Math.cos(30 * deg), sn = Math.sin(30 * deg), near = (u, w, tol = 0.012) => Math.hypot(u[0] - w[0], u[1] - w[1], u[2] - w[2]) < tol;
  ok(Math.abs(s1.ang.ax - 30) < 0.6 && JSON.stringify(s1.fr.ax) === JSON.stringify(s0.fr.ax), `a handle dragged 30° round the cross-hair in the axial slice: its lines are at ${s1.ang.ax.toFixed(2)}° and the axial plane has not moved`);
  ok(near(s1.fr.co.n, [-sn, c, 0]) && near(s1.fr.sa.n, [c, sn, 0]) && near(s1.fr.co.v, [0, 0, -1], 1e-9) && near(s1.fr.sa.v, [0, 0, -1], 1e-9) && near(s1.fr.co.u, [c, sn, 0]) && near(s1.fr.sa.u, [-sn, c, 0]),
    `the coronal and sagittal planes turned 30° about the vertical: normals ${s1.fr.co.n.map((v) => v.toFixed(3))} and ${s1.fr.sa.n.map((v) => v.toFixed(3))}, both still upright`);
  ok(/oblique (29\.[5-9]|30\.[0-5])°/.test(s1.lab.co) && /oblique (29\.[5-9]|30\.[0-5])°/.test(s1.lab.sa) && /lines (29\.[5-9]|30\.[0-5])°/.test(s1.lab.ax) && s1.btn && Math.abs(s1.ang.co) < 1e-6 && Math.abs(s1.ang.sa) < 1e-6, `labels: “${s1.lab.ax}” · “${s1.lab.co}” · “${s1.lab.sa}”; the Straighten button shows; the lines in the other two slices are still level`);
  const moved = ['ax', 'co', 'sa'].map((k) => Math.hypot(s1.scr[k][0] - s0.scr[k][0], s1.scr[k][1] - s0.scr[k][1]));
  ok(near(s1.w, s0.w, 1e-9) && Math.max(...moved) < 0.01, `the cross-hair stayed where it was, in the scan and on each slice’s screen (moved ${moved.map((v) => v.toFixed(3)).join(', ')} px)`);
  // the turned slices are the volume on those planes: every pixel against a trilinear look-up at its centre
  const px = await page.evaluate(() => {
    const out = {}, V = APP.S.vol, LUT = APP.LUT();
    for (const k of ['co', 'sa']) {
      const v = APP.views[k], g = APP.geom(v), o = g.ob, d = v.off.getContext('2d').getImageData(0, 0, g.cols, g.rows).data; let n = 0, exact = 0, worst = 0, outside = 0, outsideOk = 0, bright = 0;
      for (let r = 0; r < g.rows; r += 2) for (let c = 0; c < g.cols; c += 2) {
        const P = APP.obPt(o, (c + 0.5) * o.su, (r + 0.5) * o.sv), q = APP.D.voxelOf(V, ...P), got = d[4 * (r * g.cols + c)];
        if (q.some((x, i) => x < -0.6 || x > V.dims[i] - 0.4)) { outside++; if (got === (LUT[0] & 255)) outsideOk++; continue; }
        if (q.some((x, i) => x < 0.5 || x > V.dims[i] - 1.5)) continue;
        const want = LUT[Math.round(APP.D.sampleAt(V, ...P)) - V.min] & 255, e = Math.abs(got - want); n++; if (e === 0) exact++; worst = Math.max(worst, e); if (got > 128) bright++;
      }
      out[k] = { n, exact, worst, outside, outsideOk, bright, size: [g.cols, g.rows], px: [o.su, o.sv] };
    }
    return out;
  });
  for (const k of ['co', 'sa']) ok(px[k].n > 5000 && px[k].exact / px[k].n > 0.995 && px[k].worst <= 2 && px[k].outsideOk === px[k].outside && px[k].bright > 200, `turned ${k === 'co' ? 'coronal' : 'sagittal'} slice (${px[k].size.join(' × ')} px of ${px[k].px.map((v) => v.toFixed(3)).join(' × ')} mm): ${px[k].exact} of ${px[k].n} sampled pixels equal the trilinear value on its plane (worst ${px[k].worst} grey), ${px[k].outside} outside the scan are black, ${px[k].bright} are bone or tooth`);
  await page.screenshot({ path: OUT + 't8-turned-30.png' });

  // ── a tap, the wheel and the slider on a turned slice ──
  const Q = await page.evaluate(() => { const v = APP.views.co, o = APP.obl(v), [aa, bb] = APP.fromVox(v, ...APP.S.cur); return { p: APP.obPt(o, aa + 7, bb - 5, o.t), n: o.f.n, s: o.s }; });
  let [X, Y] = await screenOf(page, 'co', Q.p); await page.mouse.click(X, Y); await page.waitForTimeout(250);
  const s2 = await state(), off = dot([0, 1, 2].map((i) => s2.w[i] - s1.w[i]), Q.n);
  ok(near(s2.w, Q.p, 0.2) && Math.abs(off) < 1e-6, `a tap on the turned coronal slice puts the cross-hair there (${s2.w.map((v) => v.toFixed(2)).join(', ')}; wanted ${Q.p.map((v) => v.toFixed(2)).join(', ')}) and keeps it in that slice (${off.toExponential(1)} mm off its plane)`);
  await page.mouse.move(X + 20, Y + 20); await page.mouse.wheel(0, 100); await page.waitForTimeout(150); await page.mouse.wheel(0, 100); await page.waitForTimeout(250);
  const s3 = await state(), d3 = [0, 1, 2].map((i) => s3.w[i] - s2.w[i]);
  ok(near(d3, Q.n.map((x) => -2 * Q.s * x), 1e-6), `two scroll steps over it move the cross-hair two steps of ${Q.s} mm along its normal (${d3.map((v) => v.toFixed(3)).join(', ')})`);
  await page.evaluate(() => { const s = APP.views.co.slider; s.value = String(+s.value + 4); s.dispatchEvent(new Event('input')); }); await page.waitForTimeout(250);
  const s4 = await state(), d4 = [0, 1, 2].map((i) => s4.w[i] - s3.w[i]);
  ok(near(d4, Q.n.map((x) => 4 * Q.s * x), 0.31 * Q.s) && Math.abs(Math.hypot(...d4) - 4 * Q.s) < 0.51 * Q.s, `its slider moves it along the normal too (4 steps: ${Math.hypot(...d4).toFixed(2)} mm)`);

  // ── a known distance on a turned slice: the jaw's outer width along the line this plane makes half way down the bone ──
  await page.evaluate((p) => { APP.S.cur = APP.D.voxelOf(APP.S.vol, ...p).map(Math.round); APP.crossChanged(); }, [0, 4, -8.5]); await page.click('#vFit'); await page.waitForTimeout(500);
  const edge = await page.evaluate((z) => {
    const v = APP.views.co, V = APP.S.vol, o = APP.obl(v), bf = APP.S.demo.boneField, C = APP.fromVox(v, ...APP.S.cur), b = C[1], [, Ys] = APP.toScreen(v, 0, b);
    const cr = v.cv.getBoundingClientRect(), pr = v.cv.width / cr.width, row = v.ctx.getImageData(0, Math.round(Ys * pr) + 3, v.cv.width, 1).data, g = []; for (let x = 0; x < v.cv.width; x++) g.push(row[4 * x]);
    const b2 = APP.fromScreen(v, 0, Ys + 3 / pr)[1], W = APP.S.win, grey = (val) => ((val - (W.l - W.w / 2)) / W.w) * 255, half = (grey(1300) + grey(60)) / 2;
    let L = -1, R = -1; for (let x = 1; x < g.length; x++) if (g[x - 1] < half && g[x] >= half) { L = x - 1 + (half - g[x - 1]) / (g[x] - g[x - 1]); break; }
    for (let x = g.length - 1; x > 0; x--) if (g[x] < half && g[x - 1] >= half) { R = x - 1 + (g[x - 1] - half) / (g[x - 1] - g[x]); break; }
    // the truth: where the bone's surface crosses this line of the plane, from the phantom's own geometry
    const at = (aa) => bf(...APP.obPt(o, aa, b2)), ins = []; for (let aa = 0; aa <= o.Wu; aa += 0.02) if (at(aa) < 0) ins.push(aa);
    const ref = (x0, x1) => { for (let it = 0; it < 50; it++) { const m = (x0 + x1) / 2; if ((at(m) < 0) === (at(x0) < 0)) x0 = m; else x1 = m; } return (x0 + x1) / 2; };
    const a0 = ref(ins[0] - 0.02, ins[0]), a1 = ref(ins[ins.length - 1] + 0.02, ins[ins.length - 1]);
    return { L: L / pr + cr.left, R: R / pr + cr.left, Y: Ys + 3 / pr + cr.top, trueW: a1 - a0, pts: [APP.obPt(o, a0, b2), APP.obPt(o, a1, b2)] };
  }, -8.5);
  await page.click('#cbTool [data-v=dist]'); await page.mouse.click(edge.L, edge.Y); await page.mouse.click(edge.R, edge.Y); await page.waitForTimeout(300);
  const m = await page.evaluate(() => APP.S.measures[APP.S.measures.length - 1]);
  ok(m && m.kind === 'dist' && /^obco:/.test(m.key) && Math.abs(m.value - edge.trueW) < 0.4 && edge.trueW > 20, `Distance tool across the jaw on the turned coronal slice: ${m && m.value.toFixed(2)} mm; true ${edge.trueW.toFixed(2)} mm along that line (from ${edge.pts[0].map((v) => v.toFixed(1))} to ${edge.pts[1].map((v) => v.toFixed(1))})`);
  await page.screenshot({ path: OUT + 't8-measure.png' });
  await page.click('#cbTool [data-v=browse]');

  // ── keys: ] and [ turn the selected slice's lines by 1°, 0.1° with Shift ──
  const k0 = (await state()).ang.ax; await page.evaluate(() => APP.views.ax.cv.focus());
  await page.keyboard.press('BracketRight'); await page.keyboard.press('BracketRight'); await page.keyboard.press('Shift+BracketLeft'); await page.waitForTimeout(250);
  const k1 = (await state()).ang.ax; ok(Math.abs(k1 - k0 - 1.9) < 1e-6, `] ] and Shift + [ in the axial slice: ${k0.toFixed(2)}° → ${k1.toFixed(2)}°`);
  await page.keyboard.press('BracketLeft'); await page.keyboard.press('BracketLeft'); await page.keyboard.press('Shift+BracketRight'); await page.waitForTimeout(250);

  // ── a second turn, in the coronal slice: the axial slice tilts; all three stay square ──
  const t0 = await state(); await turn('co', -15, 1); const t1 = await state();
  const tilt = Math.acos(Math.abs(dot(t1.fr.ax.n, [0, 0, 1]))) / deg, orth = ['ax', 'co', 'sa'].map((k) => [dot(t1.fr[k].u, t1.fr[k].v), dot(t1.fr[k].u, t1.fr[k].n), dot(t1.fr[k].v, t1.fr[k].n), Math.hypot(...t1.fr[k].u) - 1, Math.hypot(...t1.fr[k].n) - 1]).flat().map(Math.abs);
  const sq = [dot(t1.fr.ax.n, t1.fr.co.n), dot(t1.fr.ax.n, t1.fr.sa.n), dot(t1.fr.co.n, t1.fr.sa.n)].map(Math.abs), mv = ['ax', 'co', 'sa'].map((k) => Math.hypot(t1.scr[k][0] - t0.scr[k][0], t1.scr[k][1] - t0.scr[k][1]));
  ok(Math.abs(tilt - 15) < 0.6 && JSON.stringify(t1.fr.co) === JSON.stringify(t0.fr.co) && Math.max(...orth) < 1e-9 && Math.max(...sq) < 1e-9 && /Axial · oblique (14\.[5-9]|15\.[0-5])°/.test(t1.lab.ax) && Math.max(...mv) < 0.01,
    `15° the other way in the coronal slice tilts the axial plane ${tilt.toFixed(2)}° (“${t1.lab.ax}”); the coronal plane stays; planes square to ${Math.max(...sq).toExponential(1)}; cross-hair still (${Math.max(...mv).toFixed(3)} px)`);
  const QA = await page.evaluate(() => { const v = APP.views.ax, o = APP.obl(v), [aa, bb] = APP.fromVox(v, ...APP.S.cur); return APP.obPt(o, aa - 9, bb + 6, o.t); });
  [X, Y] = await screenOf(page, 'ax', QA); await page.mouse.click(X, Y); await page.waitForTimeout(250);
  const t2 = await state(); ok(near(t2.w, QA, 0.2), `a tap on the tilted axial slice goes where it points (${t2.w.map((v) => v.toFixed(2)).join(', ')}; wanted ${QA.map((v) => v.toFixed(2)).join(', ')})`);
  const pl = await page.evaluate(() => APP.r3objs.planes.map((l) => { const g = l.geometry, at = g.attributes.instanceStart || g.attributes.position, arr = at.data ? at.data.array : at.array, st = at.data ? at.data.stride : 3, pts = []; for (let i = 0; i + 2 < arr.length; i += st) pts.push([arr[i], arr[i + 1], arr[i + 2]]); return pts; }));
  const onPl = await page.evaluate((pl) => ['ax', 'co', 'sa'].map((k, i) => Math.max(...pl[i].map((p) => APP.planeDist(APP.views[k], p)))), pl);
  ok(pl.length === 3 && pl.every((p) => p.length >= 3) && Math.max(...onPl) < 1e-3, `the three slices’ outlines in the 3D view lie on their turned planes (${pl.map((p) => p.length).join(', ')} points, furthest ${Math.max(...onPl).toExponential(1)} mm off)`);

  // ── the tooth found shows on turned slices where the true tooth is ──
  await page.click('.step[data-id=tooth] h3'); await a.idle();
  const tooth = await page.evaluate(() => { const t = APP.D.phantomTeeth().find((x) => x.name === '45' || x.name === 45); return { p: [0, 1, 2].map((q) => t.base[q] + t.w[q] * t.crown * 0.3) }; });
  await page.evaluate((p) => { APP.S.cur = APP.D.voxelOf(APP.S.vol, ...p).map(Math.round); APP.crossChanged(); }, tooth.p); await page.waitForTimeout(300);
  [X, Y] = await screenOf(page, 'ax', tooth.p); await page.mouse.click(X, Y); await a.idle(); await page.waitForFunction(() => APP.S.tooth.seg && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 }); await page.waitForTimeout(600);
  const tt = await page.evaluate(() => {
    const t = APP.D.phantomTeeth().find((x) => String(x.name) === '45'), f = APP.D.phantomToothField(t), sg = APP.S.tooth.seg, out = { err: sg.error || null, seed: APP.S.tooth.seeds[0], views: {} };
    for (const k of ['ax', 'co', 'sa']) {
      const v = APP.views[k], g = APP.geom(v), o = g.ob, d = v.off.getContext('2d').getImageData(0, 0, g.cols, g.rows).data; let tinted = 0, truth = 0, both = 0;
      for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) { const q = 4 * (r * g.cols + c), isT = d[q + 1] > d[q] + 25 && d[q + 1] > 100, P = APP.obPt(o, (c + 0.5) * o.su, (r + 0.5) * o.sv), isIn = f(...P) < 0; if (isT) tinted++; if (isIn) truth++; if (isT && isIn) both++; }
      const cr = v.cv.getBoundingClientRect(), pr = v.cv.width / cr.width, sc = v.ctx.getImageData(0, 0, v.cv.width, v.cv.height).data; let roi = 0; for (let q = 0; q < sc.length; q += 4) if (Math.abs(sc[q] - 56) < 40 && Math.abs(sc[q + 1] - 189) < 40 && sc[q + 2] > 215) roi++;
      out.views[k] = { tinted, truth, both, mm2: tinted * o.su * o.sv, roi, ob: !!o };
    }
    return out;
  });
  ok(!tt.err && near(tt.seed, tooth.p, 0.3), `tooth 45 picked with a tap on the tilted axial slice (seed at ${tt.seed.map((v) => v.toFixed(2)).join(', ')})`);
  for (const k of ['ax', 'co', 'sa']) { const w = tt.views[k]; ok(w.ob && w.truth > 150 && w.both / w.truth > 0.85 && w.both / w.tinted > 0.85 && w.roi > 30, `${k}: the tooth is tinted on the turned slice where the true tooth is (${w.tinted} px tinted, ${w.truth} px truly tooth, ${w.both} both; ${w.mm2.toFixed(1)} mm²) and the region’s outline is drawn (${w.roi} px)`); }
  await page.screenshot({ path: OUT + 't8-tooth-turned.png' });

  // ── the angles are kept in a saved case ──
  const saved = await page.evaluate(() => { const c = new APP.N.DentalCase(); APP.extendCase(c); window.__c = c; return c.data.cbct.frames; });
  await page.evaluate(() => APP.straighten()); await page.waitForTimeout(200);
  const st1 = await state(); await page.evaluate(() => APP.readCase(window.__c)); await page.waitForTimeout(600); await a.idle();
  const st2 = await state();
  ok(saved && !st1.btn && st2.btn && ['ax', 'co', 'sa'].every((k) => ['u', 'v', 'n'].every((e) => near(st2.fr[k][e], saved[k][e], 1e-9))), 'the turned planes are saved in the case and come back when it is read');

  // ── back to straight: dragging to within half a degree settles on it exactly; Straighten; the pictures are as they were ──
  await page.evaluate(() => APP.shell.goto('view')); await a.idle(); await page.evaluate(() => APP.straighten()); await page.waitForTimeout(200);
  await turn('ax', 20); const b1 = await state(); await turn('ax', -19.7, 2); const b2 = await state();
  ok(Math.abs(b1.ang.ax - 20) < 0.6 && b2.ang.ax === 0 && !b2.btn && JSON.stringify(b2.fr) === JSON.stringify(s0.fr), `turned 20° then dragged back to within 0.3°: the lines settle on straight exactly (${b1.ang.ax.toFixed(2)}° → ${b2.ang.ax}°) and the slices are the scan’s own again`);
  await turn('sa', 25); await turn('co', 10); const b3 = await state(); await page.click('#cbStraight'); await page.waitForTimeout(300);
  await page.evaluate((p) => { APP.S.cur = APP.D.voxelOf(APP.S.vol, ...p).map(Math.round); APP.crossChanged(); }, P0); await page.waitForTimeout(400);
  const b4 = await state(), h1 = { ax: await hashOf('ax'), co: await hashOf('co'), sa: await hashOf('sa') };
  ok(b3.btn && !b4.btn && JSON.stringify(b4.fr) === JSON.stringify(s0.fr) && !/oblique|lines/.test(Object.values(b4.lab).join()), `after turns in the sagittal and coronal slices, the Straighten button puts all three back (“${b4.lab.ax}” · “${b4.lab.co}” · “${b4.lab.sa}”)`);
  const errs = a.errors.filter((e) => !/font/.test(e)); ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await a.close();

  // ── with a finger: a handle is caught within a fingertip and turns the lines ──
  const b = await open({ width: 820, height: 1180, touch: true }), pg = b.page; await b.demo(); await pg.evaluate(() => APP.shell.goto('view')); await b.idle(); await pg.waitForTimeout(500);
  const H = await pg.evaluate(() => { const v = APP.views.ax, r = v.cv.getBoundingClientRect(), c = APP.toScreen(v, ...APP.fromVox(v, ...APP.S.cur)), h = APP.handles(v)[0]; return { c: [r.left + c[0], r.top + c[1]], p: [r.left + h.p[0], r.top + h.p[1]] }; });
  const cdp = await pg.context().newCDPSession(pg), touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const R = Math.hypot(H.p[0] - H.c[0], H.p[1] - H.c[1]), a0 = Math.atan2(H.p[1] - H.c[1], H.p[0] - H.c[0]), at = (t, d = 0) => [H.c[0] + (R + d) * Math.cos(t), H.c[1] + (R + d) * Math.sin(t)];
  await touch('touchStart', [at(a0 + 0.06, 9)]); for (let i = 1; i <= 12; i++) { await touch('touchMove', [at(a0 + 0.06 - 18 * deg * i / 12, 9)]); await pg.waitForTimeout(25); } await touch('touchEnd', []); await pg.waitForTimeout(400);
  const f1 = await pg.evaluate(() => ({ ang: APP.lineAngle('ax'), lab: APP.views.co.lab.textContent, rot: APP.S.rotating }));
  ok(Math.abs(f1.ang + 18) < 0.8 && /oblique 1[78]\./.test(f1.lab) && !f1.rot, `a finger put down 13 px off a handle and swept 18° the other way turns the lines to ${f1.ang.toFixed(2)}° (“${f1.lab}”)`);
  await pg.screenshot({ path: OUT + 't8-tablet.png' });
  const errs2 = b.errors.filter((e) => !/font/.test(e)); ok(errs2.length === 0, 'no page errors on the tablet ' + errs2.slice(0, 3).join(' | '));
  await b.close();
})().catch((e) => { console.error(e); process.exitCode = 1; });
