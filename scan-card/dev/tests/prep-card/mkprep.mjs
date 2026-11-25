// LEAN=25: the same preparation with its stump tipped 25° towards the buccal (an upper incisor leans like this): writes prep-lean-lower.stl and
// prep-lean-truth.json instead, with the stump's axis. Seen from straight above, its top then lies partly outside its own margin.
// Writes dev/data/prep-lower.stl (demo lower arch with 46 as a preparation of exactly known shape), prep-upper.stl, prep-truth.json.
// Built by the demo generator itself (makeDemoArch's prep option): walls converging 6° on the buccal, mesial and distal, flaring 6°
// (an undercut) on the lingual, flat occlusal surface 2.0 mm below the original cusp tips, 0.8 mm shoulder 1.2 mm under the contacts.
import fs from 'fs';
import * as N from '/home/claude/suite/shared/core.js';
const DATA = '/home/claude/suite/dev/data/';
const pair = N.makeDemoPair({ res: 0.3 }), t46 = pair.truth.lower.teeth.find((t) => t.fdi === 46), w = t46.width;
const zc = (t46.mesial[2] + t46.distal[2]) / 2, prep = { fdi: 46, zTop: t46.tip[2] - 2.0, zMargin: zc - 1.2, R0: 0.36 * w, shoulder: 0.8, taper: 6, taperLingual: -6 }, LEAN = +(process.env.LEAN || 0), OUT = LEAN ? 'prep-lean' : 'prep'; if (LEAN) prep.lean = LEAN;
const lo = N.makeDemoArch({ jaw: 'lower', res: 0.3, prep });
fs.writeFileSync(DATA + OUT + '-lower.stl', Buffer.from(N.stlBinary(lo.mesh)));
if (!LEAN) fs.writeFileSync(DATA + 'prep-upper.stl', Buffer.from(N.stlBinary(pair.upper)));
const c = [t46.centre[0], t46.centre[1]];
// the generator's own axes for this tooth: buccal = outward normal of the arch line at the tooth (lingual = its opposite)
const t = lo.truth.teeth.find((q) => q.fdi === 46), b = [t.tip[0] - t.centre[0], t.tip[1] - t.centre[1]];      // (tip = mesiobuccal cusp: only used for its side)
const Rat = (z, ux, uy, nb) => { const lingual = -(ux * nb[0] + uy * nb[1]), ang = Math.acos(Math.max(-1, Math.min(1, lingual))) * 180 / Math.PI, f = Math.max(0, Math.min(1, (ang - 37) / 16)), tau = (-6 + 12 * f) * Math.PI / 180; return prep.R0 - (z - prep.zMargin) * Math.tan(tau); };
// outward normal of the demo arch at 46 (as the generator uses it): perpendicular to the line between the neighbours' centres, away from the midline
const n45 = pair.truth.lower.teeth.find((q) => q.fdi === 45).centre, n47 = pair.truth.lower.teeth.find((q) => q.fdi === 47).centre;
let tx = n47[0] - n45[0], ty = n47[1] - n45[1]; const tl = Math.hypot(tx, ty); tx /= tl; ty /= tl; let nb = [ty, -tx]; if (nb[0] * c[0] < 0) nb = [-nb[0], -nb[1]];
const loop = []; for (let k = 0; k < 10; k++) { const a = (k / 10) * 2 * Math.PI, ux = Math.cos(a), uy = Math.sin(a), R = prep.R0 + 0.45; loop.push([c[0] + ux * R, c[1] + uy * R, prep.zMargin]); }
const truth = { fdi: 46, centre: c, ...prep, buccal: nb, taperBy: { buccal: 6, mesial: 6, distal: 6, lingual: -6 }, toc: { md: 12, bl: 0 }, wallHeight: prep.zTop - prep.zMargin, seed: [c[0], c[1], prep.zTop], loop, axis: [nb[0] * Math.sin(LEAN * Math.PI / 180), nb[1] * Math.sin(LEAN * Math.PI / 180), Math.cos(LEAN * Math.PI / 180)] };
if (LEAN) truth.seed = [c[0] + nb[0] * (prep.zTop - prep.zMargin) * Math.tan(LEAN * Math.PI / 180), c[1] + nb[1] * (prep.zTop - prep.zMargin) * Math.tan(LEAN * Math.PI / 180), prep.zTop];
fs.writeFileSync(DATA + OUT + '-truth.json', JSON.stringify(truth, null, 1));
console.log(`46 prepared: R0 ${prep.R0.toFixed(2)} mm, shoulder ${prep.shoulder} mm at z ${prep.zMargin.toFixed(2)}, top at z ${prep.zTop.toFixed(2)} (wall height ${(prep.zTop - prep.zMargin).toFixed(2)} mm); buccal direction (${nb.map((v) => v.toFixed(2))}); ${lo.mesh.indices.length / 3} triangles`);
