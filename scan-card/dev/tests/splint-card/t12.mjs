// localise handles: node t12.mjs upper|lower [json params]
import { K, N, S, saveStl } from './kernel.mjs';
const M = await S.ready(); const demo = N.makeDemoPair({ res: 0.3 });
const jaw = process.argv[2] || 'upper', over = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const sA = N.transformMesh(demo[jaw], K.archMatrix(jaw)), arch = K.analyseArch(sA), inp = { scanA: sA, arch, cache: {} };
const r = await K.build(inp, over); console.log(jaw, JSON.stringify(over), 'genus', r.report.genus, 'parts', r.report.parts);
const man = S.toManifold(r.mesh), bb = man.boundingBox();
const probe = (ax, lo, hi, step, other) => { for (let x = lo; x < hi; x += step) { const size = [200, 200, 200], pos = [0, 0, 0]; size[ax] = step; pos[ax] = x + step / 2; let box = M.Manifold.cube(size, true).translate(pos); if (other) box = box.intersect(other); const part = man.intersect(box); if (part.isEmpty()) continue; for (const q of part.decompose()) if (q.genus() !== 0) { const b = q.boundingBox(); console.log(`  axis ${ax} ${x.toFixed(1)}…${(x + step).toFixed(1)} genus ${q.genus()} bbox x[${b.min[0].toFixed(1)},${b.max[0].toFixed(1)}] y[${b.min[1].toFixed(1)},${b.max[1].toFixed(1)}] z[${b.min[2].toFixed(1)},${b.max[2].toFixed(1)}]`); } } };
probe(0, Math.floor(bb.min[0]), bb.max[0], 3); probe(1, Math.floor(bb.min[1]), bb.max[1], 3);
process.exit(0);
