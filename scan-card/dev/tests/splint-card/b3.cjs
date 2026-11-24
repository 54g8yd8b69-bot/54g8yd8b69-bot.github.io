// browser: export STL (both positions) + save case + reopen; scanner-frame STL files through the file input
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs');
const O = '/home/claude/suite/dev/out/splint-card/', D = '/home/claude/suite/dev/data/';
(async () => {
  const { page, errors, shot, close } = await openApp('splint-card', { width: 1400, height: 900 });
  await page.waitForFunction(() => window.APP, { timeout: 60000 });
  const idle = () => page.waitForFunction(() => !document.querySelector('#busy.show'), { timeout: 180000 });
  await page.setInputFiles('input[data-ss=file]', [D + 'scanner-upper.stl', D + 'scanner-lower.stl']);
  await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 60000 });
  console.log('loaded; inBite', await page.evaluate(() => APP.scans.inBite));
  await page.evaluate(() => APP.shell.goto('appliance')); await page.click('#apJaw [data-v=lower]'); await page.waitForTimeout(200);
  // change a few parameters through the real controls
  const setRange = (id, v) => page.evaluate(([id, v]) => { const r = document.getElementById(id); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  await page.evaluate(() => APP.shell.goto('path')); await setRange('paRet', 0.2); await setRange('paX', 4);
  await page.evaluate(() => APP.shell.goto('margin')); await setRange('mgB', 4.5); await page.waitForTimeout(300); await shot(O + 'b3-margin.png');
  await page.evaluate(() => APP.shell.goto('export')); await idle(); await page.waitForFunction(() => APP.D.res && !APP.D.dirty, { timeout: 180000 });
  console.log('report', await page.evaluate(() => JSON.stringify({ ...APP.D.res.report, cavity: undefined, thin: APP.D.thick.min })));
  for (const pos of ['case', 'scan']) {
    await page.click(`#exPos [data-v=${pos}]`);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#exStl')]); await dl.saveAs(O + `b3-splint-lower-${pos}.stl`); console.log('stl', pos, dl.suggestedFilename(), (fs.statSync(O + `b3-splint-lower-${pos}.stl`).size / 1e6).toFixed(1), 'MB');
  }
  const before = await page.evaluate(() => ({ P: JSON.stringify(APP.P), nv: APP.D.meshCase.positions.length, vol: APP.D.res.report.volume, thin: APP.D.thick.min }));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#exCase')]); await dl.saveAs(O + 'b3-case.zip'); console.log('case', (fs.statSync(O + 'b3-case.zip').size / 1e6).toFixed(1), 'MB');
  await page.reload(); await page.waitForFunction(() => window.APP, { timeout: 60000 });
  await page.setInputFiles('input[data-ss=file]', [O + 'b3-case.zip']);
  await page.waitForFunction(() => APP.scans.lower && APP.D.res && !document.querySelector('#busy.show'), { timeout: 60000 });
  const after = await page.evaluate(() => ({ P: JSON.stringify(APP.P), nv: APP.D.meshCase.positions.length, vol: APP.D.res.report.volume, thin: APP.D.thick.min, dirty: APP.D.dirty, jaw: APP.D.jaw, wt: APP.D.res.report.watertight }));
  console.log('reopened: params equal', before.P === after.P, '| verts', before.nv, after.nv, '| volume', before.vol.toFixed(2), after.vol.toFixed(2), '| thinnest', before.thin.toFixed(3), after.thin.toFixed(3), '| dirty', after.dirty, 'jaw', after.jaw, 'watertight', after.wt);
  await page.evaluate(() => APP.shell.goto('check')); await idle(); await page.waitForTimeout(400); await shot(O + 'b3-reopened-check.png');
  console.log('rebuilt after reopen?', await page.evaluate(() => !!APP.D.res.mesh));
  console.log('errors', errors); await close();
})();
