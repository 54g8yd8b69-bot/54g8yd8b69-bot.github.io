// E1: vertex properties through booleans; E3: self-overlapping subtrahend
import * as N from '../../../shared/core.js';
import * as S from '../../../shared/solid.js';
const M = await S.ready();
// E1
{
  const box = M.Manifold.cube([10, 10, 10], true).getMesh();
  const nV = box.numVert, P4 = new Float32Array(nV * 4);
  for (let i = 0; i < nV; i++) { P4[4 * i] = box.vertProperties[3 * i]; P4[4 * i + 1] = box.vertProperties[3 * i + 1]; P4[4 * i + 2] = box.vertProperties[3 * i + 2]; P4[4 * i + 3] = 7; }
  const idA = M.Manifold.reserveIDs(2);
  const a = new M.Manifold(new M.Mesh({ numProp: 4, vertProperties: P4, triVerts: box.triVerts, runOriginalID: new Uint32Array([idA]) }));
  const sph = M.Manifold.sphere(4, 32).translate([5, 0, 0]).getMesh();
  const b = new M.Manifold(new M.Mesh({ numProp: 3, vertProperties: sph.vertProperties, triVerts: sph.triVerts, runOriginalID: new Uint32Array([idA + 1]) }));
  const r = a.subtract(b), m = r.getMesh();
  console.log('E1 numProp', m.numProp, 'verts', m.numVert, 'tris', m.numTri, 'runs', Array.from(m.runOriginalID), Array.from(m.runIndex), 'ids', idA, idA + 1);
  const hist = {}; for (let i = 0; i < m.numVert; i++) { const k = m.vertProperties[4 * i + 3].toFixed(2); hist[k] = (hist[k] || 0) + 1; } console.log('   prop3 histogram', hist, 'merge', m.mergeFromVert.length);
  const s2 = r.simplify(0.01), m2 = s2.getMesh(); console.log('   after simplify: numProp', m2.numProp, 'tris', m2.numTri, 'runs', Array.from(m2.runOriginalID));
  // watertight when welded by position only?
  const P = new Float32Array(m.numVert * 3); for (let i = 0; i < m.numVert; i++) { P[3 * i] = m.vertProperties[4 * i]; P[3 * i + 1] = m.vertProperties[4 * i + 1]; P[3 * i + 2] = m.vertProperties[4 * i + 2]; }
  console.log('   watertight raw index', N.isWatertight({ positions: P, indices: m.triVerts }), 'after weld', N.isWatertight(N.weld(P, m.triVerts)));
}
// E3: self-overlapping subtrahend: two overlapping spheres as ONE mesh (compose keeps both shells)
{
  const s1 = M.Manifold.sphere(3, 48), s2 = M.Manifold.sphere(3, 48).translate([4, 0, 0]);
  const comp = M.Manifold.compose([s1, s2]);                    // self-overlapping: winding 2 in the lens
  const trueU = s1.add(s2);
  console.log('E3 compose vol', comp.volume().toFixed(3), 'true union vol', trueU.volume().toFixed(3), 'lens vol', (comp.volume() - trueU.volume()).toFixed(3));
  const box = M.Manifold.cube([20, 12, 12], true).translate([2, 0, 0]);
  const d1 = box.subtract(comp), d2 = box.subtract(trueU);
  console.log('   box - compose vol', d1.volume().toFixed(3), ' box - union vol', d2.volume().toFixed(3), ' diff', (d1.volume() - d2.volume()).toFixed(3), 'parts', d1.decompose().length, d2.decompose().length, 'tris', d1.numTri(), d2.numTri());
  // cover trick: union compose with a clean plug covering the lens, then subtract
  const plug = M.Manifold.sphere(2.9, 48).translate([2, 0, 0]);
  const cav = comp.add(plug); console.log('   compose ∪ plug vol', cav.volume().toFixed(3), '(true union ∪ plug', trueU.add(plug).volume().toFixed(3) + ')');
  const d3 = box.subtract(cav); console.log('   box - (compose ∪ plug) vol', d3.volume().toFixed(3), ' vs box - (union ∪ plug)', box.subtract(trueU.add(plug)).volume().toFixed(3), 'parts', d3.decompose().length);
}
