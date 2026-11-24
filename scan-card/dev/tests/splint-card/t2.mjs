import { K, N, S, saveStl } from './kernel.mjs';
import { checkAppliance, fmtCheck } from './verify.mjs';
await S.ready(); const demo = N.makeDemoPair({ res: 0.3 });
const jaw = process.argv[2] || 'lower';
const A = K.archMatrix(jaw), scanA = N.transformMesh(demo[jaw], A), arch = K.analyseArch(scanA), inp = { scanA, arch, cache: {} };
const p = { ...K.DEFAULTS };
const r = await K.build(inp, p); console.log('times', JSON.stringify(r.report.times));
const t = Date.now(); const chk = checkAppliance(scanA, arch, r, p); console.log(fmtCheck(chk)); console.log('check took', Date.now() - t, 'ms');
process.exit(0);
