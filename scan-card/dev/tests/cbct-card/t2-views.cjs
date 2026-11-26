// t2-views: the demo CBCT in the slices — window presets give the right grey for known voxels (in the image and on screen);
// the cross-hair links the three slices; scrolling, zoom about the pointer and panning; a distance measured with the
// Distance tool between bone edges found in the rendered pixels matches the phantom's true width; an angle.
const { open, ok, OUT, screenOf } = require('./lib.cjs');
(async () => {
  const a = await open(), { page } = a; await a.demo();
  // ── windows: a voxel deep in spongy bone and one in enamel, shown in every preset ──
  await page.evaluate(() => APP.shell.goto('view')); await a.idle();
  const probe = await page.evaluate(() => {
    const V = APP.S.vol, [nx, ny, nz] = V.dims, d = V.data, at = (i, j, k) => d[i + nx * (j + ny * k)];
    const find = (lo, hi) => { for (let k = 10; k < nz - 10; k += 3) for (let j = 5; j < ny - 5; j += 2) for (let i = 5; i < nx - 5; i += 2) { const v = at(i, j, k); if (v < lo || v > hi) continue; let ok = true; for (let c = -2; c <= 2 && ok; c++) for (let b = -2; b <= 2 && ok; b++) for (let a = -2; a <= 2 && ok; a++) if (Math.abs(at(i + a, j + b, k + c) - v) > 120) ok = false; if (ok) return [i, j, k, v]; } return null; };
    return { spongy: find(450, 650), enamel: find(2650, 2950) };
  });
  for (const [name, q] of Object.entries(probe)) {
    const p = await page.evaluate((q) => APP.D.worldOf(APP.S.vol, q[0], q[1], q[2]), q);
    await page.evaluate((q) => { APP.S.cur = q.slice(0, 3); APP.crossChanged(); }, q);
    for (const preset of ['bone', 'teeth', 'soft', 'full']) {
      await page.click(`#vPreset [data-v=${preset}]`); await page.waitForTimeout(250);
      const [X, Y] = await screenOf(page, 'ax', [p[0] + 0.03, p[1] + 0.03, p[2]]);       // the voxel's centre (the cross-hair leaves a gap there)
      const r = await page.evaluate(([q, X, Y]) => {
        const W = APP.S.win, want = Math.max(0, Math.min(255, ((q[3] - (W.l - W.w / 2)) / W.w) * 255)), v = APP.views.ax;
        const img = v.off.getContext('2d').getImageData(q[0], q[1], 1, 1).data[0], cr = v.cv.getBoundingClientRect(), pr = v.cv.width / cr.width, scr = v.ctx.getImageData(Math.round((X - cr.left) * pr), Math.round((Y - cr.top) * pr), 1, 1).data[0];
        return { want, img, scr, W };
      }, [q, X, Y]);
      ok(Math.abs(r.img - r.want) <= 1 && Math.abs(r.scr - r.want) <= 4, `${name} voxel (${q[3]}) in the ${preset} window ${r.W.l}/${r.W.w}: grey ${r.img} in the image, ${r.scr} on screen, expected ${r.want.toFixed(1)}`);
    }
  }
  // dragging with the Window tool: across widens, down lowers the level
  await page.click('#vPreset [data-v=bone]'); await page.click('#cbTool [data-v=window]');
  const w0 = await page.evaluate(() => ({ ...APP.S.win, span: Math.max(200, APP.S.vol.max - APP.S.vol.min) })), box = await page.evaluate(() => { const r = APP.views.co.cv.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.move(box[0], box[1]); await page.mouse.down(); await page.mouse.move(box[0] + 60, box[1] + 30, { steps: 5 }); await page.mouse.up();
  const w1 = await page.evaluate(() => APP.S.win);
  ok(Math.abs(w1.w - (w0.w + 60 * w0.span / 600)) < 2 && Math.abs(w1.l - (w0.l - 30 * w0.span / 600)) < 2, `window drag: ${w0.l}/${w0.w} → ${w1.l}/${w1.w}`);
  await page.click('#vPreset [data-v=bone]'); await page.click('#cbTool [data-v=browse]');
  // ── the cross-hair: a tap on the axial slice moves the coronal and sagittal slices there ──
  const P = [12.3, -18.6, -4.1];
  await page.evaluate((z) => { APP.S.cur[2] = APP.D.voxelOf(APP.S.vol, 0, 0, z)[2]; APP.crossChanged(); }, P[2]); await page.waitForTimeout(200);
  let [X, Y] = await screenOf(page, 'ax', P); await page.mouse.click(X, Y); X = Math.round(X); Y = Math.round(Y); await page.waitForTimeout(200);
  const c1 = await page.evaluate(() => ({ cur: APP.S.cur.slice(), w: APP.D.worldOf(APP.S.vol, ...APP.S.cur), co: APP.views.co.lab.textContent, sa: APP.views.sa.lab.textContent, read: document.querySelector('#cbRead').textContent }));
  ok(Math.abs(c1.w[0] - P[0]) < 0.2 && Math.abs(c1.w[1] - P[1]) < 0.2 && /y -18\.[5-7]/.test(c1.co) && /x 12\.[2-4]/.test(c1.sa), `tap on the axial at x ${P[0]}, y ${P[1]}: cross-hair at ${c1.w.map((v) => v.toFixed(2)).join(', ')}; ${c1.co} · ${c1.sa} · read-out “${c1.read}”`);
  const k0 = await page.evaluate(() => Math.round(APP.S.cur[2]));
  await page.mouse.move(X + 30, Y + 30); await page.mouse.wheel(0, 100); await page.waitForTimeout(150); await page.mouse.wheel(0, 100); await page.waitForTimeout(150);
  ok((await page.evaluate(() => Math.round(APP.S.cur[2]))) === k0 - 2, 'two scroll steps over the axial slice move it down two slices');
  // zoom about the pointer, pan with the right button
  const before = await page.evaluate(([X, Y]) => { const v = APP.views.ax, r = v.cv.getBoundingClientRect(); return { ab: APP.fromScreen(v, X - r.left, Y - r.top), z: v.z }; }, [X + 30, Y + 30]);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control'); await page.waitForTimeout(150);
  const after = await page.evaluate(([X, Y]) => { const v = APP.views.ax, r = v.cv.getBoundingClientRect(); return { ab: APP.fromScreen(v, X - r.left, Y - r.top), z: v.z }; }, [X + 30, Y + 30]);
  ok(after.z > before.z * 1.5 && Math.hypot(after.ab[0] - before.ab[0], after.ab[1] - before.ab[1]) < 0.05, `Ctrl + scroll zooms ${before.z.toFixed(2)} → ${after.z.toFixed(2)} px/mm and keeps the point under the pointer (${before.ab.map((v) => v.toFixed(2))} → ${after.ab.map((v) => v.toFixed(2))})`);
  await page.mouse.move(X, Y); await page.mouse.down({ button: 'right' }); await page.mouse.move(X - 40, Y + 25, { steps: 4 }); await page.mouse.up({ button: 'right' });
  const pan = await page.evaluate((c) => ({ dx: (APP.views.ax.cx - c[0]) * APP.views.ax.z, dy: (APP.views.ax.cy - c[1]) * APP.views.ax.z }), [0, 0]);
  await page.click('#vFit'); await page.waitForTimeout(300);
  // ── a known distance: the outer width of the jaw across both sides, at y = 8, half way down the bone ──
  const zMid = -8.5, yRow = 8;
  await page.evaluate((z) => { APP.S.cur[2] = APP.D.voxelOf(APP.S.vol, 0, 0, z)[2]; APP.crossChanged(); }, zMid); await page.waitForTimeout(400);
  const edge = await page.evaluate(([y, z]) => {
    const v = APP.views.ax, V = APP.S.vol, q = APP.D.voxelOf(V, 0, y, Math.round((z - V.origin[2]) / V.spacing[2]) * V.spacing[2] + V.origin[2]), [, b] = APP.fromVox(v, 0, q[1], 0), [, Ys] = APP.toScreen(v, 0, b);
    const cr = v.cv.getBoundingClientRect(), pr = v.cv.width / cr.width, row = v.ctx.getImageData(0, Math.round(Ys * pr), v.cv.width, 1).data, g = []; for (let x = 0; x < v.cv.width; x++) g.push(row[4 * x]);
    const W = APP.S.win, grey = (val) => ((val - (W.l - W.w / 2)) / W.w) * 255, half = (grey(1300) + grey(60)) / 2;   // half way between cortex and soft tissue
    let L = -1, R = -1; for (let x = 1; x < g.length; x++) if (g[x - 1] < half && g[x] >= half) { L = x - 1 + (half - g[x - 1]) / (g[x] - g[x - 1]); break; }
    for (let x = g.length - 1; x > 0; x--) if (g[x] < half && g[x - 1] >= half) { R = x - 1 + (g[x - 1] - half) / (g[x - 1] - g[x]); break; }
    // the truth: where the bone's surface crosses this line, from the phantom's own geometry
    const bf = APP.S.demo.boneField, zz = V.origin[2] + Math.round((z - V.origin[2]) / V.spacing[2]) * V.spacing[2], solve = (x0, x1) => { for (let it = 0; it < 60; it++) { const m = (x0 + x1) / 2; if ((bf(m, y, zz) < 0) === (bf(x0, y, zz) < 0)) x0 = m; else x1 = m; } return (x0 + x1) / 2; };
    return { L: L / pr + cr.left, R: R / pr + cr.left, Y: Ys + cr.top, trueW: solve(40, 0) - solve(-40, 0), xs: [solve(-40, 0), solve(40, 0)] };
  }, [yRow, zMid]);
  await page.click('#cbTool [data-v=dist]'); await page.mouse.click(edge.L, edge.Y); await page.mouse.click(edge.R, edge.Y); await page.waitForTimeout(300);
  const m = await page.evaluate(() => APP.S.measures[0]);
  ok(m && m.kind === 'dist' && Math.abs(m.value - edge.trueW) < 0.35, `Distance tool between the jaw’s outer edges found in the rendered slice: ${m && m.value.toFixed(2)} mm; true ${edge.trueW.toFixed(2)} mm (x ${edge.xs.map((x) => x.toFixed(2)).join(' … ')})`);
  // an angle: three taps at known points in the axial plane
  const A = [-20, -20, zMid], B = [0, -10, zMid], C = [15, 5, zMid], trueAng = (() => { const u = [A[0] - B[0], A[1] - B[1]], w = [C[0] - B[0], C[1] - B[1]]; return Math.acos((u[0] * w[0] + u[1] * w[1]) / (Math.hypot(...u) * Math.hypot(...w))) * 180 / Math.PI; })();
  await page.click('#cbTool [data-v=angle]'); for (const p of [A, B, C]) { const [x, y] = await screenOf(page, 'ax', p); await page.mouse.click(x, y); await page.waitForTimeout(80); }
  const ang = await page.evaluate(() => APP.S.measures[1] && APP.S.measures[1].value);
  ok(Math.abs(ang - trueAng) < 0.6, `Angle tool: ${ang && ang.toFixed(2)}° (true ${trueAng.toFixed(2)}°)`);
  await page.waitForTimeout(300); await page.screenshot({ path: OUT + 't2-measure.png' });
  const errs = a.errors.filter((e) => !/font/.test(e)); ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await a.close();
})().catch((e) => { console.error(e); process.exitCode = 1; });
