import * as N from '../../shared/core.js';
import fs from 'fs';
const T = N.THREE; let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('  FAIL', msg); } else console.log('  ok  ', msg); };

// eigen
{ const e = N.eigSym3([4, 1, 0.5, 3, 0.2, 1]); const A = [[4,1,0.5],[1,3,0.2],[0.5,0.2,1]]; let err = 0;
  e.vectors.forEach((v, i) => { for (let r = 0; r < 3; r++) err = Math.max(err, Math.abs(A[r][0]*v[0]+A[r][1]*v[1]+A[r][2]*v[2] - e.values[i]*v[r])); });
  ok(err < 1e-9 && e.values[0] >= e.values[1] && e.values[1] >= e.values[2], 'eigSym3 residual ' + err.toExponential(2)); }

// demo pair
let t0 = Date.now();
const demo = N.makeDemoPair({ res: 0.3 });
console.log('demo pair', Date.now() - t0, 'ms');
for (const jaw of ['lower', 'upper']) {
  const m = demo[jaw], b = N.meshBounds(m), loops = N.boundaryLoops(m), tw = N.buildTwins(m.indices);
  console.log(' ', jaw, 'verts', m.positions.length / 3, 'tris', m.indices.length / 3, 'size', b.size.map(v => v.toFixed(1)).join(' x '), 'z', b.min[2].toFixed(2), b.max[2].toFixed(2), 'loops', loops.map(l => l.verts.length + '/' + l.length.toFixed(0) + 'mm').join(', '), 'nonManifold', tw.nonManifold);
  ok(loops.length === 1, jaw + ' has exactly one open border');
  ok(tw.nonManifold === 0 && !tw.same.some(v => v), jaw + ' is manifold and consistently wound');
  const Nn = N.vertexNormals(m); let sz = 0; for (let i = 2; i < Nn.length; i += 3) sz += Nn[i];
  ok(jaw === 'lower' ? sz > 0 : sz < 0, jaw + ' normals face the occlusal side');
  fs.writeFileSync(`dev/data/demo-${jaw}.stl`, Buffer.from(N.stlBinary(m)));
  console.log('   teeth', demo.truth[jaw].teeth.map(t => t.fdi + ':' + t.width).join(' '));
}
// closest approach between arches
{ const gU = N.toGeometry(demo.upper), P = demo.lower.positions; let minD = 1e9; const p = new T.Vector3(), o = {};
  for (let i = 0; i < P.length; i += 3 * 7) { p.set(P[i], P[i + 1], P[i + 2]); gU.boundsTree.closestPointToPoint(p, o); if (o.distance < minD) minD = o.distance; }
  ok(minD < 0.35 && minD > 0.0, 'arches are in light contact, min gap ' + minD.toFixed(3)); }

// truth widths vs geometry: distance between truth mesial and distal points
{ let worst = 0; for (const jaw of ['lower', 'upper']) for (const t of demo.truth[jaw].teeth) { const d = Math.hypot(t.mesial[0]-t.distal[0], t.mesial[1]-t.distal[1], t.mesial[2]-t.distal[2]); worst = Math.max(worst, Math.abs(d - t.width) / t.width); }
  ok(worst < 0.06, 'truth contact points span the stated widths (worst rel err ' + worst.toFixed(3) + ')');
  // and the truth points lie on (near) the mesh surface
  const g = N.toGeometry(demo.lower); let far = 0, farPick = 0, worstPick = 0; const o = {};
  for (const t of demo.truth.lower.teeth) { for (const k of ['mesial', 'distal', 'tip']) { g.boundsTree.closestPointToPoint(new T.Vector3(...t[k]), o); far = Math.max(far, o.distance); }
    for (const k of ['mesialPick', 'distalPick']) { g.boundsTree.closestPointToPoint(new T.Vector3(...t[k]), o); farPick = Math.max(farPick, o.distance); }
    const d = Math.hypot(t.mesialPick[0]-t.distalPick[0], t.mesialPick[1]-t.distalPick[1]); worstPick = Math.max(worstPick, Math.abs(d - t.width)); }
  ok(far < 2.2 && farPick < 0.02, 'truth landmarks near the surface (' + far.toFixed(2) + ' mm), pick points on it (' + farPick.toFixed(3) + ')');
  ok(worstPick < 0.2, 'width between pick points (in the occlusal plane) is within ' + worstPick.toFixed(2) + ' mm of the designed width'); }

// auto-orient from a scanner frame
{ t0 = Date.now(); const d2 = N.makeDemoPair({ res: 0.45, scannerFrame: true });
  for (const jaw of ['lower', 'upper']) {
    const r = N.autoOrient(d2[jaw], jaw), back = r.matrix.clone().multiply(d2.matrix);     // should be ≈ identity
    const e = back.elements, ang = Math.acos(Math.min(1, (e[0] + e[5] + e[10] - 1) / 2)) * 180 / Math.PI;
    console.log('  ', jaw, 'auto-orient residual rotation', ang.toFixed(2), 'deg, shift', e[12].toFixed(2), e[13].toFixed(2), e[14].toFixed(2), 'ok', r.ok);
    ok(ang < 5 && Math.abs(e[12]) < 1.5 && Math.abs(e[14]) < 1.6, jaw + ' auto-orient recovers the frame');
  } console.log('  orient test', Date.now() - t0, 'ms'); }

// cleanMesh on a dirtied mesh
{ const m = demo.lower, P = Array.from(m.positions), I = Array.from(m.indices), nV = P.length / 3;
  for (let f = 0; f < 50; f++) I.push(I[3 * f], I[3 * f + 1], I[3 * f + 2]);                 // duplicates
  for (let f = 1000; f < 1400; f++) { const s = I[3 * f + 1]; I[3 * f + 1] = I[3 * f + 2]; I[3 * f + 2] = s; }   // flipped patch
  P.push(100, 100, 100, 101, 100, 100, 100, 101, 100); I.push(nV, nV + 1, nV + 2);             // island
  P.push(0, 0, 50); I.push(I[30000], I[30001], nV + 3);                                         // fin on an inner edge → non-manifold
  const r = N.cleanMesh({ positions: Float32Array.from(P), indices: Uint32Array.from(I) });
  console.log('  clean report', JSON.stringify(r.report));
  ok(r.report.duplicate === 50 && r.report.flipped === 400 && r.report.islandsRemoved >= 1 && r.report.nonManifold >= 3, 'cleanMesh finds duplicates, flips, islands, fins');
  const tw = N.buildTwins(r.mesh.indices); ok(tw.nonManifold === 0 && !tw.same.some(v => v), 'cleaned mesh is manifold and consistent');
  const loops = N.boundaryLoops(r.mesh); const filled = N.fillHoles(r.mesh, loops.slice(1)); ok(N.boundaryLoops(filled).length === 1, 'holes left by the fin removal are filled (' + (loops.length - 1) + ' small holes)'); }

// zip + case round trip
{ const z = await N.zipFiles([{ name: 'a.txt', data: 'hello '.repeat(500) }, { name: 'b/c.bin', data: new Uint8Array([1, 2, 3]) }]); const back = await N.unzip(z);
  ok(back.length === 2 && new TextDecoder().decode(back[0].data).length === 3000 && back[1].data[2] === 3 && z.size < 1000, 'zip round trip (deflated to ' + z.size + ' bytes)');
  const c = new N.DentalCase(); const M = new T.Matrix4().makeRotationZ(0.3).setPosition(1, 2, 3);
  c.add({ role: 'lower-scan', name: 'lower.stl', mesh: demo.lower, matrix: M, meta: { a: 1 } }); c.add({ role: 'upper-scan', name: 'upper.stl', mesh: demo.upper, matrix: M }); c.data.test = { hello: [1, 2] };
  const blob = await c.toBlob('test'); const c2 = await N.DentalCase.fromBlob(blob); const l2 = c2.get('lower-scan');
  let same = l2.mesh.positions.length === demo.lower.positions.length && l2.mesh.indices.length === demo.lower.indices.length; for (let i = 0; same && i < 3000; i++) same = l2.mesh.positions[i] === demo.lower.positions[i] && l2.mesh.indices[i] === demo.lower.indices[i];
  ok(same && c2.items.length === 2 && c2.data.test.hello[1] === 2 && l2.matrix.equals(M) && l2.meta.a === 1, 'case file round trip keeps meshes exactly (' + (blob.size / 1e6).toFixed(2) + ' MB)');
  fs.writeFileSync('dev/data/demo-case.zip', Buffer.from(await blob.arrayBuffer())); }

// height field + morphology
{ const hf = N.rasterHeightfield(demo.lower, { cell: 0.25 }); let fin = 0, mx = -1e9; for (const v of hf.z) if (Number.isFinite(v)) { fin++; mx = Math.max(mx, v); }
  const d = N.morphField(hf, 1.0, { op: 'dilate' }), e = N.morphField(hf, 0.5, { op: 'erode', shape: 'flat' }); let dmx = -1e9, efin = 0; for (const v of d.z) if (v > dmx) dmx = v; for (const v of e.z) if (Number.isFinite(v)) efin++;
  ok(Math.abs(dmx - mx - 1.0) < 0.02 && efin < fin && efin > fin * 0.7, `height field ${hf.nx}x${hf.ny}, dilate raises the top by r, erode shrinks the footprint`); }

console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
