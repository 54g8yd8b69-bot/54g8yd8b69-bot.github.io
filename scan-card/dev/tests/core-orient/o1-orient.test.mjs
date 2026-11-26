// autoOrient on models WITH A BASE (and no change on raw scans). Synthetic data only.
//   node dev/tests/core-orient/o1-orient.test.mjs            (about a minute: builds ~20 based models with Manifold)
// Based models are built from the demo arches the way Model Card builds them (mkbased.mjs): horseshoe and full bases,
// solid / hollow with an open underside / hollow with a floor, a tall base, a raised label on the underside, bases tilted
// 10–15° against the occlusal plane,
// each put in several random poses (file coordinates are arbitrary). Raw scans: demo arches and dev/data scans, random poses.
import * as N from '../../../shared/core.js';
import * as S from '../../../shared/solid.js';
import fs from 'fs';
import { makeBasedModel, randomPose, rng, orientError } from './mkbased.mjs';
const D = new URL('../../data/', import.meta.url).pathname;
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { fails++; process.exitCode = 1; } };
const rnd = rng(20261126), POSES = 4, f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);
const angTo = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;
const arches = { lower: N.makeDemoArch({ jaw: 'lower', res: 0.3 }).mesh, upper: N.makeDemoArch({ jaw: 'upper', res: 0.3 }).mesh };
const t0 = Date.now();

// ── 1. models with a base
const groups = [
  ['parallel base', [{ jaw: 'lower', style: 'horseshoe' }, { jaw: 'upper', style: 'horseshoe' }, { jaw: 'lower', style: 'full' }, { jaw: 'upper', style: 'full' }, { jaw: 'upper', style: 'full', baseH: 14 }, { jaw: 'lower', style: 'full', label: 'AB12' }]],
  ['hollow', [{ jaw: 'lower', style: 'horseshoe', hollow: 'open' }, { jaw: 'upper', style: 'full', hollow: 'open' }, { jaw: 'upper', style: 'horseshoe', hollow: 'closed' }, { jaw: 'lower', style: 'full', hollow: 'closed' }, { jaw: 'lower', style: 'horseshoe', hollow: 'open', wall: 1.5 }]],
  ['base tilted 10–15°', [{ jaw: 'lower', style: 'horseshoe', tilt: 10, tiltAz: 40 }, { jaw: 'upper', style: 'full', tilt: 12, tiltAz: 200 }, { jaw: 'lower', style: 'full', tilt: 15, tiltAz: 290 }, { jaw: 'upper', style: 'horseshoe', tilt: 15, tiltAz: 110 }, { jaw: 'upper', style: 'horseshoe', hollow: 'open', tilt: 12, tiltAz: 330 }]],
  ['base tilted 30° (too far to trust)', [{ jaw: 'lower', style: 'horseshoe', tilt: 30, tiltAz: 2 }, { jaw: 'upper', style: 'horseshoe', tilt: 30, tiltAz: 250 }]],
];
for (const [g, cfgs] of groups) {
  console.log(g);
  const R = [];
  for (const cfg of cfgs) {
    const m = await makeBasedModel(N, S, { ...cfg, arch: arches[cfg.jaw] }), bp = N.findBasePlanes(m.mesh);
    const detErr = bp.length ? angTo(bp[0].n, m.baseNormal) : 180;
    for (let k = 0; k < POSES; k++) { const pose = randomPose(N, rnd), r = N.autoOrient(N.transformMesh(m.mesh, pose), cfg.jaw); R.push({ cfg, detErr, ...orientError(N, r.matrix, pose), ok: r.ok, used: r.base && r.base.used, note: r.note }); }
  }
  const good = R.filter((r) => r.axis < 90 && r.yaw < 90), mx = (k) => Math.max(...good.map((r) => r[k])), used = [...new Set(R.map((r) => r.used))].join('/');
  ok(R.every((r) => r.detErr < 0.5), `  base found on every model, its normal within ${f2(Math.max(...R.map((r) => r.detErr)))}° of the truth`);
  ok(good.length === R.length, `  ${R.length} poses: upside down ${R.filter((r) => r.axis >= 90).length}, front/back swapped ${R.filter((r) => r.axis < 90 && r.yaw >= 90).length}`);
  if (g.startsWith('parallel') || g === 'hollow') {
    ok(mx('axis') < 0.5 && used === 'base', `  occlusal axis off by at most ${f2(mx('axis'))}° (the base sets it: ${used})`);
    ok(mx('yaw') < 3, `  front direction within ${f1(mx('yaw'))}° · midline within ${f2(Math.max(...good.map((r) => Math.abs(r.dx))))} mm`);
    ok(R.every((r) => r.ok && !r.note), `  ok, no warning, in ${R.filter((r) => r.ok).length}/${R.length}`);
  } else if (g.startsWith('base tilted 10')) {
    ok(mx('axis') < 6 && R.every((r) => r.used === 'teeth' || r.used === 'blend'), `  occlusal axis from the cusp tips, not the base: off by at most ${f1(mx('axis'))}° (${used})`);
    ok(mx('yaw') < 3, `  front direction within ${f1(mx('yaw'))}°`);
    ok(R.every((r) => r.ok), `  ok in ${R.filter((r) => r.ok).length}/${R.length}`);
  } else {
    ok(R.every((r) => !r.ok && r.used === 'none' && /base/.test(r.note)), `  not trusted: ok false with the base warning in ${R.filter((r) => !r.ok).length}/${R.length}; the base still tells up from down`);
    ok(mx('axis') < 6, `  …and the occlusal axis still comes from the cusp tips: off by at most ${f1(mx('axis'))}°`);
  }
}

// ── 2. raw scans (no base): the base code must stay out of the way, so the original method runs unchanged
console.log('raw scans (no base)');
const load = (f) => { const b = fs.readFileSync(D + f); let m = N.parseMesh(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), f.split('.').pop()); const k = N.unitScaleGuess(m); if (k !== 1) m = { ...m, positions: m.positions.map((v) => v * k) }; return N.cleanMesh(m).mesh; };
const ident = new N.THREE.Matrix4(), scanner = JSON.parse(fs.readFileSync(D + 'scanner-truth.json')), biteT = JSON.parse(fs.readFileSync(D + 'bite-truth.json'));
const raws = [['demo lower', 'lower', arches.lower, ident], ['demo upper', 'upper', arches.upper, ident], ['demo upper, 22 and 16 missing', 'upper', N.makeDemoArch({ jaw: 'upper', res: 0.3, missing: { 22: true, 16: true } }).mesh, ident],
  ['prep-lower.stl', 'lower', load('prep-lower.stl'), ident], ['prep-upper.stl', 'upper', load('prep-upper.stl'), ident], ['hypodontia-lower.stl', 'lower', load('hypodontia-lower.stl'), ident], ['hypodontia-upper.stl', 'upper', load('hypodontia-upper.stl'), ident],
  ['bite-lower.stl', 'lower', load('bite-lower.stl'), ident], ['bite-upper-moved.stl', 'upper', load('bite-upper-moved.stl'), new N.THREE.Matrix4().fromArray(biteT.upperMoved)],
  ['scanner-lower.stl', 'lower', load('scanner-lower.stl'), new N.THREE.Matrix4().fromArray(scanner.matrix)], ['scanner-upper.stl', 'upper', load('scanner-upper.stl'), new N.THREE.Matrix4().fromArray(scanner.matrix)],
  ['dirty-lower.stl', 'lower', load('dirty-lower.stl'), ident], ['metres-lower.stl', 'lower', load('metres-lower.stl'), ident], ['bite-key.stl (not an arch)', 'lower', load('bite-key.stl'), null]];
for (const [name, jaw, mesh, truth] of raws) {
  const planes = N.findBasePlanes(mesh).length, R = [];
  for (let k = 0; k < POSES; k++) { const pose = randomPose(N, rnd), r = N.autoOrient(N.transformMesh(mesh, pose), jaw); R.push({ base: r.base, ok: r.ok, ...(truth ? orientError(N, r.matrix, pose.clone().multiply(truth)) : {}) }); }
  const msg = truth ? `axis within ${f1(Math.max(...R.map((r) => r.axis)))}°, front within ${f1(Math.max(...R.map((r) => r.yaw)))}°, ok ${R.filter((r) => r.ok).length}/${POSES}` : `ok ${R.filter((r) => r.ok).length}/${POSES}`;
  ok(planes === 0 && R.every((r) => r.base === null) && (!truth || R.every((r) => r.axis < 6 && r.yaw < 6)) && (truth || R.every((r) => !r.ok)), `  ${name}: no base found, original method — ${msg}`);
}
{ // a flat on the BITING side of an open scan (a flat-topped block resting on the teeth, like a wax rim or bite block) is not a base
  const bx = N.meshBounds(arches.lower), x0 = bx.min[0] + 5, x1 = bx.max[0] - 5, y0 = bx.min[1] + 3, y1 = bx.max[1] - 3, z0 = bx.max[2] + 0.5, z1 = bx.max[2] + 4;
  const block = { positions: new Float32Array([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]), indices: new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]) };
  const m = N.mergeMeshes([arches.lower, block]), top = N.findBasePlanes(m)[0], R = [];
  for (let k = 0; k < POSES; k++) { const pose = randomPose(N, rnd), r = N.autoOrient(N.transformMesh(m, pose), 'lower'); R.push({ base: r.base, ok: r.ok, ...orientError(N, r.matrix, pose) }); }
  ok(top && top.n[2] > 0.99 && R.every((r) => r.base === null && r.axis < 6), `  demo lower with a flat-topped block on the teeth: the block's top is flat (${top ? Math.round(top.area) : 0} mm²) but faces the biting side of an open scan, so it is ignored — axis within ${f1(Math.max(...R.map((r) => r.axis)))}°, not upside down`);
}
console.log(`${fails ? fails + ' FAILED' : 'all passed'} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
