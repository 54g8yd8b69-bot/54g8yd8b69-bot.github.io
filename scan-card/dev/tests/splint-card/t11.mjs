// flat-plane type with the opposing arch: node t11.mjs [upper|lower] [straight|hinge] [open]
import { K, N, S, saveStl } from './kernel.mjs';
import { checkAppliance, checkOpposing, fmtCheck } from './verify.mjs';
await S.ready(); const demo = N.makeDemoPair({ res: 0.3 });
const jaw = process.argv[2] || 'upper', mode = process.argv[3] || 'hinge', open = +(process.argv[4] || 3), other = jaw === 'upper' ? 'lower' : 'upper';
const A = K.archMatrix(jaw), sA = N.transformMesh(demo[jaw], A), arch = K.analyseArch(sA), inc = K.incisalPoint(demo.lower);
const Om = K.openingMatrix(mode, open, other, inc), oppA = N.transformMesh(N.transformMesh(demo[other], Om), A);
console.log('incisal point', inc.map((v) => v.toFixed(2)).join(','), '| opposing moved: bbox z', N.meshBounds(oppA).min[2].toFixed(2), 'own top max', Math.max(...arch.top).toFixed(2));
const rp = K.restPlane(oppA, arch); console.log('rest plane', rp && { a: rp.a.toFixed(4), b: rp.b.toFixed(4), d: rp.d.toFixed(3) }, 'contacts', rp && rp.contacts.map((q) => q.map((v) => v.toFixed(1)).join(',')).join(' | '));
for (const over of [{ type: 'flat', thickness: 1.5 }, { type: 'flat', thickness: 1.5, imprint: 0.3 }, { type: 'guard' }]) {
  const p = { ...K.DEFAULTS, ...over }, inp = { scanA: sA, arch, cache: {}, oppA };
  const r = await K.build(inp, p), chk = checkAppliance(sA, arch, r, p), co = checkOpposing(r, oppA), kc = K.contacts(r.mesh, r.triKind, oppA);
  console.log(`\n## ${jaw} ${JSON.stringify(over)} ${mode} ${open} mm  times ${JSON.stringify(r.report.times)} lifted ${r.report.lifted} cut ${r.report.cutByOpposing} genus ${r.report.genus} parts ${r.report.parts}`);
  console.log(fmtCheck({ seatMin: chk.seatMin, fitErrP95: chk.fitErrP95, thickMin: chk.thickMin, thickAt: chk.thickAt, thickP01: chk.thickP01, thickP50: chk.thickP50, volume_mL: chk.volume_mL, watertight: chk.watertight })); console.log(fmtCheck(co)); console.log('K.contacts: min', kc.min.toFixed(3), 'through', kc.through, 'deepest', kc.deepest.toFixed(3), 'patches', kc.patches.length, 'lift', r.report.lift);
  if (!over.imprint) saveStl(`s2-${jaw}-${over.type}.stl`, r.mesh);
}
process.exit(0);
