// find the handle in the {buccal: 4.5} case
import { K, N, S, saveStl } from './kernel.mjs';
import { checkAppliance, fmtCheck } from './verify.mjs';
const M = await S.ready(); const demo = N.makeDemoPair({ res: 0.3 });
const sA = N.transformMesh(demo.lower, K.archMatrix('lower')), arch = K.analyseArch(sA), inp = { scanA: sA, arch, cache: {} }, p = { ...K.DEFAULTS, buccal: 4.5 };
const r = await K.build(inp, p); console.log('genus', r.report.genus, 'cavity genus', inp.cache.cav.genus(), 'cav parts', inp.cache.cav.decompose().length);
const chk = checkAppliance(sA, arch, r, p); console.log('engagedMax', chk.engagedMax, 'p99', chk.engagedP99, 'seat', chk.seatMin);
// cut the appliance into slabs across the arch (x) and count pieces / genus per slab to localise the handle
const man = S.toManifold(r.mesh), bb = man.boundingBox();
for (let x = Math.floor(bb.min[0]); x < bb.max[0]; x += 4) { const box = M.Manifold.cube([4, 200, 200], true).translate([x + 2, 0, 0]), part = man.intersect(box); if (part.isEmpty()) continue; const ps = part.decompose(); const gs = ps.map((q) => q.genus()); if (gs.some((g) => g !== 0)) console.log('  x', x, '…', x + 4, 'pieces', ps.length, 'genus', gs.join(','), 'bbox y', ps.map((q) => { const b = q.boundingBox(); return q.genus() ? `[${b.min[1].toFixed(1)},${b.max[1].toFixed(1)}] z[${b.min[2].toFixed(1)},${b.max[2].toFixed(1)}]` : ''; }).join(' ')); }
process.exit(0);
