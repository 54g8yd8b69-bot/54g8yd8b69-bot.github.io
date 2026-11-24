// profile the cavity stage
import { K, N, S } from './kernel.mjs';
const M = await S.ready(); const demo = N.makeDemoPair({ res: +(process.argv[2] || 0.3) });
const sA = N.transformMesh(demo.lower, K.archMatrix('lower')), arch = K.analyseArch(sA); console.log('tris', sA.indices.length / 3);
const tm = (l, f) => { const t = Date.now(); const r = f(); console.log(l.padEnd(34), Date.now() - t, 'ms'); return r; };
const b = N.meshBounds(sA), sol = tm('scanToSolid', () => S.scanToSolid(sA, { baseZ: b.min[2] - 3 }).mesh), hf = tm('raster fine', () => N.rasterHeightfield(sA, { cell: 0.075, pad: 0.6, bounds: b }));
const P = sol.positions, I = sol.indices, nV = P.length / 3, nF = I.length / 3, above = new Uint8Array(nV), use = new Uint8Array(nF), o = {}, cov = { buccal: 5.5, lingual: 6.5, adjB: [], adjL: [], distal: 7, reach: 15 };
tm('above flags', () => { for (let v = 0; v < nV; v++) { K.borderAt(arch, cov, P[3 * v], P[3 * v + 1], o); above[v] = P[3 * v + 2] > o.z ? 1 : 0; } });
let nUse = 0; for (let f = 0; f < nF; f++) if (above[I[3 * f]] || above[I[3 * f + 1]] || above[I[3 * f + 2]]) { use[f] = 1; nUse++; } console.log('used tris', nUse);
const gr = tm('growScan', () => K.growScan(sol, above, 0.1));
const band = tm('distanceBand', () => K.distanceBand(sol, use, 0.2, 0.2 + 0.08 + 0.12));
tm('morph dilate w (hfW)', () => N.morphField(hf, 0.5, { op: 'dilate', shape: 'flat' }));
tm('morph grow c', () => N.morphField(hf, 0.08, { op: 'dilate' }));
tm('morph closing', () => N.morphField(N.morphField(hf, 0.08 + 0.25, { op: 'dilate' }), 0.25, { op: 'erode' }));
const cv = tm('K.cavity (all, band given)', () => K.cavity(sol, hf, use, (x, y) => { K.borderAt(arch, cov, x, y, o); return o.z + 0.5; }, { h: 0.2, clearance: 0.08, retention: 0.1, band })); console.log('  stats', JSON.stringify(cv.stats));
const mk = (mesh) => new M.Manifold(new M.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));
const mc = tm('manifold(mc)', () => mk(cv.mesh)), gm = tm('manifold(grown scan)', () => mk({ positions: gr.positions, indices: sol.indices })); tm('union', () => { const u = mc.add(gm); u.numTri(); return u; });
process.exit(0);
