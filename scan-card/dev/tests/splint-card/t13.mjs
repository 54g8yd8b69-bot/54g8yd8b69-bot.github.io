import { K, N, S, saveStl } from './kernel.mjs';
const M = await S.ready(); const demo = N.makeDemoPair({ res: 0.3 });
const jaw = 'upper', cx = +(process.argv[2] || 8.5), cy = +(process.argv[3] || -23.5), over = process.argv[4] ? JSON.parse(process.argv[4]) : {}, sA = N.transformMesh(demo[jaw], K.archMatrix(jaw)), arch = K.analyseArch(sA), inp = { scanA: sA, arch, cache: {} };
const r = await K.build(inp, over); const man = S.toManifold(r.mesh);
const box = M.Manifold.cube([7, 7, 12], true).translate([cx, cy, 0]), part = man.intersect(box); console.log('piece genus', part.genus(), 'parts', part.decompose().length);
saveStl('t13-piece.stl', S.fromManifold(part));
// the scan in the same box, as a thin solid for viewing
const sm = S.toManifold(inp.cache.sol).intersect(M.Manifold.cube([9, 9, 12], true).translate([cx, cy, 0])); saveStl('t13-scan.stl', S.fromManifold(sm));
// where is appliance material that lies in the scan's shadow (below something) in this box? list fit-side vertices with undercut depth
const hf = N.rasterHeightfield(sA, { cell: 0.05, pad: 0.6 }); const pm = S.fromManifold(part), uc = K.undercutDepth(pm, hf, 2.5); let n = 0; const zs = [];
for (let i = 0; i < uc.length; i++) if (uc[i] > 0.2) { n++; if (zs.length < 12) zs.push([pm.positions[3 * i], pm.positions[3 * i + 1], pm.positions[3 * i + 2], uc[i]].map((v) => v.toFixed(2)).join(',')); }
console.log('piece verts in shadow deeper than 0.2:', n, zs.join(' | '));
process.exit(0);
