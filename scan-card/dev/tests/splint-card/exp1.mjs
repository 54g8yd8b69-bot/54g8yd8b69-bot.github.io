// timing experiment 1: basic costs
import * as N from '../../../shared/core.js';
import * as S from '../../../shared/solid.js';
const T = N.THREE; const tm = (l, f) => { const t = Date.now(); const r = f(); console.log(l.padEnd(46), (Date.now() - t) + ' ms'); return r; };
const M = await S.ready();
for (const res of [0.3, 0.2]) {
  console.log('--- demo res', res);
  const demo = tm('makeDemoPair', () => N.makeDemoPair({ res }));
  const scan = demo.lower; console.log('lower tris', scan.indices.length / 3, 'upper tris', demo.upper.indices.length / 3);
  const b = N.meshBounds(scan), baseZ = b.min[2] - 3;
  const sol = tm('scanToSolid', () => S.scanToSolid(scan, { baseZ }));
  const man = tm('toManifold', () => S.toManifold(sol.mesh));
  console.log('  model tris', man.numTri(), 'vol mL', (man.volume() / 1000).toFixed(2));
  for (const cell of [0.2, 0.15]) {
    const hf = tm(`raster ${cell}`, () => N.rasterHeightfield(scan, { cell, pad: 4 }));
    console.log('  grid', hf.nx, hf.ny, hf.nx * hf.ny);
    const top = tm(`dilate 2.0 @${cell}`, () => N.morphField(hf, 2.0, { op: 'dilate' }));
    const bm = tm('fieldSolid', () => S.fieldSolid(top, -6));
    const body = tm('body toManifold', () => S.toManifold(bm)); console.log('  body tris', body.numTri());
    const app = tm('body - model', () => { const r = body.subtract(man); r.numTri(); return r; });
    console.log('  app tris', app.numTri(), 'vol mL', (app.volume() / 1000).toFixed(2), 'genus', app.genus());
    const parts = tm('decompose', () => app.decompose()); console.log('  parts', parts.length);
    tm('getMesh', () => S.fromManifold(app));
    tm('simplify 0.01', () => { const s = app.simplify(0.01); console.log('   simplified tris', s.numTri()); s.delete(); });
    S.free(body, app, ...parts);
  }
  const hf5 = tm('raster 0.05', () => N.rasterHeightfield(scan, { cell: 0.05, pad: 1 })); console.log('  fine grid', hf5.nx, hf5.ny, hf5.nx * hf5.ny);
  tm('erode flat 0.25 @0.05 (full)', () => N.morphField(hf5, 0.25, { op: 'erode', shape: 'flat' }));
  tm('100 slices', () => { let nv = 0; const bb = man.boundingBox(); for (let k = 0; k < 100; k++) { const cs = man.slice(bb.max[2] - 0.05 - k * 0.1); nv += cs.numVert(); cs.delete(); } console.log('   avg verts/slice', (nv / 100) | 0); });
  tm('project', () => { const cs = man.project(); console.log('   project verts', cs.numVert(), 'contours', cs.numContour()); cs.delete(); });
  S.free(man);
}
