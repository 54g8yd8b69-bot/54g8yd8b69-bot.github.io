// which "above the survey line" scan vertices have a gap error > 0.05, with and without the neck rule?
import { K, N, S } from './kernel.mjs';
await S.ready(); const demo = N.makeDemoPair({ res: 0.3 }), T = N.THREE;
const sA = N.transformMesh(demo.lower, K.archMatrix('lower')), arch = K.analyseArch(sA);
const hf = N.rasterHeightfield(sA, { cell: 0.05, pad: 0.6 }), uc = K.undercutDepth(sA, hf, 2.5), o = {};
for (const neck of [0.4, -0.1]) {
  const p = { ...K.DEFAULTS, neck }, r = await K.build({ scanA: sA, arch, cache: {} }, p);
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(r.mesh.positions, 3)); g.setIndex(new T.BufferAttribute(Uint32Array.from(r.mesh.indices), 1)); const bvh = new N.MeshBVH(g), v = new T.Vector3(), hit = {};
  const SP = sA.positions; let n = 0, bad = 0; const zrel = [0, 0, 0, 0, 0], samples = [];
  for (let i = 0; i < SP.length / 3; i++) { const x = SP[3 * i], y = SP[3 * i + 1], z = SP[3 * i + 2]; K.borderAt(arch, p, x, y, o); if (!(z > o.z + 0.6) || uc[i] !== 0) continue; v.set(x, y, z); bvh.closestPointToPoint(v, hit, 0, 1.5); if (!(hit.distance < 1.5)) continue; n++; if (Math.abs(hit.distance - 0.1) > 0.05) { bad++; const top = o.z + (Math.abs(o.d) < 1.5 ? 3.5 : o.d > 0 ? 3 : 4); zrel[Math.min(4, Math.floor((top - z)))]++; if (samples.length < 400) samples.push([x, y, z, hit.distance, o.d]); } }
  console.log('neck', neck, 'fit verts', n, 'bad', bad, (100 * bad / n).toFixed(1) + '%', 'by depth below cusp tips (0-1,1-2,2-3,3-4,4+):', zrel.join(','));
  const near = samples.filter((q, i) => i % 25 === 0).map((q) => q.map((t) => t.toFixed(2)).join(' ')); console.log('   samples x y z gap d:', near.join(' | '));
}
process.exit(0);
