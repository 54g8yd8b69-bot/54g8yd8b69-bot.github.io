import { K, N, S, saveStl } from './kernel.mjs';
await S.ready(); const demo = N.makeDemoPair({ res: 0.3 });
const jaw = 'lower', A = K.archMatrix(jaw), scanA = N.transformMesh(demo[jaw], A), arch = K.analyseArch(scanA), inp = { scanA, arch, cache: {} };
const r = await K.build(inp, {});
const kc = [0, 0, 0]; for (const k of r.triKind) kc[k]++; console.log('tri kinds', kc, 'ids', inp.cache.ids);
const th = K.thickness(r.mesh, r.triKind); let nb = 0, nn = 0, big = 0; for (let i = 0; i < th.t.length; i++) { if (th.t[i] === th.t[i]) { nn++; if (th.border[i]) nb++; else if (th.t[i] > 5) big++; } } console.log('outer verts', nn, 'border', nb, 'big', big, 'min', th.min);
// brute-force check for a few outer verts
const P = r.mesh.positions, I = r.mesh.indices; let shown = 0;
for (let v = 0; v < th.t.length && shown < 5; v += 997) { if (!(th.t[v] > 5)) continue; shown++; let best = 1e9; for (let f = 0; f < I.length / 3; f++) { if (!r.triKind[f]) continue; for (let k = 0; k < 3; k++) { const w = I[3 * f + k]; const d = Math.hypot(P[3 * w] - P[3 * v], P[3 * w + 1] - P[3 * v + 1], P[3 * w + 2] - P[3 * v + 2]); if (d < best) best = d; } } console.log(' v', v, 'bvh', th.t[v].toFixed(3), 'brute(vertex)', best.toFixed(3), 'pos', [P[3 * v], P[3 * v + 1], P[3 * v + 2]].map(x => x.toFixed(1))); }
process.exit(0);
