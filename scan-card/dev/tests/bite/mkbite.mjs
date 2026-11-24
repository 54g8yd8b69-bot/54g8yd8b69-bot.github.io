// Synthetic bite-scan test data (no patient data): from the demo pair in its bite, a buccal registration patch — the buccal
// surfaces of both arches' right-hand teeth within 4 mm of the biting plane — and copies of the arches in other positions.
//   bite-key.stl        the patch, in the lower's file coordinates
//   bite-lower.stl      the lower, as made
//   bite-upper-moved.stl  the upper, turned 30° and moved 15 mm (as if exported on its own)
//   bite-key-moved.stl  the patch turned 50° and moved 20 mm (in neither arch's coordinates)
//   bite-truth.json     the transforms used
import fs from 'fs';
import * as N from '/home/claude/suite/shared/core.js';
const THREE = N.THREE, DATA = '/home/claude/suite/dev/data/';
const pair = N.makeDemoPair({ res: 0.3 }), pieces = [];
for (const m of [pair.upper, pair.lower]) {
  const P = m.positions, I = m.indices, keep = [];
  for (let f = 0; f < I.length; f += 3) {
    const a = I[f] * 3, b = I[f + 1] * 3, c = I[f + 2] * 3, cx = (P[a] + P[b] + P[c]) / 3, cy = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, cz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2], nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nl = Math.hypot(nx, ny, ux * wy - uy * wx) || 1;
    const rl = Math.hypot(cx, cy + 10) || 1, out = (nx * cx + ny * (cy + 10)) / (nl * rl);      // facing away from a point inside the arch
    if (Math.abs(cz) < 4 && (cx < -8 || cy < -12) && out > 0.25) keep.push(I[f], I[f + 1], I[f + 2]);
  }
  pieces.push(N.compact({ positions: P, indices: Uint32Array.from(keep) }));
}
const key = N.mergeMeshes(pieces);
const T = (deg, mm) => { const r = THREE.MathUtils.degToRad(deg); return new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r * 0.3, -r * 0.2, r)).setPosition(mm * 0.7, -mm * 0.5, mm * 0.5); };
const Tu = T(30, 15), Tk = T(-50, 20);
const w = (n, m) => fs.writeFileSync(DATA + n, Buffer.from(N.stlBinary(m)));
w('bite-key.stl', key); w('bite-lower.stl', pair.lower); w('bite-upper.stl', pair.upper); w('bite-upper-moved.stl', N.transformMesh(pair.upper, Tu)); w('bite-key-moved.stl', N.transformMesh(key, Tk));
fs.writeFileSync(DATA + 'bite-truth.json', JSON.stringify({ upperMoved: Tu.toArray(), keyMoved: Tk.toArray() }));
console.log(`bite patch: ${key.indices.length / 3} triangles (${pieces.map((p) => p.indices.length / 3).join(' upper + ')} lower)`);
