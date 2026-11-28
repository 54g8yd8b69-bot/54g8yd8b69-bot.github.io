// u3-canal.mjs — the root canals of a tooth (shared/dicom.js segmentCanal, canalField) against the phantom's exact pulp (node):
// (… and, where a canal is lost before its root's end, the course it is carried on along: presumed, apart from what is seen)
//   for a premolar, a lower incisor, a two-rooted molar and a canine, the canals found lie where the true pulp is, have its
//   volume and length, and the surface made from them is closed and close to the true pulp's surface; the molar's two canals
//   are counted; nothing outside the tooth, between its cusps or round its roots is taken. Then harder cases built from the
//   phantom: a tooth whose apex is wide open (still forming); a scan as a clinical machine makes it (blurred, noisy, canals that
//   taper to a quarter of a millimetre: followed as lines by their faint dip); a tooth lying on its side; and a scan with half
//   the voxel size where the tooth was found on a coarser copy.
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
// (what the scan shows: a stretch carried on to the root's tip as presumed is no finding, and is not measured against the true pulp)
function meshOf(cs) { const f = D.canalField(cs), m = N.isoMesh(f.any.presumed ? f.part('seen') : f.F, f.n[0], f.n[1], f.n[2], [0, 0, 0], f.h, { minVolume: 0.05 }); D.taubin(m, 2); return D.canalToPatient(m, cs); }
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
  ok(r.out <= 0.012 * cs.count && r.inside / cs.count > 0.8, `${fdi}: the ${cs.count} canal voxels lie in the true pulp or within a voxel of it (${r.inside} inside, ${r.near} at its edge, ${r.out} elsewhere: a line may run a voxel wide of a canal)`);
  ok(Math.abs(cs.volume / tp.volume - 1) < 0.2 && Math.abs(r.meshVol / tp.volume - 1) < 0.2, `${fdi}: volume ${cs.volume.toFixed(1)} mm³ as voxels, ${r.meshVol.toFixed(1)} mm³ as a surface; true ${tp.volume.toFixed(1)} mm³`);
  // (the phantom's molars have a chamber and two canals that do not quite join: three pieces, and three side by side where they overlap)
  ok(Math.abs(cs.length - tp.length) < 1.0 && cs.pieces === (tt.two ? 3 : 1) && Math.abs(cs.apexGap - (tt.root + tp.c0)) < 0.6, `${fdi}: ${cs.length.toFixed(1)} mm long along the tooth (true ${tp.length.toFixed(1)} mm), in ${cs.pieces} piece${cs.pieces === 1 ? '' : 's'}; stops ${cs.apexGap.toFixed(1)} mm short of the root end (true ${(tt.root + tp.c0).toFixed(1)} mm)`);
  ok(r.closed && r.med < 0.08 && r.p95 < 0.22, `${fdi}: its surface is closed (${r.mesh.indices.length / 3} triangles, ${r.parts} part${r.parts === 1 ? '' : 's'}) and lies ${r.med.toFixed(3)} mm (median), ${r.p95.toFixed(3)} mm (95th percentile) from the true pulp surface`);
  const rootLv = cs.levels.filter((L) => L.t > cs.apexGap + 1.5 && L.t < tt.root - 2.5), want = tt.two ? 2 : 1;
  ok(cs.canals === want && rootLv.length > 10 && rootLv.every((L) => L.count === want && L.root), `${fdi}: ${want} canal${want === 1 ? '' : 's'} side by side at every one of ${rootLv.length} levels down the root, and ${cs.canals} reported for the root (true ${want})`);
  // a point in the chamber and one in the dentine
  const inCh = centreOf(tt, 3.2), inDent = [0, 1, 2].map((a) => tt.base[a] + tt.w[a] * 2 + tt.v[a] * (tt.bl / 2 - 1.2));
  ok(cs.has(...inCh) && !cs.has(...inDent), `${fdi}: has() — the middle of the chamber is canal, the dentine beside it is not`);
  // carried on to the root's end: the phantom's canals taper out about 2 mm short of it; from there to ¾ mm from the tip the
  // course is presumed — inside the tooth, beyond the true pulp, counted and drawn apart; with reach: false, the finder as it was
  { const off = D.segmentCanal(vol, seg, { reach: false }), tf = D.phantomToothField(tt), pf2 = D.phantomPulpField(tt); let pn = 0, pin = 0, pp = null, pv = null, pulp = 0; const G = cs.grid, gs = G.n[0] * G.n[1]; for (const L of cs.paths) L.pts.forEach((x, a) => { if (!L.pres[a]) return; pn++; if (tf(...x) < 0) pin++; if (pf2(...x) < 0) pulp++; if (!pp && a > 0 && L.pres[a - 1] && a + 1 < L.pts.length && L.pres[a + 1]) { pp = x; const q = L.q[a], i = q % G.n[0], j = ((q / G.n[0]) | 0) % G.n[1], k = (q / gs) | 0; pv = [0, 1, 2].map((d) => G.O[d] + G.h * (i * G.u[d] + j * G.v[d] + k * G.w[d])); } });
    const fine = cs.fine, hf = pp ? cs.has(...pp) : -1; cs.fine = null; const hv = pv ? cs.has(...pv) : -1, chV = cs.has(...inCh), dnV = cs.has(...inDent); cs.fine = fine;
    // (a canal seen to within 2 mm of its root's end is left as it is: there is nothing to carry on)
    const due = cs.apexGap > 0.75 + (Math.round(0.75 / G.h) + 1) * G.h;
    ok(cs.roots === (tt.two ? 2 : 1) && chV === 1 && dnV === 0 && !!fine && (due ? cs.presumed > 0.8 && cs.apexGapAll < 1.2 && cs.apexGapAll < cs.apexGap - 0.4 && pn > 2 && pin === pn && pulp < 0.35 * pn && hf === 2 && hv === 2 : cs.presumed === 0 && cs.apexGapAll === cs.apexGap),
      `${fdi}: ${cs.roots} root${cs.roots === 1 ? '' : 's'}; ${due ? `carried on to ${cs.apexGapAll.toFixed(1)} mm from the root end, ${cs.presumed.toFixed(1)} mm of it presumed (${pn} points, ${pin} inside the true tooth, ${pulp} in the true pulp); has() says 2 there — read between the voxels and by voxel —` : `seen to ${cs.apexGap.toFixed(1)} mm from the root end, so nothing is carried on; has() says`} 1 in the chamber, 0 in dentine`);
    const fl = D.canalField(cs, { keep: false }), A = fl.part('seen'), B = fl.part('presumed'); let same = true, both = 0; for (let g = 0; g < fl.F.length && same; g++) { if (Math.abs(fl.F[g] - Math.min(A[g], B[g])) > 1e-6) same = false; if (A[g] < 0 && B[g] < 0) both++; }
    const mp = N.isoMesh(B, fl.n[0], fl.n[1], fl.n[2], [0, 0, 0], fl.h, { minVolume: 0.002 }); D.canalToPatient(mp, cs); let outT = 0; for (let q = 0; q < mp.positions.length; q += 3) if (tf(mp.positions[q], mp.positions[q + 1], mp.positions[q + 2]) > 0.05) outT++;
    ok(same && (due ? fl.any.presumed && both < 60 && mp.indices.length > 30 && N.isWatertight(mp) && outT === 0 && N.meshVolume(mp) < 0.2 : !fl.any.presumed && mp.indices.length === 0), `${fdi}: the field comes in two parts that make up the whole${due ? ` (they share ${both} grid points where the presumed tube leaves the hollow); the presumed part is a closed thin tube (${mp.indices.length / 3} triangles, ${N.meshVolume(mp).toFixed(3)} mm³) inside the tooth` : '; there is no presumed part'}`);
    ok(off.presumed === 0 && off.paths.every((L) => L.forcedFrom == null && !L.pres.includes(1)) && Math.abs(off.volume - cs.volume) < 0.05 && off.apexGapAll === off.apexGap && Math.abs(off.apexGap - cs.apexGap) < 1e-9, `${fdi}: with reach: false nothing is carried on (what is seen is the same: ${off.volume.toFixed(1)} mm³, ${off.apexGap.toFixed(1)} mm from the root end)`); }
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
  const open = !cs.error && cs.has(...centreOf(tt, cut + 2)) && cs.has(...centreOf(tt, cut + 3)) && cs.has(...centreOf(tt, 3.2)), below = !cs.error && cs.has(...centreOf(tt, cut - 1.2));
  ok(!cs.error && open && !below && cs.apexGap < 1.5 && cs.pieces === 1, `a tooth still forming (root cut ${(-cut).toFixed(1)} mm long, canal 2.4 mm wide at its open end${hollow ? '; the tooth as found is hollow there' : ''}): the canal is followed to within 1½ mm of the open end, where the wall round it is too thin to ring it (${cs.error || cs.apexGap.toFixed(2) + ' mm from the root end'}), ${cs.error ? '' : cs.volume.toFixed(1) + ' mm³'}, and nothing below the root is taken`);
}
{ // a scan as a clinical machine makes it (blurred by ⅓ mm, noisy, bone as bright as dentine, canals that taper to ¼ mm): the
  // canals are faint dips there, followed as lines
  const tc = Date.now(), C = D.makePhantom({ clinical: true }), cv = C.vol, cteeth = Object.fromEntries(C.truth.teeth.map((t) => [t.name, t])), cT = Math.round(40 + 0.55 * (1700 - 40));
  for (const [fdi, wantCanals] of [[36, 3], [45, 1]]) {
    const tt = cteeth[fdi], seed = centreOf(tt, tt.crown * 0.35), roi = { shape: 'cyl', c: [seed[0], seed[1]], r: 7, z0: seed[2] - 22, z1: seed[2] + 22 }; let seg = D.segmentTooth(cv, { seeds: [seed], roi, T: cT });
    if (!seg.error && seg.top && Math.hypot(seg.top[0] - roi.c[0], seg.top[1] - roi.c[1]) > 1) seg = D.segmentTooth(cv, { seeds: [seed], roi: { ...roi, c: [seg.top[0], seg.top[1]] }, T: cT });
    if (seg.error) { ok(false, `clinical ${fdi}: ${seg.error}`); continue; }
    // the tooth itself against its true shape
    const tf = D.phantomToothField(tt), { lab, box } = seg, sp = cv.spacing, og = cv.origin; let got = 0, tru = 0, extra = 0, miss = 0;
    for (let k = 0; k < box.nz; k++) for (let j = 0; j < box.ny; j++) for (let i = 0; i < box.nx; i++) { const val = tf(og[0] + (box.i0 + i) * sp[0], og[1] + (box.j0 + j) * sp[1], og[2] + (box.k0 + k) * sp[2]), on = lab[i + box.nx * (j + box.ny * k)]; if (on) { got++; if (val > 0.3) extra++; } if (val < 0) { tru++; if (!on && val < -0.3) miss++; } }
    const vv = sp[0] * sp[1] * sp[2];
    ok(Math.abs(got / tru - 1) < 0.05 && extra * vv < 4 && miss * vv < 8 && seg.touch === 0, `clinical scan, ${fdi}: tooth found ${(got * vv).toFixed(0)} mm³ (true ${(tru * vv).toFixed(0)}), ${(extra * vv).toFixed(1)} mm³ of it more than 0.3 mm outside the true tooth, ${(miss * vv).toFixed(1)} mm³ of the true tooth missed; levels ${JSON.stringify(seg.levels)}`);
    // its roots, standing in bone as bright as they are, are redrawn as smooth curves: no bumps or spikes on them. Per slice
    // and root, the outline's length in voxel edges over that of an outline with no bump or hollow in it (1 = none)
    const spiky = (sg) => { const { lab: L, box: b } = sg, at = (i, j, k) => i >= 0 && j >= 0 && i < b.nx && j < b.ny && L[i + b.nx * (j + b.ny * k)] === 1, per = []; for (let k = 0; k < b.nz; k++) { let n = 0; for (let q = 0; q < b.nx * b.ny; q++) if (L[k * b.nx * b.ny + q] === 1) n++; per.push(n); }
      const big = Math.max(...per), kb = per.indexOf(big), first = per.findIndex((n) => n > 0), last = per.length - 1 - per.slice().reverse().findIndex((n) => n > 0), rootBelow = kb - first > last - kb; let sum = 0, cnt = 0, worst = 0;
      for (let k = first; k <= last; k++) { if (!(per[k] < 0.6 * big) || (rootBelow ? k > kb : k < kb)) continue; const seen = new Uint8Array(b.nx * b.ny);
        for (let j = 0; j < b.ny; j++) for (let i = 0; i < b.nx; i++) { if (!at(i, j, k) || seen[i + b.nx * j]) continue; const st = [[i, j]]; seen[i + b.nx * j] = 1; let e = 0, a = 0, x0 = i, x1 = i, y0 = j, y1 = j;
          while (st.length) { const [x, y] = st.pop(); a++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const u = x + dx, v = y + dy; if (!at(u, v, k)) e++; else if (!seen[u + b.nx * v]) { seen[u + b.nx * v] = 1; st.push([u, v]); } } }
          if (a < 12) continue; const r = e / (2 * (x1 - x0 + 1 + y1 - y0 + 1)); sum += r; cnt++; worst = Math.max(worst, r); } }
      return { mean: sum / Math.max(1, cnt), worst, n: cnt }; };
    const drawn = D.segmentTooth(cv, { seeds: [seed], roi: seg.roi || { ...roi, c: seg.top ? [seg.top[0], seg.top[1]] : roi.c }, T: cT, smoothRoots: false }), sA = spiky(drawn), sB = spiky(seg);
    ok(!drawn.error && sB.n > 20 && sB.mean < 1.04 && sB.worst < 1.2 && sB.mean < sA.mean - 0.01, `clinical scan, ${fdi}: the roots are redrawn as smooth curves — outline ${((sB.mean - 1) * 100).toFixed(1)} % longer than one with no bump or hollow in it (worst slice ${((sB.worst - 1) * 100).toFixed(0)} %; ${sB.n} root outlines); as drawn voxel by voxel ${((sA.mean - 1) * 100).toFixed(1)} % (worst ${((sA.worst - 1) * 100).toFixed(0)} %)`);
    const cs = D.segmentCanal(cv, seg); if (cs.error) { ok(false, `clinical ${fdi}: ${cs.error}`); continue; }
    // every line against the true pulp; and how much of the true canals was found, slice by slice across the tooth
    const pf = D.phantomPulpField(tt), onTrue = cs.paths.map((L) => L.pts.filter((x) => pf(x[0], x[1], x[2]) < 0.15).length / L.pts.length), { n: [n0, n1, n2], h, O, u, v: gv, w } = cs.grid, sl = n0 * n1, X = (i, j, k) => [0, 1, 2].map((a) => O[a] + h * (i * u[a] + j * gv[a] + k * w[a]));
    let pieces = 0, hit = 0; const tr2 = new Uint8Array(sl), seen = new Uint8Array(sl), R = Math.ceil(0.4 / h);
    for (let k = 0; k < n2; k++) { for (let j = 0; j < n1; j++) for (let i = 0; i < n0; i++) { const x = X(i, j, k); tr2[i + n0 * j] = pf(x[0], x[1], x[2]) < 0 ? 1 : 0; } seen.fill(0);
      for (let r0 = 0; r0 < sl; r0++) { if (!tr2[r0] || seen[r0]) continue; const st = [r0], comp = []; seen[r0] = 1; while (st.length) { const r = st.pop(), i = r % n0, j = (r / n0) | 0; comp.push(r); for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= n0 || jj >= n1) continue; const q = ii + n0 * jj; if (tr2[q] && !seen[q]) { seen[q] = 1; st.push(q); } } }
        const ci = Math.round(comp.reduce((a, r) => a + r % n0, 0) / comp.length), cj = Math.round(comp.reduce((a, r) => a + ((r / n0) | 0), 0) / comp.length); let found = false; for (let b = -R; b <= R && !found; b++) for (let a = -R; a <= R && !found; a++) { const ii = ci + a, jj = cj + b; if (ii >= 0 && jj >= 0 && ii < n0 && jj < n1 && a * a + b * b <= R * R && cs.mask[ii + n0 * jj + sl * k]) found = true; } pieces++; if (found) hit++; } }
    ok(cs.paths.length === wantCanals && cs.canals === wantCanals && onTrue.every((x) => x > 0.9) && hit / pieces > 0.6 && cs.pieces === 1 && cs.faint > 6,
      `clinical scan, ${fdi}: ${cs.paths.length} canal${cs.paths.length === 1 ? '' : 's'} followed as lines (true ${wantCanals}), ${cs.faint.toFixed(1)} mm of them by their faint dip alone; ${onTrue.map((x) => (100 * x).toFixed(0) + ' %').join(', ')} of each line on the true canal; ${(100 * hit / pieces).toFixed(0)} % of the true canals’ cross-sections found (their last millimetres taper below what the scan can show); noise floor ${cs.noise.floor.toFixed(3)}`);
    { let pn = 0, pOn = 0, far = 0; const tf = D.phantomToothField(tt); for (const L of cs.paths) L.pts.forEach((x, a) => { if (!L.pres[a]) return; pn++; const dv = pf(x[0], x[1], x[2]); if (dv < 0.3) pOn++; if (tf(x[0], x[1], x[2]) > 0) far++; });
      // (here the true canals do go on, tapering below what the scan shows: the presumed course can be held against them)
      ok(pn > 3 && pOn / pn > 0.8 && far === 0 && cs.apexGapAll < 1.2 && cs.apexGapAll < cs.apexGap - 1, `clinical scan, ${fdi}: seen to ${cs.apexGap.toFixed(1)} mm from the root end and carried on to ${cs.apexGapAll.toFixed(1)} mm; of the ${pn} presumed points (${cs.presumed.toFixed(1)} mm) ${pOn} lie within 0.3 mm of the true canal, which the scan no longer shows there, and none outside the tooth (${cs.roots} root tips)`); }
    const f = D.canalField(cs), m = N.isoMesh(f.F, f.n[0], f.n[1], f.n[2], [0, 0, 0], f.h, { minVolume: 0.004 }); D.canalToPatient(m, cs); const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; for (let q = 0; q < m.positions.length; q += 3) for (let a = 0; a < 3; a++) { bb.min[a] = Math.min(bb.min[a], m.positions[q + a]); bb.max[a] = Math.max(bb.max[a], m.positions[q + a]); }
    ok(m.indices.length > 1000 && N.isWatertight(m) && bb.min[2] < cs.lo[2] + 0.5 && bb.max[2] > cs.hi[2] - 1, `clinical scan, ${fdi}: the canals as a closed surface (${m.indices.length / 3} triangles on a ${f.h.toFixed(3)} mm grid) spanning z ${bb.min[2].toFixed(1)} … ${bb.max[2].toFixed(1)} (canals ${cs.lo[2].toFixed(1)} … ${cs.hi[2].toFixed(1)})`);
  }
  console.log(`  (clinical phantom: ${((Date.now() - tc) / 1000).toFixed(0)} s)`);
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
