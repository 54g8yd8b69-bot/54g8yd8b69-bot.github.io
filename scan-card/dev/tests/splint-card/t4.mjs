// marching cubes + distance band unit checks
import { K, N, S, saveStl } from './kernel.mjs';
const M = await S.ready();
const mk = (n, h, f) => { const g = { nx: n, ny: n, nz: n, x0: -n * h / 2, y0: -n * h / 2, z0: -n * h / 2, h, v: new Float32Array(n * n * n) }; for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) g.v[(k * n + j) * n + i] = f(g.x0 + i * h, g.y0 + j * h, g.z0 + k * h); return g; };
const test = (name, g, expectVol) => { const t = Date.now(), m = K.marchingCubes(g), dt = Date.now() - t; const wt = N.isWatertight(m), vol = N.meshVolume(m); let man = null, err = ''; try { man = S.toManifold(m); } catch (e) { err = e.message; } console.log(name.padEnd(28), 'tris', m.indices.length / 3, 'watertight', wt, 'vol', vol.toFixed(3), expectVol ? '(expect ' + expectVol.toFixed(3) + ')' : '', 'manifold', man ? 'ok genus ' + man.genus() + ' parts ' + man.decompose().length : 'FAIL ' + err, dt + 'ms'); return m; };
test('sphere r=3', mk(48, 0.2, (x, y, z) => Math.hypot(x, y, z) - 3), 4 / 3 * Math.PI * 27);
test('torus', mk(64, 0.2, (x, y, z) => Math.hypot(Math.hypot(x, y) - 3.5, z) - 1.2), 2 * Math.PI ** 2 * 3.5 * 1.44);
test('thin shell 0.3 (h=0.2)', mk(64, 0.2, (x, y, z) => Math.abs(Math.hypot(x, y, z) - 4) - 0.15), 4 / 3 * Math.PI * (4.15 ** 3 - 3.85 ** 3));
test('noise blobs', mk(56, 0.2, (x, y, z) => Math.sin(x * 2.1) * Math.sin(y * 1.7) * Math.sin(z * 2.3) + 0.05 * Math.sin(x * 9 + y * 7) - 0.1 + Math.max(0, Math.hypot(x, y, z) - 4.5) * 3));
test('checkerboard-ish', mk(40, 0.2, (x, y, z) => { const i = Math.round(x / 0.2), j = Math.round(y / 0.2), k = Math.round(z / 0.2); return (Math.hypot(x, y, z) < 3 ? ((i + j + k) & 1 ? -0.3 : 0.4) : 1); }));
// distance band on a sphere mesh: compare with the analytic distance
{ const sph = M.Manifold.sphere(5, 96), sm = S.fromManifold(sph), use = new Uint8Array(sm.indices.length / 3).fill(1);
  let t = Date.now(); const g = K.distanceBand(sm, use, 0.2, 0.5); const dt = Date.now() - t; let n = 0, maxE = 0, wrongSign = 0;
  for (let k = 0; k < g.nz; k++) for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) { const v = g.v[(k * g.ny + j) * g.nx + i]; if (v > 1e8) continue; n++; const tr = Math.hypot(g.x0 + i * g.h, g.y0 + j * g.h, g.z0 + k * g.h) - 5; if (Math.abs(v - tr) > maxE) maxE = Math.abs(v - tr); if (v * tr < 0 && Math.abs(tr) > 0.02) wrongSign++; }
  console.log('distanceBand sphere: tris', sm.indices.length / 3, 'nodes', n, 'max err vs analytic', maxE.toFixed(4), '(faceting of the sphere mesh ~', (5 * (1 - Math.cos(Math.PI / 96))).toFixed(4) + ')', 'wrong sign', wrongSign, dt + 'ms');
  for (let q = 0; q < g.v.length; q++) { const v = g.v[q]; g.v[q] = v > 1e8 ? 1 : Math.max(v - 0.1, -0.2 - v); }
  const sh = test('shell of sphere (c=0.1)', g, 4 / 3 * Math.PI * (5.1 ** 3 - 4.8 ** 3));
  let rmin = 9, rmax = 0; for (let i = 0; i < sh.positions.length; i += 3) { const r = Math.hypot(sh.positions[i], sh.positions[i + 1], sh.positions[i + 2]); if (r > 4.95) { rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); } } console.log('   outer sheet radius', rmin.toFixed(4), '…', rmax.toFixed(4), '(target 5.1)'); }
process.exit(0);
