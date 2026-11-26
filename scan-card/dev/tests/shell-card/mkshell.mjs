// Writes the Shell Card test data to dev/data (needs mkprep.mjs's prep-lower.stl / prep-truth.json first):
//   shell-preop-lower.stl   the demo lower arch before 46 was prepared (prep-lower.stl is the same arch with 46 prepared)
//   shell-preop-moved.stl   the same, moved to an arbitrary position (the second scan has its own coordinates)
//   shell-waxup-lower.stl   the demo lower arch with 0.6 mm added to the labial and incisal surfaces of 31, 32, 41 and 42
//   shell-truth.json        the move, the incisors' tips and centres, the wax thickness
import fs from 'fs';
import * as N from '/home/claude/suite/shared/core.js';
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
const truth = { move: move.toArray(), wax: WAX, incisors: teeth.map((t) => ({ fdi: t.fdi, tip: t.tip, centre: t.centre, width: t.width })) };
fs.writeFileSync(DATA + 'shell-truth.json', JSON.stringify(truth, null, 1));
console.log('shell test data written:', lo.indices.length / 3, 'triangles per arch; incisors', teeth.map((t) => t.fdi).join(', '));
