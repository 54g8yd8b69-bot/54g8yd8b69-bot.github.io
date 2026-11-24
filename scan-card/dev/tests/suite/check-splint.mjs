// Independent check of a splint, written without reference to the splint app's own tests.
//   node dev/tests/suite/check-splint.mjs <case.zip> [opposing-in-opened-position.stl]
// Reads the case the app saved (scans + the appliance + its settings) and measures the appliance against the scan.
import * as N from '../../../shared/core.js';
import fs from 'fs';
const T = N.THREE, [caseFile, oppFile] = process.argv.slice(2);
const rd = (f) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const dc = await N.DentalCase.fromBlob(new Blob([rd(caseFile)])), sp = dc.get('splint'), P = dc.data.splint && (dc.data.splint.params || dc.data.splint.P || dc.data.splint);
if (!sp) { console.log('FAIL no splint item in the case'); process.exit(1); }
const jaw = P.jaw || (sp.meta && sp.meta.jaw), c = P.clearance, X = N.weld(dc.framed(sp).positions, dc.framed(sp).indices), A = dc.framed(jaw + '-scan');
let fails = 0; const ok = (cond, m) => { if (!cond) fails++; console.log(cond ? '  ok  ' : '  FAIL', m); };
const q = (arr, p) => { const s = Float64Array.from(arr).sort(); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))] : NaN; };
console.log(`appliance on the ${jaw} arch · type ${P.type} · clearance ${c} · retention ${P.retention} · thickness ${P.thickness}${P.type === 'flat' ? ' · occlusal ' + P.occlusal : ''}`);
// 1. closed, one piece
{ const er = N.edgeReport(X), cl = N.cleanMesh(X, { keepIslands: true }).report;
  ok(er.open === 0 && er.flipped === 0 && N.meshVolume(X) > 0 && cl.parts === 1, `closed surface, one piece: open edges ${er.open}, flipped ${er.flipped}, touching edges ${er.nonManifold / 4 | 0}, parts ${cl.parts}, volume ${(N.meshVolume(X) / 1000).toFixed(2)} mL, ${X.indices.length / 3} triangles`); }
// scan surface with face normals (to tell which side of the tooth surface a point is on)
const gA = N.toGeometry({ positions: A.positions, indices: A.indices.slice() }), bA = gA.boundsTree, IA = A.indices, PA = A.positions, o = {}, p = new T.Vector3(), a = new T.Vector3(), b = new T.Vector3(), d = new T.Vector3(), n = new T.Vector3();
const signedToScan = (x, y, z) => { p.set(x, y, z); bA.closestPointToPoint(p, o); const f = o.faceIndex * 3; a.fromArray(PA, IA[f] * 3); b.fromArray(PA, IA[f + 1] * 3); d.fromArray(PA, IA[f + 2] * 3); n.copy(b).sub(a).cross(d.sub(a)).normalize(); return (p.sub(o.point).dot(n) >= 0 ? 1 : -1) * o.distance; };
// 2. seating: no appliance vertex may be closer to the tooth surface than clearance − 0.03, or behind it
const PX = X.positions, dist = new Float32Array(PX.length / 3); let minS = Infinity, tooClose = 0, pastEdge = 0; const where = [];
const rimA = []; { const lp = N.boundaryLoops(A); for (const l of lp) for (let k = 0; k < l.verts.length; k++) rimA.push([l.verts[k], l.verts[(k + 1) % l.verts.length]]); }
const rimPts = new Float32Array(rimA.length * 3); rimA.forEach((e, k) => { for (let j = 0; j < 3; j++) rimPts[3 * k + j] = (PA[3 * e[0] + j] + PA[3 * e[1] + j]) / 2; });
const nearScanEdge = (q) => { for (let k = 0; k < rimPts.length; k += 3) if (Math.abs(rimPts[k] - q.x) < 0.4 && Math.abs(rimPts[k + 1] - q.y) < 0.4 && Math.abs(rimPts[k + 2] - q.z) < 0.4) return true; return false; };
for (let i = 0; i < dist.length; i++) { const s = Math.abs(signedToScan(PX[3 * i], PX[3 * i + 1], PX[3 * i + 2])); dist[i] = s; if (s < c - 0.03) { /* distance only: whether anything lies INSIDE a tooth is tested by splint-inside.mjs (solid intersection) */  if (nearScanEdge(o.point)) { pastEdge++; dist[i] = Math.abs(s); continue; } tooClose++; if (where.length < 6) where.push([PX[3 * i], PX[3 * i + 1], PX[3 * i + 2]].map((v) => v.toFixed(1)).join(',') + ' → ' + s.toFixed(3)); } if (dist[i] < minS) minS = dist[i]; }
ok(tooClose === 0, `seating: closest any appliance vertex comes to the tooth surface is ${minS.toFixed(3)} mm (must be ≥ ${(c - 0.03).toFixed(2)}); ${tooClose} of ${dist.length} vertices closer${where.length ? ' at ' + where.join(' ; ') : ''}; ${pastEdge} vertices lie past the open edge of the scan (no scan data there)`);
// and the other way round: scan vertices against the appliance surface
const gX = N.toGeometry({ positions: X.positions, indices: X.indices.slice() }), bX = gX.boundsTree, NA = N.vertexNormals(A), up = jaw === 'upper' ? -1 : 1;
const gaps = [], gapsAll = []; let minG = Infinity, covered = 0;
for (let i = 0; i < PA.length; i += 3) { p.set(PA[i], PA[i + 1], PA[i + 2]); bX.closestPointToPoint(p, o, 0, 2.5); if (!(o.distance < 2.5)) continue; if (o.distance < minG) minG = o.distance; if (o.distance < c + 0.6) { const al = ((o.point.x - PA[i]) * NA[i] + (o.point.y - PA[i + 1]) * NA[i + 1] + (o.point.z - PA[i + 2]) * NA[i + 2]) / (o.distance || 1); if (al < 0.9) continue; covered++; gapsAll.push(o.distance); if (NA[i + 2] * up > 0.25) gaps.push(o.distance); } }
ok(minG >= c - 0.03, `seating (scan side): the smallest gap from any scan vertex to the appliance is ${minG.toFixed(3)} mm`);
// 3. fit on surfaces that face the path of insertion (cannot be undercut)
{ const err = gaps.map((g) => Math.abs(g - c)), eAll = gapsAll.map((g) => Math.abs(g - c)); console.log(`        all ${gapsAll.length} covered scan vertices (undercut walls included): gap median ${q(gapsAll, 0.5).toFixed(3)}, 95th pct ${q(gapsAll, 0.95).toFixed(3)}; within ±0.05 of the clearance: ${(100 * eAll.filter((e) => e <= 0.05).length / eAll.length).toFixed(1)}%`); ok(q(err, 0.95) <= 0.05, `fit: ${gaps.length} covered scan vertices facing the path — gap median ${q(gaps, 0.5).toFixed(3)}, 5th–95th pct ${q(gaps, 0.05).toFixed(3)}–${q(gaps, 0.95).toFixed(3)} mm; |gap − clearance| 95th pct ${q(err, 0.95).toFixed(3)} (≤ 0.05)`); }
// 4. thickness: outer-surface vertices → distance to the scan minus the clearance; ignore the rounded border (near the rim where fit and outer surfaces meet)
{ const I = X.indices, isFit = new Uint8Array(dist.length), rim = []; for (let i = 0; i < dist.length; i++) isFit[i] = dist[i] < c + 0.12 ? 1 : 0;
  for (let t = 0; t < I.length; t += 3) { const s = isFit[I[t]] + isFit[I[t + 1]] + isFit[I[t + 2]]; if (s > 0 && s < 3) rim.push(I[t], I[t + 1], I[t + 2]); }
  const cell = 1.0, grid = new Map(), key = (x, y, z) => Math.floor(x / cell) * 73856093 ^ Math.floor(y / cell) * 19349663 ^ Math.floor(z / cell) * 83492791; for (const v of rim) grid.set(key(PX[3 * v], PX[3 * v + 1], PX[3 * v + 2]), 1);
  const nearRim = (x, y, z, r) => { const k = Math.ceil(r / cell); for (let i = -k; i <= k; i++) for (let j = -k; j <= k; j++) for (let l = -k; l <= k; l++) if (grid.has(key(x + i * cell, y + j * cell, z + l * cell))) return true; return false; };
  const th = [], edge = (P.edge ?? 0.6) + 1.0; let thin = 0; const want = P.type === 'flat' ? Math.min(P.thickness, P.minThick ?? P.thickness) : P.thickness;
  for (let i = 0; i < dist.length; i++) { if (isFit[i]) continue; if (nearRim(PX[3 * i], PX[3 * i + 1], PX[3 * i + 2], edge)) continue; const t = dist[i] - c; th.push(t); if (t < want - 0.1) thin++; }
  ok(q(th, 0) >= want - 0.1, `thickness away from the border: ${th.length} outer vertices — thinnest ${q(th, 0).toFixed(2)}, 1st pct ${q(th, 0.01).toFixed(2)}, median ${q(th, 0.5).toFixed(2)} mm (asked ${want}); ${thin} vertices (${(100 * thin / th.length).toFixed(2)}%) under ${(want - 0.1).toFixed(2)}`); }
// 5. opposing arch in its opened position
if (oppFile) { const B = N.parseMesh(rd(oppFile), 'stl', 'opposing'), PB = B.positions; let minO = Infinity; const near = [];
  for (let i = 0; i < PB.length; i += 3) { p.set(PB[i], PB[i + 1], PB[i + 2]); bX.closestPointToPoint(p, o, 0, 1); if (o.distance < minO) minO = o.distance; if (o.distance < 0.1) near.push([PB[i], PB[i + 1]]); }
  // penetration: an opposing vertex inside the appliance would be "close" too, so test inside-ness with a ray count
  const ray = new T.Ray(new T.Vector3(), new T.Vector3(0.137, 0.291, 0.947).normalize()); let inside = 0; for (let i = 0; i < PB.length; i += 3 * 4) { ray.origin.set(PB[i], PB[i + 1], PB[i + 2]); if (bX.raycast(ray, T.DoubleSide).length % 2 === 1) inside++; }
  const left = near.filter((v) => v[0] > 8).length, right = near.filter((v) => v[0] < -8).length, front = near.filter((v) => Math.abs(v[0]) <= 8).length;
  ok(inside === 0, `opposing arch: ${inside} sampled opposing vertices inside the appliance; closest approach ${minO.toFixed(3)} mm`);
  console.log(`        opposing vertices within 0.1 mm of the appliance: left ${left}, front ${front}, right ${right}`); }
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
