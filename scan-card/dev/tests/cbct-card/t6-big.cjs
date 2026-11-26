// t6-big: a scan the size of a large CBCT — 600 × 600 × 500 voxels of 0.15 mm (360 MB as 16-bit), the phantom inside air —
// opened in the page; how long each thing takes: opening (histogram, windows, the 3D texture), drawing each slice, scrolling,
// the 3D view, proposing the arch, the panoramic, a donor tooth and its replica. Everything must finish and stay usable.
const { open, ok, OUT, screenOf } = require('./lib.cjs');
(async () => {
  const a = await open(), { page } = a;
  const made = await page.evaluate(async () => {
    const D = APP.D, ph = D.makePhantom({ voxel: 0.3 }).vol, n = [600, 600, 500], h = 0.15, data = new Int16Array(n[0] * n[1] * n[2]);
    const lo = [0, 1, 2].map((q) => ph.origin[q] + ((ph.dims[q] - 1) * ph.spacing[q]) / 2 - ((n[q] - 1) * h) / 2), idx = [0, 1, 2].map((q) => { const m = new Int32Array(n[q]); for (let i = 0; i < n[q]; i++) { const f = Math.round((lo[q] + i * h - ph.origin[q]) / ph.spacing[q]); m[i] = f >= 0 && f < ph.dims[q] ? f : -1; } return m; });
    const [X, Y, Z] = idx, pd = ph.data, PX = ph.dims[0], PY = ph.dims[1];
    for (let k = 0; k < n[2]; k++) { const kk = Z[k]; for (let j = 0; j < n[1]; j++) { const jj = Y[j], o = n[0] * (j + n[1] * k); if (kk < 0 || jj < 0) { data.fill(-1000, o, o + n[0]); continue; } const b = PX * (jj + PY * kk); for (let i = 0; i < n[0]; i++) data[o + i] = X[i] < 0 ? -1000 : pd[b + X[i]]; } }
    let min = 32767, max = -32768; for (let i = 0; i < data.length; i += 7) { const v = data[i]; if (v < min) min = v; if (v > max) max = v; }
    const vol = { data, dims: n, spacing: [h, h, h], origin: lo, min: Math.min(min, ph.min), max: Math.max(max, ph.max), shift: 0, modality: 'CT', date: '', compression: 'made up', warnings: [] };
    const t0 = performance.now(); APP.setVolume(vol); APP.S.demo = null; const tOpen = performance.now() - t0;
    return { mb: data.byteLength / 1048576, tOpen, tex: APP.box3 ? APP.box3.material.uniforms.uVol.value.image.width + '×' + APP.box3.material.uniforms.uVol.value.image.height + '×' + APP.box3.material.uniforms.uVol.value.image.depth : '' };
  });
  await page.waitForTimeout(1500);
  ok(made.tOpen < 15000, `a ${made.mb.toFixed(0)} MB volume (600 × 600 × 500) set up in ${(made.tOpen / 1000).toFixed(1)} s (histogram, windows, 3D texture ${made.tex})`);
  // time real redraws: change the slice and wait for the frame
  const times = await page.evaluate(async () => {
    const res = {}; const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    for (const id of ['ax', 'co', 'sa']) { const ax = id === 'ax' ? 2 : id === 'co' ? 1 : 0, ts = []; for (let r = 0; r < 5; r++) { APP.S.cur[ax] = 150 + r * 23; const t = performance.now(); APP.crossChanged(); await frame(); ts.push(performance.now() - t); } ts.sort((p, q) => p - q); res[id] = ts[2]; }
    return res;
  });
  ok(times.ax < 400 && times.co < 400 && times.sa < 400, `moving the cross-hair redraws all three slices and the 3D planes: median ${times.ax.toFixed(0)} / ${times.co.toFixed(0)} / ${times.sa.toFixed(0)} ms (moving axial / coronal / sagittal)`);
  // scrolling the coronal slice with the wheel, 10 steps
  const box = await page.evaluate(() => { const r = APP.views.co.cv.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.move(box[0], box[1]); const j0 = await page.evaluate(() => Math.round(APP.S.cur[1])), t1 = Date.now();
  for (let s = 0; s < 10; s++) await page.mouse.wheel(0, 100);
  await page.waitForFunction((j) => Math.round(APP.S.cur[1]) === j - 10, j0, { timeout: 30000 }); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  ok(Date.now() - t1 < 6000, `ten scroll steps through the coronal slices: ${Date.now() - t1} ms in all`);
  const t3 = await page.evaluate(() => { const t = performance.now(); APP.viewer.snapshot(); return performance.now() - t; });
  ok(t3 < 30000, `one 3D (MIP) frame: ${t3.toFixed(0)} ms (software WebGL here; a real GPU is far quicker)`);
  // the panoramic
  await page.click('.step[data-id=pano] h3'); await a.idle(); let t = Date.now(); await page.click('#pPropose'); await a.idle(); await page.waitForFunction(() => APP.S.pano, null, { timeout: 120000 });
  const tp = await page.evaluate(() => { const t = performance.now(); APP.makePano(); return { ms: performance.now() - t, cols: APP.S.pano.cols, rows: APP.S.pano.rows, pts: APP.S.arch.points.length }; });
  ok(tp.pts >= 5 && tp.ms < 5000, `arch proposed (${tp.pts} points, ${((Date.now() - t) / 1000).toFixed(1)} s with the panoramic); the panoramic alone, ${tp.cols} × ${tp.rows} with a 10 mm slab, in ${tp.ms.toFixed(0)} ms`);
  await page.waitForTimeout(600); await page.screenshot({ path: OUT + 't6-big-pano.png' });
  // a donor tooth and its replica
  await page.click('.step[data-id=tooth] h3'); await a.idle();
  const seed = await page.evaluate(() => { const D = APP.D, t = D.phantomTeeth().find((x) => x.name === 45), p = [0, 1, 2].map((q) => t.base[q] + t.w[q] * t.crown * 0.3); APP.S.cur[2] = Math.round(D.voxelOf(APP.S.vol, 0, 0, p[2])[2]); APP.crossChanged(); return p; });
  await page.waitForTimeout(400); const [x, y] = await screenOf(page, 'ax', seed); t = Date.now(); await page.mouse.click(x, y); await a.idle(); await page.waitForFunction(() => APP.S.tooth.seg, null, { timeout: 300000 }); await a.idle();
  const sg = await page.evaluate(() => ({ v: APP.S.tooth.seg.volume, sp: APP.S.tooth.seg.vol.spacing, box: APP.S.tooth.seg.box }));
  const tSeg = Date.now() - t;
  ok(Math.abs(sg.v - 422) / 422 < 0.04 && tSeg < 60000, `donor tooth 45 found in ${(tSeg / 1000).toFixed(1)} s (both passes, region fitted, preview mesh): ${sg.v.toFixed(0)} mm³ (true 422), worked on ${sg.sp[0]} mm voxels, box ${sg.box.nx}×${sg.box.ny}×${sg.box.nz}`);
  await page.click('.step[data-id=replica] h3'); await a.idle(); t = Date.now(); await page.click('#rMake'); await a.idle(); await page.waitForFunction(() => APP.S.rep.info, null, { timeout: 300000 });
  const ri = await page.evaluate(() => APP.S.rep.info);
  ok(ri.closed && Math.abs(ri.volume - 422) / 422 < 0.04, `replica in ${((Date.now() - t) / 1000).toFixed(1)} s: ${ri.volume.toFixed(0)} mm³, closed, ${ri.tris.toLocaleString()} triangles`);
  await page.waitForTimeout(600); await page.screenshot({ path: OUT + 't6-big-replica.png' });
  const errs = a.errors.filter((e) => !/font/.test(e)); ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await a.close();
})().catch((e) => { console.error(e); process.exitCode = 1; });
