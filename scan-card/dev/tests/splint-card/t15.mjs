// find a hole through the shell: outer vertices with (almost) no thickness that are not at the margin.  node t15.mjs cx cy [json]
import { K, N, S, saveStl } from './kernel.mjs';
await S.ready(); const demo = N.makeDemoPair({ res: 0.3 });
const jaw = 'upper', cx = +(process.argv[2] || -9.5), cy = +(process.argv[3] || -23.5), over = process.argv[4] ? JSON.parse(process.argv[4]) : {};
const sA = N.transformMesh(demo[jaw], K.archMatrix(jaw)), arch = K.analyseArch(sA), inp = { scanA: sA, arch, cache: {} };
const r = await K.build(inp, over), th = K.thickness(r.mesh, r.triKind, 0.85), P = r.mesh.positions, mp = { ...K.DEFAULTS, ...over }, o = {};
console.log('genus', r.report.genus);
const rows = []; for (let v = 0; v < th.t.length; v++) { const t = th.t[v]; if (!(t === t) || t > 0.3) continue; const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2]; if (Math.abs(x - cx) > 4 || Math.abs(y - cy) > 4) continue;
  K.archCoords(arch, x, y, o); K.borderAt(arch, mp, x, y, o); rows.push([x, y, z, t, z - o.z, o.d]); }
rows.sort((a, b) => b[4] - a[4]); console.log('thin outer vertices in the box:', rows.length, ' height above the margin surface: max', rows[0] && rows[0][4].toFixed(2), 'median', rows.length && rows[rows.length >> 1][4].toFixed(2));
for (const q of rows.slice(0, 14)) console.log('  ', q.map((v) => v.toFixed(2)).join('  '));
process.exit(0);
