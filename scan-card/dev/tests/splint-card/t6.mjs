// accuracy run: node t6.mjs [quick]
import { K, N, S, saveStl, loadStl } from './kernel.mjs';
import { checkAppliance, fmtCheck } from './verify.mjs';
await S.ready(); const demo = N.makeDemoPair({ res: 0.3 });
const run = async (label, scanA, over, save) => { const arch = K.analyseArch(scanA), inp = { scanA, arch, cache: {} }, p = { ...K.DEFAULTS, ...over, ...JSON.parse(process.env.OVER || '{}') }; const r = await K.build(inp, p); const chk = checkAppliance(scanA, arch, r, p);
  console.log(`\n## ${label}  ${JSON.stringify(over)}  times ${JSON.stringify(r.report.times)}`); console.log(fmtCheck(chk)); if (save) saveStl(save, r.mesh); return { r, chk, inp }; };
const which = process.argv[2] || 'all';
if (which === 'all' || which === 'lower') { const sA = N.transformMesh(demo.lower, K.archMatrix('lower')); await run('demo lower uniform', sA, {}, 's1-lower.stl'); if (which === 'all') { await run('demo lower r=0', sA, { retention: 0 }); await run('demo lower r=0.25 c=0.2', sA, { retention: 0.25, clearance: 0.2 }); await run('demo lower c=0.05 t=1', sA, { clearance: 0.05, thickness: 1 }); } }
if (which === 'all' || which === 'upper') { const sA = N.transformMesh(demo.upper, K.archMatrix('upper')); await run('demo upper uniform', sA, {}, 's1-upper.stl'); }
process.exit(0);
