import { K, N, S, saveStl, loadStl } from './kernel.mjs';
await S.ready();
const raw = N.cleanMesh(loadStl('scanner-lower.stl')).mesh, o = N.autoOrient(raw, 'lower'), sA = N.transformMesh(raw, o.matrix), arch = K.analyseArch(sA), inp = { scanA: sA, arch, cache: {} };
console.log('scanner-lower tris', raw.indices.length / 3, 'orient ok', o.ok, 'arch L', arch.L.toFixed(1));
for (const over of [{}, { tiltX: 4, buccal: 4.5, retention: 0.2 }]) {
  const r = await K.build(inp, over), th = K.thickness(r.mesh, r.triKind, 0.85);
  const tv = []; for (let i = 0; i < th.t.length; i++) if (th.t[i] === th.t[i] && !th.border[i]) tv.push(th.t[i]); tv.sort((a, b) => a - b);
  console.log(JSON.stringify(over).padEnd(46), 'genus', r.report.genus, 'parts', r.report.parts, 'thin', th.min.toFixed(3), 'at', th.minAt.map(v => v.toFixed(1)).join(','), 'p0.1%', tv[Math.floor(tv.length * 0.001)].toFixed(3), 'p1%', tv[Math.floor(tv.length * 0.01)].toFixed(3), 'n<1.8:', tv.filter(v => v < 1.8).length, 'vol', (r.report.volume / 1000).toFixed(2));
  if (over.tiltX) { saveStl('t8-case.stl', r.mesh); // dump thin vertices
    const P = r.mesh.positions; let n = 0; for (let i = 0; i < th.t.length && n < 12; i++) if (th.t[i] < 1.5 && !th.border[i]) { n++; console.log('   thin v', [P[3 * i], P[3 * i + 1], P[3 * i + 2]].map(v => v.toFixed(2)).join(','), th.t[i].toFixed(3)); } }
}
process.exit(0);
