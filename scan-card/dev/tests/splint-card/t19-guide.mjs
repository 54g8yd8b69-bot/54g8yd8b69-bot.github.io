// Guidance ramps and the excursion check.   node t19-guide.mjs <upper|lower> [demo|scanner]
// Tips found against the designed teeth; flat splint meeting the opposing cusps without and with ramps; files re-read;
// the excursions judged by the kernel's own check AND by an independent mesh check (BVH distance at each slid position).
import fs from 'fs';
import { K, N, S, saveStl, loadStl, OUT } from './kernel.mjs';
import { checkAppliance } from './verify.mjs';
await S.ready();
const THREE = N.THREE, jaw = process.argv[2] || 'upper', src = process.argv[3] || 'demo', other = jaw === 'upper' ? 'lower' : 'upper';
const pair = N.makeDemoPair({ res: 0.3 }), truth = { upper: pair.truthUpper || pair.truth?.upper, lower: pair.truthLower || pair.truth?.lower };
const A = K.archMatrix(jaw), sA = N.transformMesh(pair[jaw], A), arch = K.analyseArch(sA), cache = {};
const open = jaw === 'upper' ? 6 : 5, Om = K.openingMatrix('hinge', open, other, K.incisalPoint(pair.lower)), oppA = N.transformMesh(N.transformMesh(pair[other], Om), A);
let bad = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
// 1. tips against the designed canine tips (case frame → opened → arch frame)
const tips = K.guideTips(oppA, arch, other === 'upper', jaw === 'upper');
const T = pair.truth && pair.truth[other] ? pair.truth[other].teeth : (pair[other + 'Truth'] || {}).teeth;
if (T) {
  const M = A.clone().multiply(Om), at = (fdi) => { const t = T.find((q) => q.fdi === fdi); return t ? new THREE.Vector3(...t.tip).applyMatrix4(M) : null; };
  const q = other === 'lower' ? { right: 43, left: 33 } : { right: 13, left: 23 };
  for (const sd of ['right', 'left']) { const w = at(q[sd]), g = tips[sd]; const e = w && g ? Math.hypot(w.x - g[0], w.y - g[1]) : NaN; ok(e < 1.5, `${sd} canine tip found ${e.toFixed(2)} mm (in plan) from the designed tip of ${q[sd]}`); }
} else console.log('  (no designed tips in the demo pair) tips:', JSON.stringify(tips));
ok(!!tips.inc, 'front point found: ' + (tips.inc || []).map((v) => v.toFixed(1)).join(', '));
const base = { ...K.DEFAULTS, type: 'flat', thickness: 1.5, minThick: 2, lingual: 5, meet: true };
const reread = (name) => { const m = loadStl(OUT + name), e = N.edgeReport(m); return { wt: N.isWatertight(m), open: e.open, flipped: e.flipped, nm: e.nonManifold, m }; };
// independent excursion check: slide the opposing MESH, raise it until no vertex is inside the appliance's upper envelope … measured with a BVH
function independent(appA, d, s) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(appA.positions, 3)); g.setIndex(new THREE.BufferAttribute(appA.indices, 1)); const bvh = new N.MeshBVH(g), ray = new THREE.Ray(), up = new THREE.Vector3(0, 0, 1), dn = new THREE.Vector3(0, 0, -1);
  // lift = the most any opposing vertex must rise to clear the appliance directly below it
  const P = oppA.positions; let lift = -Infinity; const lo = [];
  for (let v = 0; v < P.length; v += 9) { const x = P[v] + d[0] * s, y = P[v + 1] + d[1] * s, z = P[v + 2]; ray.origin.set(x, y, 200); ray.direction.copy(dn); const h = bvh.raycastFirst(ray, THREE.DoubleSide); if (!h) continue; lo.push([x, y, z, h.point.z]); if (h.point.z - z > lift) lift = h.point.z - z; }
  return { lift, gapAt: (pred) => { let m = Infinity; for (const [x, y, z, t] of lo) if (pred(x, y)) m = Math.min(m, z + lift - t); return m; } };
}
let km = 0; for (let k = 1; k < arch.n; k++) if (arch.py[k] < arch.py[km]) km = k;
const o = {}, sCan = Math.max(...['right', 'left'].filter((k) => tips[k]).map((k) => { K.archCoords(arch, tips[k][0], tips[k][1], o); return Math.abs(o.s - km * arch.step); })), front = sCan + 3;
const isBack = (x, y) => { K.archCoords(arch, x, y, o); return Math.abs(o.s - km * arch.step) > front + 2; };
const res = {};
for (const g of [null, { canine: true, front: true, canineAngle: 35, frontAngle: 30, length: 4 }]) {
  const tag = g ? 'ramps' : 'flat', p = { ...base, ramps: g ? K.rampSpecs(tips, jaw, g) : [] }, t0 = Date.now(), r = await K.build({ scanA: sA, arch, cache, oppA }, p);
  const name = `guide-${src}-${jaw}-${tag}.stl`; saveStl(name, r.mesh); const rr = reread(name), c = checkAppliance(sA, arch, r, p), kc = K.contacts(r.mesh, r.triKind, oppA);
  console.log(`\n## ${tag}: build ${Date.now() - t0} ms, volume ${(r.report.volume / 1000).toFixed(2)} mL, genus ${r.report.genus}, pieces ${r.report.parts}, ramps ${JSON.stringify(r.report.ramps || [])}`);
  ok(rr.wt && !rr.open && !rr.flipped && !rr.nm && r.report.genus === 0, `${name} re-read: watertight, no open / flipped / non-manifold edges, genus 0`);
  ok(c.seatMin >= p.clearance - 0.03 && c.fitErrP95 < 0.06, `fit unchanged by the ramps: seat ${c.seatMin.toFixed(3)}, error p95 ${c.fitErrP95.toFixed(3)}`);
  ok(kc.through === 0, `closed: nothing passes through the opposing arch (nearest ${kc.min.toFixed(3)}, ${kc.patches.length} contacts)`);
  const ex = K.excursions(r.mesh, oppA, arch, jaw, front, [1, 2, 3]); res[tag] = ex;
  for (const mv of ['right', 'left', 'forward']) {
    const k2 = ex[mv][1], ind = independent(r.mesh, K.guideDirs(jaw)[mv], 2), backInd = ind.gapAt(isBack);
    console.log(`  ${mv.padEnd(7)} 2 mm: kernel lift ${k2.lift.toFixed(2)}, back teeth clear by ${k2.back.toFixed(2)}, guided by ${k2.guide} | independent: back teeth clear by ${backInd.toFixed(2)}`);
    if (g) ok(k2.guide === 'front' && k2.back > 0.4 && backInd > 0.3, `${mv}: with ramps the back teeth are clear at 2 mm (kernel ${k2.back.toFixed(2)}, independent ${backInd.toFixed(2)})`);
    else ok(k2.back < 0.2, `${mv}: a plain flat table keeps the back teeth in contact (kernel ${k2.back.toFixed(2)}) — the check can tell the difference`);
  }
}
console.log(bad ? `\n${bad} FAILED` : '\nall passed'); process.exit(bad ? 1 : 0);
