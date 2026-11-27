// t5-replica: the donor tooth and its replica through the page, on the demo CBCT — tap 45 in the axial slice; the tooth found
// matches the true tooth; the replica (downloaded STL) is closed and matches the true tooth's volume and surface; enlarged by
// 0.3 mm it grows by its area × 0.3; with a handle it stays one closed piece; the file name carries the chosen tooth number.
// Then 35 (in tight contact with 36); a leak from too low a threshold, fixed with "Not tooth" taps; the eraser and Undo.
const { open, ok, OUT, screenOf } = require('./lib.cjs');
const fs = require('fs');
let N, D, THREE;
const trueVolume = (t, h = 0.06) => { const f = D.phantomToothField(t), R = Math.max(t.md, t.bl) / 2 + 3, lo = [t.base[0] - R, t.base[1] - R, t.base[2] - t.root - 2], hi = [t.base[0] + R, t.base[1] + R, t.base[2] + t.crown + 2]; let n = 0; for (let z = lo[2]; z < hi[2]; z += h) for (let y = lo[1]; y < hi[1]; y += h) for (let x = lo[0]; x < hi[0]; x += h) if (f(x, y, z) < 0) n++; return n * h * h * h; };
const trueSurface = (t, h = 0.12) => { const f = D.phantomToothField(t), R = Math.max(t.md, t.bl) / 2 + 3, lo = [t.base[0] - R, t.base[1] - R, t.base[2] - t.root - 2], n = [Math.ceil(2 * R / h), Math.ceil(2 * R / h), Math.ceil((t.root + t.crown + 4) / h)], F = new Float32Array(n[0] * n[1] * n[2]); for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) F[i + n[0] * (j + n[1] * k)] = f(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h); return N.isoMesh(F, n[0], n[1], n[2], lo, h); };
function readStl(file) { const b = fs.readFileSync(file); return N.cleanMesh(N.parseMesh(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), 'stl'), { keepIslands: true }).mesh; }
function compare(mesh, t) {
  const f = D.phantomToothField(t), out = []; for (let i = 0; i < mesh.positions.length; i += 3) out.push(Math.abs(f(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]))); out.sort((a, b) => a - b);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.indices), 1));
  const bvh = new N.MeshBVH(g), hit = {}, v = new THREE.Vector3(), ts = trueSurface(t), back = []; for (let i = 0; i < ts.positions.length; i += 3) { bvh.closestPointToPoint(v.set(ts.positions[i], ts.positions[i + 1], ts.positions[i + 2]), hit); back.push(hit.distance); } back.sort((a, b) => a - b);
  const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))]; return { med: q(out, 0.5), p95: q(out, 0.95), back95: q(back, 0.95), back99: q(back, 0.99), max: back[back.length - 1] };
}
(async () => {
  N = await import('/home/claude/suite/shared/core.js'); D = await import('/home/claude/suite/shared/dicom.js'); THREE = N.THREE;
  const teeth = Object.fromEntries(D.phantomTeeth().map((t) => [t.name, t])), TV = { 45: trueVolume(teeth[45]), 35: trueVolume(teeth[35]) };
  const a = await open(), { page } = a; await a.demo();
  await page.click('.step[data-id=tooth] h3'); await a.idle();
  const tapTooth = async (fdi, tool = null) => {
    const t = teeth[fdi], p = [0, 1, 2].map((q) => t.base[q] + t.w[q] * t.crown * 0.3);
    await page.evaluate((z) => { APP.S.cur[2] = Math.round(APP.D.voxelOf(APP.S.vol, 0, 0, z)[2]); APP.crossChanged(); }, p[2]); await page.waitForTimeout(250);
    if (tool) await page.click(`#cbTool [data-v=${tool}]`);
    const [x, y] = await screenOf(page, 'ax', p); await page.mouse.click(x, y); await a.idle(); await page.waitForFunction(() => APP.S.tooth.seg && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 }); await page.waitForTimeout(400);
    return page.evaluate(() => { const s = APP.S.tooth.seg; return s.error ? { error: s.error } : { volume: s.volume, touch: s.touch, roi: APP.S.tooth.roi, T: APP.S.tooth.T, crown: s.crown, axis: s.axis, length: s.length }; });
  };
  ok((await page.evaluate(() => document.querySelector('#cbTool .on').dataset.v)) === 'tooth', 'the Pick a tooth step starts with “Pick tooth” selected');
  let s = await tapTooth(45);
  ok(!s.error && Math.abs(s.volume - TV[45]) / TV[45] < 0.03 && s.touch === 0 && s.crown * s.axis[2] > 0, `45 tapped in the axial slice: ${s.volume && s.volume.toFixed(0)} mm³ of voxels (true ${TV[45].toFixed(0)} mm³), threshold ${s.T} (from the tooth's own brightness), crown up, length ${s.length && s.length.toFixed(1)} mm, region fitted to r ${s.roi && s.roi.r} mm, z ${s.roi && s.roi.z0.toFixed(1)} … ${s.roi && s.roi.z1.toFixed(1)}`);
  await page.screenshot({ path: OUT + 't5-tooth45.png' });
  // the replica
  await page.click('.step[data-id=replica] h3'); await a.idle(); await page.selectOption('#rFdi', '45'); await page.click('#rMake'); await a.idle(); await page.waitForFunction(() => APP.S.rep.info, null, { timeout: 120000 });
  let info = await page.evaluate(() => APP.S.rep.info);
  let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#rStl')]); let file = OUT + 't5-replica-45.stl'; await dl.saveAs(file);
  let m = readStl(file), c = compare(m, teeth[45]), mv = N.meshVolume(m);
  ok(dl.suggestedFilename() === 'tooth-replica-45.stl' && N.isWatertight(m) && Math.abs(mv - TV[45]) / TV[45] < 0.03 && c.med < 0.08 && c.p95 < 0.2 && c.back99 < 0.4,
    `replica ${dl.suggestedFilename()}: closed ${N.isWatertight(m)}, ${mv.toFixed(0)} mm³ (true ${TV[45].toFixed(0)}, ${((mv - TV[45]) / TV[45] * 100).toFixed(1)}%); replica→true median ${c.med.toFixed(3)}, 95% ${c.p95.toFixed(3)} mm; true→replica 95% ${c.back95.toFixed(3)}, 99% ${c.back99.toFixed(3)}, max ${c.max.toFixed(2)} mm; made in ${info.seconds.toFixed(1)} s`);
  await page.waitForTimeout(800); await page.screenshot({ path: OUT + 't5-replica45.png' });
  const area = N.meshArea(m);
  await page.evaluate(() => { const i = document.querySelector('#rPdl'); i.value = 0.3; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); });
  await page.waitForFunction(() => APP.S.rep.info && APP.S.rep.info.pdl === 0.3, null, { timeout: 120000 }); await a.idle();
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#rStl')]); file = OUT + 't5-replica-45-pdl.stl'; await dl.saveAs(file);
  const me = readStl(file), ev = N.meshVolume(me), want = mv + area * 0.3;
  ok(N.isWatertight(me) && Math.abs(ev - want) / want < 0.025, `enlarged by 0.3 mm: ${ev.toFixed(0)} mm³, closed ${N.isWatertight(me)} (expected about ${want.toFixed(0)}: ${mv.toFixed(0)} + ${area.toFixed(0)} mm² × 0.3)`);
  await page.evaluate(() => { const i = document.querySelector('#rPdl'); i.value = 0; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); }); await page.waitForFunction(() => APP.S.rep.info && APP.S.rep.info.pdl === 0, null, { timeout: 120000 }); await a.idle();
  await page.check('#rHandle'); await page.waitForFunction(() => APP.S.rep.info && APP.S.rep.info.handle, null, { timeout: 120000 }); await a.idle();
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#rStl')]); file = OUT + 't5-replica-45-handle.stl'; await dl.saveAs(file);
  const mh = readStl(file), top = Math.max(...Array.from({ length: mh.positions.length / 3 }, (_, i) => mh.positions[3 * i + 2])), tip = teeth[45].base[2] + teeth[45].crown, peg = Math.PI * 1.5 * 1.5 * 8;
  ok(N.isWatertight(mh) && N.splitParts(mh).length === 1 && top > tip + 6 && Math.abs(N.meshVolume(mh) - mv - peg) < 0.3 * peg, `with a handle (3 × 8 mm): one closed piece, ${N.meshVolume(mh).toFixed(0)} mm³, reaching ${(top - tip).toFixed(1)} mm above the crown tip`);
  await page.waitForTimeout(800); await page.screenshot({ path: OUT + 't5-replica45-handle.png' });
  await page.uncheck('#rHandle'); await a.idle();
  // 35, which touches 36
  await page.click('.step[data-id=tooth] h3'); await a.idle(); await page.click('#dClear');
  s = await tapTooth(35);
  ok(!s.error && Math.abs(s.volume - TV[35]) / TV[35] < 0.03, `35 (in tight contact with 36): ${s.volume && s.volume.toFixed(0)} mm³ (true ${TV[35].toFixed(0)})`);
  await page.screenshot({ path: OUT + 't5-tooth35.png' });
  // a leak: threshold set too low, then three "Not tooth" taps where it went
  await page.evaluate(() => { const i = document.querySelector('#dT'); i.value = 600; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); }); await a.idle(); await page.waitForTimeout(300);
  const leak = await page.evaluate(() => APP.S.tooth.seg.volume);
  const spots = await page.evaluate(() => { const s = APP.S.tooth.seg, t = APP.S.demo.teeth.find((x) => x.name === 35), f = APP.D.phantomToothField(t), ex = []; const { lab, box } = s; for (let k = 0; k < box.nz; k++) for (let j = 0; j < box.ny; j++) for (let i = 0; i < box.nx; i++) if (lab[i + box.nx * (j + box.ny * k)]) { const p = APP.D.worldOf(APP.S.vol, box.i0 + i, box.j0 + j, box.k0 + k); if (f(...p) > 0.5) ex.push(p); } ex.sort((a, b) => a[2] - b[2]); return ex.length ? [0.25, 0.5, 0.75].map((q) => ex[Math.floor(q * ex.length)]) : []; });
  await page.click('#cbTool [data-v=not]');
  for (const p of spots) { await page.evaluate((z) => { APP.S.cur[2] = Math.round(APP.D.voxelOf(APP.S.vol, 0, 0, z)[2]); APP.crossChanged(); }, p[2]); await page.waitForTimeout(200); const [x, y] = await screenOf(page, 'ax', p); await page.mouse.click(x, y); await a.idle(); await page.waitForTimeout(300); }
  const fixed = await page.evaluate(() => ({ v: APP.S.tooth.seg.volume, n: APP.S.tooth.not.length }));
  ok(leak > TV[35] * 1.08 && fixed.n === 3 && Math.abs(fixed.v - TV[35]) / TV[35] < 0.04, `threshold 600 leaks into the bone (${leak.toFixed(0)} mm³); three “Not tooth” taps where it leaked bring it back to ${fixed.v.toFixed(0)} mm³ (true ${TV[35].toFixed(0)})`);
  await page.screenshot({ path: OUT + 't5-leak-fixed.png' });
  // the eraser cuts, Undo puts it back
  const before = fixed.v, t35 = teeth[35], pc = [0, 1, 2].map((q) => t35.base[q] + t35.w[q] * t35.crown * 0.8);
  await page.evaluate((z) => { APP.S.cur[2] = Math.round(APP.D.voxelOf(APP.S.vol, 0, 0, z)[2]); APP.crossChanged(); }, pc[2]); await page.waitForTimeout(200);
  await page.click('#cbTool [data-v=erase]'); const u = t35.u, A = await screenOf(page, 'ax', [pc[0] - 4 * u[0], pc[1] - 4 * u[1], pc[2]]), B = await screenOf(page, 'ax', [pc[0] + 4 * u[0], pc[1] + 4 * u[1], pc[2]]);
  await page.mouse.move(A[0], A[1]); await page.mouse.down(); await page.mouse.move(B[0], B[1], { steps: 12 }); await page.mouse.up(); await a.idle(); await page.waitForTimeout(400);
  const cut = await page.evaluate(() => ({ v: APP.S.tooth.seg.volume, n: APP.S.tooth.erase.length }));
  await page.click('#dUndo'); await a.idle(); await page.waitForTimeout(400);
  const back = await page.evaluate(() => ({ v: APP.S.tooth.seg.volume, n: APP.S.tooth.erase.length }));
  ok(cut.n > 3 && cut.v < before - 5 && back.n === 0 && Math.abs(back.v - before) < 0.5, `a stroke of the eraser across the crown: ${cut.n} marks, ${before.toFixed(0)} → ${cut.v.toFixed(0)} mm³; Undo: ${back.v.toFixed(0)} mm³`);
  const errs = a.errors.filter((e) => !/font/.test(e)); ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await a.close();
})().catch((e) => { console.error(e); process.exitCode = 1; });
