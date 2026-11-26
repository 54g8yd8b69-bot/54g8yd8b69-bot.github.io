// u2-volume.mjs — the volume tools of shared/dicom.js against the phantom's exact geometry (node):
//   the proposed arch passes through the teeth in order; the panorama shows them in order; cross-sections have the right
//   scale; a tooth cut out and made into a replica matches the true tooth (volume, surface distance) — a lone premolar and
//   one in tight contact with its neighbour; the enlargement adds what it should; the surface at a bone threshold is closed
//   and in the right place.          node dev/tests/cbct-card/u2-volume.mjs [fdi …]
import * as D from '../../../shared/dicom.js';
import * as N from '../../../shared/core.js';
const THREE = N.THREE;
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { fails++; process.exitCode = 1; } };
const t0 = Date.now(), { vol, truth } = D.makePhantom({ voxel: 0.3 }), teeth = truth.teeth, V = truth.values;
console.log(`phantom ${vol.dims.join('×')} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const byName = Object.fromEntries(teeth.map((t) => [t.name, t]));
const centreOf = (t, c = 0) => [0, 1, 2].map((q) => t.base[q] + t.w[q] * c);
const order = [47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37];

// ── windows ──
const W = D.windowPresets(vol); ok(W.hu && W.bone.w === 2600 && W.soft.l === 40, `window presets: Hounsfield-like scan detected; bone ${W.bone.l}/${W.bone.w}, teeth ${W.teeth.l}/${W.teeth.w}, soft ${W.soft.l}/${W.soft.w}`);

// ── the arch ──
let t = Date.now(); const A = D.proposeArch(vol); const curve = D.archCurve(A.points);
const proj = (p) => { let best = Infinity, bs = 0; for (let i = 0; i < curve.pts.length; i++) { const d = Math.hypot(curve.pts[i][0] - p[0], curve.pts[i][1] - p[1]); if (d < best) { best = d; bs = curve.s[i]; } } return { d: best, s: bs }; };
const pr = order.map((f) => ({ f, ...proj(byName[f].base) }));
const maxOff = Math.max(...pr.map((p) => p.d)), inOrder = pr.every((p, i) => i === 0 || p.s > pr[i - 1].s);
ok(maxOff < 2.0 && inOrder, `proposed arch (${A.points.length} points, ${curve.length.toFixed(1)} mm, ${((Date.now() - t) / 1000).toFixed(2)} s) passes within ${maxOff.toFixed(2)} mm of every tooth's axis, teeth in order 47 → 37: ${inOrder}`);

// ── the panorama ──
t = Date.now(); const P = D.panorama(vol, curve, { slab: 5 });
const prow = (z) => P.rows - 1 - Math.round((z - vol.origin[2]) / vol.spacing[2]), pval = (s, z) => P.data[prow(z) * P.cols + Math.round(s / P.px - 0.5)];
let bright = 0, darkBetween = 0, pairs = 0;
pr.forEach((p, i) => { const tt = byName[p.f], z = tt.base[2] + tt.crown * 0.7; if (pval(p.s, z) > (V.soft + V.dentine) / 2) bright++; if (i > 0) { const q = pr[i - 1], tq = byName[q.f], zm = Math.min(z, tq.base[2] + tq.crown * 0.7) + 0.6, mid = pval((p.s + q.s) / 2, zm); pairs++; if (mid < Math.min(pval(p.s, zm), pval(q.s, zm)) - 300) darkBetween++; } });
ok(bright === 14 && darkBetween >= 12, `panorama ${P.cols}×${P.rows} (${((Date.now() - t) / 1000).toFixed(2)} s): all ${bright} of 14 crowns bright at their place along the arch; darker between neighbours for ${darkBetween} of ${pairs} pairs (35|36 touch)`);
// cross-section: bone width square to the arch between two teeth, half way down the bone, should be 2 × boneHalf
{
  const s = (pr[3].s + pr[4].s) / 2, X = D.crossSection(vol, curve, s, { width: 30 }), z = (V.crest + V.boneBottom) / 2, r = X.rows - 1 - Math.round((z - vol.origin[2]) / vol.spacing[2]);
  const row = Array.from(X.data.subarray(r * X.cols, (r + 1) * X.cols)), half = (V.cortex + V.soft) / 2; let a = -1, b = -1;
  for (let c = 1; c < row.length; c++) { if (a < 0 && row[c - 1] < half && row[c] >= half) a = c - 1 + (half - row[c - 1]) / (row[c] - row[c - 1]); if (row[c - 1] >= half && row[c] < half) b = c - 1 + (row[c - 1] - half) / (row[c - 1] - row[c]); }
  const w = (b - a) * X.px; ok(Math.abs(w - 2 * V.boneHalf) < 0.35, `cross-section between 44 and 43: bone ${w.toFixed(2)} mm wide half way down (true ${(2 * V.boneHalf).toFixed(1)} mm, plane square to the arch)`);
}

// ── a tooth cut out, and its replica ──
function trueVolume(tt, h = 0.06) {
  const f = D.phantomToothField(tt), R = Math.max(tt.md, tt.bl) / 2 + 3, lo = [tt.base[0] - R, tt.base[1] - R, tt.base[2] - tt.root - 2], hi = [tt.base[0] + R, tt.base[1] + R, tt.base[2] + tt.crown + 2]; let n = 0;
  for (let z = lo[2]; z < hi[2]; z += h) for (let y = lo[1]; y < hi[1]; y += h) for (let x = lo[0]; x < hi[0]; x += h) if (f(x, y, z) < 0) n++;
  return n * h * h * h;
}
function trueSurface(tt, h = 0.12) {
  const f = D.phantomToothField(tt), R = Math.max(tt.md, tt.bl) / 2 + 3, lo = [tt.base[0] - R, tt.base[1] - R, tt.base[2] - tt.root - 2], n = [Math.ceil(2 * R / h), Math.ceil(2 * R / h), Math.ceil((tt.root + tt.crown + 4) / h)], F = new Float32Array(n[0] * n[1] * n[2]);
  for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) F[i + n[0] * (j + n[1] * k)] = f(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
  return N.isoMesh(F, n[0], n[1], n[2], lo, h);
}
function distances(mesh, pts) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.indices), 1));
  const bvh = new N.MeshBVH(g), hit = {}, v = new THREE.Vector3(), out = [];
  for (let i = 0; i < pts.length; i += 3) { bvh.closestPointToPoint(v.set(pts[i], pts[i + 1], pts[i + 2]), hit); out.push(hit.distance); }
  return out.sort((a, b) => a - b);
}
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
function replicaOf(tt, o = {}) {
  const seed = centreOf(tt, tt.crown * 0.35), roi = { shape: 'cyl', c: [seed[0], seed[1]], r: o.r || 7, z0: seed[2] - 20, z1: seed[2] + 14 };
  const t1 = Date.now(), seg = D.segmentTooth(vol, { seeds: [seed], not: o.not || [], roi, T: o.T ?? 1000 }); if (seg.error) return { error: seg.error };
  const fld = D.replicaField(vol, seg, { smooth: o.smooth ?? 0.15, handle: o.handle || null });
  let mesh = N.isoMesh(fld.F, fld.n[0], fld.n[1], fld.n[2], fld.origin, fld.h, { minVolume: 5 }); D.taubin(mesh, o.taubin ?? 4); if (o.pdl) D.offsetMesh(mesh, o.pdl);
  return { seg, mesh, ms: Date.now() - t1 };
}
const ONLY = process.argv.slice(2).map(Number);
for (const f of ONLY.length ? ONLY : [45, 35, 31, 46]) {
  const tt = byName[f], r = replicaOf(tt); if (r.error) { ok(false, `${f}: ${r.error}`); continue; }
  const tv = trueVolume(tt), mv = N.meshVolume(r.mesh), closed = N.isWatertight(r.mesh), fld = D.phantomToothField(tt);
  const out = []; for (let i = 0; i < r.mesh.positions.length; i += 3) out.push(Math.abs(fld(r.mesh.positions[i], r.mesh.positions[i + 1], r.mesh.positions[i + 2]))); out.sort((a, b) => a - b);
  const ts = trueSurface(tt), back = distances(r.mesh, ts.positions);
  const err = (mv - tv) / tv * 100;
  ok(closed && Math.abs(err) < 3 && q(out, 0.5) < 0.08 && q(out, 0.95) < 0.25 && q(back, 0.99) < 0.4,
    `${f}${f === 35 ? ' (touching 36)' : ''}: replica ${mv.toFixed(0)} mm³ vs true ${tv.toFixed(0)} mm³ (${err >= 0 ? '+' : ''}${err.toFixed(1)}%), closed ${closed}; replica→true median ${q(out, 0.5).toFixed(3)}, 95% ${q(out, 0.95).toFixed(3)} mm; true→replica 95% ${q(back, 0.95).toFixed(3)}, 99% ${q(back, 0.99).toFixed(3)}, max ${back[back.length - 1].toFixed(2)} mm · ${(r.ms / 1000).toFixed(1)} s · seg ${r.seg.volume.toFixed(0)} mm³ touch ${r.seg.touch} · crown ${r.seg.crown > 0 ? 'up' : 'down'}`);
  if (f === 45) {
    const e = replicaOf(tt, { pdl: 0.3 }), area = N.meshArea(r.mesh), ev = N.meshVolume(e.mesh), want = mv + area * 0.3;
    ok(N.isWatertight(e.mesh) && Math.abs(ev - want) / want < 0.02, `45 enlarged 0.3 mm: ${ev.toFixed(0)} mm³, expected about ${want.toFixed(0)} (volume + area ${area.toFixed(0)} mm² × 0.3)`);
    const hdl = replicaOf(tt, { handle: { r: 1.5, length: 8 } }), hv = N.meshVolume(hdl.mesh), peg = Math.PI * 1.5 * 1.5 * 8, top = Math.max(...Array.from({ length: hdl.mesh.positions.length / 3 }, (_, i) => hdl.mesh.positions[3 * i + 2]));
    ok(N.isWatertight(hdl.mesh) && N.splitParts(hdl.mesh).length === 1 && Math.abs(hv - mv - peg) < 0.25 * peg && top > tt.base[2] + tt.crown + 6, `45 with a handle: one closed piece, ${hv.toFixed(0)} mm³ (tooth ${mv.toFixed(0)} + peg about ${peg.toFixed(0)}), reaching z = ${top.toFixed(1)} (crown tip ${(tt.base[2] + tt.crown).toFixed(1)})`);
  }
}

// ── an upper tooth: the phantom turned upside down (crowns point down), and a box instead of a cylinder ──
if (!ONLY.length) {
  const [nx, ny, nz] = vol.dims, flip = new Int16Array(vol.data.length), S = nx * ny; for (let k = 0; k < nz; k++) flip.set(vol.data.subarray(k * S, (k + 1) * S), (nz - 1 - k) * S);
  const up = { ...vol, data: flip }, zf = (z) => 2 * vol.origin[2] + (nz - 1) * vol.spacing[2] - z, tt = byName[45], seed = centreOf(tt, tt.crown * 0.35); seed[2] = zf(seed[2]);
  const sg = D.segmentTooth(up, { seeds: [seed], roi: { shape: 'box', c: [seed[0], seed[1]], r: 7, z0: seed[2] - 20, z1: seed[2] + 20 }, T: 955 });
  const f = D.replicaField(up, sg, { smooth: 0.15, handle: { r: 1.5, length: 8 } }), m = N.isoMesh(f.F, f.n[0], f.n[1], f.n[2], f.origin, f.h, { minVolume: 5 }); D.taubin(m, 4);
  const low = Math.min(...Array.from({ length: m.positions.length / 3 }, (_, i) => m.positions[3 * i + 2])), tip = zf(tt.base[2] + tt.crown);
  ok(!sg.error && Math.abs(sg.volume - 422) / 422 < 0.03 && sg.crown * sg.axis[2] < 0 && low < tip - 6 && N.isWatertight(m), `45 as an upper tooth (scan upside down), in a box: ${sg.volume.toFixed(0)} mm³, crown found pointing down, the handle goes down from the crown (to z ${low.toFixed(1)}, crown tip ${tip.toFixed(1)}), closed`);
  const A2 = D.proposeArch(up), c2 = A2 && D.archCurve(A2.points), far = c2 ? Math.max(...order.map((fdi) => { const b = byName[fdi].base; let best = Infinity; for (const p of c2.pts) best = Math.min(best, Math.hypot(p[0] - b[0], p[1] - b[1])); return best; })) : Infinity;
  ok(far < 2, `the arch is proposed on the upside-down scan too (furthest tooth ${far.toFixed(2)} mm from the curve)`);
}

// ── the surface at a bone threshold ──
if (!ONLY.length) {
  t = Date.now(); const sf = D.surfaceField(vol, 700, 0.5), m = N.isoMesh(sf.F, sf.n[0], sf.n[1], sf.n[2], sf.origin, sf.h, { minVolume: 20 }), closed = N.isWatertight(m);
  const fields = teeth.map((tt) => [D.phantomToothField(tt), D.phantomPulpField(tt)]), bb = N.meshBounds(m); const dd = [];
  for (let i = 0; i < m.positions.length; i += 3 * 7) {
    const x = m.positions[i], y = m.positions[i + 1], z = m.positions[i + 2]; let tmin = Infinity, pulp = Infinity; for (const [f, g] of fields) { const v = f(x, y, z); if (v < tmin) { tmin = v; pulp = g(x, y, z); } }
    const b = truth.boneField(x, y, z), lam = tmin - V.pdlWidth;
    // where the scan crosses 700: the outside of bone ∪ teeth, the inside of the cortex (spongy bone is darker), each tooth's surface
    // (against its ligament), the lining of each socket (both sides), and the pulp
    dd.push(Math.min(Math.abs(Math.min(b, tmin)), Math.abs(b + 1.4), Math.abs(tmin), Math.abs(lam), Math.abs(lam - 0.45), Math.abs(pulp)));
  }
  dd.sort((a, b) => a - b);
  ok(closed && q(dd, 0.5) < 0.12 && q(dd, 0.95) < 0.35, `surface at 700 on a 0.5 mm grid (${((Date.now() - t) / 1000).toFixed(1)} s): ${(m.indices.length / 3).toLocaleString()} triangles, closed ${closed}; distance to the true boundary median ${q(dd, 0.5).toFixed(3)}, 95% ${q(dd, 0.95).toFixed(3)} mm; spans x ${bb.min[0].toFixed(1)} … ${bb.max[0].toFixed(1)}, z ${bb.min[2].toFixed(1)} … ${bb.max[2].toFixed(1)}`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
