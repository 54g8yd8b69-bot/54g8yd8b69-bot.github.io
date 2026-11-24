const { openApp } = require('/home/claude/suite/dev/pw.cjs');
(async () => {
  const { page, errors, close } = await openApp('model-card', { width: 1400, height: 900 });
  await page.waitForFunction(() => window.APP); await page.click('[data-ss=demo]'); await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'));
  await page.evaluate(() => APP.shell.goto('base')); await page.waitForFunction(() => APP.A.upper.info && APP.A.lower.info && !document.querySelector('#busy.show'), { timeout: 120000 });
  // change settings three times in quick succession while a build is running, then change the scan itself mid-build
  const r = await page.evaluate(async () => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    set('bsH', 8); await new Promise(r => setTimeout(r, 150)); set('bsH', 3); await new Promise(r => setTimeout(r, 150)); document.querySelector('#bsStyle [data-v=full]').click(); await new Promise(r => setTimeout(r, 100)); set('bsH', 6);
    await new Promise(r => setTimeout(r, 300)); await APP.ensureBuilt(); await new Promise(r => setTimeout(r, 200));
    const lowZ = APP.N.meshBounds(APP.scans.framed('lower')).min[2], modelLow = APP.N.meshBounds(APP.A.lower.model).min[2];
    return { P: [APP.P.baseH, APP.P.style], baseBelowScan: +(lowZ - modelLow).toFixed(3), dirty: [APP.A.upper.dirty, APP.A.lower.dirty], shown: [!!APP.A.upper.object, !!APP.A.lower.object] }; });
  console.log('after rapid changes:', JSON.stringify(r), '(base should be 6 mm below the scan, full base)');
  const r2 = await page.evaluate(async () => { const p = APP.rebuild(); await new Promise(r => setTimeout(r, 60)); APP.scans.clear('upper'); await p; await APP.ensureBuilt(); await new Promise(r => setTimeout(r, 300));
    return { upperObject: !!APP.A.upper.object, upperModel: !!APP.A.upper.model, lower: !!APP.A.lower.model && !APP.A.lower.dirty, panelUpperHidden: document.querySelector('[data-mvis=upper]').hidden }; });
  console.log('scan removed mid-build:', JSON.stringify(r2), '(no upper model may remain)');
  console.log('errors', errors); await close();
})();
