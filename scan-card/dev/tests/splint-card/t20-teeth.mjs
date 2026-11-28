// Marked teeth (K.toothArch, K.toothMargin): the appliance covers the marked teeth and nothing beside them.   node t20-teeth.mjs
//  1. demo lower, every tooth found (N.findTeeth) and marked: fit as good as the whole-arch margin, one closed piece, and no part of the
//     fit surface more than 1.5 mm (sideways) from a marked tooth;
//  2. the same with a deep margin (cheek 6 mm, tongue 8 mm): still nothing beyond 1.5 mm, where the whole-arch margin covers gum and
//     floor-of-mouth tissue several millimetres away;
//  3. three teeth marked (43–33): nothing covered past them along the arch;
//  4. 46 missing (a 10 mm gap): bridged across the ridge, the appliance in one piece; without the bridge it would fall in two;
//  5. an upper arch with 12 and 22 missing.
import { K, N, S } from './kernel.mjs';
import { checkAppliance } from './verify.mjs';
await S.ready();
let fails = 0; const ok = (c, msg) => { console.log(`${c ? '✓' : '✗ FAIL'} ${msg}`); if (!c) fails++; };
const f = (v, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : String(v));

function setup(jaw, demo = {}) {
  const mesh = N.makeDemoArch({ jaw, res: 0.3, ...demo }).mesh, A = K.archMatrix(jaw), sA = N.transformMesh(mesh, A), arch0 = K.analyseArch(sA), hfA = N.rasterHeightfield(sA, { cell: 0.25, pad: 1 });
  const ft = N.findTeeth(mesh, { jaw }), v = new N.THREE.Vector3(), toA = (q) => v.set(q[0], q[1], q[2]).applyMatrix4(A).toArray(), half = (w) => (w > 2 ? w : 7) / 2 + 1;
  const teeth = ft.teeth.map((t) => ({ fdi: t.fdi, p: toA(t.tap), c: toA(t.centre), a: half(t.width), b: half(t.bl > 2 ? t.bl : t.width) }));
  return { jaw, mesh, sA, arch0, hfA, ft, teeth };
}
const one = (r) => r.report.watertight && (r.report.parts === 1 || (r.report.crumbVolume || 0) < 0.5), pcs = (r) => `pieces ${r.report.parts}${r.report.parts > 1 ? `, loose crumbs ${f(r.report.crumbVolume || 0, 3)} mm³ left out` : ''}`;
const mpOf = (p) => ({ buccal: p.buccal, lingual: p.lingual, adjB: p.adjB || [], adjL: p.adjL || [] });
/** distance (mm, sideways) from every cell to the nearest tooth or bridge cell of tm */
function distField(tm) {
  const { nx, ny, kind } = tm, d = new Float32Array(nx * ny).fill(Infinity), q = [];
  for (let k = 0; k < kind.length; k++) if (kind[k] === 1 || kind[k] === 2) { d[k] = 0; q.push(k); }
  for (let h = 0; h < q.length; h++) { const k = q[h], i = k % nx, j = (k / nx) | 0; for (const [a, b, w] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]]) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const r = jj * nx + ii, nd = d[k] + w * tm.cell; if (nd < d[r] - 1e-6) { d[r] = nd; q.push(r); } } }
  return d;
}
/** how far the fit surface (triKind 1) reaches from the marked teeth */
function reach(res, tm, dF) {
  const P = res.mesh.positions, I = res.mesh.indices, seen = new Uint8Array(P.length / 3); let max = 0, over = 0, n = 0;
  for (let t = 0; t < res.triKind.length; t++) { if (res.triKind[t] !== 1) continue; for (let e = 0; e < 3; e++) { const v = I[3 * t + e]; if (seen[v]) continue; seen[v] = 1; n++;
    const i = Math.round((P[3 * v] - tm.x0) / tm.cell), j = Math.round((P[3 * v + 1] - tm.y0) / tm.cell); const d = i < 0 || j < 0 || i >= tm.nx || j >= tm.ny ? Infinity : dF[j * tm.nx + i]; if (d > max) max = d; if (d > 1.5) over++; } }
  return { max, over, n };
}
async function build(s, archT, tm, over = {}) {
  const p = { ...K.DEFAULTS, ...over, tm }, t0 = Date.now(), r = await K.build({ scanA: s.sA, arch: archT || s.arch0, cache: {} }, p);
  return { r, p, ms: Date.now() - t0, c: checkAppliance(s.sA, archT || s.arch0, r, p) };
}

// ── 1. demo lower, every tooth marked
{
  const s = setup('lower'), archT = K.toothArch(s.sA, s.arch0, s.teeth), tm = K.toothMargin(s.sA, archT, s.hfA, mpOf(K.DEFAULTS)), dF = distField(tm);
  ok(s.teeth.length === 14 && tm.teeth.every((q) => q.ok), `1. demo lower: ${s.teeth.length} teeth found and marked (${s.teeth[0].fdi}–${s.teeth[s.teeth.length - 1].fdi}), all on the scan above the margin`);
  ok(archT.prof.s.length === 14 && archT.L > 90, `   line along the teeth ${f(archT.L, 1)} mm (whole-arch line ${f(s.arch0.L, 1)} mm), ${archT.prof.s.length} tips`);
  const b = await build(s, archT, tm), a = await build(s, null, null), w = reach(b.r, tm, dF), wa = reach(a.r, tm, dF);
  console.log(`   marked: build ${b.ms} ms, genus ${b.r.report.genus}, seat ${f(b.c.seatMin, 3)}, gap mean ${f(b.c.gapMean, 3)} p95 ${f(b.c.gapP95, 3)}, within ±0.05 ${f(b.c.fitWithin05 * 100, 1)} %, thinnest ${f(b.c.thickMin)}; whole arch: seat ${f(a.c.seatMin, 3)}, within ±0.05 ${f(a.c.fitWithin05 * 100, 1)} %`);
  ok(one(b.r), `   one closed piece (watertight ${b.r.report.watertight}, ${pcs(b.r)})`);
  ok(b.c.seatMin >= 0.07 && b.c.fitWithin05 >= 0.93 && b.c.thickMin >= 1.4, `   fit and thickness as good as the whole-arch margin (seat ≥ 0.07, ≥ 93 % within ±0.05 mm, thinnest ≥ 1.4)`);
  ok(w.max <= 1.5, `   fit surface reaches at most ${f(w.max)} mm from a marked tooth (${w.n} vertices); whole-arch margin: ${f(wa.max)} mm, ${wa.over} vertices beyond 1.5 mm`);
}
// ── 2. a deep margin
{
  const s = setup('lower'), over = { buccal: 6, lingual: 8 }, archT = K.toothArch(s.sA, s.arch0, s.teeth), tm = K.toothMargin(s.sA, archT, s.hfA, mpOf({ ...K.DEFAULTS, ...over })), dF = distField(tm);
  const b = await build(s, archT, tm, over), a = await build(s, null, null, over), w = reach(b.r, tm, dF), wa = reach(a.r, tm, dF);
  ok(one(b.r) && w.max <= 1.5, `2. deep margin (cheek 6, tongue 8): one closed piece (${pcs(b.r)}), fit surface within ${f(w.max)} mm of the teeth; the whole-arch margin reaches ${f(wa.max)} mm (${wa.over} vertices beyond 1.5 mm)`);
  ok(wa.over > 500, '   (the whole-arch margin does cover tissue beside the teeth at these depths, so the check above means something)');
}
// ── 3. three teeth marked
{
  const s = setup('lower'), sub = s.teeth.filter((t) => [43, 42, 41, 31, 32, 33].includes(t.fdi)).filter((t) => [43, 41, 33].includes(t.fdi));
  const archT = K.toothArch(s.sA, s.arch0, sub), tm = K.toothMargin(s.sA, archT, s.hfA, mpOf(K.DEFAULTS)), b = await build(s, archT, tm);
  const P = b.r.mesh.positions, o = {}; let xMin = Infinity, xMax = -Infinity; for (let v = 0; v < P.length; v += 3) { if (P[v] < xMin) xMin = P[v]; if (P[v] > xMax) xMax = P[v]; }
  const c43 = sub.find((t) => t.fdi === 43).c, c33 = sub.find((t) => t.fdi === 33).c;
  ok(one(b.r), `3. 43, 41, 33 marked: one closed piece (${pcs(b.r)}); the unmarked teeth between them are passed over as gaps (${tm.bridges.length} bridges)`);
  ok(xMin > c43[0] - 6.5 && xMax < c33[0] + 6.5, `   the appliance spans x ${f(xMin, 1)} … ${f(xMax, 1)}, within 6.5 mm of the middles of 43 (${f(c43[0], 1)}) and 33 (${f(c33[0], 1)}): nothing past them`);
}
// ── 4. 46 missing: a gap bridged
{
  const s = setup('lower', { missing: { 46: true } }), archT = K.toothArch(s.sA, s.arch0, s.teeth), tm = K.toothMargin(s.sA, archT, s.hfA, mpOf(K.DEFAULTS));
  ok(!s.teeth.some((t) => t.fdi === 46) && tm.bridges.length === 1, `4. 46 missing: ${s.teeth.length} teeth found, ${tm.bridges.length} bridge (${tm.bridges.map((q) => f(q[2], 1) + ' mm').join(', ')})`);
  const b = await build(s, archT, tm);
  ok(one(b.r) && b.c.seatMin >= 0.07, `   one closed piece across the gap (${pcs(b.r)}, seat ${f(b.c.seatMin, 3)}, genus ${b.r.report.genus})`);
  const tmNo = K.toothMargin(s.sA, archT, s.hfA, mpOf(K.DEFAULTS), { bridgeMax: 0 }), bn = await build(s, archT, tmNo);
  ok(bn.r.report.parts >= 2 && bn.r.report.crumbVolume > 50, `   without the bridge it comes apart (${bn.r.report.parts} pieces, ${f(bn.r.report.crumbVolume, 0)} mm³ left out)`);
}
// ── 5. upper, 12 and 22 missing
{
  const s = setup('upper', { missing: { 12: true, 22: true } }), archT = K.toothArch(s.sA, s.arch0, s.teeth), tm = K.toothMargin(s.sA, archT, s.hfA, mpOf(K.DEFAULTS)), dF = distField(tm);
  const b = await build(s, archT, tm), w = reach(b.r, tm, dF);
  ok(one(b.r) && w.max <= 1.5 && b.c.seatMin >= 0.07, `5. upper with 12 and 22 missing: ${s.teeth.length} teeth, ${tm.bridges.length} bridges, one closed piece (${pcs(b.r)}), fit within ${f(w.max)} mm of the teeth, seat ${f(b.c.seatMin, 3)}`);
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
