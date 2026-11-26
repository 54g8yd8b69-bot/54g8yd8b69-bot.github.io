// Articulator Card — kinematics, against the definitions (synthetic shapes; nothing touches, so only the paths count):
//  • the articulator: intercondylar width, Bonwill side and Balkwill angle as set
//  • protrusion: both condyles run forward and down at the sagittal condylar guidance, the travel asked for
//  • side movements: the non-working condyle at the Bennett angle (seen from above) and the condylar guidance (from the side),
//    after the immediate side shift; the working condyle keeps its height and depth and shifts outwards; the condyles stay the
//    same distance apart — for several settings, left and right set apart too
//  • every worked-out position is a rigid movement with the condyles exactly where the paths put them
//  • incisal table: with nothing touching, the incisal point follows the table (flat: stays level; 20°: drops at 20°)
const { open, ok, OUT, V, deg } = require('./lib.cjs');
(async () => {
  const a = await open(), { page } = a;
  await a.pair('art-free-upper.stl'); await a.goto('mount');
  ok(await page.evaluate(() => !!APP.E), 'the synthetic pair is mounted');
  // ── the articulator itself
  for (const s of [{ icw: 101.6, side: 101.6, balk: 26 }, { icw: 110, side: 105, balk: 20 }, { icw: 95, side: 112, balk: 33 }]) {
    await a.setup(s);
    const f = await page.evaluate(() => { const F = APP.E.F; return { L: F.L.toArray(), R: F.R.toArray(), inc: F.inc.toArray() }; });
    const w = Math.hypot(...V.sub(f.L, f.R)), sl = Math.hypot(...V.sub(f.L, f.inc)), sr = Math.hypot(...V.sub(f.R, f.inc)), mid = f.L.map((x, i) => (x + f.R[i]) / 2), balk = deg(Math.atan2(mid[2] - f.inc[2], mid[1] - f.inc[1]));
    ok(Math.abs(w - s.icw) < 1e-6 && Math.abs(sl - s.side) < 1e-6 && Math.abs(sr - s.side) < 1e-6 && Math.abs(balk - s.balk) < 1e-6 && Math.abs(mid[0] - f.inc[0]) < 1e-9,
      `condyles ${w.toFixed(2)} mm apart, ${sl.toFixed(2)} / ${sr.toFixed(2)} mm from the incisal point, triangle tilted ${balk.toFixed(2)}° behind and above it (asked: ${s.icw}, ${s.side}, ${s.balk}°)`);
  }
  // ── condylar paths, straight from K for many settings
  const SETS = [{ sci: [30, 30], ben: [15, 15], iss: [0, 0] }, { sci: [0, 0], ben: [0, 0], iss: [0, 0] }, { sci: [45, 45], ben: [25, 25], iss: [1.2, 1.2] }, { sci: [20, 50], ben: [5, 20], iss: [0.4, 1.5], apart: true }, { sci: [60, 10], ben: [30, 0], iss: [1.5, 0], apart: true }];
  for (const st of SETS) {
    await a.setup(st);
    const r = await page.evaluate(() => {
      const E = APP.E, K = APP.K, P = APP.P, F = E.F, at = (mv, t) => { const C = K.condyles(F, P, mv, t); return { L: C.L.toArray(), R: C.R.toArray() }; };
      return { F: { L: F.L.toArray(), R: F.R.toArray(), W: F.W }, prot: [0, 1, 4, 8].map((t) => at('prot', t)), right: [0, 0.25, 0.5, 1, 4, 8].map((t) => at('right', t)), left: [0, 0.25, 0.5, 1, 4, 8].map((t) => at('left', t)) };
    });
    const F = r.F, msgs = [], bad = [];
    const chk = (c, m) => { if (!c) bad.push(m); };
    // protrusion: each condyle along its own sagittal angle, no sideways movement (when both angles match), travel = t
    [1, 4, 8].forEach((t, k) => { for (const [s, i] of [['L', 0], ['R', 1]]) { const d = V.sub(r.prot[k + 1][s], F[s]); const sag = deg(Math.atan2(-d[2], -d[1])), len = Math.hypot(...d); chk(Math.abs(sag - st.sci[i]) < 1e-6, `prot ${s} sagittal ${sag}`); if (st.sci[0] === st.sci[1]) chk(Math.abs(d[0]) < 1e-9 && Math.abs(len - t) < 1e-9, `prot ${s} travel ${len} dx ${d[0]}`); else chk(Math.abs(len - t) < 0.02, `prot ${s} travel ${len}`); } });
    for (const [mv, orb, wk, k, inward] of [['right', 'L', 'R', 0, -1], ['left', 'R', 'L', 1, 1]]) {
      const P0 = r[mv][0], at1 = r[mv][3], at4 = r[mv][4], at8 = r[mv][5];
      // non-working condyle beyond the side shift: Bennett angle from above, condylar guidance from the side
      const d = V.sub(at8[orb], at1[orb]), ben = deg(Math.atan2(Math.abs(d[0]), -d[1])), sag = deg(Math.atan2(-d[2], -d[1]));
      chk(Math.abs(ben - st.ben[k]) < 1e-6 && Math.sign(d[0]) * inward >= 0, `${mv}: Bennett ${ben.toFixed(3)} (want ${st.ben[k]})`);
      chk(Math.abs(sag - st.sci[k]) < 1e-6, `${mv}: non-working sagittal ${sag.toFixed(3)} (want ${st.sci[k]})`);
      // immediate side shift: by 0.5 mm of travel the condyle is iss further in than the path alone puts it
      const pd = [inward * Math.tan(st.ben[k] * Math.PI / 180), -1, -Math.tan(st.sci[k] * Math.PI / 180)], pl = Math.hypot(...pd), pathX = (t) => t * pd[0] / pl;
      for (const [i, t] of [[2, 0.5], [3, 1], [4, 4]]) chk(Math.abs((r[mv][i][orb][0] - F[orb][0]) - (pathX(t) + inward * st.iss[k])) < 1e-9, `${mv}: side shift at ${t} mm`);
      chk(Math.abs((r[mv][1][orb][0] - F[orb][0]) - (pathX(0.25) + inward * st.iss[k] * 0.5)) < 1e-9, `${mv}: side shift half taken up at 0.25 mm`);
      // working condyle: same height and depth, outwards, the two condyles still W apart
      // (the Bennett movement: the working condyle shifts out by what the other moves in, less the second-order (dy² + dz²) / 2W that
      //  keeps the distance when the other runs forward — 0.08 mm after 4 mm straight forward, with a 0° Bennett angle)
      for (const q of [at1, at4, at8]) { chk(Math.abs(q[wk][1] - F[wk][1]) < 1e-9 && Math.abs(q[wk][2] - F[wk][2]) < 1e-9, `${mv}: working condyle stays at its height and depth`); chk(Math.abs(Math.hypot(...V.sub(q.L, q.R)) - F.W) < 1e-9, `${mv}: condyles ${Math.hypot(...V.sub(q.L, q.R))} apart`); const dO = V.sub(q[orb], F[orb]), outW = (q[wk][0] - F[wk][0]) * inward, inO = dO[0] * inward, q2 = (dO[1] * dO[1] + dO[2] * dO[2]) / (2 * F.W); chk(outW <= inO + 1e-9 && outW >= inO - q2 * 1.05 - 1e-9, `${mv}: working condyle out ${outW.toFixed(3)} vs other in ${inO.toFixed(3)}`); }
      // travel along the path beyond the side shift: (8 − 1) mm
      chk(Math.abs(Math.hypot(...d) - 7) < 1e-9, `${mv}: non-working condyle travel ${Math.hypot(...d)}`);
      msgs.push(`${mv}: Bennett ${ben.toFixed(2)}°, sagittal ${sag.toFixed(2)}°, working condyle out ${((at4[wk][0] - F[wk][0]) * inward).toFixed(2)} mm at 4 mm`);
    }
    ok(bad.length === 0, `paths for condylar guidance ${st.sci.join('/')}°, Bennett ${st.ben.join('/')}°, side shift ${st.iss.join('/')} mm: ${msgs.join('; ')}${bad.length ? ' — FAILED: ' + bad.slice(0, 4).join(' | ') : ''}`);
  }
  // ── the worked-out positions: rigid, condyles where the paths say
  await a.setup({ sci: [35, 25], ben: [12, 18], iss: [0.6, 0.9], apart: true });
  for (const id of ['prot', 'right', 'left', 'back']) {
    await a.run(id);
    const r = await page.evaluate((id) => {
      const E = APP.E, R = E.res[id], M = new APP.THREE.Matrix4(); let rigid = 0, cond = 0;
      for (const s of R.steps) {
        M.fromArray(s.pose); const e = M.elements, c0 = [e[0], e[1], e[2]], c1 = [e[4], e[5], e[6]], c2 = [e[8], e[9], e[10]], dt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        rigid = Math.max(rigid, Math.abs(dt(c0, c0) - 1), Math.abs(dt(c1, c1) - 1), Math.abs(dt(c2, c2) - 1), Math.abs(dt(c0, c1)), Math.abs(dt(c1, c2)), Math.abs(dt(c0, c2)), Math.abs(M.determinant() - 1));
        const C = APP.K.condyles(E.F, APP.P, id, s.p); cond = Math.max(cond, E.F.L.clone().applyMatrix4(M).distanceTo(C.L), E.F.R.clone().applyMatrix4(M).distanceTo(C.R));
      }
      return { rigid, cond, n: R.steps.length, free: R.steps.every((s) => s.free), kind: R.verdict.kind };
    }, id);
    ok(r.rigid < 1e-6 && r.cond < 1e-6, `${id}: ${r.n} positions, each a rigid movement (worst ${r.rigid.toExponential(1)}) with the condyles on their paths (worst ${r.cond.toExponential(1)} mm)`);
  }
  // ── incisal table, nothing touching
  for (const ang of [0, 20]) {
    await a.setup({ guide: 'table', table: ang });
    for (const id of ['prot', 'right', 'left']) {
      const R = await a.run(id), inc0 = await page.evaluate(() => APP.E.pt.inc.toArray());
      let worst = 0; for (const s of R.steps) { const h = Math.hypot(s.inc[0] - inc0[0], s.inc[1] - inc0[1]), want = h * Math.tan(ang * Math.PI / 180); worst = Math.max(worst, Math.abs(s.drop - want)); }
      ok(worst < 0.01 && R.steps.every((s) => s.by === 'table'), `incisal table at ${ang}°, ${id}: the incisal point rides on it (worst ${worst.toFixed(4)} mm off; ${R.steps[R.steps.length - 1].drop.toFixed(2)} mm down after ${R.steps[R.steps.length - 1].p} mm)`);
    }
  }
  await a.setup({});
  const R0 = await a.run('right');
  ok(R0.verdict.kind === 'free' && R0.steps.every((s) => s.free), 'teeth only, nothing to touch: every position free, verdict “nothing touches”');
  await a.goto('move'); await page.waitForTimeout(300); await a.shot(OUT + 't1-free.png');
  const errs = a.errors.filter((e) => !/font-src/.test(e)); ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await a.close();
})();
