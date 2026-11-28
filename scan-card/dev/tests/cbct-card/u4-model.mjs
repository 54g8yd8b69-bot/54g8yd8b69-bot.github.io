// u4-model.mjs — everything round the trained tooth network (shared/dicom.js: modelFrame, modelMap, modelCube, modelTeeth,
// modelTooth, toothFromMask), in node and without the network itself. Its answer is made up instead:
//   · from the phantom's exact geometry (every voxel of the cube inside a tooth by more than 0.6 mm is "centre", the rest of
//     the tooth "border"), so what comes out can be held against the true tooth: volume, axis, crown end, the replica's
//     surface, the canals found inside it;
//   · as plain shapes, for the cases the phantom does not have: two teeth the network joined (parted at the bridge), a
//     two-rooted tooth (not parted), a speck (dropped), a tap beside a tooth, a tooth that runs out of the cube.
// The cube handed to the network is checked too: an exact copy of a 0.2 mm scan, read between the voxels of any other.
//                 node dev/tests/cbct-card/u4-model.mjs
import * as D from '../../../shared/dicom.js';
import * as N from '../../../shared/core.js';
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { fails++; process.exitCode = 1; } };
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))], M = D.TOOTH_MODEL, H = M.h, norm = (v) => (Math.min(M.hi, Math.max(M.lo, v)) - M.mean) / M.std;
const t0 = Date.now(), { vol, truth } = D.makePhantom({ voxel: 0.3 }), V = truth.values, byName = Object.fromEntries(truth.teeth.map((t) => [t.name, t]));
console.log(`phantom ${vol.dims.join('×')} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const centreOf = (t, c = 0) => [0, 1, 2].map((a) => t.base[a] + t.w[a] * c);
const fields = truth.teeth.map((t) => D.phantomToothField(t));
const rulesOf = (tt, seed) => D.segmentTooth(vol, { seeds: [seed], roi: { shape: 'cyl', c: [seed[0], seed[1]], r: 7, z0: seed[2] - 20, z1: seed[2] + 14 }, T: 1000 });
/** the network's answer made up from the phantom: 1 where a tooth is more than 0.6 mm deep, 2 for the rest of it, 0 outside */
function oracle(cube) {
  const [n0, n1, n2] = cube.n, lab = new Uint8Array(n0 * n1 * n2); let u = 0;
  for (let k = 0; k < n2; k++) for (let j = 0; j < n1; j++) for (let i = 0; i < n0; i++, u++) { const x = cube.o[0] + i * H, y = cube.o[1] + j * H, z = cube.o[2] + k * H; let f = Infinity; for (const g of fields) { const v = g(x, y, z); if (v < f) f = v; if (f < -0.6) break; } lab[u] = f < -0.6 ? 1 : f < 0 ? 2 : 0; }
  return lab;
}
function trueVolume(tt, h = 0.1) { const f = D.phantomToothField(tt), R = Math.max(tt.md, tt.bl) / 2 + 2; let n = 0; for (let z = tt.base[2] - tt.root - 1; z < tt.base[2] + tt.crown + 1; z += h) for (let y = tt.base[1] - R - 4; y < tt.base[1] + R + 4; y += h) for (let x = tt.base[0] - R - 4; x < tt.base[0] + R + 4; x += h) if (f(x, y, z) < 0) n++; return n * h * h * h; }

// ── the cube's size and place
{
  const seed = [10, 20, 30], f0 = D.modelFrame(vol, seed), box = (c, s) => ({ lo: c.map((v, a) => v - s[a] / 2), hi: c.map((v, a) => v + s[a] / 2) });
  ok(f0.n.join() === '128,128,160' && f0.centre.join() === seed.join(), `with no tooth from the rules the cube is ${f0.n.join(' × ')} voxels round the tap`);
  const f1 = D.modelFrame(vol, seed, box([10, 20, 28], [8, 8, 22])), f2 = D.modelFrame(vol, seed, box([10, 21, 27], [14, 12, 19])), f3 = D.modelFrame(vol, seed, box([14, 20, 30], [24, 10, 10])), f4 = D.modelFrame(vol, seed, box([10, 20, 30], [30, 30, 40]));
  ok(f1.n.join() === '96,96,160' && f2.n.join() === '128,128,144' && f3.n.join() === '160,96,96', `a single-rooted tooth gets ${f1.n.join(' × ')}, a molar ${f2.n.join(' × ')}, a tooth lying on its side ${f3.n.join(' × ')}: 4½ mm to spare all round`);
  ok(f4.n[0] * f4.n[1] * f4.n[2] <= 2.9e6 && [f1, f2, f3, f4].every((f) => f.n[0] % 32 === 0 && f.n[1] % 32 === 0 && f.n[2] % 16 === 0), `an outsize outline is held to ${f4.n.join(' × ')} = ${(f4.n[0] * f4.n[1] * f4.n[2] / 1e6).toFixed(2)} million voxels; every size is one the network takes`);
  ok(f2.centre.every((v, a) => Math.abs(v - [10, 21, 27][a]) < 1e-9), 'the cube sits on the middle of the rules’ outline');
  const f5 = D.modelFrame(vol, seed, box([25, 20, 50], [8, 8, 22])), half = f5.n.map((n) => (n - 1) / 2 * H);
  ok(f5.centre.every((v, a) => Math.abs(seed[a] - v) <= half[a] - 3 + 1e-9), `an outline far from the tap does not carry the cube off it: the tap stays ${Math.min(...f5.centre.map((v, a) => half[a] - Math.abs(seed[a] - v))).toFixed(1)} mm inside`);
}
// ── the grey scale
{
  ok(D.modelMap(vol, { dentine: 1200, soft: 40 }) === null && D.modelMap(vol, null) === null, 'a CT-like scan is given to the network as it is (no stretch)');
  const odd = { ...vol, shift: 0 }, m = D.modelMap(odd, { dentine: 0.5 * V.dentine + 2000, soft: 0.5 * V.soft + 2000 });
  ok(m && Math.abs(m[0] * (0.5 * V.soft + 2000) + m[1] - M.soft) < 1e-6 && Math.abs(m[0] * (0.5 * V.dentine + 2000) + m[1] - M.dentine) < 1e-6, `a scan on another scale (dentine ${0.5 * V.dentine + 2000}, soft tissue ${0.5 * V.soft + 2000}) is stretched: soft tissue to ${M.soft}, dentine to ${M.dentine} (× ${m && m[0].toFixed(2)}, ${m && m[1].toFixed(0)})`);
  const sh = D.modelMap({ ...vol, shift: 1000 }, { dentine: 2850 - 1000, soft: 2030 - 1000 });
  ok(sh && Math.abs(sh[0] - m[0]) < 1e-9 && Math.abs(sh[1] - m[1]) < 1e-6, 'the same scan stored with a shift gets the same stretch');
  const d2 = new Int16Array(vol.data.length); for (let i = 0; i < d2.length; i++) d2[i] = Math.round(vol.data[i] * 0.5 + 2000); const v2 = { ...vol, data: d2, min: Math.round(vol.min * 0.5 + 2000), max: Math.round(vol.max * 0.5 + 2000) }, mp = D.modelMap(v2, null);
  ok(mp && Math.abs(mp[0] * (0.5 * V.soft + 2000) + mp[1] - 40) < 80 && Math.abs(mp[0] * (0.5 * V.dentine + 2000) + mp[1] - V.dentine) < 0.25 * V.dentine, `with no tooth to go by, a scan that is not CT-like is stretched as its window presets are: soft tissue to ${mp && (mp[0] * (0.5 * V.soft + 2000) + mp[1]).toFixed(0)}, dentine to ${mp && (mp[0] * (0.5 * V.dentine + 2000) + mp[1]).toFixed(0)}`);
}
// ── the cube itself
{
  // a 0.2 mm scan: copied exactly, the cube moved onto its voxels
  const n = [70, 64, 58], d = new Int16Array(n[0] * n[1] * n[2]); let s = 12345; for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s % 5200) - 1100; }
  const fine = { data: d, dims: n, spacing: [0.2, 0.2, 0.2], origin: [3.1, -7.3, 11.05], min: -1100, max: 4100, shift: 0, warnings: [] };
  const c = D.modelCube(fine, [3.1 + 6.93, -7.3 + 6.4, 11.05 + 5.77], [32, 32, 16]), off = c.o.map((v, a) => (v - fine.origin[a]) / 0.2); let bad = 0, far = 0;
  for (let k = 0, u = 0; k < 16; k++) for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++, u++) { const v = d[Math.round(off[0]) + i + n[0] * (Math.round(off[1]) + j + n[1] * (Math.round(off[2]) + k))]; if (Math.abs(c.x[u] - norm(v)) > 1e-5) bad++; }
  for (let a = 0; a < 3; a++) if (Math.abs(off[a] - Math.round(off[a])) > 1e-6) far++;
  ok(bad === 0 && far === 0 && c.x.length === 32 * 32 * 16 && c.h === 0.2, `a 0.2 mm scan is copied voxel for voxel (${bad} of ${c.x.length} differ), the cube moved onto the scan’s own voxels`);
  // the 0.3 mm phantom: read between its voxels
  const tt = byName[45], ctr = centreOf(tt, -3), cu = D.modelCube(vol, ctr, [64, 64, 80]); let worst = 0, nn = 0;
  for (let t = 0; t < 4000; t++) { const i = (t * 7919) % 64, j = (t * 104729) % 64, k = (t * 1299709) % 80, u = i + 64 * (j + 64 * k), w = D.sampleAt(vol, cu.o[0] + i * H, cu.o[1] + j * H, cu.o[2] + k * H); worst = Math.max(worst, Math.abs(cu.x[u] - norm(w))); nn++; }
  ok(worst < 2e-3 && Math.abs(cu.o[0] + 31.5 * H - ctr[0]) <= 0.151 && Math.abs(cu.o[2] + 39.5 * H - ctr[2]) <= 0.151, `a 0.3 mm scan is read between its voxels (largest difference from sampleAt over ${nn} points: ${worst.toExponential(1)} of the network’s units), the cube within half a voxel of where it was asked`);
  // a shift, and a stretch
  const d3 = new Int16Array(vol.data.length); for (let i = 0; i < d3.length; i++) d3[i] = vol.data[i] - 500; const c3 = D.modelCube({ ...vol, data: d3, shift: 500 }, ctr, [64, 64, 80]); let e3 = 0; for (let u = 0; u < c3.x.length; u += 37) e3 = Math.max(e3, Math.abs(c3.x[u] - cu.x[u]));
  const c4 = D.modelCube(vol, ctr, [64, 64, 80], [2, 100]); let e4 = 0; for (let t = 0; t < 2000; t++) { const i = (t * 7919) % 64, j = (t * 104729) % 64, k = (t * 1299709) % 80; e4 = Math.max(e4, Math.abs(c4.x[i + 64 * (j + 64 * k)] - norm(2 * D.sampleAt(vol, cu.o[0] + i * H, cu.o[1] + j * H, cu.o[2] + k * H) + 100))); }
  ok(e3 < 1e-6 && e4 < 4e-3, `a scan stored with a shift gives the same cube (${e3.toExponential(1)}); a stretch is applied before the network’s own scale (${e4.toExponential(1)})`);
  const c5 = D.modelCube(vol, [vol.origin[0] + 2, vol.origin[1] + 2, vol.origin[2] + 2], [96, 96, 96]); let fin = true; for (let u = 0; u < c5.x.length; u += 11) if (!Number.isFinite(c5.x[u])) fin = false;
  ok(fin && c5.x[0] === c5.x[1], 'a cube that runs past the edge of the scan repeats the edge (no gaps)');
}
// ── the phantom's teeth through the whole chain, the network's answer made up from their true shape
function chain(name, o = {}) {
  const tt = byName[name], seed = centreOf(tt, tt.crown * 0.35), rules = o.noRules ? null : rulesOf(tt, seed), fr = D.modelFrame(vol, seed, rules), cube = D.modelCube(vol, fr.centre, fr.n), lab = oracle(cube);
  const t1 = Date.now(), teeth = D.modelTeeth(lab, cube.n), one = D.modelTooth(teeth.ids, cube.n, cube.o, seed); if (one.error) return { error: one.error };
  const sg = D.toothFromMask(vol, cube, one.mask, { seeds: [seed], rules, ...(o.opt || {}) }); return { tt, seed, rules, fr, cube, lab, teeth, one, sg, ms: Date.now() - t1 };
}
function meshOf(sg) { const f = D.replicaField(vol, sg, { smooth: 0.15 }), m = N.isoMesh(f.F, f.n[0], f.n[1], f.n[2], f.origin, f.h, { minVolume: 5 }); D.taubin(m, 4); return m; }
for (const name of [45, 46, 41, 35]) {
  const r = chain(name); if (r.error) { ok(false, `${name}: ${r.error}`); continue; }
  const { tt, sg, one, teeth, rules } = r, tv = trueVolume(tt), f = D.phantomToothField(tt), { lab, box } = sg; let out = 0, cnt = 0;
  for (let k = 0; k < box.nz; k++) for (let j = 0; j < box.ny; j++) for (let i = 0; i < box.nx; i++) { if (!lab[i + box.nx * (j + box.ny * k)]) continue; cnt++; if (f(vol.origin[0] + (box.i0 + i) * 0.3, vol.origin[1] + (box.j0 + j) * 0.3, vol.origin[2] + (box.k0 + k) * 0.3) > 0.25) out++; }
  const ang = Math.acos(Math.min(1, Math.abs(sg.axis[0] * tt.w[0] + sg.axis[1] * tt.w[1] + sg.axis[2] * tt.w[2]))) * 180 / Math.PI, errV = 100 * (sg.volume / tv - 1), C = sg.levels.dentine - sg.levels.soft;
  ok(sg.model === true && teeth.count >= 2 && !one.parted && one.touches.every((p) => !p[0] && !p[1]) && Math.abs(errV) < 4 && out === 0,
    `${name}: ${teeth.count} teeth in the cube (${r.fr.n.join(' × ')}), the tapped one ${sg.volume.toFixed(0)} mm³ (true ${tv.toFixed(0)}, ${errV >= 0 ? '+' : ''}${errV.toFixed(1)}%), ${out} of its ${cnt} voxels more than 0.25 mm outside the true tooth, not parted, clear of the cube’s sides · ${r.ms} ms`);
  ok(ang < 4 && sg.axis[2] * sg.crown > 0 && Math.abs(sg.length - (tt.root + tt.crown)) < 0.8 && sg.T >= sg.levels.soft + 0.3 * C - 1 && sg.T <= sg.levels.soft + 0.8 * C + 1 && Math.abs(sg.levels.dentine - V.dentine) < 120 && sg.levels.enamel != null && Math.abs(sg.levels.enamel - V.enamel) < 400 && sg.levels.soft === rules.levels.soft,
    `${name}: long axis ${ang.toFixed(1)}° from the true one, crown end up, ${sg.length.toFixed(1)} mm long (true ${(tt.root + tt.crown).toFixed(1)}); threshold ${sg.T} lies ${(100 * (sg.T - sg.levels.soft) / C).toFixed(0)}% of the way from soft tissue to dentine; the grey levels are the tooth’s own — dentine ${sg.levels.dentine} (true ${V.dentine}; the rules read ${rules.levels.dentine} in their one slice), enamel ${sg.levels.enamel} (true ${V.enamel}) — and soft tissue the rules’ (${sg.levels.soft})`);
  const m = meshOf(sg), mv = N.meshVolume(m), d = []; for (let p = 0; p < m.positions.length; p += 3) d.push(Math.abs(f(m.positions[p], m.positions[p + 1], m.positions[p + 2]))); d.sort((a, b) => a - b);
  ok(N.isWatertight(m) && N.splitParts(m).length === 1 && Math.abs(100 * (mv / tv - 1)) < 4 && q(d, 0.5) < 0.1 && q(d, 0.95) < 0.3,
    `${name}: the replica made from it is closed and in one piece, ${mv.toFixed(0)} mm³ (${(100 * (mv / tv - 1)).toFixed(1)}%), its surface ${q(d, 0.5).toFixed(2)} mm (median) and ${q(d, 0.95).toFixed(2)} mm (95%) from the true tooth’s`);
  const cs = D.segmentCanal(vol, sg), cr = D.segmentCanal(vol, rules), pf = D.phantomPulpField(tt); let cin = 0, cout = 0;
  if (!cs.error) { const g = cs.grid, [n0, n1, n2] = g.n; for (let k = 0; k < n2; k++) for (let j = 0; j < n1; j++) for (let i = 0; i < n0; i++) { if (!cs.mask[i + n0 * (j + n1 * k)]) continue; const P = [0, 1, 2].map((a) => g.O[a] + g.h * (i * g.u[a] + j * g.v[a] + k * g.w[a])); if (pf(...P) < g.h) cin++; else cout++; } }
  ok(!cs.error && !cr.error && cout <= 0.03 * (cin + cout) && Math.abs(cs.volume / cr.volume - 1) < 0.15 && cs.canals === cr.canals,
    `${name}: the canal finder works inside it as inside the rules’ outline: ${cs.error || `${cs.volume.toFixed(1)} mm³ (rules ${cr.volume.toFixed(1)}), ${cs.canals} canal${cs.canals === 1 ? '' : 's'} (rules ${cr.canals}), ${cout} of ${cin + cout} voxels off the true pulp`}`);
}
{ // the same tooth, whatever the rules read for the tap: their dentine level put 250 lower or 250 higher changes nothing —
  // not the tooth's levels, not its threshold, not one voxel or figure of its canals (it did: the same molar gave three
  // canals or four, according to where it was tapped)
  const r = chain(46), lv = r.rules.levels, alt = (d) => D.toothFromMask(vol, r.cube, r.one.mask, { seeds: [r.seed], rules: { ...r.rules, levels: { ...lv, dentine: lv.dentine + d }, ref: (r.rules.ref ?? lv.dentine) + d } });
  const A0 = 0; const A = alt(-250), B = alt(250), cA = D.segmentCanal(vol, A), cB = D.segmentCanal(vol, B), c0 = D.segmentCanal(vol, r.sg); let same = cA.mask.length === cB.mask.length; for (let q = 0; same && q < cA.mask.length; q++) if (cA.mask[q] !== cB.mask[q] || cA.mask[q] !== c0.mask[q]) same = false;
  ok(!A.error && !B.error && A.levels.dentine === B.levels.dentine && A.levels.dentine === r.sg.levels.dentine && A.T === B.T && A.T === r.sg.T && !cA.error && same && cA.T === cB.T && cA.paths.length === cB.paths.length && cA.volume === cB.volume && cA.noise.floor === cB.noise.floor,
    `46 with the rules’ dentine level put at ${lv.dentine - 250} and at ${lv.dentine + 250}: the same tooth (dentine ${A.levels.dentine}, threshold ${A.T}) and the same canals to the voxel (${cA.error || `${cA.volume.toFixed(1)} mm³, ${cA.paths.length} lines, threshold ${cA.T}`})`);
}
{ // without the rules' outline: the cube round the tap; the grey levels are the tooth's own either way
  const r = chain(44, { noRules: true }), tv = trueVolume(byName[44]);
  ok(!r.error && r.fr.n.join() === '128,128,160' && Math.abs(r.sg.volume / tv - 1) < 0.04 && Math.abs(r.sg.levels.dentine - V.dentine) < 120 && r.sg.levels.enamel != null && Math.abs(r.sg.levels.enamel - V.enamel) < 400 && r.sg.T > r.sg.levels.soft && r.sg.T < r.sg.levels.dentine,
    `44 with no outline from the rules: ${r.error || `${r.sg.volume.toFixed(0)} mm³ (true ${tv.toFixed(0)}), dentine taken as ${r.sg.levels.dentine} (true ${V.dentine}), enamel ${r.sg.levels.enamel} (true ${V.enamel}), threshold ${r.sg.T}`}`);
  // cuts by hand: an eraser ball on the root, a "not tooth" point, and a tap on the neighbour as a second "Tooth" tap
  const tt = byName[44], cut = centreOf(tt, -tt.root * 0.7), a = D.toothFromMask(vol, r.cube, r.one.mask, { seeds: [r.seed], erase: [{ p: cut, r: 1.5 }] }), tip = centreOf(tt, -tt.root + 0.4), b = D.toothFromMask(vol, r.cube, r.one.mask, { seeds: [r.seed], not: [tip] }), inside = D.toothFromMask(vol, r.cube, r.one.mask, { seeds: [r.seed], not: [cut] });
  ok(!a.error && !b.error && a.volume < r.sg.volume - 8 && a.length < r.sg.length - 1 && b.volume < r.sg.volume - 0.5 && b.volume > a.volume && b.length < r.sg.length - 0.5 && !inside.error && inside.volume >= a.volume, `an eraser ball of 1.5 mm across the root cuts the tip off (${r.sg.volume.toFixed(0)} → ${a.volume.toFixed(0)} mm³, ${r.sg.length.toFixed(1)} → ${a.length.toFixed(1)} mm: the piece under the tap is kept); a “Not tooth” point on the root’s tip cuts a 1 mm ball off it (${b.volume.toFixed(1)} mm³, ${b.length.toFixed(1)} mm); one where the eraser cut takes no more than the eraser did (${inside.volume.toFixed(0)} mm³)`);
  const other = D.modelTooth(r.teeth.ids, r.cube.n, r.cube.o, centreOf(byName[43], byName[43].crown * 0.3));
  ok(!other.error && other.id !== r.one.id, 'a tap on the next tooth picks that tooth, not this one');
}
// ── plain shapes: what the phantom does not have
{
  const n = [96, 96, 176], N3 = n[0] * n[1] * n[2], o = [0, 0, 0], ell = (c, r, x, y, z) => ((x - c[0]) / r[0]) ** 2 + ((y - c[1]) / r[1]) ** 2 + ((z - c[2]) / r[2]) ** 2;
  const at = (i, j, k) => i + n[0] * (j + n[1] * k), world = (p) => p.map((v) => v * H);
  const paint = (fn) => { const lab = new Uint8Array(N3); for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) lab[at(i, j, k)] = fn(i, j, k); return lab; };
  const count = (m) => { let c = 0; for (let u = 0; u < m.length; u++) if (m[u]) c++; return c; };
  // two teeth side by side with a gap, and a speck of "centre" too small to be a tooth
  const A = [[30, 48, 60], [14, 16, 40]], B = [[66, 48, 60], [14, 16, 40]], shr = (r) => r.map((v) => v - 3);
  const two = paint((i, j, k) => { if (Math.abs(i - 48) < 3 && Math.abs(j - 10) < 3 && Math.abs(k - 150) < 3) return 1; for (const [c, r] of [A, B]) { if (ell(c, shr(r), i, j, k) <= 1) return 1; if (ell(c, r, i, j, k) <= 1) return 2; } return 0; });
  const T2 = D.modelTeeth(two, n), volA = count(paint((i, j, k) => (ell(A[0], A[1], i, j, k) <= 1 ? 1 : 0))), pa = D.modelTooth(T2.ids, n, o, world(A[0])), pb = D.modelTooth(T2.ids, n, o, world(B[0]));
  ok(T2.count === 2 && !pa.error && !pb.error && pa.id !== pb.id && Math.abs(count(pa.mask) - volA) <= 0.01 * volA && !pa.parted, `two teeth with a gap between them are two teeth (${T2.count}); the tapped one has all its rim (${count(pa.mask)} voxels of ${volA}); a speck of 1 mm³ is no tooth`);
  const gap = D.modelTooth(T2.ids, n, o, world([47, 48, 60])), far = D.modelTooth(T2.ids, n, o, world([48, 48, 150])), outside = D.modelTooth(T2.ids, n, o, [-5, 0, 0]);
  ok(!gap.error && gap.id === pa.id && /no tooth/.test(far.error || '') && /outside/.test(outside.error || ''), `a tap just off a tooth (0.6 mm) takes the nearest; a tap in the open says so (“${far.error}”); a tap outside the cube says so`);
  // an upper and a lower tooth biting together, which the network joined: one "centre" runs through both
  const U = [[48, 48, 121], [20, 20, 35]], L = [[48, 48, 55], [20, 20, 35]];
  const joined = paint((i, j, k) => { const inU = ell(U[0], U[1], i, j, k) <= 1, inL = ell(L[0], L[1], i, j, k) <= 1; if (!inU && !inL) return 0; if (ell(U[0], shr(U[1]), i, j, k) <= 1 || ell(L[0], shr(L[1]), i, j, k) <= 1 || ((i - 48) ** 2 + (j - 48) ** 2 <= 9 && k > 60 && k < 116)) return 1; return 2; });
  const TJ = D.modelTeeth(joined, n), volL = count(paint((i, j, k) => (ell(L[0], L[1], i, j, k) <= 1 ? 1 : 0))), lo = D.modelTooth(TJ.ids, n, o, world(L[0])), up = D.modelTooth(TJ.ids, n, o, world(U[0]));
  let above = 0; if (!lo.error) for (let k = 96; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) if (lo.mask[at(i, j, k)]) above++;
  ok(TJ.count === 1 && !lo.error && lo.parted && lo.parted.sizes.length === 2 && Math.abs(count(lo.mask) / volL - 1) < 0.04 && above === 0 && !up.error && up.parted && Math.abs(count(up.mask) / volL - 1) < 0.04,
    `two teeth biting together that the network made one (${TJ.count}) are parted at the bridge: a tap on the lower keeps ${count(lo.mask)} voxels (the lower tooth alone has ${volL}), none of them in the upper tooth’s body; shrunk by ${lo.parted && lo.parted.at.toFixed(1)} mm it fell into pieces of ${lo.parted && lo.parted.sizes.join(' and ')} mm³; a tap on the upper keeps the upper`);
  // a tooth with two thick roots is one tooth, however far it is shrunk
  const molar = paint((i, j, k) => { const crown = ell([48, 48, 120], [26, 22, 30], i, j, k) <= 1, r1 = (i - 34) ** 2 + (j - 48) ** 2 <= 144 && k >= 30 && k <= 110, r2 = (i - 62) ** 2 + (j - 48) ** 2 <= 144 && k >= 30 && k <= 110; if (!crown && !r1 && !r2) return 0;
    const deep = ell([48, 48, 120], [23, 19, 27], i, j, k) <= 1 || ((i - 34) ** 2 + (j - 48) ** 2 <= 81 && k >= 33 && k <= 110) || ((i - 62) ** 2 + (j - 48) ** 2 <= 81 && k >= 33 && k <= 110); return deep ? 1 : 2; });
  const TM = D.modelTeeth(molar, n), mo = D.modelTooth(TM.ids, n, o, world([48, 48, 120]));
  ok(TM.count === 1 && !mo.error && !mo.parted && mo.touches.every((p) => !p[0] && !p[1]), `a tooth with two thick roots stays one tooth (${count(mo.mask)} voxels, not parted)`);
  // a tooth that runs out of the top of the cube says which side
  const tall = paint((i, j, k) => (ell([48, 48, 150], [17, 17, 37], i, j, k) <= 1 ? 1 : ell([48, 48, 150], [20, 20, 40], i, j, k) <= 1 ? 2 : 0)), TT = D.modelTeeth(tall, n), ta = D.modelTooth(TT.ids, n, o, world([48, 48, 140]));
  ok(!ta.error && ta.touches[2][1] && !ta.touches[2][0] && !ta.touches[0][0] && !ta.touches[1][1], 'a tooth that runs out of the cube is said to reach that side (so the page can move the cube and ask again)');
  // … and made into a tooth result it still is one
  const none = D.toothFromMask(vol, { n, o: [vol.origin[0] + 5, vol.origin[1] + 5, vol.origin[2] + 2], h: H }, new Uint8Array(N3));
  ok(/no tooth/.test(none.error || ''), 'an empty answer gives an error, not a tooth');
}
console.log(fails ? `${fails} FAILED` : 'all passed', `· ${((Date.now() - t0) / 1000).toFixed(0)} s`);
