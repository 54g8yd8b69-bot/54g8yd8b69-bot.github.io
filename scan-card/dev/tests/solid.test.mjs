import * as N from '../../shared/core.js';
import * as S from '../../shared/solid.js';
import fs from 'fs';
const T = N.THREE; let fails = 0; const ok = (c, msg) => { if (!c) { fails++; console.log('  FAIL', msg); } else console.log('  ok  ', msg); };
const out = (n, m) => fs.writeFileSync('/home/claude/suite/dev/out/' + n, Buffer.from(N.stlBinary(m)));
const load = (f) => { const b = fs.readFileSync('/home/claude/suite/dev/data/' + f); return N.parseMesh(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), 'stl', f); };
let t0 = Date.now(); const M = await S.ready(); console.log('manifold ready', Date.now() - t0, 'ms');
const demo = N.makeDemoPair({ res: 0.3 });
const flipU = N.rotationAbout('y', 180);
for (const jaw of ['lower', 'upper']) {
  const scan = jaw === 'upper' ? N.transformMesh(demo.upper, flipU) : demo.lower, b = N.meshBounds(scan), baseZ = b.min[2] - 4;
  t0 = Date.now(); const r = S.scanToSolid(scan, { baseZ }); const tS = Date.now() - t0;
  console.log(' ', jaw, 'scanToSolid', tS, 'ms', JSON.stringify({ ...r.report, volume: +(r.report.volume / 1000).toFixed(2) + ' mL' }), 'outline pts', r.outline.length);
  ok(r.report.watertight && r.report.volume > 0, jaw + ' solid is watertight with positive volume');
  t0 = Date.now(); const man = S.toManifold(r.mesh); console.log('   toManifold', Date.now() - t0, 'ms; genus', man.genus(), 'vol', (man.volume() / 1000).toFixed(2), 'mL, tris', man.numTri());
  ok(Math.abs(man.volume() - r.report.volume) / r.report.volume < 0.01, jaw + ' Manifold accepts it and agrees on volume');
  out(`solid-${jaw}.stl`, r.mesh);
  // hollow, open base
  t0 = Date.now(); const h = S.hollow(man, { wall: 2.5, openBelow: baseZ }); const hm = S.fromManifold(h.solid);
  console.log('   hollow', Date.now() - t0, 'ms; cavity', (h.cavityVolume / 1000).toFixed(2), 'mL; result vol', (h.solid.volume() / 1000).toFixed(2), 'mL; genus', h.solid.genus(), 'watertight', N.isWatertight(hm));
  ok(N.isWatertight(hm) && h.solid.volume() < man.volume() * 0.9, jaw + ' hollow model is watertight and lighter');
  // wall thickness: cavity vertices (well inside, above the base) → distance to the outer skin (scan + walls, not the cut-away underside)
  { const I = r.mesh.indices, Pm = r.mesh.positions, keep = []; for (let t = 0; t < I.length; t += 3) { if (Pm[3 * I[t] + 2] < baseZ + 1e-4 && Pm[3 * I[t + 1] + 2] < baseZ + 1e-4 && Pm[3 * I[t + 2] + 2] < baseZ + 1e-4) continue; keep.push(I[t], I[t + 1], I[t + 2]); }
    const skin = N.toGeometry({ positions: Pm, indices: Uint32Array.from(keep) }).boundsTree, full = N.toGeometry(r.mesh).boundsTree, o = {}, p = new T.Vector3(), P = hm.positions; let minWall = 1e9, cnt = 0, sum = 0;
    for (let i = 0; i < P.length; i += 3 * 3) { if (P[i + 2] < baseZ + 0.6) continue; p.set(P[i], P[i + 1], P[i + 2]); full.closestPointToPoint(p, o); if (o.distance < 0.3) continue; skin.closestPointToPoint(p, o); cnt++; sum += o.distance; if (o.distance < minWall) minWall = o.distance; }
    console.log('   cavity sample pts', cnt, 'min wall', minWall.toFixed(2), 'mean', (sum / cnt).toFixed(2)); ok(cnt > 100 && minWall > 1.9, jaw + ' walls are at least ~2 mm everywhere sampled (target 2.5)'); }
  out(`hollow-${jaw}.stl`, hm);
  // closed-bottom hollow
  const h2 = S.hollow(man, { wall: 2.5 }); ok(h2.solid.decompose().length === 2 && h2.cavityVolume > 0 && h2.cavityVolume < h.cavityVolume, jaw + ' sealed hollow keeps a floor: internal cavity ' + (h2.cavityVolume / 1000).toFixed(2) + ' mL'); out(`sealed-${jaw}.stl`, S.fromManifold(h2.solid));
  S.free(man, h.solid, h2.solid);
}
// dirty + quadrant + scanner-frame files
for (const f of ['dirty-lower.stl', 'quadrant-lower.stl']) {
  const scan = load(f), b = N.meshBounds(scan); let r; try { r = S.scanToSolid(scan, { baseZ: b.min[2] - 4 }); } catch (e) { console.log('   ', f, 'ERROR', e.message); }
  if (r) { console.log('  ', f, JSON.stringify({ ...r.report, volume: +(r.report.volume / 1000).toFixed(2) })); const man = S.toManifold(r.mesh); ok(r.report.watertight && man.volume() > 0, f + ' closes into a solid (holes filled ' + r.report.holesFilled + ', pieces dropped ' + r.report.piecesDropped + ')'); out('solid-' + f, r.mesh); S.free(man); } else ok(false, f + ' closes into a solid');
}
// margin option
{ const b = N.meshBounds(demo.lower), r = S.scanToSolid(demo.lower, { baseZ: b.min[2] - 4, margin: 2, smooth: 2 }); ok(r.report.watertight, 'margin 2 mm / smooth 2 mm base is watertight'); const man = S.toManifold(r.mesh); ok(man.volume() > 0, 'and solid'); out('solid-lower-margin.stl', r.mesh); S.free(man); }
// text
{ const t = S.textSolid('UR-12', { height: 4, depth: 0.6 }), bb = t.boundingBox(); console.log('   text bbox', bb.min.map(v => v.toFixed(2)), bb.max.map(v => v.toFixed(2)), 'vol', t.volume().toFixed(1));
  ok(Math.abs(bb.max[1] - bb.min[1] - 4) < 0.25 && Math.abs(bb.max[2] - 0.6) < 1e-3 && t.volume() > 5, 'lettering is 4 mm tall, 0.6 mm thick'); out('text.stl', S.fromManifold(t)); S.free(t); }
// field solid
{ const hf = N.rasterHeightfield(demo.lower, { cell: 0.3 }), top = N.morphField(hf, 2.0, { op: 'dilate' }); const m = S.fieldSolid(top, hf); ok(m && N.isWatertight(m), 'fieldSolid(dilated, original) is watertight (' + (m ? m.indices.length / 3 : 0) + ' tris)');
  const man = S.toManifold(m); console.log('   shell volume', (man.volume() / 1000).toFixed(2), 'mL'); out('fieldsolid.stl', m);
  const m2 = S.fieldSolid(top, -12); const man2 = S.toManifold(m2); ok(man2.volume() > man.volume(), 'fieldSolid with a flat underside'); S.free(man, man2); }
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
