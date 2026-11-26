// Writes the Shell Card test data to dev/data (needs mkprep.mjs's prep-lower.stl / prep-truth.json first):
//   shell-preop-lower.stl   the demo lower arch before 46 was prepared (prep-lower.stl is the same arch with 46 prepared)
//   shell-preop-moved.stl   the same, moved to an arbitrary position (the second scan has its own coordinates)
//   shell-waxup-lower.stl   the demo lower arch with 0.6 mm added to the labial and incisal surfaces of 31, 32, 41 and 42
//   shell-waxup-model-lower.stl  that wax-up as a solid model with a horseshoe base, built the way Models builds it
//   shell-truth.json        the move, the incisors' tips and centres, the wax thickness
//   shell-upper-model-solid.stl / -hollow.stl  the demo upper arch as a model with a 4 mm horseshoe base (sharp-edged), solid and hollowed
//   shell-upper-truth.json  its canine-to-canine tips, and the first premolars beside them
//   shell-waxparts-lower.stl  the demo lower arch saved the way Wax Card (and most CAD) saves a wax-up: the scan plus each waxed tooth
//                           as its own closed piece (a small ellipsoid over 31, 32, 41, 42, each 0.4% of the scan's triangles) and an
//                           open scrap of scan that should still be left out
//   shell-waxparts-truth.json  the incisor tips, and points of the wax pieces standing more than 0.3 mm outside the scan
import fs from 'fs';
import * as N from '/home/claude/suite/shared/core.js';
import * as S from '/home/claude/suite/shared/solid.js';
import { makeBasedModel } from '../core-orient/mkbased.mjs';
const THREE = N.THREE, DATA = '/home/claude/suite/dev/data/';
const pair = N.makeDemoPair({ res: 0.3 }), lo = pair.lower;
fs.writeFileSync(DATA + 'shell-preop-lower.stl', Buffer.from(N.stlBinary(lo)));
const move = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.21, -0.13, 0.62)).setPosition(14.5, -8.2, 31.0);
fs.writeFileSync(DATA + 'shell-preop-moved.stl', Buffer.from(N.stlBinary(N.transformMesh(lo, move))));
// the wax-up: vertices of the four incisors pushed out along their normals by 0.6 mm, fading to nothing over the last 1.5 mm towards the gum
const teeth = pair.truth.lower.teeth.filter((t) => [31, 32, 41, 42].includes(t.fdi)), P = lo.positions, nrm = N.vertexNormals(lo), out = Float32Array.from(P), WAX = 0.6;
for (let v = 0; v < P.length / 3; v++) {
  const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2]; let w = 0;
  for (const t of teeth) { const d = Math.hypot(x - t.centre[0], y - t.centre[1]); if (d > t.width * 0.62) continue; const top = t.tip[2], fall = N.clamp((z - (top - 7.5)) / 1.5, 0, 1); w = Math.max(w, fall * N.clamp((t.width * 0.62 - d) / 0.8, 0, 1)); }
  if (w > 0) for (let k = 0; k < 3; k++) out[3 * v + k] += WAX * w * nrm[3 * v + k];
}
fs.writeFileSync(DATA + 'shell-waxup-lower.stl', Buffer.from(N.stlBinary({ positions: out, indices: lo.indices })));
const waxModel = await makeBasedModel(N, S, { jaw: 'lower', style: 'horseshoe', arch: { positions: out, indices: lo.indices }, baseH: 6 });
if (!N.isWatertight(waxModel.mesh)) throw new Error('the wax-up model is not closed');
fs.writeFileSync(DATA + 'shell-waxup-model-lower.stl', Buffer.from(N.stlBinary(waxModel.mesh)));
const truth = { move: move.toArray(), wax: WAX, incisors: teeth.map((t) => ({ fdi: t.fdi, tip: t.tip, centre: t.centre, width: t.width })), canines: pair.truth.lower.teeth.filter((t) => [33, 43].includes(t.fdi)).map((t) => ({ fdi: t.fdi, tip: t.tip, centre: t.centre, width: t.width })) };
fs.writeFileSync(DATA + 'shell-truth.json', JSON.stringify(truth, null, 1));
for (const [name, o] of [['solid', {}], ['hollow', { hollow: 'open' }]]) {
  const m = await makeBasedModel(N, S, { jaw: 'upper', style: 'horseshoe', arch: pair.upper, baseH: 4, ...o });
  if (!N.isWatertight(m.mesh)) throw new Error('the upper model is not closed'); fs.writeFileSync(DATA + `shell-upper-model-${name}.stl`, Buffer.from(N.stlBinary(m.mesh)));
}
const ut = (f) => pair.truth.upper.teeth.filter((t) => f.includes(t.fdi)).map((t) => ({ fdi: t.fdi, tip: t.tip, centre: t.centre, width: t.width }));
fs.writeFileSync(DATA + 'shell-upper-truth.json', JSON.stringify({ teeth: ut([13, 12, 11, 21, 22, 23]), neighbours: ut([14, 24]) }, null, 1));
{ // the wax-up as separate closed pieces: an ellipsoid over each lower incisor, pushed out labially so it stands proud of the tooth
  const ell = (c, ax, ay, az, dir) => {                          // UV ellipsoid, closed, outside out; axes along the arch, labially, up
    const R = 10, Sg = 16, pos = [], idx = [], tx = -dir[1], ty = dir[0];
    const put = (u, v, w) => pos.push(c[0] + u * ax * tx + v * ay * dir[0], c[1] + u * ax * ty + v * ay * dir[1], c[2] + w * az);
    put(0, 0, -1); for (let r = 1; r < R; r++) { const th = Math.PI * r / R; for (let k = 0; k < Sg; k++) { const ph = 2 * Math.PI * k / Sg; put(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), -Math.cos(th)); } } put(0, 0, 1);
    const top = 1 + (R - 1) * Sg, at = (r, k) => 1 + (r - 1) * Sg + (k % Sg);
    for (let k = 0; k < Sg; k++) idx.push(0, at(1, k + 1), at(1, k)); for (let r = 1; r < R - 1; r++) for (let k = 0; k < Sg; k++) idx.push(at(r, k), at(r, k + 1), at(r + 1, k + 1), at(r, k), at(r + 1, k + 1), at(r + 1, k)); for (let k = 0; k < Sg; k++) idx.push(top, at(R - 1, k), at(R - 1, k + 1));
    const m = { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) }; if (N.meshVolume(m) < 0) { const I = m.indices; for (let t = 0; t < I.length; t += 3) { const q = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = q; } } return m;
  };
  const all = pair.truth.lower.teeth, gx = all.reduce((a, t) => a + t.centre[0], 0) / all.length, gy = all.reduce((a, t) => a + t.centre[1], 0) / all.length;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(lo.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(lo.indices), 1)); const bvh = new N.MeshBVH(g), hit = {}, q = new THREE.Vector3(), nrm = N.vertexNormals(lo);
  const pieces = [], proud = [];
  for (const t of teeth) {
    const d = [t.centre[0] - gx, t.centre[1] - gy], l = Math.hypot(...d), dir = [d[0] / l, d[1] / l];
    const e = ell([t.centre[0] + dir[0] * 0.9, t.centre[1] + dir[1] * 0.9, t.tip[2] - 3.2], t.width * 0.44, 2.6, 3.6, dir); pieces.push(e);
    const E = e.positions; let n = 0;
    for (let v = 0; v < E.length / 3 && n < 30; v++) { q.set(E[3 * v], E[3 * v + 1], E[3 * v + 2]); bvh.closestPointToPoint(q, hit); const f = 3 * hit.faceIndex, a = lo.indices[f], b = lo.indices[f + 1], c = lo.indices[f + 2];
      const nx = nrm[3 * a] + nrm[3 * b] + nrm[3 * c], ny = nrm[3 * a + 1] + nrm[3 * b + 1] + nrm[3 * c + 1], nz = nrm[3 * a + 2] + nrm[3 * b + 2] + nrm[3 * c + 2];
      if (hit.distance > 0.3 && (q.x - hit.point.x) * nx + (q.y - hit.point.y) * ny + (q.z - hit.point.z) * nz > 0) { proud.push([q.x, q.y, q.z, +hit.distance.toFixed(3)]); n++; } }
  }
  const scrap = { positions: Float32Array.from([gx, gy, -30, gx + 1.5, gy, -30, gx, gy + 1.5, -30, gx + 1.5, gy + 1.5, -30]), indices: Uint32Array.from([0, 1, 2, 1, 3, 2]) };   // an open bit well below the arch
  const parts = [lo, ...pieces, scrap]; let nv = 0, ni = 0; for (const m of parts) { nv += m.positions.length; ni += m.indices.length; }
  const Pp = new Float32Array(nv), Ip = new Uint32Array(ni); let ov = 0, oi = 0; for (const m of parts) { Pp.set(m.positions, ov); for (let k = 0; k < m.indices.length; k++) Ip[oi + k] = m.indices[k] + ov / 3; ov += m.positions.length; oi += m.indices.length; }
  fs.writeFileSync(DATA + 'shell-waxparts-lower.stl', Buffer.from(N.stlBinary({ positions: Pp, indices: Ip })));
  fs.writeFileSync(DATA + 'shell-waxparts-truth.json', JSON.stringify({ incisors: teeth.map((t) => ({ fdi: t.fdi, tip: t.tip })), pieceTris: pieces[0].indices.length / 3, scanTris: lo.indices.length / 3, proud }, null, 1));
  console.log('wax-up as pieces:', pieces.length, 'closed pieces of', pieces[0].indices.length / 3, 'triangles,', proud.length, 'points proud of the scan (up to', Math.max(...proud.map((p) => p[3])).toFixed(2), 'mm)');
}
console.log('shell test data written:', lo.indices.length / 3, 'triangles per arch; incisors', teeth.map((t) => t.fdi).join(', '));
