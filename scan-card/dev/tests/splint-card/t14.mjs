// topology of the upper guard with and without the "own triangles" shortcut.  node t14.mjs [jaw] [json overrides...]
import { K, N, S, saveStl } from './kernel.mjs';
await S.ready(); const demo = N.makeDemoPair({ res: 0.3 }), jaw = process.argv[2] || 'upper';
const sA = N.transformMesh(demo[jaw], K.archMatrix(jaw)), arch = K.analyseArch(sA);
for (const a of process.argv.slice(3)) { const over = JSON.parse(a);
  const r = await K.build({ scanA: sA, arch, cache: {} }, over);
  console.log(a.padEnd(34), 'genus', r.report.genus, 'parts', r.report.parts, 'crumbs', r.report.crumbs, 'vol', (r.report.volume / 1000).toFixed(3), JSON.stringify(r.report.times), JSON.stringify(r.report.cavity || {}).slice(0, 140));
  if (over.save) saveStl(over.save, r.mesh);
}
process.exit(0);
