// Analysis Card: "Find the teeth" — teeth found and numbered automatically (N.findTeeth) fill the tooth-width step (synthetic demos).
//  • standard demo: every tooth 11–16 / 21–26 / 31–36 / 41–46 gets its two contact points, on the scan surface; each width within
//    0.5 mm of the designed width (plus, on the curved front, the demo's own ambiguity: see core-teeth/lib.mjs widthAmbiguity);
//    Bolton's ratios near the designed ones (3 points anterior, 1.5 overall: the demo's front crowns only touch inside the curve); the chart shows them as automatic
//  • points the user placed beforehand are kept; dragging a found point clears its "automatic" mark; Undo brings back the state
//    before the search
//  • the numbers show beside the arch; tapping one and choosing another renumbers the arch and the points move with the numbers
//  • the "missing laterals" demo: 12 and 22 marked missing, their spaces listed; the summary marks automatic widths with *
//  • a case saved and opened again keeps the automatic marks
const L = require('./lib.cjs');
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; return c; };
// in the page: designed width, the demo's ambiguity at that tooth, and the width the app measured
const WIDTHS = `(function () {
  const T = APP.scans.demoTruth, out = [];
  for (const jaw of ['upper', 'lower']) {
    const ORDER = APP.archOrder(jaw, true), by = new Map(T[jaw].teeth.map((t) => [t.fdi, t])), amb = new Map(T[jaw].teeth.map((t) => [t.fdi, 0])), right = (f) => [1, 4].includes((f / 10) | 0);
    const facing = (t, side) => (side === 'next' ? (right(t.fdi) ? t.mesialPick : t.distalPick) : (right(t.fdi) ? t.distalPick : t.mesialPick));
    for (let q = 0; q + 1 < ORDER.length; q++) { const a = by.get(ORDER[q]), b = by.get(ORDER[q + 1]); if (!a || !b) continue; const pa = facing(a, 'next'), pb = facing(b, 'prev'), sep = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]); if (sep > 1.7) continue; amb.set(a.fdi, amb.get(a.fdi) + sep / 2); amb.set(b.fdi, amb.get(b.fdi) + sep / 2); }
    // fair: the width a measurement on the fused demo crowns can find — to the middle of two touching crowns' own ends
    const end = new Map(T[jaw].teeth.map((t) => [t.fdi, { m: t.mesialPick, d: t.distalPick }]));
    for (let q = 0; q + 1 < ORDER.length; q++) { const a = by.get(ORDER[q]), b = by.get(ORDER[q + 1]); if (!a || !b) continue; const pa = facing(a, 'next'), pb = facing(b, 'prev'); if (Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) > 1.7) continue; const mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2]; end.get(a.fdi)[right(a.fdi) ? 'm' : 'd'] = mid; end.get(b.fdi)[right(b.fdi) ? 'd' : 'm'] = mid; }
    for (const t of T[jaw].teeth) { const e = end.get(t.fdi); out.push({ fdi: t.fdi, design: t.width, amb: amb.get(t.fdi), fair: Math.hypot(e.m[0] - e.d[0], e.m[1] - e.d[1]), w: APP.calc.w[t.fdi], auto: !!(APP.state.teeth[t.fdi] && APP.state.teeth[t.fdi].auto) }); }
  }
  return out;
})`;
(async () => {
  const t0 = Date.now(), { page, errors, shot, close } = await L.open();
  await L.loadDemo(page, 0);
  await page.evaluate(() => APP.shell.goto('widths')); await page.waitForTimeout(200);
  // the user has already placed 16's points by hand (at the truth's picks)
  await page.evaluate(() => { const t = APP.scans.demoTruth.upper.teeth.find((q) => q.fdi === 16), M = APP.scans.upper.matrix.clone().invert(), raw = (p) => new APP.THREE.Vector3(...p).applyMatrix4(M).toArray(); APP.state.teeth[16] = { st: 'p', m: raw(t.mesialPick), d: raw(t.distalPick) }; APP.changed(); });
  const own16 = await page.evaluate(() => JSON.stringify(APP.state.teeth[16]));
  const tf = Date.now(); await page.click('#wFind'); await L.idle(page); await page.waitForTimeout(200); const ms = Date.now() - tf;
  const status = await page.evaluate(() => document.querySelector('#status').textContent); console.log('    status: ' + status);
  let W = await page.evaluate(WIDTHS + '()');
  const want = W.filter((r) => r.fdi % 10 <= 6), have = want.filter((r) => r.w != null);
  ok(have.length === 24, `all 24 teeth (1–6 in each quadrant) measured after one press, in ${ms} ms (${want.filter((r) => r.w == null).map((r) => r.fdi).join(' ') || 'none missing'})`);
  const bad = have.filter((r) => Math.abs(r.w - r.design) > 0.5 + r.amb);
  ok(!bad.length, `each width within 0.5 mm of the designed width (+ the demo's ambiguity on the front teeth): largest excess over that ambiguity ${Math.max(0, ...have.map((r) => Math.abs(r.w - r.design) - r.amb)).toFixed(2)} mm${bad.length ? ' — ' + bad.map((r) => `${r.fdi} ${r.w.toFixed(2)} vs ${r.design}`).join(', ') : ''}`);
  console.log('    widths (found − designed / found − measurable): ' + have.map((r) => `${r.fdi} ${(r.w - r.design >= 0 ? '+' : '') + (r.w - r.design).toFixed(2)}/${(r.w - r.fair >= 0 ? '+' : '') + (r.w - r.fair).toFixed(2)}`).join(' '));
  ok(await page.evaluate((s) => JSON.stringify(APP.state.teeth[16]) === s, own16), '16’s points, placed by hand before, are kept');
  ok(have.filter((r) => r.fdi !== 16).every((r) => r.auto) && !W.find((r) => r.fdi === 16).auto, 'the found teeth are marked automatic (16, placed by hand, is not)');
  const onSurf = await page.evaluate(() => { let worst = 0; for (const f in APP.state.teeth) { const t = APP.state.teeth[f], jaw = f < 30 ? 'upper' : 'lower'; for (const k of ['m', 'd']) if (t[k]) worst = Math.max(worst, APP.N.closestOnMesh(APP.scans[jaw].object, APP.toWorld(jaw, t[k])).distance); } return worst; });
  ok(onSurf < 0.05, `every contact point lies on its scan (within ${onSurf.toFixed(3)} mm)`);
  const B = await page.evaluate(() => APP.calc.bolton), T = await page.evaluate(() => APP.scans.demoTruth);
  const des = {}; for (const j of ['upper', 'lower']) for (const t of T[j].teeth) des[t.fdi] = t.width; const sum = (qs, top) => qs.reduce((s, q) => s + Array.from({ length: top }, (_, i) => des[q * 10 + i + 1]).reduce((a, b) => a + b, 0), 0);
  // against the ratios from the widths a measurement on the fused demo crowns can find (fair), and the designed ones for information
  const fair = {}; for (const r of W) fair[r.fdi] = r.fair; const fsum = (qs, top) => qs.reduce((s, q) => s + Array.from({ length: top }, (_, i) => fair[q * 10 + i + 1]).reduce((a, b) => a + b, 0), 0);
  const fa = fsum([3, 4], 3) / fsum([1, 2], 3) * 100, fo = fsum([3, 4], 6) / fsum([1, 2], 6) * 100, ant = sum([3, 4], 3) / sum([1, 2], 3) * 100, ovr = sum([3, 4], 6) / sum([1, 2], 6) * 100;
  // The demo's front crowns are straight boxes on a tight curve: they touch only where they run into each other on the inside of the
  // curve, so contact-to-contact widths there differ from the designed box widths (lower incisors +0.5 mm, see the widths above) and
  // the anterior ratio with them. Allowed: 3 points anterior, 1.5 overall, against the designed ratios.
  ok(B.anterior.ratio != null && Math.abs(B.anterior.ratio - ant) < 3 && Math.abs(B.overall.ratio - ovr) < 1.5, `Bolton from the found teeth: anterior ${B.anterior.ratio && B.anterior.ratio.toFixed(1)}% (designed ${ant.toFixed(1)}%; to the middle of touching crowns' ends ${fa.toFixed(1)}%), overall ${B.overall.ratio && B.overall.ratio.toFixed(1)}% (designed ${ovr.toFixed(1)}%; ${fo.toFixed(1)}%)`);
  const chartAuto = await page.evaluate(() => document.querySelectorAll('#chart .t.auto').length); ok(chartAuto >= 23, `the chart shows ${chartAuto} teeth as found automatically (dashed)`);
  const labs = await page.evaluate(() => [...document.querySelectorAll('#labels .lbl.tn')].map((e) => e.textContent)); ok(labs.length >= 14, `the numbers show beside the arch on view (${labs.join(' ')})`);
  await shot(L.O + 't12-found-lower.png');
  await page.click('#wJaw [data-v=upper]'); await page.waitForTimeout(300); await shot(L.O + 't12-found-upper.png');
  // dragging a found point clears its mark; Undo
  const p26 = await page.evaluate(() => APP.toWorld('upper', APP.state.teeth[26].d).toArray());
  await L.dragWorld(page, p26, [p26[0] + 0.4, p26[1] + 0.3, p26[2]]); await page.waitForTimeout(200);
  ok(await page.evaluate(() => !APP.state.teeth[26].auto && APP.state.teeth[25].auto), 'dragging 26’s point marks 26 as checked by hand (25 stays automatic)');
  // renumbering: the tooth found as 11 is said to be 12 — the right side moves on by one
  const before = await page.evaluate(() => ({ c11: APP.calc.P[11].m && APP.calc.P[11].m.toArray() }));
  await page.locator('#labels .lbl.tn[data-fdi="11"]').click(); await page.waitForTimeout(150);
  ok(await page.isVisible('.tl-menu'), 'tapping the number 11 opens the choice of numbers'); await shot(L.O + 't12-renumber-menu.png');
  await page.click('.tl-menu button[data-fdi="12"]'); await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ p12m: APP.calc.P[12].m && APP.calc.P[12].m.toArray(), st11: APP.state.teeth[11] && APP.state.teeth[11].st, nums: APP.AUTO.upper.res.teeth.map((t) => t.fdi) }));
  ok(after.p12m && L.d2(after.p12m, before.c11) < 1.5, `renumbered 11 → 12: the points that were 11’s are now 12’s (${after.nums.join(' ')}); 11 is now ${after.st11 === 'm' ? 'marked missing' : after.st11 || 'empty'}`);
  await page.waitForTimeout(200); await shot(L.O + 't12-renumbered.png');
  await page.click('#wUndo'); await page.waitForTimeout(200);
  ok(await page.evaluate((c) => APP.calc.P[11].m && Math.hypot(APP.calc.P[11].m.x - c[0], APP.calc.P[11].m.y - c[1]) < 0.01, before.c11), 'Undo puts the numbers back');
  // the summary marks automatic widths
  const rep = await page.evaluate(() => APP.reportText()); ok(/\d\.\d\*/.test(rep) && /\* uses a landmark placed automatically/.test(rep), 'the summary marks widths from points not yet checked with *');
  // a saved case keeps the marks
  const kept = await page.evaluate(async () => { const blob = await APP.scans.toCase().toBlob('Analysis Card'); await APP.scans.openCase(blob); await new Promise((r) => setTimeout(r, 400)); return Object.values(APP.state.teeth).filter((t) => t.auto).length; });
  ok(kept >= 20, `a case saved and opened again keeps the automatic marks (${kept} teeth)`);

  // ── missing laterals demo (12 and 22 missing, spaces part-closed)
  await L.loadDemo(page, 1); await page.evaluate(() => APP.shell.goto('widths')); await page.click('#wFind'); await L.idle(page); await page.waitForTimeout(200);
  const ml = await page.evaluate(() => ({ st12: APP.state.teeth[12] && APP.state.teeth[12].st, st22: APP.state.teeth[22] && APP.state.teeth[22].st, spans: APP.calc.gaps.upper.filter((g) => g.kind === 'span').map((g) => `${g.missing.join('+')} ${g.width.toFixed(1)}`) }));
  ok(ml.st12 === 'm' && ml.st22 === 'm', `missing laterals: 12 and 22 marked missing (${ml.st12}, ${ml.st22})`);
  ok(ml.spans.length === 2, `their spaces are listed for the restorative step: ${ml.spans.join('; ')}`);
  W = await page.evaluate(WIDTHS + '()'); const bad2 = W.filter((r) => r.fdi % 10 <= 6 && r.w != null && Math.abs(r.w - r.design) > 0.5 + r.amb);
  ok(W.filter((r) => r.fdi % 10 <= 6 && r.w != null).length === 22 && !bad2.length, `the other 22 teeth measured, widths within limits${bad2.length ? ' — ' + bad2.map((r) => `${r.fdi} ${r.w.toFixed(2)} vs ${r.design} (±${r.amb.toFixed(1)})`).join(', ') : ''}`);
  await page.click('#wJaw [data-v=upper]'); await page.waitForTimeout(300); await shot(L.O + 't12-missing-laterals.png');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  await close();
})().catch((e) => { console.error(e); process.exit(1); });
