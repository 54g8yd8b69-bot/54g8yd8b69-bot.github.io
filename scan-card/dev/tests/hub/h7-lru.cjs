// Large scans: only the tool in front and the one before it stay open; a closed tool comes back with its work, at its step.
const { openHub, ok, OUT } = require('./lib.cjs');
(async () => {
  const a = await openHub(), { page } = a;
  await page.evaluate(() => APP.scans.loadDemo({ res: 0.2 }));
  await page.waitForFunction(() => APP.scans.has('upper') && APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 180000 });
  const alive = () => page.evaluate(() => Object.keys(APP.F).sort().join());
  let an = await a.go('analysis');
  await an.evaluate(() => { APP.state.opts = APP.state.opts || {}; });
  // mark something recognisable in Analysis: set the arch-view step and a few widths through its own state loader
  await an.evaluate(() => APP.shell.goto('bolton'));
  const mo = await a.go('model'); await mo.waitForFunction(() => APP.A.lower.model && APP.A.upper.model && !APP.A.lower.dirty && !APP.A.upper.dirty, null, { timeout: 300000 });
  await mo.evaluate(async () => { APP.P.baseH = 6.5; await APP.rebuild(); APP.shell.goto('label'); }); await a.idle(mo);
  ok(await alive() === 'analysis,model', 'two tools open: both kept (' + await alive() + ')');
  const sp = await a.go('splint');
  ok(await alive() === 'model,splint', 'third tool opened with large scans: the least recently used one (Analysis) was closed → ' + await alive());
  ok(await page.evaluate(() => APP.valid(APP.TOOLS[1]) && APP.H.step.analysis === 'bolton'), 'its work and its step are held by the hub');
  an = await a.go('analysis');
  ok(await an.evaluate(() => APP.scans.has('upper') && APP.shell.steps[APP.shell.current].id === 'bolton'), 'Analysis reopened with the scans, back on its Bolton step');
  ok(await alive() === 'analysis,splint', 'now Models is the one closed → ' + await alive());
  const t0 = Date.now(), mo2 = await a.go('model');
  await mo2.waitForFunction(() => APP.A.lower.model && APP.A.upper.model, null, { timeout: 120000 });
  const st = await mo2.evaluate(() => ({ baseH: APP.P.baseH, dirty: [APP.A.upper.dirty, APP.A.lower.dirty], step: APP.shell.steps[APP.shell.current].id, wt: APP.A.lower.info && APP.A.lower.info.watertight }));
  ok(st.baseH === 6.5 && !st.dirty[0] && !st.dirty[1] && st.step === 'label' && st.wt, `Models reopened in ${Date.now() - t0} ms with its setting, both built models (not rebuilt) and its step: ` + JSON.stringify(st));
  ok(a.errors.length === 0, 'no page errors ' + a.errors.slice(0, 3).join(' | '));
  await a.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
