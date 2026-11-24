// ─────────────────────────────────────────────────────────────────────────────
// Notile 3D solids  ·  shared by Model Card and Splint Card
// Turns scans into watertight, printable solids and combines solids (Manifold, WebAssembly).
//
// Needs in the page:   <script src="manifold-wasm.js"></script>     (the engine binary, shipped beside the app)
// and in the importmap: "manifold-3d/manifold.js": "https://cdn.jsdelivr.net/npm/manifold-3d@3.5.5/manifold.js"
//
//   import * as S from './solid.js';
//   const M = await S.ready();                       // { Manifold, CrossSection, Mesh, triangulate, … }
//   const { mesh } = S.scanToSolid(scanMesh, { baseZ: -20 });
//   const man = S.toManifold(mesh);                  // → Manifold; combine with man.add / subtract / intersect
//   const out = S.fromManifold(result);              // → MeshData for display / STL
// Manifold objects live in WebAssembly memory: call .delete() on ones you no longer need (S.free(a, b, …) does it safely).
// ─────────────────────────────────────────────────────────────────────────────
import * as N from './core.js';
import Module from 'manifold-3d/manifold.js';
import { Font } from 'three/addons/loaders/FontLoader.js';
const THREE = N.THREE;

let wasm = null, loading = null;
/** Load the Manifold engine once. → the module ({ Manifold, CrossSection, Mesh, triangulate, … }) */
export function ready() {
  if (wasm) return Promise.resolve(wasm);
  if (!loading) loading = (async () => {
    const b64 = globalThis.MANIFOLD_WASM_B64, opts = {};
    if (b64) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); opts.wasmBinary = u.buffer; }
    const w = await Module(opts); w.setup(); wasm = w; return w;
  })();
  return loading;
}
const need = () => { if (!wasm) throw new Error('Call await S.ready() first'); return wasm; };
export const free = (...objs) => { for (const o of objs) { try { if (o && o.delete) o.delete(); } catch (_) {} } };

/** MeshData (must be a closed, consistently wound shell) → Manifold. Throws a readable error if it is not solid. */
export function toManifold(mesh) {
  const w = need(); let man;
  const m = new w.Mesh({ numProp: 3, vertProperties: mesh.positions instanceof Float32Array ? mesh.positions : new Float32Array(mesh.positions), triVerts: mesh.indices instanceof Uint32Array ? mesh.indices : new Uint32Array(mesh.indices) });
  try { man = new w.Manifold(m); } catch (e) { throw new Error('That mesh is not a closed solid (' + ((e && e.message) || e) + ').'); }
  const st = man.status(); if (st && st !== 'NoError' && st.value !== 0 && st !== 0) { free(man); throw new Error('That mesh is not a closed solid (' + (st.value ?? st) + ').'); }
  return man;
}
/** Manifold → MeshData */
export function fromManifold(man) {
  const m = man.getMesh(), np = m.numProp, nV = m.vertProperties.length / np; let P;
  if (np === 3) P = new Float32Array(m.vertProperties); else { P = new Float32Array(nV * 3); for (let i = 0; i < nV; i++) { P[3 * i] = m.vertProperties[np * i]; P[3 * i + 1] = m.vertProperties[np * i + 1]; P[3 * i + 2] = m.vertProperties[np * i + 2]; } }
  return { positions: P, indices: new Uint32Array(m.triVerts), colors: null };
}
/** THREE.Matrix4 → Manifold's column-major Mat4 array */
export const mat4 = (m) => Array.from(m.elements);

// ───────────────────────────── 2D outlines ─────────────────────────────
const area2 = (p) => { let a = 0; for (let i = 0, n = p.length; i < n; i++) { const q = p[(i + 1) % n]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; };
/** Points every `step` mm round a closed polygon [[x,y]…]. */
export function resamplePolygon(poly, step = 0.5) {
  const n = poly.length, len = []; let L = 0; for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]); len.push(l); L += l; }
  const m = Math.max(8, Math.round(L / step)), out = []; let seg = 0, acc = 0;
  for (let k = 0; k < m; k++) { const s = (k / m) * L; while (seg < n - 1 && acc + len[seg] < s) { acc += len[seg]; seg++; } const a = poly[seg], b = poly[(seg + 1) % n], t = len[seg] > 0 ? (s - acc) / len[seg] : 0; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  return out;
}
/**
 * Clean a (possibly ragged or self-crossing) closed loop into one simple outline.
 *   close: fill notches narrower than 2×close.  open: remove spikes thinner than 2×open.  margin: grow outward (mm).
 * → [[x,y]…] counter-clockwise, resampled every `step` mm; or null if nothing is left.
 */
export function cleanOutline(loop, o = {}) {
  const w = need(), close = o.close ?? 0.8, open = o.open ?? 0.3, margin = o.margin || 0, seg = 24;
  let cs = new w.CrossSection([loop], 'NonZero'), t;
  const step = (d) => { t = cs.offset(d, 'Round', 2, seg); cs.delete(); cs = t; };
  if (close > 0) { step(close); step(-close); }
  if (open > 0) { step(-open); step(open); }
  if (margin) step(margin);
  t = cs.simplify(0.02); cs.delete(); cs = t;
  const polys = cs.toPolygons(); cs.delete();
  let best = null, ba = 0; for (const p of polys) { const a = area2(p); if (a > ba) { ba = a; best = p; } }
  return best ? resamplePolygon(best, o.step || 0.5) : null;
}

// ───────────────────────────── scan → solid ─────────────────────────────
/**
 * Close an open scan into a watertight solid by dropping a wall from its border down to a flat base.
 *   mesh   scan with its teeth pointing +Z (flip an upper arch first), any orientation of triangles
 *   baseZ  height of the flat underside (must be below the whole scan)
 *   o.margin (0)   mm the wall stands outside the scan border      o.smooth (0.8)  how much the outline is tidied
 *   o.drop (0.25)  mm the wall top sits below the scan's edge      o.step (0.5)    spacing of wall vertices
 * Small holes are closed with flat patches; if the scan is in several pieces only the largest is used.
 * The original scan triangles are kept untouched, so undercuts and surface detail survive exactly.
 * → { mesh (watertight MeshData), outline [[x,y]…], report:{ holesFilled, largestHole, piecesDropped, rimVerts, rimZ:[min,max], volume } }
 */
export function scanToSolid(mesh, o = {}) {
  const w = need(), baseZ = o.baseZ, drop = o.drop ?? 0.25, rep = { holesFilled: 0, largestHole: 0, piecesDropped: 0 };
  let m; { const cl = N.cleanMesh(mesh, { islandFraction: 0.999 }); rep.piecesDropped = cl.report.islandsRemoved; m = cl.mesh; }   // largest piece only
  { const Nn = N.vertexNormals(m); let sz = 0; for (let i = 2; i < Nn.length; i += 3) sz += Nn[i]; if (sz < 0) { const I = m.indices; for (let t = 0; t < I.length; t += 3) { const q = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = q; } } }
  let loops = N.boundaryLoops(m);
  if (!loops.length) { rep.alreadyClosed = true; rep.volume = N.meshVolume(m); return { mesh: m, outline: null, report: rep }; }
  if (loops.length > 1) { rep.holesFilled = loops.length - 1; rep.largestHole = loops[1].length; m = N.fillHoles(m, loops.slice(1)); loops = N.boundaryLoops(m); if (loops.length > 1) m = N.fillHoles(m, loops.slice(1)); loops = N.boundaryLoops(m); }
  const rim = loops[0].verts, n = rim.length, P = m.positions;
  let zmin = Infinity, zmax = -Infinity; const loop2 = [];
  for (let i = 0; i < n; i++) { const v = rim[i] * 3; loop2.push([P[v], P[v + 1]]); if (P[v + 2] < zmin) zmin = P[v + 2]; if (P[v + 2] > zmax) zmax = P[v + 2]; }
  rep.rimVerts = n; rep.rimZ = [zmin, zmax];
  if (!(baseZ < zmin - 0.2)) throw new Error('The base has to sit below the lowest edge of the scan.');
  let S = cleanOutline(loop2, { close: o.smooth ?? 0.8, open: Math.min(0.4, (o.smooth ?? 0.8) / 2), margin: o.margin || 0, step: o.step || 0.5 });
  if (!S || S.length < 8) throw new Error('Could not work out the outline of this scan.');
  if (area2(loop2) < 0) S.reverse();                              // run the outline the same way round as the scan border
  const mS = S.length;
  // wall-top height: just under the lowest nearby part of the scan edge, smoothed
  const zt = new Float32Array(mS), bound = new Float32Array(mS);
  for (let j = 0; j < mS; j++) { let best = Infinity, bz = zmin, lo = Infinity; for (let i = 0; i < n; i++) { const dx = loop2[i][0] - S[j][0], dy = loop2[i][1] - S[j][1], d = dx * dx + dy * dy, z = P[rim[i] * 3 + 2]; if (d < best) { best = d; bz = z; } if (d < 2.25 && z < lo) lo = z; } bound[j] = Math.max(baseZ + 0.3, Math.min(bz, lo) - drop); zt[j] = bound[j]; }
  for (let it = 0; it < 4; it++) { const c = Float32Array.from(zt); for (let j = 0; j < mS; j++) { const a = c[(j + mS - 1) % mS], b = c[(j + 1) % mS]; zt[j] = Math.min(bound[j], (a + 2 * c[j] + b) / 4); } }
  // vertices: [scan…][wall top ring][wall bottom ring]
  const nV = P.length / 3, T0 = nV, B0 = nV + mS, P2 = new Float32Array((nV + 2 * mS) * 3); P2.set(P);
  for (let j = 0; j < mS; j++) { P2[3 * (T0 + j)] = S[j][0]; P2[3 * (T0 + j) + 1] = S[j][1]; P2[3 * (T0 + j) + 2] = zt[j]; P2[3 * (B0 + j)] = S[j][0]; P2[3 * (B0 + j) + 1] = S[j][1]; P2[3 * (B0 + j) + 2] = baseZ; }
  const F = [];
  // zip the scan border to the wall top (always n + mS triangles, whatever the shapes)
  let j0 = 0, bd = Infinity; for (let j = 0; j < mS; j++) { const d = (loop2[0][0] - S[j][0]) ** 2 + (loop2[0][1] - S[j][1]) ** 2; if (d < bd) { bd = d; j0 = j; } }
  const dist = (i, j) => { const a = rim[i % n] * 3, b = (T0 + (j % mS)) * 3; return Math.hypot(P2[a] - P2[b], P2[a + 1] - P2[b + 1]) + 0.3 * Math.abs(P2[a + 2] - P2[b + 2]); };
  let ia = 0, ja = 0;
  while (ia < n || ja < mS) {
    const i = ia, j = j0 + ja, canI = ia < n, canJ = ja < mS;
    const goI = canI && (!canJ || dist(i + 1, j) <= dist(i, j + 1));
    if (goI) { F.push(rim[(i + 1) % n], rim[i % n], T0 + (j % mS)); ia++; } else { F.push(rim[i % n], T0 + (j % mS), T0 + ((j + 1) % mS)); ja++; }
  }
  for (let j = 0; j < mS; j++) { const k = (j + 1) % mS; F.push(T0 + k, T0 + j, B0 + j, T0 + k, B0 + j, B0 + k); }
  const tri = w.triangulate([S]); if (tri.length !== mS - 2) rep.capNote = `cap ${tri.length} of ${mS - 2}`;
  let flipCap = false; for (const t of tri) { for (let e = 0; e < 3; e++) { if ((t[e] + 1) % mS === t[(e + 1) % 3]) { flipCap = true; } } if (flipCap) break; }
  for (const t of tri) { if (flipCap) F.push(B0 + t[0], B0 + t[2], B0 + t[1]); else F.push(B0 + t[0], B0 + t[1], B0 + t[2]); }
  const I2 = new Uint32Array(m.indices.length + F.length); I2.set(m.indices); I2.set(F, m.indices.length);
  const out = { positions: P2, indices: I2, colors: null };
  rep.watertight = N.isWatertight(out); rep.volume = N.meshVolume(out);
  if (!rep.watertight) throw new Error('Could not close this scan into a solid — try trimming its ragged edge first.');
  return { mesh: out, outline: S, report: rep };
}

// ───────────────────────────── height-field solids ─────────────────────────────
/**
 * The solid between two height fields on the same grid (see core rasterHeightfield): everything from `bottom` up to `top`
 * wherever both exist and top − bottom > o.min (default 0.05 mm). `bottom` may be a number (flat underside).
 * `o.mask` (Uint8Array per node) can restrict it further. → MeshData (watertight) or null if empty.
 */
export function fieldSolid(top, bottom, o = {}) {
  const { nx, ny, x0, y0, cell } = top, flat = typeof bottom === 'number', minT = o.min ?? 0.05, zb = (k) => (flat ? bottom : bottom.z[k]);
  const node = new Uint8Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) node[k] = (!o.mask || o.mask[k]) && Number.isFinite(top.z[k]) && Number.isFinite(zb(k)) && top.z[k] - zb(k) > minT ? 1 : 0;
  const cx = nx - 1, cy = ny - 1, cellOn = new Uint8Array(cx * cy);
  for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) { const k = j * nx + i; cellOn[j * cx + i] = node[k] & node[k + 1] & node[k + nx] & node[k + nx + 1]; }
  for (let pass = 0; pass < 12; pass++) {                        // no two cells may touch only at a corner
    let changed = 0;
    for (let j = 1; j < cy; j++) for (let i = 1; i < cx; i++) { const a = cellOn[(j - 1) * cx + i - 1], b = cellOn[(j - 1) * cx + i], c = cellOn[j * cx + i - 1], d = cellOn[j * cx + i]; if (a && d && !b && !c) { cellOn[j * cx + i] = 0; changed++; } else if (b && c && !a && !d) { cellOn[j * cx + i - 1] = 0; changed++; } }
    if (!changed) break;
  }
  const vt = new Int32Array(nx * ny).fill(-1), P = [], F = []; let nv = 0;
  const use = (k) => { if (vt[k] < 0) { vt[k] = nv; nv += 2; const x = x0 + (k % nx) * cell, y = y0 + Math.floor(k / nx) * cell; P.push(x, y, top.z[k], x, y, zb(k)); } return vt[k]; };
  const on = (i, j) => i >= 0 && j >= 0 && i < cx && j < cy && cellOn[j * cx + i];
  let any = false;
  for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    if (!cellOn[j * cx + i]) continue; any = true;
    const ka = j * nx + i, kb = ka + 1, kc = ka + nx + 1, kd = ka + nx, a = use(ka), b = use(kb), c = use(kc), d = use(kd);
    if (Math.abs(top.z[ka] - top.z[kc]) <= Math.abs(top.z[kb] - top.z[kd])) F.push(a, b, c, a, c, d); else F.push(a, b, d, b, c, d);
    if (Math.abs(zb(ka) - zb(kc)) <= Math.abs(zb(kb) - zb(kd))) F.push(a + 1, c + 1, b + 1, a + 1, d + 1, c + 1); else F.push(a + 1, d + 1, b + 1, b + 1, d + 1, c + 1);
    const wall = (p, q) => F.push(q, p, p + 1, q, p + 1, q + 1);
    if (!on(i, j - 1)) wall(a, b); if (!on(i + 1, j)) wall(b, c); if (!on(i, j + 1)) wall(c, d); if (!on(i - 1, j)) wall(d, a);
  }
  return any ? { positions: Float32Array.from(P), indices: Uint32Array.from(F), colors: null } : null;
}

// ───────────────────────────── hollowing ─────────────────────────────
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) { let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); } k++; v[k] = q; z[k] = s; z[k + 1] = 1e20; }
  k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + f[p]; }
}
/**
 * Voxel distance field of a solid: for every voxel centre inside the solid, the distance (mm) to its surface; 0 outside.
 *   o.cell (0.4)   o.openBelow: number — treat everything under this z as solid (so a cavity can run out through the base)
 * → { nx, ny, nz, x0, y0, z0, cell, d: Float32Array }   voxel (i,j,k) centre = (x0+(i+.5)cell, y0+(j+.5)cell, z0+(k+.5)cell)
 */
export function distanceField(man, o = {}) {
  const cell = o.cell || 0.4, bb = man.boundingBox(), pad = 2, open = o.openBelow !== undefined, ext = open ? Math.ceil(((o.extra ?? 4)) / cell) : pad;
  const x0 = bb.min[0] - pad * cell, y0 = bb.min[1] - pad * cell, z0 = bb.min[2] - ext * cell;
  const nx = Math.ceil((bb.max[0] - x0) / cell) + pad, ny = Math.ceil((bb.max[1] - y0) / cell) + pad, nz = Math.ceil((bb.max[2] - z0) / cell) + pad;
  const BIG = 1e12, d = new Float32Array(nx * ny * nz), xs = [];
  let firstSolid = -1;
  for (let k = 0; k < nz; k++) {
    const z = z0 + (k + 0.5) * cell; if (z < bb.min[2] || z > bb.max[2]) continue;
    const cs = man.slice(z), polys = cs.toPolygons(); cs.delete(); if (!polys.length) continue; if (firstSolid < 0) firstSolid = k;
    for (let j = 0; j < ny; j++) {
      const y = y0 + (j + 0.5) * cell; xs.length = 0;
      for (const p of polys) for (let a = 0, n = p.length; a < n; a++) { const A = p[a], B = p[(a + 1) % n]; if ((A[1] <= y) !== (B[1] <= y)) xs.push(A[0] + (y - A[1]) / (B[1] - A[1]) * (B[0] - A[0])); }
      if (xs.length < 2) continue; xs.sort((p, q) => p - q);
      for (let s = 0; s + 1 < xs.length; s += 2) { const i0 = Math.max(0, Math.ceil((xs[s] - x0) / cell - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[s + 1] - x0) / cell - 0.5)); const row = (k * ny + j) * nx; for (let i = i0; i <= i1; i++) d[row + i] = BIG; }
    }
  }
  if (open && firstSolid > 0) for (let k = 0; k < firstSolid; k++) d.copyWithin(k * nx * ny, firstSolid * nx * ny, (firstSolid + 1) * nx * ny);
  const L = Math.max(nx, ny, nz), f = new Float64Array(L), g = new Float64Array(L), v = new Int32Array(L), z = new Float64Array(L + 1);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) { const r = (k * ny + j) * nx; for (let i = 0; i < nx; i++) f[i] = d[r + i]; edt1d(f, nx, g, v, z); for (let i = 0; i < nx; i++) d[r + i] = g[i]; }
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const r = k * ny * nx + i; for (let j = 0; j < ny; j++) f[j] = d[r + j * nx]; edt1d(f, ny, g, v, z); for (let j = 0; j < ny; j++) d[r + j * nx] = g[j]; }
  const sxy = nx * ny;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const r = j * nx + i; for (let k = 0; k < nz; k++) f[k] = d[r + k * sxy]; edt1d(f, nz, g, v, z); for (let k = 0; k < nz; k++) d[r + k * sxy] = g[k]; }
  for (let q = 0; q < d.length; q++) d[q] = Math.sqrt(Math.min(d[q], 1e8)) * cell;
  return { nx, ny, nz, x0, y0, z0, cell, d };
}
/** Trilinear sample of a distanceField at a point (0 outside the grid). */
export function sampleDistance(F, x, y, z) {
  const fx = (x - F.x0) / F.cell - 0.5, fy = (y - F.y0) / F.cell - 0.5, fz = (z - F.z0) / F.cell - 0.5;
  let i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
  if (i < 0 || j < 0 || i >= F.nx - 1 || j >= F.ny - 1 || k >= F.nz - 1) return 0;
  let tz = fz - k; if (k < 0) { k = 0; tz = 0; }
  const tx = fx - i, ty = fy - j, sxy = F.nx * F.ny, b = k * sxy + j * F.nx + i, d = F.d;
  const c00 = d[b] + (d[b + 1] - d[b]) * tx, c10 = d[b + F.nx] + (d[b + F.nx + 1] - d[b + F.nx]) * tx, c01 = d[b + sxy] + (d[b + sxy + 1] - d[b + sxy]) * tx, c11 = d[b + sxy + F.nx] + (d[b + sxy + F.nx + 1] - d[b + sxy + F.nx]) * tx;
  const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty; return c0 + (c1 - c0) * tz;
}
/**
 * Hollow a solid, leaving walls about `wall` mm thick (±one voxel).
 *   o.wall (2.5)   o.cell (0.4)   o.openBelow: z of the flat base → the cavity opens out through the base (no floor)
 *   without openBelow the cavity is sealed inside (add drain holes yourself).
 * Only one connected cavity is made (with openBelow: every pocket that reaches the base); isolated pockets are left solid.
 * → { solid: Manifold (new; the input is not deleted), cavityVolume, field }
 */
export function hollow(man, o = {}) {
  const w = need(), wall = o.wall ?? 2.5, cell = o.cell || 0.4, open = o.openBelow !== undefined;
  const F = distanceField(man, { cell, openBelow: o.openBelow, extra: 3 });
  let deepest = 0; for (let q = 0; q < F.d.length; q++) if (F.d[q] > deepest) deepest = F.d[q];
  if (deepest < wall + cell) return { solid: man.translate(0, 0, 0), cavityVolume: 0, field: F, note: 'Too thin to hollow at this wall thickness.' };
  const bb = man.boundingBox(), lo = open ? o.openBelow - 2.4 : bb.min[2];
  let cav = w.Manifold.levelSet((p) => sampleDistance(F, p[0], p[1], p[2]) - wall, { min: [bb.min[0], bb.min[1], lo], max: bb.max }, o.edge || Math.max(0.6, cell * 1.5), 0);
  { // one cavity only: pockets that do not join it would be sealed bubbles of trapped resin
    const parts = cav.decompose();
    if (parts.length > 1) {
      let keep = open ? parts.filter((q) => q.boundingBox().min[2] < o.openBelow - 0.05) : [];
      if (!keep.length) { let big = parts[0]; for (const q of parts) if (q.volume() > big.volume()) big = q; keep = [big]; }
      const merged = keep.length === 1 ? keep[0].translate(0, 0, 0) : w.Manifold.compose(keep); free(cav); cav = merged;
    }
    free(...parts);
  }
  const cavityVolume = cav.volume(), solid = man.subtract(cav); free(cav);
  return { solid, cavityVolume, field: F };
}

// ───────────────────────────── text ─────────────────────────────
const FONT = new Font({"glyphs":{"A":{"ha":1069,"x_min":0,"x_max":966.671875,"o":"m 966 0 l 747 0 l 679 208 l 286 208 l 218 0 l 0 0 l 361 1013 l 600 1013 l 966 0 m 623 376 l 480 810 l 340 376 l 623 376 "},"B":{"ha":938,"x_min":0,"x_max":835,"o":"m 674 547 q 791 450 747 518 q 835 304 835 383 q 718 75 835 158 q 461 0 612 0 l 0 0 l 0 1013 l 477 1013 q 697 951 609 1013 q 797 754 797 880 q 765 630 797 686 q 674 547 734 575 m 438 621 q 538 646 495 621 q 590 730 590 676 q 537 814 590 785 q 436 838 494 838 l 199 838 l 199 621 l 438 621 m 445 182 q 561 211 513 182 q 618 311 618 247 q 565 410 618 375 q 444 446 512 446 l 199 446 l 199 182 l 445 182 "},"C":{"ha":1043,"x_min":0,"x_max":970.828125,"o":"m 970 345 q 802 70 933 169 q 490 -29 672 -29 q 130 130 268 -29 q 0 506 0 281 q 134 885 0 737 q 502 1040 275 1040 q 802 939 668 1040 q 965 679 936 838 l 745 679 q 649 809 716 761 q 495 857 582 857 q 283 747 361 857 q 214 508 214 648 q 282 267 214 367 q 493 154 359 154 q 651 204 584 154 q 752 345 718 255 l 970 345 "},"D":{"ha":968,"x_min":0,"x_max":864,"o":"m 400 1013 q 736 874 608 1013 q 864 523 864 735 q 717 146 864 293 q 340 0 570 0 l 0 0 l 0 1013 l 400 1013 m 398 837 l 206 837 l 206 182 l 372 182 q 584 276 507 182 q 657 504 657 365 q 594 727 657 632 q 398 837 522 837 "},"E":{"ha":824,"x_min":0,"x_max":761.109375,"o":"m 761 0 l 0 0 l 0 1013 l 734 1013 l 734 837 l 206 837 l 206 621 l 690 621 l 690 446 l 206 446 l 206 186 l 761 186 l 761 0 "},"F":{"ha":778,"x_min":0,"x_max":706.953125,"o":"m 706 837 l 206 837 l 206 606 l 645 606 l 645 431 l 206 431 l 206 0 l 0 0 l 0 1013 l 706 1013 l 706 837 "},"G":{"ha":1057,"x_min":0,"x_max":971,"o":"m 971 -1 l 829 -1 l 805 118 q 479 -29 670 -29 q 126 133 261 -29 q 0 509 0 286 q 130 884 0 737 q 493 1040 268 1040 q 790 948 659 1040 q 961 698 920 857 l 736 698 q 643 813 709 769 q 500 857 578 857 q 285 746 364 857 q 213 504 213 644 q 285 263 213 361 q 505 154 365 154 q 667 217 598 154 q 761 374 736 280 l 548 374 l 548 548 l 971 548 l 971 -1 "},"H":{"ha":953,"x_min":0,"x_max":838,"o":"m 838 0 l 628 0 l 628 450 l 210 450 l 210 0 l 0 0 l 0 1013 l 210 1013 l 210 635 l 628 635 l 628 1013 l 838 1013 l 838 0 "},"I":{"ha":365,"x_min":41,"x_max":249,"o":"m 249 0 l 41 0 l 41 1013 l 249 1013 l 249 0 "},"J":{"ha":760,"x_min":0,"x_max":649,"o":"m 649 294 q 573 48 649 125 q 327 -29 497 -29 q 61 82 136 -29 q 0 375 0 173 l 200 375 l 199 309 q 219 194 199 230 q 321 145 249 145 q 418 193 390 145 q 441 307 441 232 l 441 1013 l 649 1013 l 649 294 "},"K":{"ha":996,"x_min":0,"x_max":900,"o":"m 900 0 l 647 0 l 316 462 l 208 355 l 208 0 l 0 0 l 0 1013 l 208 1013 l 208 595 l 604 1013 l 863 1013 l 461 603 l 900 0 "},"L":{"ha":763,"x_min":0,"x_max":704.171875,"o":"m 704 0 l 0 0 l 0 1013 l 208 1013 l 208 186 l 704 186 l 704 0 "},"M":{"ha":1135,"x_min":0,"x_max":1019,"o":"m 1019 0 l 823 0 l 823 819 l 618 0 l 402 0 l 194 818 l 194 0 l 0 0 l 0 1013 l 309 1012 l 510 241 l 707 1013 l 1019 1013 l 1019 0 "},"N":{"ha":949,"x_min":0,"x_max":833,"o":"m 833 0 l 617 0 l 206 695 l 206 0 l 0 0 l 0 1013 l 216 1013 l 629 315 l 629 1013 l 833 1013 l 833 0 "},"O":{"ha":1094,"x_min":0,"x_max":994,"o":"m 497 -29 q 133 127 272 -29 q 0 505 0 277 q 131 883 0 733 q 497 1040 270 1040 q 860 883 721 1040 q 994 505 994 733 q 862 127 994 277 q 497 -29 723 -29 m 497 154 q 710 266 631 154 q 780 506 780 365 q 710 745 780 647 q 497 857 631 857 q 283 747 361 857 q 213 506 213 647 q 282 266 213 365 q 497 154 361 154 "},"P":{"ha":838,"x_min":0,"x_max":771,"o":"m 208 361 l 208 0 l 0 0 l 0 1013 l 450 1013 q 682 919 593 1013 q 771 682 771 826 q 687 452 771 544 q 466 361 604 361 l 208 361 m 421 837 l 208 837 l 208 544 l 410 544 q 525 579 480 544 q 571 683 571 615 q 527 792 571 747 q 421 837 484 837 "},"Q":{"ha":1096,"x_min":0,"x_max":995.59375,"o":"m 995 49 l 885 -70 l 762 42 q 641 -12 709 4 q 497 -29 572 -29 q 135 123 271 -29 q 0 504 0 276 q 131 881 0 731 q 497 1040 270 1040 q 859 883 719 1040 q 994 506 994 731 q 966 321 994 413 q 884 152 938 229 l 995 49 m 730 299 q 767 395 755 344 q 779 504 779 446 q 713 743 779 644 q 505 857 638 857 q 284 745 366 857 q 210 501 210 644 q 279 265 210 361 q 492 157 357 157 q 615 181 557 157 l 508 287 l 620 405 l 730 299 "},"R":{"ha":947,"x_min":0,"x_max":836.109375,"o":"m 836 0 l 608 0 q 588 53 596 20 q 581 144 581 86 q 581 179 581 162 q 581 215 581 197 q 553 345 581 306 q 428 393 518 393 l 208 393 l 208 0 l 0 0 l 0 1013 l 491 1013 q 720 944 630 1013 q 819 734 819 869 q 778 584 819 654 q 664 485 738 513 q 757 415 727 463 q 794 231 794 358 l 794 170 q 800 84 794 116 q 836 31 806 51 l 836 0 m 462 838 l 208 838 l 208 572 l 452 572 q 562 604 517 572 q 612 704 612 640 q 568 801 612 765 q 462 838 525 838 "},"S":{"ha":915,"x_min":0,"x_max":826,"o":"m 826 306 q 701 55 826 148 q 423 -29 587 -29 q 138 60 255 -29 q 0 318 13 154 l 208 318 q 288 192 216 238 q 437 152 352 152 q 559 181 506 152 q 623 282 623 217 q 466 411 623 372 q 176 487 197 478 q 18 719 18 557 q 136 958 18 869 q 399 1040 244 1040 q 670 956 561 1040 q 791 713 791 864 l 591 713 q 526 826 583 786 q 393 866 469 866 q 277 838 326 866 q 218 742 218 804 q 374 617 218 655 q 667 542 646 552 q 826 306 826 471 "},"T":{"ha":894,"x_min":0,"x_max":809,"o":"m 809 831 l 509 831 l 509 0 l 299 0 l 299 831 l 0 831 l 0 1013 l 809 1013 l 809 831 "},"U":{"ha":926,"x_min":0,"x_max":813,"o":"m 813 362 q 697 79 813 187 q 405 -29 582 -29 q 114 78 229 -29 q 0 362 0 186 l 0 1013 l 210 1013 l 210 387 q 260 226 210 291 q 408 154 315 154 q 554 226 500 154 q 603 387 603 291 l 603 1013 l 813 1013 l 813 362 "},"V":{"ha":997,"x_min":0,"x_max":895.828125,"o":"m 895 1013 l 550 0 l 347 0 l 0 1013 l 231 1013 l 447 256 l 666 1013 l 895 1013 "},"W":{"ha":1399,"x_min":0,"x_max":1291.671875,"o":"m 1291 1013 l 1002 0 l 802 0 l 645 777 l 490 0 l 288 0 l 0 1013 l 215 1013 l 388 298 l 534 1012 l 757 1013 l 904 299 l 1076 1013 l 1291 1013 "},"X":{"ha":999,"x_min":0,"x_max":894.453125,"o":"m 894 0 l 654 0 l 445 351 l 238 0 l 0 0 l 316 516 l 0 1013 l 238 1013 l 445 659 l 652 1013 l 894 1013 l 577 519 l 894 0 "},"Y":{"ha":931,"x_min":0,"x_max":836,"o":"m 836 1013 l 532 376 l 532 0 l 322 0 l 322 376 l 0 1013 l 208 1013 l 427 576 l 626 1013 l 836 1013 "},"Z":{"ha":906,"x_min":0,"x_max":804.171875,"o":"m 804 836 l 251 182 l 793 182 l 793 0 l 0 0 l 0 176 l 551 830 l 11 830 l 11 1013 l 804 1013 l 804 836 "},"0":{"ha":828,"x_min":51,"x_max":779,"o":"m 415 -26 q 142 129 242 -26 q 51 476 51 271 q 141 825 51 683 q 415 984 242 984 q 687 825 585 984 q 779 476 779 682 q 688 131 779 271 q 415 -26 587 -26 m 415 137 q 529 242 485 137 q 568 477 568 338 q 530 713 568 619 q 415 821 488 821 q 303 718 344 821 q 262 477 262 616 q 301 237 262 337 q 415 137 341 137 "},"1":{"ha":828,"x_min":197.609375,"x_max":628,"o":"m 628 0 l 434 0 l 434 674 l 197 674 l 197 810 q 373 837 318 810 q 468 984 450 876 l 628 984 l 628 0 "},"2":{"ha":828,"x_min":64,"x_max":764,"o":"m 764 685 q 675 452 764 541 q 484 325 637 415 q 307 168 357 250 l 754 168 l 754 0 l 64 0 q 193 301 64 175 q 433 480 202 311 q 564 673 564 576 q 519 780 564 737 q 416 824 475 824 q 318 780 358 824 q 262 633 270 730 l 80 633 q 184 903 80 807 q 415 988 276 988 q 654 907 552 988 q 764 685 764 819 "},"3":{"ha":828,"x_min":61,"x_max":767,"o":"m 767 290 q 653 51 767 143 q 402 -32 548 -32 q 168 48 262 -32 q 61 300 61 140 l 250 300 q 298 173 250 219 q 405 132 343 132 q 514 169 471 132 q 563 282 563 211 q 491 405 563 369 q 343 432 439 432 l 343 568 q 472 592 425 568 q 534 701 534 626 q 493 793 534 758 q 398 829 453 829 q 306 789 344 829 q 268 669 268 749 l 80 669 q 182 909 80 823 q 410 986 274 986 q 633 916 540 986 q 735 719 735 840 q 703 608 735 656 q 615 522 672 561 q 727 427 687 486 q 767 290 767 369 "},"4":{"ha":828,"x_min":53,"x_max":775.21875,"o":"m 775 213 l 660 213 l 660 0 l 470 0 l 470 213 l 53 213 l 53 384 l 416 958 l 660 958 l 660 370 l 775 370 l 775 213 m 474 364 l 474 786 l 204 363 l 474 364 "},"5":{"ha":828,"x_min":59,"x_max":767,"o":"m 767 319 q 644 59 767 158 q 382 -29 533 -29 q 158 43 247 -29 q 59 264 59 123 l 252 264 q 295 165 252 201 q 400 129 339 129 q 512 172 466 129 q 564 308 564 220 q 514 437 564 387 q 398 488 464 488 q 329 472 361 488 q 271 420 297 456 l 93 428 l 157 958 l 722 958 l 722 790 l 295 790 l 271 593 q 348 635 306 621 q 431 649 389 649 q 663 551 560 649 q 767 319 767 453 "},"6":{"ha":828,"x_min":57,"x_max":771,"o":"m 744 734 l 544 734 q 500 802 533 776 q 425 828 466 828 q 315 769 359 828 q 264 571 264 701 q 451 638 343 638 q 691 537 602 638 q 771 315 771 449 q 683 79 771 176 q 420 -29 586 -29 q 134 123 227 -29 q 57 455 57 250 q 184 865 57 721 q 452 988 293 988 q 657 916 570 988 q 744 734 744 845 m 426 128 q 538 178 498 128 q 578 300 578 229 q 538 422 578 372 q 415 479 493 479 q 303 430 342 479 q 264 313 264 381 q 308 184 264 240 q 426 128 352 128 "},"7":{"ha":828,"x_min":65.28125,"x_max":762.5,"o":"m 762 808 q 521 435 604 626 q 409 0 438 244 l 205 0 q 313 422 227 234 q 548 789 387 583 l 65 789 l 65 958 l 762 958 l 762 808 "},"8":{"ha":828,"x_min":57,"x_max":770,"o":"m 625 516 q 733 416 697 477 q 770 284 770 355 q 675 69 770 161 q 415 -29 574 -29 q 145 65 244 -29 q 57 273 57 150 q 93 413 57 350 q 204 516 130 477 q 112 609 142 556 q 83 718 83 662 q 177 905 83 824 q 414 986 272 986 q 650 904 555 986 q 745 715 745 822 q 716 608 745 658 q 625 516 688 558 m 414 590 q 516 624 479 590 q 553 706 553 659 q 516 791 553 755 q 414 828 480 828 q 311 792 348 828 q 275 706 275 757 q 310 624 275 658 q 414 590 345 590 m 413 135 q 527 179 487 135 q 564 279 564 218 q 525 386 564 341 q 411 436 482 436 q 298 387 341 436 q 261 282 261 344 q 300 178 261 222 q 413 135 340 135 "},"9":{"ha":828,"x_min":58,"x_max":769,"o":"m 769 492 q 646 90 769 232 q 384 -33 539 -33 q 187 35 271 -33 q 83 224 98 107 l 282 224 q 323 154 286 182 q 404 127 359 127 q 513 182 471 127 q 563 384 563 248 q 475 335 532 355 q 372 315 418 315 q 137 416 224 315 q 58 642 58 507 q 144 877 58 781 q 407 984 239 984 q 694 827 602 984 q 769 492 769 699 m 416 476 q 525 521 488 476 q 563 632 563 566 q 521 764 563 709 q 403 826 474 826 q 297 773 337 826 q 258 649 258 720 q 295 530 258 577 q 416 476 339 476 "},"-":{"ha":525,"x_min":27.78125,"x_max":413.890625,"o":"m 413 279 l 27 279 l 27 468 l 413 468 l 413 279 "},".":{"ha":303,"x_min":0,"x_max":206,"o":"m 206 0 l 0 0 l 0 207 l 206 207 l 206 0 "},"/":{"ha":828,"x_min":196.109375,"x_max":632.5625,"o":"m 632 1040 l 289 -128 l 196 -128 l 538 1040 l 632 1040 "},"#":{"ha":1117,"x_min":0,"x_max":1019.453125,"o":"m 1019 722 l 969 582 l 776 581 l 717 417 l 919 417 l 868 279 l 668 278 l 566 -6 l 413 -5 l 516 279 l 348 279 l 247 -6 l 94 -6 l 196 278 l 0 279 l 49 417 l 245 417 l 304 581 l 98 582 l 150 722 l 354 721 l 455 1006 l 606 1006 l 507 721 l 673 722 l 776 1006 l 927 1006 l 826 721 l 1019 722 m 627 581 l 454 581 l 394 417 l 567 417 l 627 581 "},"+":{"ha":828,"x_min":43,"x_max":784,"o":"m 784 353 l 483 353 l 483 0 l 343 0 l 343 353 l 43 353 l 43 489 l 343 489 l 343 840 l 483 840 l 483 489 l 784 489 l 784 353 "}," ":{"ha":375,"x_min":0,"x_max":0,"o":""}},"familyName":"Helvetiker","ascender":1216,"descender":-334,"underlinePosition":-100,"underlineThickness":50,"boundingBox":{"yMin":-333,"xMin":-162,"yMax":1216,"xMax":1681},"resolution":1000,"original_font_information":{"format":0},"cssFontWeight":"bold","cssFontStyle":"normal","lineHeight":1549});
/** Characters the label font has. */
export const LABEL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-./#+ ';
/**
 * Raised lettering as a solid: capitals `height` mm tall, `depth` mm thick, lying in the XY plane (reads correctly when
 * viewed from +Z), centred on the origin, from z = 0 to z = depth. → Manifold (or null for empty text)
 */
export function textSolid(text, o = {}) {
  const w = need(), height = o.height || 4, depth = o.depth || 0.6, clean = String(text).toUpperCase().split('').filter((c) => LABEL_CHARS.includes(c)).join('');
  if (!clean.trim()) return null;
  const size = height / 1.013, contours = [];
  for (const sh of FONT.generateShapes(clean, size)) { const pts = sh.extractPoints(6); contours.push(pts.shape.map((p) => [p.x, p.y])); for (const h of pts.holes) contours.push(h.map((p) => [p.x, p.y])); }
  for (const c of contours) { const a = c[0], b = c[c.length - 1]; if (c.length > 3 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) c.pop(); }
  let cs = new w.CrossSection(contours, 'EvenOdd'); const r = cs.bounds(), t = cs.translate([-(r.min[0] + r.max[0]) / 2, -(r.min[1] + r.max[1]) / 2]); cs.delete(); cs = t;
  const man = cs.extrude(depth); cs.delete();
  return man;
}
