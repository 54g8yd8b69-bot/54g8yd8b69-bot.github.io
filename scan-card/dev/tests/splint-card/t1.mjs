import { K, N, S, saveStl } from './kernel.mjs';
const demo = N.makeDemoPair({ res: 0.3 });
for (const jaw of ['lower', 'upper']) {
  const A = K.archMatrix(jaw), scanA = N.transformMesh(demo[jaw], A);
  let t = Date.now(); const arch = K.analyseArch(scanA); console.log(jaw, 'analyseArch', Date.now() - t, 'ms  L', arch.L.toFixed(1), 'n', arch.n, 'top range', Math.min(...arch.top).toFixed(2), Math.max(...arch.top).toFixed(2), 'ends', [arch.px[0], arch.py[0]].map(v => v.toFixed(1)), [arch.px[arch.n - 1], arch.py[arch.n - 1]].map(v => v.toFixed(1)));
  const inp = { scanA, arch, cache: {} };
  const r = await K.build(inp, {}, async (s) => {});
  console.log('  report', JSON.stringify(r.report));
  t = Date.now(); const th = K.thickness(r.mesh, r.triKind); console.log('  thickness', Date.now() - t, 'ms  min', th.min.toFixed(3), 'at', th.minAt && th.minAt.map(v => v.toFixed(1)));
  saveStl(`s1-${jaw}.stl`, r.mesh);
  const r2 = await K.build(inp, { thickness: 1.5 }); console.log('  rebuild (thickness only) times', JSON.stringify(r2.report.times));
}
process.exit(0);
