// where is the thinnest wall for a given parameter set?  node t18.mjs <lower|upper> '<json>'
import { K, N, S } from './kernel.mjs';
import { checkAppliance } from './verify.mjs';
await S.ready(); const demo = N.makeDemoPair({ res: 0.3 }), jaw = process.argv[2] || 'lower', over = JSON.parse(process.argv[3] || '{}');
const sA = N.transformMesh(demo[jaw], K.archMatrix(jaw)), arch = K.analyseArch(sA), p = { ...K.DEFAULTS, ...over };
const r = await K.build({ scanA: sA, arch, cache: {} }, p), c = checkAppliance(sA, arch, r, p);
console.log(JSON.stringify(over), 'genus', r.report.genus, 'edge', r.report.edge, 'seat', c.seatMin.toFixed(3), 'fitErrP95', c.fitErrP95.toFixed(3), 'engagedMax', c.engagedMax, 'thickMin', c.thickMin.toFixed(3), 'at', c.thickAt.map((v) => v.toFixed(1)).join(','), 'p01', c.thickP01.toFixed(3));
const th = K.thickness(r.mesh, r.triKind, p.edge + 0.25), P = r.mesh.positions, o = {}, rows = [];
for (let v = 0; v < th.t.length; v++) { const t = th.t[v]; if (!(t === t) || th.border[v] || t > p.thickness - 0.08) continue; K.archCoords(arch, P[3 * v], P[3 * v + 1], o); const s = o.s, d = o.d; K.borderAt(arch, p, P[3 * v], P[3 * v + 1], o); rows.push([P[3 * v], P[3 * v + 1], P[3 * v + 2], t, s, d, P[3 * v + 2] - o.z]); }
rows.sort((a, b) => a[3] - b[3]); console.log('outer vertices thinner than set - 0.08, away from the border:', rows.length, '  columns: x y z thickness s d height-above-border');
for (const q of rows.slice(0, 10)) console.log('   ', q.map((v) => v.toFixed(2)).join('  '));
process.exit(0);
