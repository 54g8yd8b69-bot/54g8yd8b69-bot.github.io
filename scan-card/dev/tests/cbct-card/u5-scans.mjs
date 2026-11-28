// u5-scans.mjs — an intraoral scan lined up with the CBCT (shared/dicom.js: scanReference, alignScan, meshCut,
// phantomScanField), in node. The phantom's lower teeth and gum, as a scanner would show them, are made from the same shapes
// as the phantom CBCT, so where the scan belongs is known exactly:
//   · handed over in "scanner" coordinates — turned any way and moved — it is put back by itself, each time;
//   · the same with the CBCT's head tilted (nodded, rolled and turned), as patients are;
//   · on three or more matching points, marked a little off, and after a nudge (the fine fit);
//   · as the wrong arch (upside-down) it is not passed as a fit, and a CBCT with no teeth gives a plain refusal;
//   · its outline in a slice (meshCut) lies in the slice's plane and on the scan's surface.
// Nothing here comes from a patient: the scan and the CBCT are made up.
//                 node dev/tests/cbct-card/u5-scans.mjs
import * as D from '../../../shared/dicom.js';
import * as N from '../../../shared/core.js';
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { fails++; process.exitCode = 1; } };
const T3 = N.THREE, t00 = Date.now(), secs = (t) => ((Date.now() - t) / 1000).toFixed(1);
const { vol } = D.makePhantom({ voxel: 0.3 }), f = D.phantomScanField({}), m0 = N.isoMesh(f.F, f.n[0], f.n[1], f.n[2], f.origin, f.h, {});
console.log(`phantom CBCT ${vol.dims.join('×')} and its scan (${(m0.indices.length / 3).toLocaleString('en-GB')} triangles) in ${secs(t00)} s`);
const rnd = (() => { let s = 20261128; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
const anyPose = () => new T3.Matrix4().makeRotationFromQuaternion(new T3.Quaternion(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize()).setPosition(60 * (rnd() - 0.5), 60 * (rnd() - 0.5), 60 * (rnd() - 0.5));
const moved = (S) => N.transformMesh({ positions: m0.positions.slice(), indices: m0.indices.slice() }, S);
/** how far the scan's points end from where they belong: M (found) · S (the scanner's pose) against W (the truth; identity when the CBCT is as made) */
const off = (M, S, W = new T3.Matrix4()) => { const E = M.clone().multiply(S).elements, G = W.elements, P = m0.positions; let mx = 0, sum = 0, n = 0; for (let v = 0; v < P.length; v += 30) { const x = P[v], y = P[v + 1], z = P[v + 2], d = Math.hypot(E[0] * x + E[4] * y + E[8] * z + E[12] - (G[0] * x + G[4] * y + G[8] * z + G[12]), E[1] * x + E[5] * y + E[9] * z + E[13] - (G[1] * x + G[5] * y + G[9] * z + G[13]), E[2] * x + E[6] * y + E[10] * z + E[14] - (G[2] * x + G[6] * y + G[10] * z + G[14])); if (d > mx) mx = d; sum += d; n++; } return { mean: sum / n, max: mx }; };

// ── the CBCT's own surface
let t = Date.now(); const ref = D.scanReference(vol, N);
ok(!ref.error && ref.mesh.indices.length > 50000 && ref.arch && ref.arch.points.length >= 5 && ref.dist && ref.dist.D.length === ref.dist.n[0] * ref.dist.n[1] * ref.dist.n[2] && ref.h >= 0.4, `the CBCT’s surface round the teeth: ${(ref.mesh.indices.length / 3).toLocaleString('en-GB')} triangles on a ${ref.h} mm grid at level ${ref.T}, with the arch line and the map of distances to enamel (${secs(t)} s)`);
{ let zero = 0, far = 0; for (const d of ref.dist.D) { if (d === 0) zero++; else if (d > 5) far++; } ok(zero > 2000 && far > 1000 && zero < ref.dist.D.length / 4, `that map is 0 in ${zero.toLocaleString('en-GB')} cells of enamel and grows away from them`); }

// ── by itself, from any pose the scanner may hand it over in
{
  const res = [];
  for (let i = 0; i < 4; i++) { const S = anyPose(), scan = moved(S); t = Date.now(); const r = D.alignScan(ref, scan, N, { jaw: 'lower' }); res.push({ r, o: r.error ? null : off(r.matrix, S), s: (Date.now() - t) / 1000 }); }
  ok(res.every((x) => !x.r.error && x.r.ok && x.r.how === 'auto' && x.r.oriented), `four scans, each turned and moved at random, are stood up and lined up by themselves (${res.map((x) => x.s.toFixed(1)).join(', ')} s)`);
  ok(res.every((x) => x.o && x.o.mean < 0.06 && x.o.max < 0.15), `each ends where it belongs: off by ${res.map((x) => x.o && x.o.mean.toFixed(3)).join(', ')} mm on average, ${Math.max(...res.map((x) => (x.o ? x.o.max : 9))).toFixed(3)} mm at most`);
  ok(res.every((x) => x.r.fit.median < 0.08 && x.r.fit.within05 > 0.55 && x.r.fit.within05 < 0.8 && x.r.fit.n > 2000), `the fit says so: half the crown points within ${Math.max(...res.map((x) => x.r.fit.median)).toFixed(3)} mm; ${Math.round(100 * res[0].r.fit.within05)} % within ½ mm (the rest is gum, which the CBCT’s surface does not have)`);
  ok(res.every((x) => x.s < 20), 'none takes long');
}

// ── the head tilted in the CBCT: nodded 9°, rolled 4°, turned 7° about the middle of the arch
{
  t = Date.now(); const c = [0, -8, 4], W = new T3.Matrix4().makeTranslation(...c).multiply(new T3.Matrix4().makeRotationFromEuler(new T3.Euler(9 * Math.PI / 180, 4 * Math.PI / 180, 7 * Math.PI / 180, 'ZXY'))).multiply(new T3.Matrix4().makeTranslation(-c[0], -c[1], -c[2]));
  const Wi = W.clone().invert().elements, [nx, ny, nz] = vol.dims, sp = vol.spacing, og = vol.origin, src = vol.data, out = new Int16Array(src.length); let q = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++, q++) { const x = og[0] + i * sp[0], y = og[1] + j * sp[1], z = og[2] + k * sp[2], a = Math.round((Wi[0] * x + Wi[4] * y + Wi[8] * z + Wi[12] - og[0]) / sp[0]), b = Math.round((Wi[1] * x + Wi[5] * y + Wi[9] * z + Wi[13] - og[1]) / sp[1]), d = Math.round((Wi[2] * x + Wi[6] * y + Wi[10] * z + Wi[14] - og[2]) / sp[2]); out[q] = a >= 0 && b >= 0 && d >= 0 && a < nx && b < ny && d < nz ? src[a + nx * (b + ny * d)] : vol.min; }
  const tilted = { ...vol, data: out }, ref2 = D.scanReference(tilted, N), S = anyPose(), r = D.alignScan(ref2, moved(S), N, { jaw: 'lower' }), o = r.error ? null : off(r.matrix, S, W);
  ok(!ref2.error && !r.error && r.ok && o.mean < 0.15 && o.max < 0.35, `with the head nodded 9°, rolled 4° and turned 7° in the CBCT the scan is still found by itself: off by ${o ? o.mean.toFixed(3) : '—'} mm on average, ${o ? o.max.toFixed(3) : '—'} at most (the tilted copy is read to the nearest voxel; ${secs(t)} s)`);
}

// ── on matching points, and after a nudge
{
  const S = anyPose(), scan = moved(S), P = scan.positions, B = m0.positions, nV = P.length / 3, pick = [0.07, 0.31, 0.52, 0.74, 0.93].map((u) => Math.floor(u * nV));
  const far = (k) => 0.6 * (((k * 7919) % 13) / 6 - 1), pairs = pick.map((v, i) => ({ a: [P[3 * v], P[3 * v + 1], P[3 * v + 2]], b: [B[3 * v] + far(i), B[3 * v + 1] + far(i + 3), B[3 * v + 2] + far(i + 7)] }));
  const raw = D.alignScan(ref, scan, N, { jaw: 'lower', pairs, refine: false }), oRaw = off(raw.matrix, S), fin = D.alignScan(ref, scan, N, { jaw: 'lower', pairs }), oFin = off(fin.matrix, S);
  ok(raw.how === 'points' && oRaw.max < 3 && oRaw.mean > 0.05, `five matching points, each marked up to 0.6 mm off: the points alone put the scan within ${oRaw.max.toFixed(2)} mm (${oRaw.mean.toFixed(2)} on average)`);
  ok(fin.how === 'points' && fin.ok && oFin.mean < 0.06 && oFin.max < 0.15 && oFin.mean < oRaw.mean, `and the fine fit that follows settles it: ${oFin.mean.toFixed(3)} mm on average, ${oFin.max.toFixed(3)} at most`);
  const three = D.alignScan(ref, scan, N, { jaw: 'lower', pairs: pairs.slice(0, 3) }), o3 = off(three.matrix, S);
  ok(three.ok && o3.mean < 0.06, `three points are enough (${o3.mean.toFixed(3)} mm)`);
  ok(D.alignScan(ref, scan, N, { jaw: 'lower', pairs: pairs.slice(0, 2) }).how === 'auto', 'two are not: the scan is then lined up by itself');
  const nudge = new T3.Matrix4().makeTranslation(0.9, -0.6, 0.7).multiply(new T3.Matrix4().makeRotationFromEuler(new T3.Euler(0.03, -0.025, 0.035))).multiply(S.clone().invert()), oN = off(nudge, S), ff = D.alignScan(ref, scan, N, { jaw: 'lower', start: nudge }), oF = off(ff.matrix, S);
  ok(ff.how === 'fine' && ff.ok && oN.max > 1 && oF.mean < 0.06 && oF.max < 0.15, `the fine fit alone, from ${oN.max.toFixed(1)} mm and 3° out: ${oF.mean.toFixed(3)} mm on average, ${oF.max.toFixed(3)} at most`);
  const asIs = D.alignScan(ref, scan, N, { jaw: 'lower', start: nudge, refine: false });
  ok(asIs.matrix.equals(nudge) && !asIs.ok && asIs.fit.median > 0.3, `asked only to measure, it leaves the scan where it is and says the fit is not close (half the points more than ${asIs.fit.median.toFixed(2)} mm off)`);
}

// ── what must not pass
{
  const S = anyPose(), scan = moved(S), up = D.alignScan(ref, scan, N, { jaw: 'upper' });
  ok(!!up.error || !up.ok, `taken for an upper scan (upside-down), the lower scan is not passed as a fit${up.error ? '' : ` (half the points ${up.fit.median.toFixed(2)} mm off)`}`);
  const tiny = D.alignScan(ref, { positions: new Float32Array(30), indices: new Uint32Array(27) }, N, { jaw: 'lower' });
  ok(!!tiny.error, `a scan with next to no points is refused (“${tiny.error}”)`);
  const blank = { ...vol, data: new Int16Array(vol.data.length).fill(vol.min) }; let rb = null; try { rb = D.scanReference(blank, N); } catch (e) { rb = { threw: String(e && e.message) }; }
  const out = rb.error ? rb : rb.threw ? rb : D.alignScan(rb, scan, N, { jaw: 'lower' });
  ok(!rb.threw && !!out.error, `a CBCT with no teeth in it gives a plain refusal (“${out.error || rb.threw}”)`);
}

// ── the scan's outline in a slice
{
  const S = anyPose(), scan = moved(S), M = S.clone().invert(), z0 = 7.05, seg = D.meshCut(scan, M.elements, [0, 0, z0], [0, 0, 1]);
  const at = (x, y, z) => { const fx = (x - f.origin[0]) / f.h, fy = (y - f.origin[1]) / f.h, fz = (z - f.origin[2]) / f.h, i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), tx = fx - i, ty = fy - j, tz = fz - k, g = (a, b, c) => f.F[(i + a) + f.n[0] * ((j + b) + f.n[1] * (k + c))]; return ((g(0, 0, 0) * (1 - tx) + g(1, 0, 0) * tx) * (1 - ty) + (g(0, 1, 0) * (1 - tx) + g(1, 1, 0) * tx) * ty) * (1 - tz) + ((g(0, 0, 1) * (1 - tx) + g(1, 0, 1) * tx) * (1 - ty) + (g(0, 1, 1) * (1 - tx) + g(1, 1, 1) * tx) * ty) * tz; };
  let offPlane = 0, offSurf = 0, len = 0; for (let v = 0; v < seg.length; v += 3) { offPlane = Math.max(offPlane, Math.abs(seg[v + 2] - z0)); offSurf = Math.max(offSurf, Math.abs(at(seg[v], seg[v + 1], seg[v + 2]))); } for (let v = 0; v < seg.length; v += 6) len += Math.hypot(seg[v + 3] - seg[v], seg[v + 4] - seg[v + 1], seg[v + 5] - seg[v + 2]);
  ok(seg.length % 6 === 0 && seg.length / 6 > 300 && offPlane < 1e-3 && offSurf < 0.05, `across the crowns the outline is ${seg.length / 6} short lines, all in the slice’s plane (within ${offPlane.toExponential(0)} mm) and on the scan’s surface (within ${offSurf.toFixed(3)} mm)`);
  ok(len > 150 && len < 600, `together ${len.toFixed(0)} mm long: the rings round fourteen crowns`);
  const ob = D.meshCut(scan, M.elements, [0, -20, 5], [0, Math.SQRT1_2, Math.SQRT1_2]); let offOb = 0; for (let v = 0; v < ob.length; v += 3) offOb = Math.max(offOb, Math.abs((ob[v + 1] + 20) * Math.SQRT1_2 + (ob[v + 2] - 5) * Math.SQRT1_2));
  ok(ob.length > 60 && offOb < 1e-3, `a tilted slice cuts it just as well (${ob.length / 6} lines)`);
  ok(D.meshCut(scan, M.elements, [0, 0, 60], [0, 0, 1]).length === 0, 'a slice that misses the scan gives no outline');
}
console.log(fails ? `\n${fails} FAILED` : `\nall passed in ${secs(t00)} s`);
