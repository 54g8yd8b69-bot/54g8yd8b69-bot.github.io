// Final accuracy run for the report.  node accuracy.mjs <demo|scanner> <lower|upper>
// Three designs per arch: uniform guard, flat plane without an opposing scan, flat plane meeting the opposing cusps (bite opened).
// Every exported STL is written to dev/out/splint-card/acc-*.stl and read back before it is judged.
import fs from 'fs';
import { K, N, S, saveStl, loadStl, OUT } from './kernel.mjs';
import { checkAppliance, checkOpposing } from './verify.mjs';
await S.ready();
const src = process.argv[2] || 'demo', jaw = process.argv[3] || 'lower', other = jaw === 'upper' ? 'lower' : 'upper';
let pair;
if (src === 'demo') pair = N.makeDemoPair({ res: 0.3 });
else { const up = N.cleanMesh(loadStl('scanner-upper.stl')).mesh, lo = N.cleanMesh(loadStl('scanner-lower.stl')).mesh, o = N.autoOrient(up, 'upper');
  console.log('scanner files oriented by N.autoOrient on the upper, ok =', o.ok); pair = { upper: N.transformMesh(up, o.matrix), lower: N.transformMesh(lo, o.matrix) }; }
const A = K.archMatrix(jaw), sA = N.transformMesh(pair[jaw], A), arch = K.analyseArch(sA), cache = {};
const open = jaw === 'upper' ? 6 : 5, mode = 'hinge', Om = K.openingMatrix(mode, open, other, K.incisalPoint(pair.lower)), oppA = N.transformMesh(N.transformMesh(pair[other], Om), A);
console.log(`# ${src} ${jaw}: ${sA.indices.length / 3} triangles, arch length ${arch.L.toFixed(1)} mm`);
const reread = (name) => { const m = loadStl(OUT + name), P = m.positions, I = m.indices, e = N.edgeReport(m), par = new Int32Array(P.length / 3).map((_, i) => i);
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  let vol = 0; for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3; par[find(I[t])] = find(I[t + 1]); par[find(I[t + 1])] = find(I[t + 2]);
    vol += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6; }
  const used = new Uint8Array(P.length / 3); for (let t = 0; t < I.length; t++) used[I[t]] = 1; const roots = new Set(); for (let v = 0; v < used.length; v++) if (used[v]) roots.add(find(v));
  return { watertight: N.isWatertight(m), open: e.open, flipped: e.flipped, nonManifold: e.nonManifold, pieces: roots.size, volume_mL: vol / 1000, tris: I.length / 3 }; };
const f = (v, n = 3) => (typeof v === 'number' ? v.toFixed(n) : String(v));
for (const d of [{ tag: 'guard', over: { type: 'guard' } }, { tag: 'flat', over: { type: 'flat', thickness: 1.5, minThick: 2, occlusal: 2, lingual: 5 } }, { tag: 'flat-opp', over: { type: 'flat', thickness: 1.5, minThick: 2, lingual: 5, meet: true }, opp: true }]) {
  const p = { ...K.DEFAULTS, ...d.over }, inp = { scanA: sA, arch, cache, ...(d.opp ? { oppA } : {}) }, t0 = Date.now();
  const r = await K.build(inp, p), ms = Date.now() - t0, c = checkAppliance(sA, arch, r, p), name = `acc-${src}-${jaw}-${d.tag}.stl`; saveStl(name, r.mesh); const rr = reread(name);
  console.log(`\n## ${d.tag}  c ${p.clearance} r ${p.retention} wall ${p.thickness}${p.type === 'flat' ? ' min biting ' + p.minThick : ''}${d.opp ? `  opposing ${mode} ${open} mm` : ''}   build ${ms} ms ${JSON.stringify(r.report.times)}`);
  console.log(`  file ${name}: watertight ${rr.watertight}, open ${rr.open}, flipped ${rr.flipped}, non-manifold ${rr.nonManifold}, pieces ${rr.pieces}, volume ${f(rr.volume_mL, 2)} mL, triangles ${rr.tris}; kernel genus ${r.report.genus}`);
  console.log(`  seating: nearest interior point to scan ${f(c.seatMin)} (bar >= ${f(p.clearance - 0.03, 2)}); nearest fit vertex to scan ${f(c.fitToScanMin)}`);
  console.log(`  fit above survey line: gap mean ${f(c.gapMean)}, p05 ${f(c.gapP05)}, p50 ${f(c.gapP50)}, p95 ${f(c.gapP95)}; |gap - c| mean ${f(c.fitErrMean)}, p95 ${f(c.fitErrP95)}, within 0.05: ${f(c.fitWithin05 * 100, 1)} %`);
  console.log(`  retention: deepest engagement ${f(c.engagedMax)} (bar <= ${f(p.retention + 0.2, 2)}), p99 ${f(c.engagedP99)}`);
  console.log(`  thickness away from border: min ${f(c.thickMin)} at ${c.thickAt.map((v) => v.toFixed(1))} (bar >= ${f(Math.min(p.thickness, p.type === 'flat' ? p.minThick : p.thickness) - 0.1, 2)}), p01 ${f(c.thickP01)}, p50 ${f(c.thickP50)}`);
  if (p.type === 'flat') { const th = K.thickness(r.mesh, r.triKind, p.edge + 0.25), P = r.mesh.positions, Nm = N.vertexNormals(r.mesh), o = {}; let occ = Infinity, wall = Infinity, nO = 0, nW = 0;       // graded as the app does: biting surface = beyond the cusp tips and facing the other jaw
    for (let v = 0; v < th.t.length; v++) { const t = th.t[v]; if (!(t === t) || th.border[v]) continue; K.archCoords(arch, P[3 * v], P[3 * v + 1], o);
      const ff = Math.min(arch.n - 1, Math.max(0, o.s / arch.step)), i0 = Math.min(arch.n - 2, Math.floor(ff)), top = arch.top[i0] + (arch.top[i0 + 1] - arch.top[i0]) * (ff - i0);
      if (P[3 * v + 2] > top + 0.3 && Math.abs(o.d) < 7 && Nm[3 * v + 2] > 0.6) { nO++; if (t < occ) occ = t; } else { nW++; if (t < wall) wall = t; } }
    console.log(`  graded: biting surface min ${f(occ)} (bar >= ${f(p.minThick - 0.1, 2)}, ${nO} vertices), walls min ${f(wall)} (bar >= ${f(Math.min(p.minThick, p.thickness) - 0.1, 2)}, ${nW} vertices); table lift ${f(r.report.lift)}`); }
  if (d.opp) { const co = checkOpposing(r, oppA), kc = K.contacts(r.mesh, r.triKind, oppA);
    console.log(`  opposing: nearest ${f(kc.min)}, through ${kc.through}, deepest ${f(kc.deepest)}, contact patches within 0.1 mm: ${kc.patches.length} (verify.mjs: ${co.contactPatches}, left ${co.left}, right ${co.right}, spread x ${f(co.spreadX, 1)} y ${f(co.spreadY, 1)} mm, penetrating verts ${co.penetrating}, worst ${f(co.worstPen)})`); }
}
process.exit(0);
