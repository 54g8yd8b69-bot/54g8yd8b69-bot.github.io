import { K, N, S, saveStl } from './kernel.mjs';
await S.ready(); const demo = N.makeDemoPair({ res: 0.3 });
const sA = N.transformMesh(demo.lower, K.archMatrix('lower')), arch = K.analyseArch(sA), inp = { scanA: sA, arch, cache: {} };
for (const over of [{}, { tiltX: 4 }, { buccal: 4.5 }, { retention: 0.2 }, { tiltX: 4, buccal: 4.5, retention: 0.2 }]) {
  const r = await K.build(inp, over), th = K.thickness(r.mesh, r.triKind, 0.85);
  console.log(JSON.stringify(over).padEnd(46), 'genus', r.report.genus, 'parts', r.report.parts, 'thin', th.min.toFixed(3), 'at', th.minAt.map(v => v.toFixed(1)).join(','), 'vol', (r.report.volume / 1000).toFixed(2), 'crumb mm3', r.report.crumbVolume.toFixed(3), 'ms', r.report.times.total, JSON.stringify(r.report.times));
  if (over.tiltX && over.buccal) saveStl('t7-case.stl', r.mesh);
}
process.exit(0);
