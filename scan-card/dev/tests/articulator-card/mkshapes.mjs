// Synthetic test shapes for Articulator Card, with exact answers (case frame: +X patient's left, +Y back, +Z up; mm).
//   node dev/tests/articulator-card/mkshapes.mjs      → dev/data/art-*.stl + dev/data/art-truth.json
// Lower "arch": closed spheres (r = 2 mm) standing for the incisal point, the canine tips, premolar and molar cusps, over a base
// plate far below. Each upper is a few closed boxes whose flat faces are guidance surfaces of known angle:
//   art-flat-upper     a flat plate 0.05 mm above every cusp (flat teeth: the opening follows the condylar guidance)
//   art-canine-upper   a canine ramp on each side, 45°, facing down and inwards (canine guidance)
//   art-incisal-upper  a front ramp, 35°, facing down and back (incisal guidance in protrusion)
//   art-nw-upper       a 60° ramp over the lower left molar, facing down and outwards: a non-working-side interference in a
//                      right side movement
//   art-free-upper     only a plate 20 mm up: nothing ever touches (for the incisal table and pure kinematics)
// The group-function upper is made in the test itself (t2-guidance.cjs) from the canine case's own movement, with box() below.
// Every upper also has the same far plate (z ≈ +22) so the arches look like a pair. Nothing here comes from a patient.
import fs from 'fs';
import * as N from '../../../shared/core.js';
const DATA = new URL('../../data/', import.meta.url).pathname;
const v = { add: (a, b) => a.map((x, i) => x + b[i]), sub: (a, b) => a.map((x, i) => x - b[i]), mul: (a, s) => a.map((x) => x * s), dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm: (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); } };
export { v };

/** a closed icosphere (outward triangles), subdivided `level` times */
export function icosphere(c, r, level = 4) {
  const t = (1 + Math.sqrt(5)) / 2; let P = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(v.norm);
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let l = 0; l < level; l++) {
    const mid = new Map(), m = (a, b) => { const k = a < b ? a + ',' + b : b + ',' + a; if (!mid.has(k)) { mid.set(k, P.length); P.push(v.norm(v.mul(v.add(P[a], P[b]), 0.5))); } return mid.get(k); }, G = [];
    for (const [a, b, c2] of F) { const ab = m(a, b), bc = m(b, c2), ca = m(c2, a); G.push([a, ab, ca], [b, bc, ab], [c2, ca, bc], [ab, bc, ca]); }
    F = G;
  }
  return { positions: Float32Array.from(P.flatMap((p) => v.add(c, v.mul(p, r)))), indices: Uint32Array.from(F.flat()) };
}
/** a closed box: centre c, unit axes a1, a2, a3 (right-handed), half extents h = [h1, h2, h3] */
export function box(c, a1, a2, a3, h) {
  const P = []; for (const s3 of [-1, 1]) for (const s2 of [-1, 1]) for (const s1 of [-1, 1]) P.push(v.add(c, v.add(v.mul(a1, s1 * h[0]), v.add(v.mul(a2, s2 * h[1]), v.mul(a3, s3 * h[2])))));
  // vertex k = s1 bit0, s2 bit1, s3 bit2; faces outward for a right-handed (a1, a2, a3)
  const F = [[0, 2, 3], [0, 3, 1], [4, 5, 7], [4, 7, 6], [0, 1, 5], [0, 5, 4], [2, 6, 7], [2, 7, 3], [0, 4, 6], [0, 6, 2], [1, 3, 7], [1, 7, 5]];
  return { positions: Float32Array.from(P.flat()), indices: Uint32Array.from(F.flat()) };
}
/**
 * A guidance ramp: a box whose face (normal n, pointing at the sphere) lies on the plane n·x = n·c − r − gap, i.e. `gap` mm
 * clear of the sphere (centre c, radius r). It runs from `from` to `to` mm along the in-plane direction d (where the sphere's
 * contact point slides), ±w mm across, 3 mm thick on the far side. → { mesh, n, d, off (plane: n·x = off), q0 (the point of the plane nearest c) }
 */
export function ramp(c, r, n, d, { gap = 0.05, from = -2, to = 11, w = 4, thick = 3 } = {}) {
  n = v.norm(n); d = v.norm(v.sub(d, v.mul(n, v.dot(d, n)))); const e = v.cross(d, n);   // (d, e, n) right-handed? d × e = n  ⇔  e = n × d
  const q0 = v.sub(c, v.mul(n, r + gap)), mid = v.add(q0, v.add(v.mul(d, (from + to) / 2), v.mul(n, -thick / 2)));
  const a3 = v.cross(d, e);                                        // completes a right-handed frame with d and e
  return { mesh: box(mid, d, e, a3, [(to - from) / 2, w, thick / 2]), n, d, off: v.dot(n, c) - r - gap, q0 };
}
const merge = (list) => N.mergeMeshes(list);
const D2R = Math.PI / 180, R = 2, GAP = 0.05;
export const LOWER = { I: [0, -22, -2], CR: [-12, -15, -2], CL: [12, -15, -2], PR: [-17, -6, -2], PL: [17, -6, -2], MR: [-21, 6, -2], ML: [21, 6, -2] };
export const R_SPHERE = R;
const top = (c) => [c[0], c[1], c[2] + R];
const farUpper = () => box([0, -7, 22], [1, 0, 0], [0, 1, 0], [0, 0, 1], [30, 22, 1.5]);

export function make() {
  const lower = merge([...Object.values(LOWER).map((c) => icosphere(c, R, 4)), box([0, -7, -22], [1, 0, 0], [0, 1, 0], [0, 0, 1], [30, 22, 1.5])]);
  const truth = { r: R, gap: GAP, spheres: LOWER, landmarks: { inc: top(LOWER.I), lcR: top(LOWER.CR), lcL: top(LOWER.CL), ucR: [-12, -15, 0], ucL: [12, -15, 0] }, cases: {} };
  const out = { 'art-lower.stl': lower };
  // flat teeth
  out['art-flat-upper.stl'] = merge([farUpper(), box([0, -11, GAP + 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], [32, 28, 2])]);   // y −39…17: the front cusp stays under it for 12 mm of protrusion
  truth.cases.flat = { plane: { n: [0, 0, -1], off: -GAP } };      // n·x = off  ⇔  z = GAP; the spheres lie on the side n points to
  // canine ramps, 45°: right n = (sin β, 0, −cos β) (down and inwards), sliding direction while the jaw moves right: (−cos β, 0, −sin β)
  { const b = 45 * D2R, rr = ramp(LOWER.CR, R, [Math.sin(b), 0, -Math.cos(b)], [-Math.cos(b), 0, -Math.sin(b)], { gap: GAP, from: -2, to: 15 }),
      rl = ramp(LOWER.CL, R, [-Math.sin(b), 0, -Math.cos(b)], [Math.cos(b), 0, -Math.sin(b)], { gap: GAP, from: -2, to: 15 });
    out['art-canine-upper.stl'] = merge([farUpper(), rr.mesh, rl.mesh]);
    const sh = (q, s) => [q[0] + s * 1.5, q[1], q[2]];               // the upper canine "tip" 1.5 mm out along the ramp, so 1–4 mm of travel stays within its region
    truth.cases.canine = { beta: 45, R: { n: rr.n, off: rr.off, d: rr.d }, L: { n: rl.n, off: rl.off, d: rl.d }, ucR: sh(rr.q0, -1), ucL: sh(rl.q0, 1) }; }
  // front ramp, 35°: n = (0, sin α, −cos α) (down and back), sliding forward and down
  { const a = 35 * D2R, ri = ramp(LOWER.I, R, [0, Math.sin(a), -Math.cos(a)], [0, -Math.cos(a), -Math.sin(a)], { gap: GAP, from: -2, to: 14, w: 5 });
    out['art-incisal-upper.stl'] = merge([farUpper(), ri.mesh]);
    truth.cases.incisal = { alpha: 35, plane: { n: ri.n, off: ri.off, d: ri.d } }; }
  // non-working interference over the lower left molar, 60°: n = (sin γ, 0, −cos γ) (down and outwards), sliding inwards and down
  { const g = 60 * D2R, rn = ramp(LOWER.ML, R, [Math.sin(g), 0, -Math.cos(g)], [-Math.cos(g), 0, -Math.sin(g)], { gap: GAP, from: -2, to: 16 });
    out['art-nw-upper.stl'] = merge([farUpper(), rn.mesh]);
    truth.cases.nw = { gamma: 60, plane: { n: rn.n, off: rn.off, d: rn.d } }; }
  out['art-free-upper.stl'] = farUpper();
  truth.cases.free = {};
  return { out, truth };
}

if (process.argv[1] && new URL(import.meta.url).pathname === fs.realpathSync(process.argv[1])) {
  const { out, truth } = make();
  for (const [f, m] of Object.entries(out)) { fs.writeFileSync(DATA + f, new Uint8Array(N.stlBinary(m, null, "Articulator Card synthetic test shape, mm"))); console.log(f, m.indices.length / 3, 'triangles'); }
  fs.writeFileSync(DATA + 'art-truth.json', JSON.stringify(truth, null, 1)); console.log('art-truth.json');
}
