// Tooth widths and Bolton on the standard demo, driven through the real UI with clicks at the demo's truth pick points.
const L = require('./lib.cjs');
(async () => {
  const t0 = Date.now(), { page, errors, shot, close } = await L.open();
  await L.loadDemo(page, 0);
  const truth = await page.evaluate(() => APP.scans.demoTruth);
  const n = await L.clickAllWidths(page, L.truthPoint(truth));
  console.log('clicks made:', n, '| prompt now:', await page.evaluate(() => document.querySelector('#wPrompt b').textContent));
  const got = await page.evaluate(() => ({ w: APP.calc.w, mode: APP.state.widthMode, bolton: APP.calc.bolton, sums: APP.calc.sums }));
  let worst = 0, worstC = 0; const rows = [];
  for (const jaw of ['upper', 'lower']) for (const t of truth[jaw].teeth) { if (t.fdi % 10 > 6) continue; const w = got.w[t.fdi], c = L.d2(t.mesial, t.distal); worst = Math.max(worst, Math.abs(w - t.width)); worstC = Math.max(worstC, Math.abs(w - c)); rows.push(`${t.fdi}:${w.toFixed(3)}(${(w - t.width >= 0 ? '+' : '') + (w - t.width).toFixed(3)})`); }
  console.log('width mode:', got.mode); console.log(rows.join('  '));
  console.log('worst |measured − designed width| =', worst.toFixed(3), 'mm ; worst |measured − distance between truth contact points| =', worstC.toFixed(4), 'mm');
  // hand calculation of Bolton from the designed widths, and from the truth contact points
  const by = {}; for (const jaw of ['upper', 'lower']) for (const t of truth[jaw].teeth) by[t.fdi] = t;
  const sum = (qs, top, f) => qs.reduce((s, q) => s + Array.from({ length: top }, (_, i) => f(by[q * 10 + i + 1])).reduce((a, b) => a + b, 0), 0);
  for (const [name, f] of [['designed widths', (t) => t.width], ['truth contact points (plane)', (t) => L.d2(t.mesial, t.distal)]]) {
    const U6 = sum([1, 2], 3, f), L6 = sum([3, 4], 3, f), U12 = sum([1, 2], 6, f), L12 = sum([3, 4], 6, f);
    console.log(`hand calc from ${name}: anterior ${L6.toFixed(2)}/${U6.toFixed(2)} = ${(L6 / U6 * 100).toFixed(3)}%  overall ${L12.toFixed(2)}/${U12.toFixed(2)} = ${(L12 / U12 * 100).toFixed(3)}%`);
  }
  const B = got.bolton; console.log(`app: anterior ${B.anterior.lower.toFixed(2)}/${B.anterior.upper.toFixed(2)} = ${B.anterior.ratio.toFixed(3)}% excess ${B.anterior.arch} ${B.anterior.excess.toFixed(3)}  overall ${B.overall.lower.toFixed(2)}/${B.overall.upper.toFixed(2)} = ${B.overall.ratio.toFixed(3)}% excess ${B.overall.arch} ${B.overall.excess.toFixed(3)}`);
  await page.evaluate(() => APP.shell.goto('widths')); await page.waitForTimeout(300); await shot(L.O + 't1-widths-lower.png');
  await page.click('#wJaw [data-v=upper]'); await page.waitForTimeout(300); await shot(L.O + 't1-widths-upper.png');
  await page.evaluate(() => APP.shell.goto('bolton')); await page.waitForTimeout(300); await shot(L.O + 't1-bolton.png');
  await page.evaluate(() => APP.shell.goto('space')); await page.waitForTimeout(300); await shot(L.O + 't1-space-upper.png');
  console.log('gaps upper:', await page.evaluate(() => APP.calc.gaps.upper.map((g) => `${g.a}-${g.b} ${g.kind} sep ${g.sep.toFixed(2)} straight ${g.straight.toFixed(2)}`).join(' | ')));
  console.log('space:', await page.evaluate(() => JSON.stringify(['upper', 'lower'].map((j) => { const s = APP.calc.space[j]; return { j, avail: +s.avail.toFixed(2), req: +s.req.toFixed(2), diff: +s.diff.toFixed(2) }; }))));
  console.log('errors', errors, (Date.now() - t0) + 'ms');
  await close();
})();
