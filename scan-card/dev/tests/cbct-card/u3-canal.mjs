// u3-canal.mjs — the root canals of a tooth (shared/dicom.js segmentCanal, canalField) against the phantom's exact pulp (node):
//   for a premolar, a lower incisor, a two-rooted molar and a canine, the canals found lie where the true pulp is, have its
//   volume and length, and the surface made from them is closed and close to the true pulp's surface; the molar's two canals
//   are counted; nothing outside the tooth, between its cusps or round its roots is taken. Then harder cases built from the
//   phantom: a tooth whose apex is wide open (still forming), a tooth with an access cavity cut down to the chamber, a tooth
//   lying on its side, and a scan with half the voxel size where the tooth was found on a coarser copy.
//                 node dev/tests/cbct-card/u3-canal.mjs [fdi …]
import * as D from '../../../shared/dicom.js';
import * as N from '../../../shared/core.js';
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { fails++; process.exitCode = 1; } };
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
const t0 = Date.now(), { vol, truth } = D.makePhantom({ voxel: 0.3 }), V = truth.values, byName = Object.fromEntries(truth.teeth.map((t) => [t.name, t]));
console.log(`phantom ${vol.dims.join('×')} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const centreOf = (t, c = 0) => [0, 1, 2].map((a) => t.base[a] + t.w[a] * c);
/** the true pulp: volume (mm³), and its reach along the tooth's axis (c from the tooth's base, mm) */
function truePulp(t, h = 0.05) {
  const f = D.phantomPulpField(t), R = Math.max(t.md, t.bl) / 2 + 1, lo = [t.base[0] - R - 3, t.base[1] - R - 3, t.base[2] - t.root - 1], hi = [t.base[0] + R + 3, t.base[1] + R + 3, t.base[2] + t.crown + 1]; let n = 0, c0 = Infinity, c1 = -Infinity;
  for (let z = lo[2]; z < hi[2]; z += h) for (let y = lo[1]; y < hi[1]; y += h) for (let x = lo[0]; x < hi[0]; x += h) if (f(x, y, z) < 0) { n++; const c = (x - t.base[0]) * t.w[0] + (y - t.base[1]) * t.w[1] + (z - t.base[2]) * t.w[2]; if (c < c0) c0 = c; if (c > c1) c1 = c; }
  return { volume: n * h * h * h, c0, c1, length: c1 - c0 };
}
function toothOf(v, tt, o = {}) {
  const seed = o.seed || centreOf(tt, tt.crown * 0.35), roi = o.roi || { shape: 'cyl', c: [seed[0], seed[1]], r: o.r || 7, z0: seed[2] - 20, z1: seed[2] + 14 };
  return D.segmentTooth(v, { seeds: [seed], roi, T: o.T ?? 1000, maxVoxels: o.maxVoxels });
}
function meshOf(cs) { const f = D.canalField(cs), m = N.isoMesh(f.F, f.n[0], f.n[1], f.n[2], [0, 0, 0], f.h, { minVolume: 0.05 }); D.taubin(m, 2); return D.canalToPatient(m, cs); }
/** how the canals found compare with a true pulp field */
function compare(cs, f, tooth) {
  const { mask, grid } = cs, [n0, n1, n2] = grid.n, d = [];
  let inside = 0, near = 0, out = 0; for (let k = 0; k < n2; k++) for (let j = 0; j < n1; j++) for (let i = 0; i < n0; i++) { if (!mask[i + n0 * (j + n1 * k)]) continue; const P = [0, 1, 2].map((a) => grid.O[a] + grid.h * (i * grid.u[a] + j * grid.v[a] + k * grid.w[a])), v = f(...P); if (v < 0) inside++; else if (v < grid.h) near++; else out++; if (tooth && tooth(...P) > 0) out += 1000; }
  const m = meshOf(cs); for (let p = 0; p < m.positions.length; p += 3) d.push(Math.abs(f(m.positions[p], m.positions[p + 1], m.positions[p + 2]))); d.sort((a, b) => a - b);
  return { inside, near, out, mesh: m, med: q(d, 0.5), p95: q(d, 0.95), closed: N.isWatertight(m), meshVol: N.meshVolume(m), parts: N.splitParts(m).length };
}

const ONLY = process.argv.slice(2).map(Number);
for (const fdi of ONLY.length ? ONLY : [45, 31, 36, 43]) {
  const tt = byName[fdi], tp = truePulp(tt), seg = toothOf(vol, tt), t1 = Date.now(), cs = D.segmentCanal(vol, seg), ms = Date.now() - t1;
  if (cs.error) { ok(false, `${fdi}: ${cs.error}`); continue; }
  const r = compare(cs, D.phantomPulpField(tt), D.phantomToothField(tt));
  ok(Math.abs(cs.pulp - V.pulp) < 400 && Math.abs(cs.dentine - V.dentine) < 120 && cs.auto > cs.pulp && cs.auto < cs.dentine, `${fdi}: levels read from the tooth itself — pulp ${cs.pulp} (true ${V.pulp}; thin canals read brighter), dentine ${cs.dentine} (true ${V.dentine}); canal threshold ${cs.auto} (${ms} ms, grid ${cs.grid.n.join('×')} of ${cs.grid.h} mm)`);
  ok(r.out === 0 && r.inside / cs.count > 0.8, `${fdi}: all ${cs.count} canal voxels lie in the true pulp or within a voxel of it (${r.inside} inside, ${r.near} at its edge, ${r.out} elsewhere)`);
  ok(Math.abs(cs.volume / tp.volume - 1) < 0.2 && Math.abs(r.meshVol / tp.volume - 1) < 0.2, `${fdi}: volume ${cs.volume.toFixed(1)} mm³ as voxels, ${r.meshVol.toFixed(1)} mm³ as a surface; true ${tp.volume.toFixed(1)} mm³`);
  // (the phantom's molars have a chamber and two canals that do not quite join: three pieces, and three side by side where they overlap)
  ok(Math.abs(cs.length - tp.length) < 1.0 && cs.pieces === (tt.two ? 3 : 1) && Math.abs(cs.apexGap - (tt.root + tp.c0)) < 0.6, `${fdi}: ${cs.length.toFixed(1)} mm long along the tooth (true ${tp.length.toFixed(1)} mm), in ${cs.pieces} piece${cs.pieces === 1 ? '' : 's'}; stops ${cs.apexGap.toFixed(1)} mm short of the root end (true ${(tt.root + tp.c0).toFixed(1)} mm)`);
  ok(r.closed && r.med < 0.08 && r.p95 < 0.22, `${fdi}: its surface is closed (${r.mesh.indices.length / 3} triangles, ${r.parts} part${r.parts === 1 ? '' : 's'}) and lies ${r.med.toFixed(3)} mm (median), ${r.p95.toFixed(3)} mm (95th percentile) from the true pulp surface`);
  const rootLv = cs.levels.filter((L) => L.t > cs.apexGap + 1.5 && L.t < tt.root - 2.5), want = tt.two ? 2 : 1;
  ok(cs.canals === want && rootLv.length > 10 && rootLv.every((L) => L.count === want && L.root), `${fdi}: ${want} canal${want === 1 ? '' : 's'} side by side at every one of ${rootLv.length} levels down the root, and ${cs.canals} reported for the root (true ${want})`);
  // a point in the chamber and one in the dentine
  const inCh = centreOf(tt, 3.2), inDent = [0, 1, 2].map((a) => tt.base[a] + tt.w[a] * 2 + tt.v[a] * (tt.bl / 2 - 1.2));
  ok(cs.has(...inCh) && !cs.has(...inDent), `${fdi}: has() — the middle of the chamber is canal, the dentine beside it is not`);
  // a higher threshold takes more, a lower one less; the pulp's own level takes nothing much
  const hiT = D.segmentCanal(vol, seg, { T: cs.auto + 400 }), loT = D.segmentCanal(vol, seg, { T: cs.auto - 400 });
  ok(!hiT.error && !loT.error && hiT.volume > cs.volume && loT.volume < cs.volume && hiT.T === cs.auto + 400, `${fdi}: threshold ${cs.auto - 400} → ${loT.volume.toFixed(1)} mm³, ${cs.auto} → ${cs.volume.toFixed(1)}, ${cs.auto + 400} → ${hiT.volume.toFixed(1)}`);
}

// ── harder cases, cut into copies of the phantom ──
const cloneVol = () => ({ ...vol, data: vol.data.slice() });
const paint = (v, lo, hi, fn) => { const [nx, ny] = v.dims, s = v.spacing[0], o = v.origin, r = (x, a) => Math.max(0, Math.min(v.dims[a] - 1, Math.round((x - o[a]) / s))); for (let k = r(lo[2], 2); k <= r(hi[2], 2); k++) for (let j = r(lo[1], 1); j <= r(hi[1], 1); j++) for (let i = r(lo[0], 0); i <= r(hi[0], 0); i++) { const val = fn(o[0] + i * s, o[1] + j * s, o[2] + k * s, v.data[i + nx * (j + ny * k)]); if (val != null) v.data[i + nx * (j + ny * k)] = val; } };
{ // a tooth still forming: the root cut short, its canal wide open at the end (a funnel of soft tissue 2.4 mm across)
  const tt = byName[45], v = cloneVol(), cut = -tt.root + 6, loc = (x, y, z) => { const d = [x - tt.base[0], y - tt.base[1], z - tt.base[2]]; return [d[0] * tt.u[0] + d[1] * tt.u[1] + d[2] * tt.u[2], d[0] * tt.v[0] + d[1] * tt.v[1] + d[2] * tt.v[2], d[0] * tt.w[0] + d[1] * tt.w[1] + d[2] * tt.w[2]]; };
  const tf = D.phantomToothField(tt), R = 6;
  paint(v, [tt.base[0] - R, tt.base[1] - R, tt.base[2] - tt.root - 2], [tt.base[0] + R, tt.base[1] + R, tt.base[2] + 2], (x, y, z, old) => { const [a, b, c] = loc(x, y, z), rr = Math.hypot(a, b); if (c < cut && tf(x, y, z) < 0.5) return V.soft; if (c < cut + 5 && c >= cut && rr < 1.2 * (1 - (c - cut) / 5) + 0.5 * ((c - cut) / 5)) return V.pulp; return null; });
  const seg = toothOf(v, tt), cs = D.segmentCanal(v, seg);
  let hollow = 0; { const { lab, box } = seg; const P = centreOf(tt, cut + 1.5), i = Math.round((P[0] - v.origin[0]) / 0.3) - box.i0, j = Math.round((P[1] - v.origin[1]) / 0.3) - box.j0, k = Math.round((P[2] - v.origin[2]) / 0.3) - box.k0; hollow = lab[i + box.nx * (j + box.ny * k)] ? 0 : 1; }
  const open = !cs.error && cs.has(...centreOf(tt, cut + 1)) && cs.has(...centreOf(tt, cut + 3)) && cs.has(...centreOf(tt, 3.2)), below = !cs.error && cs.has(...centreOf(tt, cut - 1.2));
  ok(!cs.error && open && !below && cs.apexGap < 0.7 && cs.pieces === 1, `a tooth still forming (root cut ${(-cut).toFixed(1)} mm long, canal 2.4 mm wide at its open end${hollow ? '; the tooth as found is hollow there' : ''}): the canal is followed to the open end (${cs.error || cs.apexGap.toFixed(2) + ' mm from the root end'}), ${cs.error ? '' : cs.volume.toFixed(1) + ' mm³'}, and nothing below the root is taken`);
}
{ // an access cavity: a 2 mm hole drilled from the top of the crown into the chamber (air). (The tooth as picked before the hole was
  // cut: picking a tooth whose chamber is open is the tooth finder's business, not tested here.)
  const tt = byName[36], v = cloneVol(), R = 1.0, seg = toothOf(vol, tt), whole = D.segmentCanal(vol, seg);
  paint(v, [tt.base[0] - 3, tt.base[1] - 3, tt.base[2] + 2], [tt.base[0] + 3, tt.base[1] + 3, tt.base[2] + tt.crown + 2], (x, y, z) => { const d = [x - tt.base[0], y - tt.base[1], z - tt.base[2]], c = d[0] * tt.w[0] + d[1] * tt.w[1] + d[2] * tt.w[2], rr = Math.hypot(d[0] - c * tt.w[0], d[1] - c * tt.w[1], d[2] - c * tt.w[2]); return c > 3.2 && rr < R ? V.air : null; });
  const cs = D.segmentCanal(v, seg), rootLv = cs.error ? [] : cs.levels.filter((L) => L.t > cs.apexGap + 1.5 && L.t < tt.root - 2.5);
  ok(!cs.error && cs.has(...centreOf(tt, 2.6)) && rootLv.length > 10 && rootLv.every((L) => L.count === 2) && !cs.has(...centreOf(tt, tt.crown - 0.6)) && !cs.has(...centreOf(tt, tt.crown - 2)) && cs.volume > 0.7 * whole.volume && cs.volume < 1.1 * whole.volume,
    `a molar with a 2 mm access cavity open to the chamber: the chamber below it and both canals are still found (${cs.error || cs.volume.toFixed(1) + ' mm³; ' + whole.volume.toFixed(1) + ' mm³ before the cavity was cut — the top of the chamber, within reach of the open cavity, is not counted'}), and the cavity through the crown is not taken as canal`);
  const strict = D.segmentCanal(v, seg, { crownDepth: 100 });
  ok(strict.error || strict.volume < 0.75 * whole.volume, `(with no limit on how deep the crown counts as open from above, the opened chamber is lost: ${strict.error ? 'nothing found' : strict.volume.toFixed(1) + ' mm³'})`);
}
{ // a tooth of which only half was picked (as the tooth finder may do on a real scan): its label cut down the middle
  const tt = byName[36], seg = toothOf(vol, tt), whole = D.segmentCanal(vol, seg), half = { ...seg, lab: seg.lab.slice() }, { box } = seg;
  for (let k = 0; k < box.nz; k++) for (let j = 0; j < box.ny; j++) for (let i = 0; i < box.nx; i++) { const P = [vol.origin[0] + (box.i0 + i) * 0.3 - tt.base[0], vol.origin[1] + (box.j0 + j) * 0.3 - tt.base[1], vol.origin[2] + (box.k0 + k) * 0.3 - tt.base[2]]; if (P[0] * tt.v[0] + P[1] * tt.v[1] + P[2] * tt.v[2] > 0.2) half.lab[i + box.nx * (j + box.ny * k)] = 0; }
  const cs = D.segmentCanal(vol, half), r = cs.error ? null : compare(cs, D.phantomPulpField(tt), D.phantomToothField(tt));
  ok(whole.by === 'tooth' && r && cs.by === 'walls' && r.out === 0 && cs.has(...centreOf(tt, 3.2)) && cs.volume > 8 && cs.volume < 1.1 * whole.volume, `a molar of which only the cheek-side half was picked: its halved outline no longer rings the pulp, so the chamber is found inside the scan’s own bright walls (“${cs.by}”; the whole tooth: “${whole.by}”) — ${cs.error || `${cs.volume.toFixed(1)} mm³ of ${whole.volume.toFixed(1)}, all of it true pulp (${r.inside} voxels inside, ${r.near} at its edge, ${r.out} elsewhere)`}`);
}
{ // a tooth lying on its side: the scan turned a quarter turn about x (the tooth's axis now runs front to back)
  const [nx, ny, nz] = vol.dims, data = new Int16Array(nx * nz * ny);            // new (i, j, k) = old (i, k, ny − 1 − j)
  for (let k = 0; k < ny; k++) for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) data[i + nx * (j + nz * k)] = vol.data[i + nx * ((ny - 1 - k) + ny * j)];
  const v = { ...vol, data, dims: [nx, nz, ny], origin: [vol.origin[0], vol.origin[2], -(vol.origin[1] + (ny - 1) * 0.3)] }, map = (p) => [p[0], p[2], -p[1]], back = (x, y, z) => [x, -z, y];
  const tt = byName[45], seed = map(centreOf(tt, tt.crown * 0.35)), seg = D.segmentTooth(v, { seeds: [seed], roi: { shape: 'box', c: [seed[0], seed[1]], r: 16, z0: seed[2] - 7, z1: seed[2] + 7 }, T: 1000 });
  const cs = seg.error ? { error: seg.error } : D.segmentCanal(v, seg), tp = truePulp(tt), pf = D.phantomPulpField(tt);
  const r = cs.error ? null : compare(cs, (x, y, z) => pf(...back(x, y, z)));
  ok(r && Math.abs(seg.axis[1]) > 0.9 && r.out === 0 && Math.abs(cs.volume / tp.volume - 1) < 0.2 && Math.abs(cs.length - tp.length) < 1 && r.p95 < 0.22, `a tooth lying on its side (axis ${seg.axis ? seg.axis.map((x) => x.toFixed(2)) : ''}): ${cs.error || `${cs.volume.toFixed(1)} mm³ (true ${tp.volume.toFixed(1)}), ${cs.length.toFixed(1)} mm long (true ${tp.length.toFixed(1)}), surface within ${r.p95.toFixed(3)} mm (95th percentile)`}`);
}
{ // a finer scan (0.15 mm) with the tooth found on a copy with voxels twice the size: the canals still use the scan's own voxels
  const t1 = Date.now(), fine = D.makePhantom({ voxel: 0.15 }).vol, tt = byName[44], tp = truePulp(tt), coarse = D.cropVolume(fine, [0, 0, 0], fine.dims.map((n) => n - 1), 2), seg = toothOf(coarse, tt), cs = D.segmentCanal(fine, seg);
  const r = cs.error ? null : compare(cs, D.phantomPulpField(tt), D.phantomToothField(tt));
  ok(r && seg.vol === coarse && Math.abs(coarse.spacing[0] - 0.3) < 1e-9 && Math.abs(cs.grid.h - 0.15) < 1e-9 && r.out === 0 && Math.abs(cs.volume / tp.volume - 1) < 0.1 && r.p95 < 0.12, `a 0.15 mm scan with the tooth found on a ${coarse.spacing[0].toFixed(2)} mm copy: canals on a ${cs.grid ? cs.grid.h : '?'} mm grid — ${cs.error || `${cs.volume.toFixed(2)} mm³ (true ${tp.volume.toFixed(2)}), surface within ${r.p95.toFixed(3)} mm (95th percentile)`} (${((Date.now() - t1) / 1000).toFixed(1)} s with the phantom)`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
