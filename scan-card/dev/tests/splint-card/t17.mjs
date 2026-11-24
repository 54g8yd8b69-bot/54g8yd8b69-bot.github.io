// text slices through appliance (A) and scan (T) near a point.  node t17.mjs cx cy "z1,z2,..." [json]
import { K, N, S } from './kernel.mjs';
await S.ready(); const THREE = N.THREE, demo = N.makeDemoPair({ res: 0.3 });
const jaw = 'upper', cx = +(process.argv[2] || -8.9), cy = +(process.argv[3] || -23.7), zs = (process.argv[4] || '-1,-2,-3').split(',').map(Number), over = process.argv[5] ? JSON.parse(process.argv[5]) : {};
const sA = N.transformMesh(demo[jaw], K.archMatrix(jaw)), arch = K.analyseArch(sA), inp = { scanA: sA, arch, cache: {} };
const r = await K.build(inp, over); console.log('genus', r.report.genus);
const mk = (m) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(m.indices), 1)); const b = new N.MeshBVH(g, { indirect: true }), ray = new THREE.Ray();
  return (y, z, x0, x1, dx) => { ray.origin.set(x0 - 30, y + 1e-4, z + 1e-4); ray.direction.set(1, 0, 0); const hits = b.raycast(ray, THREE.DoubleSide).map((q) => q.distance - 30 + x0).sort((p, q) => p - q), out = []; for (let x = x0; x <= x1; x += dx) { let n = 0; for (const hh of hits) if (hh < x) n++; out.push(n & 1); } return out; }; };
const inA = mk(r.meshW || r.mesh), inT = mk(inp.cache.sol), hf = inp.cache.hf, W = 1.6, dx = 0.05;
for (const z of zs) { console.log(`\nz = ${z}   x ${(cx - W).toFixed(2)} … ${(cx + W).toFixed(2)} (→), y from ${(cy + 1.1).toFixed(2)} down to ${(cy - 1.1).toFixed(2)};  A appliance, T tooth, : open but under the envelope, blank open`);
  for (let y = cy + 1.1; y >= cy - 1.1 - 1e-9; y -= 0.1) { const a = inA(y, z, cx - W, cx + W, dx), t = inT(y, z, cx - W, cx + W, dx); let s = ''; for (let i = 0; i < a.length; i++) s += t[i] ? (a[i] ? 'X' : 'T') : a[i] ? 'A' : N.sampleField(hf, cx - W + i * dx, y) > z + 0.05 ? ':' : ' '; console.log(y.toFixed(1).padStart(6), s); } }
process.exit(0);
