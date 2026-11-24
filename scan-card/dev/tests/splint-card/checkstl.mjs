// Re-read the STL files the browser tests downloaded and judge them.  node checkstl.mjs
import { N, loadStl, OUT } from './kernel.mjs';
const THREE = N.THREE;
const judge = (name) => { const m = loadStl(OUT + name), P = m.positions, I = m.indices, e = N.edgeReport(m), par = new Int32Array(P.length / 3).map((_, i) => i);
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }; let vol = 0;
  for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3; par[find(I[t])] = find(I[t + 1]); par[find(I[t + 1])] = find(I[t + 2]);
    vol += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6; }
  const roots = new Set(); for (let v = 0; v < par.length; v++) roots.add(find(v));
  console.log(`${name}: ${I.length / 3} triangles, watertight ${N.isWatertight(m)}, open edges ${e.open}, flipped ${e.flipped}, non-manifold ${e.nonManifold}, pieces ${roots.size}, volume ${(vol / 1000).toFixed(2)} mL`); return m; };
const near = (app, scanFile, label) => { const sc = N.cleanMesh(loadStl(scanFile)).mesh, g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(sc.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(sc.indices), 1));
  const bvh = new N.MeshBVH(g, { indirect: true }), q = new THREE.Vector3(), hit = {}, d = []; let min = Infinity;
  for (let v = 0; v < app.positions.length; v += 3) { q.set(app.positions[v], app.positions[v + 1], app.positions[v + 2]); bvh.closestPointToPoint(q, hit); if (hit.distance < min) min = hit.distance; if (hit.distance < 0.25) d.push(hit.distance); }
  d.sort((a, b) => a - b); console.log(`   ${label}: nearest appliance vertex to the scan ${min.toFixed(3)} mm; of the ${d.length} vertices within 0.25 mm: p05 ${d[Math.floor(d.length * 0.05)].toFixed(3)}, median ${d[d.length >> 1].toFixed(3)}, p95 ${d[Math.floor(d.length * 0.95)].toFixed(3)}`); };
const a = judge('f1-splint-lower-scan.stl'); near(a, 'scanner-lower.stl', 'against the untouched scanner-lower.stl (scanner coordinates)');
judge('f1-splint-lower-case.stl'); judge('f2-splint-upper-case.stl'); judge('f3-tablet-thin-lower.stl'); judge('f3-phone-thin-lower.stl');
process.exit(0);
