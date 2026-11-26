// Writes the Obturator Card test data to dev/data (synthetic only — no patient scans):
//   obt-defect-upper.stl   the demo upper arch after a partial maxillectomy on the patient's left (Aramany class II): 24–27 gone and a
//                          cavity of exactly known shape cut up through the alveolus and palate. The cavity is a rounded rectangle in plan
//                          whose walls lean in by TAPER° as they rise (so they face the path of insertion: no undercut), closed by a flat
//                          roof with a rounded edge, plus a spherical pocket in its lateral wall (an undercut the bulb must not enter
//                          unless it is allowed to).
//   obt-preop-upper.stl    the full demo upper arch (the scan before surgery, for the surgical obturator)
//   obt-lower.stl          the demo lower arch (not needed by the tool; lets the pair load as a case)
//   obt-truth.json         the cavity's parameters, taps on the defect's rim, a plate outline, a resection line and its plate outline,
//                          and the remaining teeth — all in the STL files' own coordinates (= the case frame of the demo)
// The cavity is cut with Manifold from the scan closed into a solid, and only the scan's own triangles and the cavity's wall are kept,
// so the scan stays an open surface like a real one. sdfCav() below is the exact truth for the defect's walls.
import fs from 'fs';
import * as N from '/home/claude/suite/shared/core.js';
import * as S from '/home/claude/suite/shared/solid.js';
const THREE = N.THREE, DATA = '/home/claude/suite/dev/data/';
const TAPER = 6, CAV = { cx: 17, cy: 4, ax: 7, ay: 10, r: 5, zref: 8, tan: Math.tan(TAPER * Math.PI / 180), cos: Math.cos(TAPER * Math.PI / 180), zroof: 30, roofR: 3, bottom: 3.5, pocketZ: 17, pocketR: 2.5 };
CAV.pocket = [CAV.cx + CAV.ax - (CAV.pocketZ - CAV.zref) * CAV.tan, CAV.cy, CAV.pocketZ];   // centred on the lateral wall at that height
const roundI = (a, b, r) => Math.min(-r, Math.max(a, b)) + Math.hypot(Math.max(r + a, 0), Math.max(r + b, 0));
/** horizontal signed distance to the tapered rounded rectangle, times cos(taper): the true distance to its leaning walls */
export function sdfSide(x, y, z, c = CAV) {
  const qx = Math.abs(x - c.cx) - (c.ax - c.r), qy = Math.abs(y - c.cy) - (c.ay - c.r);
  const d2 = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - c.r;
  return (d2 + (z - c.zref) * c.tan) * c.cos;
}
export function sdfCav(x, y, z, c = CAV) {
  let f = roundI(sdfSide(x, y, z, c), z - c.zroof, c.roofR); f = Math.max(f, c.bottom - z);
  return Math.min(f, Math.hypot(x - c.pocket[0], y - c.pocket[1], z - c.pocket[2]) - c.pocketR);
}
const bvhOf = (m) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(m.indices), 1)); return new N.MeshBVH(g); };

async function main() {
  await S.ready();
  const pair = N.makeDemoPair({ res: 0.3, missing: { 24: true, 25: true, 26: true, 27: true } }), U = pair.upper;
  const pre = N.makeDemoPair({ res: 0.3 });
  const W = N.rotationAbout('y', 180);                                     // work frame: teeth up, so the scan closes like a lower arch
  const UW = N.transformMesh(U, W), bw = N.meshBounds(UW), closed = S.scanToSolid(UW, { baseZ: bw.min[2] - 26 });
  const w = (await S.ready()), c = CAV;
  // the cavity in the work frame (x → −x, z → −z); levelSet wants positive inside
  const cav = w.Manifold.levelSet((p) => -sdfCav(-p[0], p[1], -p[2]), { min: [-(c.cx + c.ax + 4), c.cy - c.ay - 4, -(c.zroof + 1.5)], max: [-(c.cx - c.ax - 4), c.cy + c.ay + 4, -(c.bottom - 1)] }, 0.3, 0);
  const tissue = S.toManifold(closed.mesh), cut = tissue.subtract(cav), out = N.transformMesh(S.fromManifold(cut), W); S.free(tissue, cav, cut);
  // keep the scan's own triangles and the cavity's wall; drop the base and the walls that closed the scan
  const bU = bvhOf(U), hit = {}, q = new THREE.Vector3(), P = out.positions, I = out.indices, keep = [];
  let nScan = 0, nWall = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = 3 * I[t], b = 3 * I[t + 1], cc = 3 * I[t + 2]; q.set((P[a] + P[b] + P[cc]) / 3, (P[a + 1] + P[b + 1] + P[cc + 1]) / 3, (P[a + 2] + P[b + 2] + P[cc + 2]) / 3);
    bU.closestPointToPoint(q, hit); if (hit.distance < 0.003) { keep.push(I[t], I[t + 1], I[t + 2]); nScan++; continue; }
    if (Math.abs(sdfCav(q.x, q.y, q.z)) < 0.2) { keep.push(I[t], I[t + 1], I[t + 2]); nWall++; }
  }
  const defect = N.cleanMesh(N.compact({ positions: P, indices: Uint32Array.from(keep) })).mesh;
  const loops = N.boundaryLoops(defect), er = N.edgeReport ? N.edgeReport(defect) : null;
  console.log('defect scan:', defect.indices.length / 3, 'triangles (', nScan, 'from the scan,', nWall, 'cavity wall ), border loops', loops.length, er ? JSON.stringify(er) : '');
  if (process.env.DBG) for (const l of loops.slice(1)) { const v = l.verts[0] * 3, Pp = defect.positions; console.log("hole", l.verts.length, [Pp[v], Pp[v + 1], Pp[v + 2]].map((x) => x.toFixed(2)).join(","), "sdf", sdfCav(Pp[v], Pp[v + 1], Pp[v + 2]).toFixed(3)); }
  if (loops.length !== 1) throw new Error('expected one border loop, got ' + loops.length);
  fs.writeFileSync(DATA + 'obt-defect-upper.stl', Buffer.from(N.stlBinary(defect, null, 'synthetic maxilla with a defect')));
  fs.writeFileSync(DATA + 'obt-preop-upper.stl', Buffer.from(N.stlBinary(pre.upper, null, 'synthetic maxilla before surgery')));
  fs.writeFileSync(DATA + 'obt-lower.stl', Buffer.from(N.stlBinary(pair.lower, null, 'synthetic mandible')));

  // ── taps on the rim of the defect: where the original oral surface meets the cavity's side, 18 round it
  const ray = new THREE.Ray(), zOral = (b, x, y) => { ray.origin.set(x, y, -40); ray.direction.set(0, 0, 1); const h = b.raycastFirst(ray, THREE.DoubleSide); return h ? h.point.z : NaN; };
  const rim = [];
  for (let k = 0; k < 18; k++) {
    const th = 2 * Math.PI * k / 18, ux = Math.cos(th), uy = Math.sin(th), f = (r) => sdfSide(c.cx + r * ux, c.cy + r * uy, zOral(bU, c.cx + r * ux, c.cy + r * uy));
    let lo = 0, hi = 0.2; while (f(hi) < 0) { lo = hi; hi += 0.2; if (hi > 20) throw new Error('rim not found'); }
    for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; }
    const r = (lo + hi) / 2, x = c.cx + r * ux, y = c.cy + r * uy; rim.push([x, y, zOral(bU, x, y)]);
  }
  // ── a plate outline: palatal to each remaining tooth, along the posterior palate, and round the defect 4 mm outside its rim
  const BL = [7.0, 6.2, 8.0, 9.0, 9.0, 11.0, 10.8], PC = [0, 4], bD = bvhOf(defect);
  const palatal = (t, extra) => { const ux = PC[0] - t.centre[0], uy = PC[1] - t.centre[1], L = Math.hypot(ux, uy), s = BL[t.type - 1] / 2 + extra, x = t.centre[0] + ux / L * s, y = t.centre[1] + uy / L * s; return [x, y]; };
  const kept = pair.truth.upper.teeth, cand = [];
  for (const t of kept) cand.push(palatal(t, 2.0));
  for (const x of [-20, -10, 0, 10]) cand.push([x, 19]);
  for (let k = 0; k < 18; k++) { const th = 2 * Math.PI * k / 18, deg = th * 180 / Math.PI; if (!(deg <= 80 || deg >= 300)) continue; const p = rim[k], ux = p[0] - c.cx, uy = p[1] - c.cy, L = Math.hypot(ux, uy); cand.push([p[0] + ux / L * 4, p[1] + uy / L * 4]); }
  cand.sort((a, b) => Math.atan2(a[1] - PC[1], a[0] - PC[0]) - Math.atan2(b[1] - PC[1], b[0] - PC[0]));
  const outline = cand.map(([x, y]) => [x, y, zOral(bD, x, y)]);
  if (outline.some((p) => !Number.isFinite(p[2]))) throw new Error('an outline point missed the scan');
  // ── the surgical case: a resection line on the left (from palatal of the 22/23 contact back along x ≈ 5) and a full palatal outline
  const bP = bvhOf(pre.upper), pt = pre.truth.upper.teeth, t22 = pt.find((t) => t.fdi === 22), t23 = pt.find((t) => t.fdi === 23);
  const a22 = palatal(t22, 1.0), a23 = palatal(t23, 1.0), cutXY = [[(a22[0] + a23[0]) / 2, (a22[1] + a23[1]) / 2], [7, -9], [5.5, -1], [5, 8], [5, 15], [5, 20]];
  const cutLine = cutXY.map(([x, y]) => [x, y, zOral(bP, x, y)]);
  const cand2 = pt.map((t) => palatal(t, 2.0)); for (const x of [-20, -10, 0, 10, 20]) cand2.push([x, 19]);
  cand2.sort((a, b) => Math.atan2(a[1] - PC[1], a[0] - PC[0]) - Math.atan2(b[1] - PC[1], b[0] - PC[0]));
  const outline2 = cand2.map(([x, y]) => [x, y, zOral(bP, x, y)]);
  const truth = {
    note: 'Synthetic. Coordinates are the STL files’ own (the demo case frame: +X patient’s left, +Y back, +Z up; upper teeth point −Z).',
    cavity: { ...CAV, taperDeg: TAPER }, rim, outline,
    teeth: kept.map((t) => ({ fdi: t.fdi, type: t.type, centre: t.centre, tip: t.tip, width: t.width, bl: BL[t.type - 1] })),
    surgical: { cut: cutLine, outline: outline2, side: 'left', teeth: pt.map((t) => ({ fdi: t.fdi, centre: t.centre, tip: t.tip, bl: BL[t.type - 1] })) },
  };
  fs.writeFileSync(DATA + 'obt-truth.json', JSON.stringify(truth, null, 1));
  const rz = rim.map((p) => p[2]); console.log('rim taps', rim.length, 'heights', Math.min(...rz).toFixed(2), '–', Math.max(...rz).toFixed(2), 'mean', (rz.reduce((a, b) => a + b, 0) / rz.length).toFixed(2), '· outline', outline.length, 'taps · surgical outline', outline2.length, 'cut', cutLine.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
