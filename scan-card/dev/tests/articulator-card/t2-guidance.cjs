// Articulator Card — guidance from the surfaces, on synthetic shapes with exact answers (mkshapes.mjs):
//  • flat teeth: in protrusion the front cusp stays on the plate and the back cusps come apart in proportion to the condylar
//    guidance (none at 0°); in a side movement the non-working side drops away
//  • canine ramps of 45°: canine guidance on the working side only; the lower canine slides down the ramp at 45°
//  • a front ramp of 35°: front-tooth guidance in protrusion; the incisal cusp slides down it at 35°
//  • a 60° ramp over the lower left molar: flagged as non-working-side guidance in the right movement, nothing in the left
//  • canine ramp plus a back-tooth ramp made from that movement: group function
//  • at every position: the surfaces never cross, and closing 0.01 mm further at the incisal point would make them cross
const { open, ok, OUT, DATA, V, deg } = require('./lib.cjs');
const fs = require('fs');
(async () => {
  const T = JSON.parse(fs.readFileSync(DATA + 'art-truth.json')), S = T.spheres, r = T.r, Cs = T.cases;
  const gap = (pose, c, pl) => V.dot(pl.n, V.apply(pose, c)) - pl.off - r;             // signed: > 0 clear of that plane
  const pts = (ucR, ucL) => ({ inc: T.landmarks.inc, lcR: T.landmarks.lcR, lcL: T.landmarks.lcL, ucR: ucR || T.landmarks.ucR, ucL: ucL || T.landmarks.ucL });
  const after = (R, p0 = 0.5) => R.steps.filter((s) => s.p >= p0 - 1e-9);
  const tag = (s) => s.contacts.map((c) => c.side + ':' + c.upper + '/' + c.lower).join(' ');
  const a = await open(), { page } = a;
  const solid = async (id, what) => { const q = await a.solid(id); ok(q.cross === 0 && q.notTight === 0, `${what}: surfaces never cross at ${q.n} positions, and 0.01 mm more closing would make them cross at every one (${q.cross} crossing, ${q.notTight} not tight)`); };

  // ── flat teeth
  await a.pair('art-flat-upper.stl'); await a.setup({}, pts()); await a.goto('mount');
  const fl = Cs.flat.plane;
  for (const sci of [30, 15, 0]) {
    await a.setup({ sci: [sci, sci] }, pts());
    const R = await a.run('prot'), F = await page.evaluate(() => ({ y: APP.E.F.L.y }));
    const Li = F.y - S.I[1], Lm = F.y - S.MR[1], k = 1 - Lm / Li, g0 = gap(R.steps[0].pose, S.MR, fl);
    let worstInc = 0, worstPen = Infinity, worstK = 0;
    for (const s of after(R)) {
      worstInc = Math.max(worstInc, Math.abs(gap(s.pose, S.I, fl))); for (const c of Object.values(S)) worstPen = Math.min(worstPen, gap(s.pose, c, fl));
      const want = s.p * Math.sin(sci * Math.PI / 180) * k, got = gap(s.pose, S.MR, fl) - g0; worstK = Math.max(worstK, Math.abs(got - want) - 0.03 * want);
    }
    const last = R.steps[R.steps.length - 1], sepM = gap(last.pose, S.MR, fl) - g0;
    ok(worstInc < 0.01 && worstPen > -0.003 && worstK < 0.005, `flat teeth, condylar guidance ${sci}°, protrusion: the front cusp stays on the plate (within ${worstInc.toFixed(4)} mm), nothing passes into it (${worstPen.toFixed(4)}), the molars come apart by ${sepM.toFixed(3)} mm after ${last.p} mm = condylar drop × ${k.toFixed(3)} (1 − their distance from the hinge axis / the incisal point’s) to within 3 %`);
    if (sci !== 15) ok(sci === 0 ? R.verdict.kind === 'shared' : R.verdict.kind === 'anterior', `…verdict: ${R.verdict.head}`);
    if (sci === 30) await solid('prot', 'flat teeth, protrusion');
  }
  await a.setup({}, pts());
  { const R = await a.run('right'), s4 = R.steps.find((s) => Math.abs(s.p - 4) < 1e-9), gl = gap(s4.pose, S.ML, fl), gr = gap(s4.pose, S.MR, fl);
    const leftC = after(R, 1).some((s) => s.contacts.some((c) => c.side === 'L' && c.upper !== 'incisor'));
    ok(gl > gr + 0.3 && !leftC && after(R).every((s) => s.contacts.length), `flat teeth, right side movement: the non-working (left) molar ${gl.toFixed(2)} mm clear at 4 mm, the working one ${gr.toFixed(2)} mm; from 1 mm no back-tooth contact on the left`);
    ok(R.verdict.kind === 'group' && !R.verdict.nonWorking, `…on a flat plate the working side’s canine and back teeth all touch: “${R.verdict.head}”`);
    await solid('right', 'flat teeth, right movement'); }

  // ── canine ramps, 45°
  const cn = Cs.canine;
  await a.pair('art-canine-upper.stl'); await a.setup({}, pts(cn.ucR, cn.ucL)); await a.goto('mount');
  for (const [id, sph, pl, sd, W] of [['right', S.CR, cn.R, 'R', 'right'], ['left', S.CL, cn.L, 'L', 'left']]) {
    const R = await a.run(id), st = after(R), w4 = st.filter((s) => s.p <= 4 + 1e-9), s1 = R.steps.find((s) => Math.abs(s.p - 1) < 1e-9), s4 = R.steps.find((s) => Math.abs(s.p - 4) < 1e-9);
    const c1 = V.apply(s1.pose, sph), c4 = V.apply(s4.pose, sph), ang = deg(Math.atan2(c1[2] - c4[2], Math.abs(c4[0] - c1[0]))), out = sd === 'R' ? c4[0] < c1[0] : c4[0] > c1[0];
    let wg = 0, pen = Infinity; for (const s of st) { const g = gap(s.pose, sph, pl); wg = Math.max(wg, Math.abs(g)); pen = Math.min(pen, g); }
    const only = w4.every((s) => s.contacts.length && s.contacts.every((c) => c.side === sd && c.upper === 'canine' && c.lower === 'canine'));
    ok(R.verdict.kind === 'canine' && R.verdict.head === `Canine guidance on the ${W}` && !R.verdict.nonWorking, `canine ramps, ${id} movement: “${R.verdict.head}” — ${R.verdict.notes.join(' ')}`);
    ok(Math.abs(R.verdict.canineAngle - cn.beta) < 2, `…reported working-side canine tip path ${R.verdict.canineAngle.toFixed(1)}° below level (ramp ${cn.beta}°)`);
    ok(only, `…every position from 0.5 to 4 mm: only the ${W} canine touches (${tag(st[2])})`);
    ok(wg < 0.01 && pen > -0.003 && out && Math.abs(ang - cn.beta) < 0.3, `…the lower canine slides down the ramp all the way to 8 mm: in contact within ${wg.toFixed(4)} mm (closest ${pen.toFixed(4)}), outwards and down at ${ang.toFixed(2)}° (ramp ${cn.beta}°)`);
    await solid(id, `canine ramps, ${id}`);
  }
  await a.goto('move'); await page.evaluate(async () => { await APP.setMove('right'); APP.setPos(3, true); APP.setView('lower'); }); await page.waitForTimeout(400); await a.shot(OUT + 't2-canine-right-lower.png');
  await page.evaluate(() => APP.setView('both')); await page.waitForTimeout(300); await a.shot(OUT + 't2-canine-right.png');

  // ── front ramp, 35°
  const ic = Cs.incisal;
  await a.pair('art-incisal-upper.stl'); await a.setup({}, pts()); await a.goto('mount');
  { const R = await a.run('prot'), st = after(R), s1 = R.steps.find((s) => Math.abs(s.p - 1) < 1e-9), s4 = R.steps.find((s) => Math.abs(s.p - 4) < 1e-9);
    const c1 = V.apply(s1.pose, S.I), c4 = V.apply(s4.pose, S.I), ang = deg(Math.atan2(c1[2] - c4[2], c1[1] - c4[1]));
    let wg = 0; for (const s of st) wg = Math.max(wg, Math.abs(gap(s.pose, S.I, ic.plane)));
    const only = st.every((s) => s.contacts.length && s.contacts.every((c) => c.upper === 'incisor' && c.lower === 'incisor'));
    ok(R.verdict.kind === 'anterior' && only, `front ramp, protrusion: “${R.verdict.head}”, only the incisors touch (${tag(st[3])})`);
    ok(wg < 0.01 && Math.abs(ang - ic.alpha) < 0.3 && Math.abs(R.verdict.angle - ic.alpha) < 2, `…the incisal cusp slides down the ramp at ${ang.toFixed(2)}° (ramp ${ic.alpha}°; the incisal point’s path as reported: ${R.verdict.angle.toFixed(1)}°), in contact within ${wg.toFixed(4)} mm`);
    await solid('prot', 'front ramp, protrusion'); }

  // ── non-working interference
  const nw = Cs.nw;
  await a.pair('art-nw-upper.stl'); await a.setup({}, pts()); await a.goto('mount');
  { const R = await a.run('right'), st = after(R); let wg = 0; for (const s of st) wg = Math.max(wg, Math.abs(gap(s.pose, S.ML, nw.plane)));
    const only = st.every((s) => s.contacts.length && s.contacts.every((c) => c.side === 'L' && c.upper === 'molar'));
    ok(R.verdict.kind === 'nonworking' && R.verdict.nonWorking && R.verdict.warn && R.verdict.notes.some((t) => /^Non-working-side contact: left molars/.test(t)), `ramp over the lower left molar, right movement: “${R.verdict.head}” — ${R.verdict.notes.join(' ')}`);
    ok(only && wg < 0.01, `…every contact is the left (non-working) molar, riding the ramp within ${wg.toFixed(4)} mm`);
    await solid('right', 'non-working ramp, right');
    const L = await a.run('left'); ok(!L.verdict.nonWorking && L.steps.every((s) => s.contacts.every((c) => c.side === 'L')), `…in the left movement that molar is on the working side: no non-working-side contact (“${L.verdict.head}”)`); }
  await a.goto('move'); await page.evaluate(async () => { await APP.setMove('right'); APP.setPos(3, true); }); await page.waitForTimeout(400); await a.shot(OUT + 't2-nonworking.png');

  // ── group function: the canine case's right movement, plus a back-tooth ramp lying along the lower right molar's path in it
  await a.pair('art-canine-upper.stl'); await a.setup({}, pts(cn.ucR, cn.ucL)); await a.goto('mount');
  const R1 = await a.run('right'), path = R1.steps.map((s) => ({ p: s.p, c: V.apply(s.pose, S.MR) })), win = path.filter((q) => q.p >= 1 - 1e-9 && q.p <= 4 + 1e-9);
  const sh = await import('./mkshapes.mjs'), v = sh.v;
  const chord = v.norm(v.sub(win[win.length - 1].c, win[0].c)), down = [0, 0, -1], n = v.norm(v.sub(down, v.mul(chord, v.dot(down, chord))));
  const wproj = win.map((q) => v.dot(n, q.c)), spread = Math.max(...wproj) - Math.min(...wproj), off = Math.min(...wproj) - r - 0.02;
  const c05 = path.find((q) => Math.abs(q.p - 0.5) < 1e-9).c, c6 = path.find((q) => Math.abs(q.p - 6) < 1e-9).c, len = v.dot(v.sub(c6, c05), chord);
  const back = sh.ramp(c05, r, n, chord, { gap: v.dot(n, c05) - r - off, from: 0, to: len + 1, w: 4 });
  const b = 45 * Math.PI / 180, N = await import('../../../shared/core.js');
  const canineUp = (() => { const rr = sh.ramp(S.CR, r, [Math.sin(b), 0, -Math.cos(b)], [-Math.cos(b), 0, -Math.sin(b)], { gap: T.gap, from: -2, to: 15 }), rl = sh.ramp(S.CL, r, [-Math.sin(b), 0, -Math.cos(b)], [Math.cos(b), 0, -Math.sin(b)], { gap: T.gap, from: -2, to: 15 }); return [rr.mesh, rl.mesh]; })();
  const far = sh.box([0, -7, 22], [1, 0, 0], [0, 1, 0], [0, 0, 1], [30, 22, 1.5]);
  fs.writeFileSync(DATA + 'art-group-upper.stl', new Uint8Array(N.stlBinary(N.mergeMeshes([far, ...canineUp, back.mesh]), null, 'Articulator Card synthetic test shape (group function), mm')));
  ok(n[0] > 0.3 && n[2] < -0.5, `back-tooth ramp made along the lower right molar’s path: facing down (${n[2].toFixed(2)}) and inwards (${n[0].toFixed(2)}), ${deg(Math.acos(-n[2])).toFixed(1)}° from flat; the path strays ${spread.toFixed(3)} mm from it between 1 and 4 mm`);
  await a.pair('art-group-upper.stl'); await a.setup({}, pts(cn.ucR, cn.ucL)); await a.goto('mount');
  { const R = await a.run('right'), st = R.steps.filter((s) => s.p >= 1 - 1e-9 && s.p <= 4 + 1e-9);
    const both = st.every((s) => s.contacts.some((c) => c.side === 'R' && c.upper === 'canine') && s.contacts.some((c) => c.side === 'R' && c.upper === 'molar'));
    ok(R.verdict.kind === 'group' && both && !R.verdict.nonWorking, `canine ramp + back-tooth ramp, right movement: “${R.verdict.head}”, canine and molar both touching at every position from 1 to 4 mm (${tag(st[2])})`);
    await solid('right', 'group function, right'); }
  await a.goto('move'); await page.evaluate(async () => { await APP.setMove('right'); APP.setPos(2.5, true); }); await page.waitForTimeout(400); await a.shot(OUT + 't2-group.png');

  const errs = a.errors.filter((e) => !/font-src/.test(e)); ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await a.close();
})();
