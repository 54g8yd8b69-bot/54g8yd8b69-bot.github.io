// thin septa of appliance between teeth: fit-side vertices with other fit surface close behind them (through the material).
// node t16.mjs cx cy [json]
import { K, N, S } from './kernel.mjs';
await S.ready(); const THREE = N.THREE, demo = N.makeDemoPair({ res: 0.3 });
const jaw = 'upper', cx = +(process.argv[2] || -9.5), cy = +(process.argv[3] || -23.5), over = process.argv[4] ? JSON.parse(process.argv[4]) : {};
const sA = N.transformMesh(demo[jaw], K.archMatrix(jaw)), arch = K.analyseArch(sA), inp = { scanA: sA, arch, cache: {} };
const r = await K.build(inp, over), m = r.meshW || r.mesh, P = m.positions, I = m.indices, nrm = N.vertexNormals(m);
const hf = inp.cache.hf, geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(I), 1));
const bvh = new N.MeshBVH(geo, { indirect: true }), ray = new THREE.Ray(), kindV = new Uint8Array(P.length / 3); for (let t = 0; t < r.triKind.length; t++) if (r.triKind[t]) for (let e = 0; e < 3; e++) kindV[I[3 * t + e]] = r.triKind[t];
console.log('genus', r.report.genus, 'tilt none: work frame = arch frame');
const rows = []; for (let v = 0; v < kindV.length; v++) { if (!kindV[v]) continue; const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2]; if (Math.abs(x - cx) > 3.5 || Math.abs(y - cy) > 3.5) continue;
  ray.origin.set(x - 0.02 * nrm[3 * v], y - 0.02 * nrm[3 * v + 1], z - 0.02 * nrm[3 * v + 2]); ray.direction.set(-nrm[3 * v], -nrm[3 * v + 1], -nrm[3 * v + 2]);
  const hit = bvh.raycastFirst(ray, THREE.DoubleSide); if (!hit || hit.distance > 0.5) continue; const hk = r.triKind[hit.faceIndex]; if (!hk) continue;
  rows.push([x, y, z, hit.distance + 0.02, N.sampleField(hf, x, y) - z, kindV[v], hk]); }
console.log('septum vertices (material under 0.5 mm thick, fit surface on both sides):', rows.length);
const zs = rows.map((q) => q[2]).sort((a, b) => a - b); if (rows.length) console.log('  z range', zs[0].toFixed(2), '…', zs[zs.length - 1].toFixed(2), ' x', Math.min(...rows.map((q) => q[0])).toFixed(2), '…', Math.max(...rows.map((q) => q[0])).toFixed(2), ' y', Math.min(...rows.map((q) => q[1])).toFixed(2), '…', Math.max(...rows.map((q) => q[1])).toFixed(2));
const below = rows.filter((q) => q[4] > 0.05).length; console.log('  of these under the envelope (in shadow):', below, ' seen from above:', rows.length - below);
rows.sort((a, b) => a[2] - b[2]); const stepN = Math.max(1, Math.floor(rows.length / 24)); for (let k = 0; k < rows.length; k += stepN) console.log('   ', rows[k].map((v) => (+v).toFixed(2)).join('  '));
process.exit(0);
