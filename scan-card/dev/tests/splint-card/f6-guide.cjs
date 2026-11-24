// Splint Card in the browser: guidance ramps from the controls, dots on the opposing tips, moving one by tapping, the excursion summary.
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const OUT = '/home/claude/suite/dev/out/splint-card/';
let bad = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { bad++; process.exitCode = 1; } };
(async () => {
  const { page, errors, shot, close } = await openApp('splint-card', { width: 1400, height: 900 });
  const idle = async () => { await page.waitForTimeout(150); await page.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 }); };
  await page.waitForFunction(() => window.APP);
  await page.click('[data-ss=demo]'); await idle();
  await page.evaluate(() => APP.shell.goto('appliance')); await page.click('#apJaw [data-v=upper]'); await page.click('#apType [data-v=flat]');
  await page.evaluate(() => APP.shell.goto('shell')); await idle();
  await page.check('#shUse'); await idle(); await page.click('#shAuto'); await idle();
  ok(await page.isVisible('#gdOn'), 'Guidance section shows for a flat splint with the opposing arch');
  ok(!(await page.isVisible('#gdCa')), 'its options stay folded until ramps are switched on');
  await page.check('#gdOn'); await idle();
  await page.waitForFunction(() => APP.D.res && !APP.D.dirty, null, { timeout: 300000 });
  const r = await page.evaluate(() => ({ ramps: APP.D.res.report.ramps, wt: APP.D.res.report.watertight, exc: APP.D.exc && ['right', 'left', 'forward'].map((k) => APP.D.exc[k][1]), sum: document.getElementById('shInfo').innerText }));
  ok(JSON.stringify(r.ramps) === '["right","left","front"]' && r.wt, 'built with three ramps, watertight');
  ok(r.exc && r.exc.every((q) => q.guide === 'front' && q.back > 0.3), 'Check: back teeth clear at 2 mm in all three movements: ' + r.exc.map((q) => q.back.toFixed(2)).join(', '));
  ok(/Excursions \(simplified\)/.test(r.sum) && /back teeth clear by/.test(r.sum), 'the summary shows the excursions');
  const dots = await page.evaluate(() => [...document.querySelectorAll('.lbl, .label, [class*=label]')].map((e) => e.textContent).filter((t) => /^[RFL]$/.test(t)).join(''));
  ok(dots.length === 3, 'three labelled dots (R, F, L) on the opposing arch: ' + dots);
  await shot(OUT + 'f6-guide-shell.png');
  // move the right canine point: choose it, tap the opposing arch 3 mm further back
  const before = await page.evaluate(() => APP.P.gTips.right.slice());
  await page.click('#gdPick [data-v=right]');
  const xy = await page.evaluate((b) => { const sc = APP.scans.lower, Om = APP.opposing().Om, v = new APP.N.THREE.Vector3(b[0], b[1] + 3, b[2]).applyMatrix4(Om), q = APP.viewer.toScreen(v), r = APP.viewer.dom.getBoundingClientRect(); return [q.x + r.left, q.y + r.top]; }, before);
  await page.mouse.click(xy[0], xy[1]); await idle();
  await page.waitForFunction(() => APP.D.res && !APP.D.dirty, null, { timeout: 300000 });
  const after = await page.evaluate(() => APP.P.gTips.right.slice());
  ok(Math.hypot(after[0] - before[0], after[1] - before[1]) > 1.5, `tapping moved the right canine point by ${Math.hypot(after[0] - before[0], after[1] - before[1]).toFixed(1)} mm and the splint was rebuilt`);
  // switching the ramps off brings back contact on the back teeth
  await page.uncheck('#gdOn'); await idle(); await page.waitForFunction(() => APP.D.res && !APP.D.dirty, null, { timeout: 300000 });
  ok(await page.evaluate(() => !APP.D.res.report.ramps && ['right', 'left', 'forward'].some((k) => APP.D.exc[k][1].guide !== 'front')), 'ramps off: the check reports the back teeth touching again');
  // case round trip keeps the settings and the moved point
  await page.check('#gdOn'); await idle(); await page.waitForFunction(() => APP.D.res && !APP.D.dirty, null, { timeout: 300000 });
  const p1 = await page.evaluate(() => JSON.stringify([APP.P.guide, APP.P.gCa, APP.P.gTips]));
  const blob = await page.evaluate(async () => { const b = await APP.scans.toCase().toBlob('t'); return Array.from(new Uint8Array(await b.arrayBuffer())); });
  await page.evaluate(async (a) => { await APP.scans.useCase(await APP.N.DentalCase.fromBlob(new Blob([new Uint8Array(a)]))); }, blob); await idle();
  ok(await page.evaluate(() => JSON.stringify([APP.P.guide, APP.P.gCa, APP.P.gTips])) === p1, 'the case file keeps the guidance settings and the moved point');
  console.log('errors:', JSON.stringify(errors.slice(0, 4))); ok(errors.length === 0, 'no page errors');
  await close(); console.log(bad ? bad + ' FAILED' : 'all passed');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
