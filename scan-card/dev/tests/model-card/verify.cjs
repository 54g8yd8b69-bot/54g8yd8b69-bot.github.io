// Independent end-to-end check: scanner-frame STL files in through the real file input, models out through the real
// download button, then measured in Node against the original scan files.
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs');
const O = '/home/claude/suite/dev/out/model-card/', D = '/home/claude/suite/dev/data/';
const idle = (page) => page.waitForFunction(() => !document.querySelector('#busy.show'), { timeout: 180000 });
(async () => {
  const { page, errors, close } = await openApp('model-card', { width: 1400, height: 900 });
  await page.waitForFunction(() => window.APP);
  await page.setInputFiles('input[data-ss=file]', [D + 'scanner-upper.stl', D + 'scanner-lower.stl']);
  await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 60000 });
  await page.evaluate(() => APP.shell.goto('export')); await page.waitForFunction(() => APP.A.upper.info && APP.A.lower.info && !document.querySelector('#busy.show'), { timeout: 180000 });
  const variants = [['solid', {}], ['hollow-hinge', { hollow: true, hinge: true }], ['full-closed', { hollow: true, hinge: false, underside: 'closed', style: 'full' }]];
  const out = [];
  for (const [name, cfg] of variants) {
    await page.evaluate((c) => { Object.assign(APP.P, { hollow: false, hinge: false, underside: 'open', style: 'horseshoe' }, c); return APP.rebuild(); }, cfg); await idle(page);
    for (const pos of ['scan', 'print']) {
      await page.click(`#exPos [data-v=${pos}]`);
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#exStl')]); const f = O + `verify-${name}-${pos}.zip`; await dl.saveAs(f); out.push([name, pos, f]);
    }
    out.push([name, 'info', JSON.stringify(await page.evaluate(() => ['upper', 'lower'].map(j => ({ j, vol: APP.A[j].info.volume, baseH: APP.P.baseH, notes: APP.A[j].info.notes }))))]);
  }
  fs.writeFileSync(O + 'verify-list.json', JSON.stringify(out)); console.log('browser errors:', errors); await close();
})();
