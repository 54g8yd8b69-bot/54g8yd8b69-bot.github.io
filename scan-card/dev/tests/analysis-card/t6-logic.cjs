// Bolton arithmetic, missing / not measured / substitution, undo, jump, redo, notation, second molars, space-analysis arithmetic, measure tool.
const L = require('./lib.cjs');
(async () => {
  const t0 = Date.now(), { page, errors, shot, close } = await L.open(); let fails = 0;
  const ok = (c, msg) => { if (!c) fails++; console.log(c ? '  ok  ' : '  FAIL', msg); };
  await L.loadDemo(page, 0);
  const truth = await page.evaluate(() => APP.scans.demoTruth), by = {}; for (const j of ['upper', 'lower']) for (const t of truth[j].teeth) by[t.fdi] = t;
  // 1. Bolton arithmetic on the designed widths against a hand calculation written out here
  const w = {}; for (const f in by) w[f] = by[f].width;
  const B = await page.evaluate((w) => APP.bolton(w, false), w);
  const U6 = 2 * (8.6 + 6.7 + 7.6), L6 = 2 * (5.4 + 5.9 + 6.9), U12 = U6 + 2 * (7.0 + 6.7 + 10.3), L12 = L6 + 2 * (7.0 + 7.1 + 10.9);
  console.log(`designed widths: anterior ${L6.toFixed(1)}/${U6.toFixed(1)} = ${(L6 / U6 * 100).toFixed(4)}%, overall ${L12.toFixed(1)}/${U12.toFixed(1)} = ${(L12 / U12 * 100).toFixed(4)}%`);
  ok(Math.abs(B.anterior.ratio - L6 / U6 * 100) < 1e-9 && Math.abs(B.overall.ratio - L12 / U12 * 100) < 1e-9, `app function gives ${B.anterior.ratio.toFixed(4)} / ${B.overall.ratio.toFixed(4)}`);
  ok(B.anterior.arch === 'lower' && Math.abs(B.anterior.excess - (L6 - U6 * 0.772)) < 1e-9, `anterior excess lower ${B.anterior.excess.toFixed(3)} = ${L6} − ${U6} × 0.772 = ${(L6 - U6 * 0.772).toFixed(3)}; or upper shortfall ${B.anterior.alt.toFixed(3)} = ${L6}/0.772 − ${U6} = ${(L6 / 0.772 - U6).toFixed(3)}`);
  ok(B.overall.arch === 'lower' && Math.abs(B.overall.excess - (L12 - U12 * 0.913)) < 1e-9, `overall excess lower ${B.overall.excess.toFixed(3)} = ${(L12 - U12 * 0.913).toFixed(3)}`);
  const B2 = await page.evaluate(() => { const w = {}; for (const q of [1, 2, 3, 4]) for (let n = 1; n <= 6; n++) w[q * 10 + n] = q < 3 ? 8 : 6; return APP.bolton(w, false); });   // 72/96 = 75% < both means → upper excess
  ok(B2.anterior.arch === 'upper' && Math.abs(B2.anterior.excess - (48 - 36 / 0.772)) < 1e-9 && Math.abs(B2.overall.excess - (96 - 72 / 0.913)) < 1e-9, `ratio below the mean → upper excess ${B2.anterior.excess.toFixed(3)} (= 48 − 36/0.772 = ${(48 - 36 / 0.772).toFixed(3)}), overall ${B2.overall.excess.toFixed(3)} (= ${(96 - 72 / 0.913).toFixed(3)})`);
  // 2. guided clicking details
  await page.evaluate(() => APP.shell.goto('widths')); await page.waitForTimeout(150);
  const prompt = () => page.evaluate(() => document.querySelector('#wPrompt b').textContent);
  ok((await prompt()) === '16 — distal contact', 'first prompt: ' + (await prompt()));
  await L.clickWorld(page, by[16].distalPick); ok((await prompt()) === '16 — mesial contact', 'after one click: ' + (await prompt()));
  await page.click('#wUndo'); ok((await prompt()) === '16 — distal contact' && !(await page.evaluate(() => APP.state.teeth[16] && APP.state.teeth[16].d)), 'Undo takes the click back: ' + (await prompt()));
  await page.click('#wNot [data-v=palmer]'); ok((await prompt()) === 'UR6 — distal contact', 'Palmer: ' + (await prompt()) + ' | chart cell: ' + (await page.evaluate(() => document.querySelector('#chart [data-f="16"] b').textContent)));
  await page.click('#wNot [data-v=fdi]');
  await page.check('#w7'); ok((await prompt()) === '17 — distal contact', 'with second molars: ' + (await prompt())); await page.uncheck('#w7');
  await page.click('#chart [data-f="12"]'); ok((await prompt()) === '12 — distal contact', 'chart jump: ' + (await prompt()));
  await page.click('#wMiss'); ok((await page.evaluate(() => APP.state.teeth[12].st)) === 'm' && (await prompt()) === '11 — distal contact', 'Missing marks 12 and moves on: ' + (await prompt()));
  await page.click('#chart [data-f="35"]'); await page.click('#wSkip'); ok((await page.evaluate(() => APP.state.teeth[35].st)) === 's', 'Not measured marks 35; view switched to ' + (await page.evaluate(() => APP.ui.jaw)));
  await page.click('#chart [data-f="16"]');
  const n = await L.clickAllWidths(page, L.truthPoint(truth)); ok(n === 44, `${n} clicks for 22 teeth (12 missing, 35 not measured)`);
  await page.evaluate(() => APP.shell.goto('bolton')); await page.waitForTimeout(150); await shot(L.O + 't6-bolton-incomplete.png');
  let bt = await page.evaluate(() => ({ a: APP.calc.bolton.anterior, o: APP.calc.bolton.overall, notes: [...document.querySelectorAll('#bOut .note')].map((e) => e.textContent) }));
  ok(bt.a.ratio == null && bt.o.ratio == null, 'no ratio with teeth lacking → ' + bt.notes.join(' | '));
  await page.check('#bSub'); await page.waitForTimeout(100); await shot(L.O + 't6-bolton-substituted.png');
  bt = await page.evaluate(() => ({ a: APP.calc.bolton.anterior, o: APP.calc.bolton.overall, w: APP.calc.w, notes: [...document.querySelectorAll('#bOut .note')].map((e) => e.textContent) }));
  const expA = (bt.w[41] + bt.w[42] + bt.w[43] + bt.w[31] + bt.w[32] + bt.w[33]) / (bt.w[11] + bt.w[13] + bt.w[21] + 2 * bt.w[22] + bt.w[23]) * 100;   // all six lower widths: clicks beside a gap land on the crown, so left and right are no longer mirror-equal to the last decimal
  ok(Math.abs(bt.a.ratio - expA) < 1e-9 && bt.a.subs.join() === '12' && bt.o.subs.join() === '12,35', `substituted: anterior ${bt.a.ratio.toFixed(3)} (hand ${expA.toFixed(3)}), flagged → ` + bt.notes.join(' | '));
  await page.uncheck('#bSub');
  // redo a tooth
  await page.evaluate(() => APP.shell.goto('widths')); await page.click('#chart [data-f="26"]'); await page.click('#wRedo'); ok((await prompt()) === '26 — mesial contact', 'Redo tooth clears 26: ' + (await prompt()));
  await L.clickWorld(page, by[26].mesialPick); await L.clickWorld(page, by[26].distalPick); ok(Math.abs((await page.evaluate(() => APP.calc.w[26])) - 10.3) < 0.01, '26 measured again: ' + (await page.evaluate(() => APP.calc.w[26].toFixed(3))));
  // drag a point with the mouse
  const p = by[26].distalPick; await L.dragWorld(page, p, [p[0] + 0.4, p[1] + 1.0, p[2]]); const wd = await page.evaluate(() => APP.calc.w[26]); await page.keyboard.press('Control+z'); await page.waitForTimeout(80);
  ok(Math.abs(wd - 10.3) > 0.3 && Math.abs((await page.evaluate(() => APP.calc.w[26])) - 10.3) < 0.01, `mouse-drag of 26 distal: 10.30 → ${wd.toFixed(2)} → Ctrl+Z → ${(await page.evaluate(() => APP.calc.w[26])).toFixed(2)}`);
  // 3. measure tool against hand calculations
  await page.click('#topBtns button:nth-child(3)'); await page.waitForTimeout(150); await page.click('#viewBtns button:nth-child(7)'); await page.waitForTimeout(150);
  await L.clickWorld(page, by[16].distalPick); await L.clickWorld(page, by[26].distalPick);
  await page.click('#mTool [data-v=a]'); await L.clickWorld(page, by[16].distalPick); await L.clickWorld(page, by[11].mesialPick); await L.clickWorld(page, by[26].distalPick);
  const M = await page.evaluate(() => APP.calc.meas.map((m) => ({ t: m.t, d: m.d, plane: m.plane, vert: m.vert, ang: m.ang, P: m.P.map((p) => p.toArray()) })));
  const a = by[16].distalPick, b = by[26].distalPick, c = by[11].mesialPick, v1 = [a[0] - c[0], a[1] - c[1], a[2] - c[2]], v2 = [b[0] - c[0], b[1] - c[1], b[2] - c[2]], ang = Math.acos((v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (Math.hypot(...v1) * Math.hypot(...v2))) * 180 / Math.PI;
  ok(M.length === 2 && Math.abs(M[0].d - L.d3(a, b)) < 0.05 && Math.abs(M[0].plane - L.d2(a, b)) < 0.05, `distance 16d–26d: app ${M[0].d.toFixed(3)} (in plane ${M[0].plane.toFixed(3)}, vertical ${M[0].vert.toFixed(3)}); hand ${L.d3(a, b).toFixed(3)} (${L.d2(a, b).toFixed(3)}, ${Math.abs(a[2] - b[2]).toFixed(3)})`);
  ok(Math.abs(M[1].ang - ang) < 0.3, `angle 16d–11m–26d: app ${M[1].ang.toFixed(2)}°, hand ${ang.toFixed(2)}°`);
  await shot(L.O + 't6-measure.png');
  await page.click('#topBtns button:nth-child(3)'); ok((await page.evaluate(() => APP.ui.step)) === 'widths', 'Measure button returns to the step it came from: ' + (await page.evaluate(() => APP.ui.step)));
  // 4. space-analysis arithmetic on landmarks placed exactly on a circle (R = 24 mm, twelve teeth over 200°)
  const R = 24, st = 200 / 12 * Math.PI / 180, bnd = (k) => { const ph = (170 * Math.PI / 180) + k * st; return [+(R * Math.cos(ph)).toFixed(4), +(R * Math.sin(ph)).toFixed(4), -1]; };
  const order = [16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26], teeth = {}; order.forEach((f, k) => { teeth[f] = k < 6 ? { st: 'p', d: bnd(k), m: bnd(k + 1) } : { st: 'p', m: bnd(k), d: bnd(k + 1) }; });
  const S = await page.evaluate((teeth) => { APP.loadState({ teeth }); APP.changed(false); const s = APP.calc.space.upper, r = { curve: s.avail, req: s.req, w: APP.calc.w[13] }; APP.state.line.upper = { pts: null, smooth: false }; APP.changed(false); r.seg = APP.calc.space.upper.avail; r.gaps = APP.calc.gaps.upper.map((g) => g.kind + ':' + g.sep.toFixed(4)); return r; }, teeth);
  const chord = 2 * R * Math.sin(st / 2), arc = R * 10 * st, seg6 = 6 * 2 * R * Math.sin(10 * st / 12);
  ok(Math.abs(S.w - chord) < 1e-3 && Math.abs(S.req - 10 * chord) < 1e-2, `circle test: tooth width ${S.w.toFixed(4)} (chord ${chord.toFixed(4)}), required ${S.req.toFixed(3)} (10 chords ${(10 * chord).toFixed(3)})`);
  ok(Math.abs(S.curve - S.req) < 0.3, `space available, curve: app ${S.curve.toFixed(3)} mm (true arc ${arc.toFixed(3)}) → the app reads ${(S.curve - S.req).toFixed(2)} mm on a perfectly aligned circular arch (arc − chords = ${(arc - 10 * chord).toFixed(2)})`);
  ok(Math.abs(S.seg - seg6) < 0.02, `space available, 6 straight segments: app ${S.seg.toFixed(3)} mm, six equal chords ${seg6.toFixed(3)} mm → the app reads ${(S.seg - S.req).toFixed(2)} mm`);
  ok(S.gaps.every((g) => g.startsWith('contact:') && Math.abs(+g.split(':')[1]) < 1e-3), 'shared contact points give 11 contacts with zero separation');
  // the same on a realistic arch shape (y = −25.2 + 0.0215·|x|^2.3, the demo's upper arch line) with real tooth sizes and shared contacts
  const half = [[0, -25.2, 0]]; { let x = 0, y = -25.2, sAcc = 0; while (sAcc < 50) { const x2 = x + 0.002, y2 = -25.2 + 0.0215 * Math.pow(x2, 2.3); sAcc += Math.hypot(0.002, y2 - y); x = x2; y = y2; half.push([x, y, sAcc]); } }
  const at = (sv) => { const h = half.find((q) => q[2] >= Math.abs(sv)); return [+(Math.sign(sv) * h[0]).toFixed(4), +h[1].toFixed(4), -1]; };
  const md = [8.6, 6.7, 7.6, 7.0, 6.7, 10.3], cum = [0]; md.forEach((m) => cum.push(cum[cum.length - 1] + m)); const t2 = {};
  for (let i = 1; i <= 6; i++) { t2[10 + i] = { st: 'p', m: at(-cum[i - 1]), d: at(-cum[i]) }; t2[20 + i] = { st: 'p', m: at(cum[i - 1]), d: at(cum[i]) }; }
  const S2 = await page.evaluate((teeth) => { APP.loadState({ teeth }); APP.changed(false); const s = APP.calc.space.upper, r = { curve: s.avail, req: s.req }; APP.state.line.upper = { pts: null, smooth: false }; APP.changed(false); r.seg = APP.calc.space.upper.avail; return r; }, t2);
  ok(Math.abs(S2.curve - S2.req) < 0.4, `demo-shaped arch, shared contacts: required ${S2.req.toFixed(3)} (arc 73.2), curve ${S2.curve.toFixed(3)} → reads ${(S2.curve - S2.req).toFixed(2)} mm; 6 segments ${S2.seg.toFixed(3)} → reads ${(S2.seg - S2.req).toFixed(2)} mm`);
  console.log(fails ? `${fails} FAILED` : 'all passed', '| errors', errors, (Date.now() - t0) + 'ms');
  await close();
})();
