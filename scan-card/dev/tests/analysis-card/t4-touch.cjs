// 820×1180 with touch: every point is placed with a tap; one screenshot per step.
const L = require('./lib.cjs');
(async () => {
  const t0 = Date.now(), { page, errors, shot, close } = await L.open({ width: 820, height: 1180, touch: true });
  await page.tap('[data-ss=demo][data-i="0"]');
  await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && APP.scans.demoTruth && !document.querySelector('#busy.show'), { timeout: 120000 }); await page.waitForTimeout(200);
  await shot(L.O + 't4-touch-load.png');
  const truth = await page.evaluate(() => APP.scans.demoTruth);
  console.log('taps:', await L.clickAllWidths(page, L.truthPoint(truth), { touch: true }));
  const got = await page.evaluate(() => ({ w: APP.calc.w, a: APP.calc.bolton.anterior.ratio, o: APP.calc.bolton.overall.ratio, size: APP.viewer.size }));
  let worst = 0; for (const j of ['upper', 'lower']) for (const t of truth[j].teeth) if (t.fdi % 10 < 7) worst = Math.max(worst, Math.abs(got.w[t.fdi] - L.d2(t.mesial, t.distal)));
  console.log('view size', got.size, '| worst |width − truth contact distance| =', worst.toFixed(3), 'mm | Bolton', got.a.toFixed(2), got.o.toFixed(2));
  await page.tap('#wJaw [data-v=upper]'); await page.waitForTimeout(300); await shot(L.O + 't4-touch-widths.png');
  // drag a point with a finger: move 16 distal 1.5 mm and put it back with Undo
  const p = truth.upper.teeth.find((t) => t.fdi === 16).distalPick, a = await L.screenOf(page, p), b = await L.screenOf(page, [p[0] + 1.5, p[1], p[2]]);
  const cdp = await page.context().newCDPSession(page), tp = (x, y) => [{ x, y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(a[0], a[1]) });
  for (let k = 1; k <= 5; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(a[0] + (b[0] - a[0]) * k / 5, a[1] + (b[1] - a[1]) * k / 5) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(150);
  const w16 = await page.evaluate(() => APP.calc.w[16]); await page.tap('#wUndo'); await page.waitForTimeout(100);
  console.log('finger-drag of 16 distal by 1.5 mm: width 10.30 →', w16.toFixed(2), '→ after Undo', (await page.evaluate(() => APP.calc.w[16])).toFixed(2));
  for (const [id, name] of [['bolton', 'bolton'], ['space', 'space'], ['arch', 'arch']]) { await page.evaluate((s) => APP.shell.goto(s), id); await page.waitForTimeout(350); await shot(L.O + `t4-touch-${name}.png`); }
  await page.tap('#aView [data-v=section]'); await page.waitForTimeout(350); await shot(L.O + 't4-touch-section.png');
  await page.evaluate(() => APP.shell.goto('report')); await page.waitForTimeout(600); await shot(L.O + 't4-touch-report.png');
  console.log('errors', errors, (Date.now() - t0) + 'ms');
  await close();
})();
