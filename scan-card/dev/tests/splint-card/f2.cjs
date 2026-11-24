// FINAL browser test 2 (1400×900, mouse): demo scans → upper flat-plane splint with palate coverage, bite opened (hinge, then
// straight), table meeting the opposing cusps, cusp imprints, contact map, cross-section, STL, save case, reopen.  node f2.cjs
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs');
const O = '/home/claude/suite/dev/out/splint-card/';
(async () => {
  const { page, errors, shot, close } = await openApp('splint-card', { width: 1400, height: 900 });
  await page.waitForFunction(() => window.APP, { timeout: 60000 });
  const idle = async () => { await page.waitForTimeout(150); await page.waitForFunction(() => !document.querySelector('#busy.show'), { timeout: 240000 }); await page.waitForTimeout(200); };
  const built = async () => { await idle(); await page.waitForFunction(() => APP.D.res && !APP.D.dirty && !document.querySelector('#busy.show'), { timeout: 240000 }); await page.waitForTimeout(150); };
  const setRange = (id, v) => page.evaluate(([id, v]) => { const r = document.getElementById(id); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  const state = () => page.evaluate(() => { const r = APP.D.res.report, c = APP.D.contact, t = APP.D.thick; return JSON.stringify({ open: APP.P.open, mode: APP.P.openMode, met: r.met, lift: +(+r.lift).toFixed(2), wt: r.watertight, genus: r.genus, vol: +(r.volume / 1000).toFixed(2), occ: +t.occ.min.toFixed(2), wall: +t.wall.min.toFixed(2), contacts: c && c.patches.length, nearest: c && +c.min.toFixed(3), through: c && c.through, ms: r.times.total }); });
  await page.click('[data-ss=demo]'); await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 60000 });
  await page.evaluate(() => APP.shell.goto('appliance')); await page.click('#apJaw [data-v=upper]'); await page.click('#apType [data-v=flat]'); await page.waitForTimeout(300);
  console.log('preset flat →', await page.evaluate(() => JSON.stringify({ thickness: APP.P.thickness, minThick: APP.P.minThick, occlusal: APP.P.occlusal, buccal: APP.P.buccal, lingual: APP.P.lingual, useOpp: APP.P.useOpp, meet: APP.P.meet, clearance: APP.P.clearance, retention: APP.P.retention })));
  await page.evaluate(() => APP.shell.goto('margin')); await page.waitForTimeout(600); await page.evaluate(() => APP.viewer.setView('bottom')); await page.waitForTimeout(500); await shot(O + 'f2-margin.png');
  console.log('margin info:', (await page.evaluate(() => document.getElementById('mgInfo').innerText)).replace(/\n+/g, ' | ').slice(0, 200));
  let t = Date.now(); await page.evaluate(() => APP.shell.goto('shell')); await built(); console.log('first build', Date.now() - t, 'ms  ', await state());
  console.log('shell info before opening:', (await page.evaluate(() => document.getElementById('shInfo').innerText)).replace(/\n+/g, ' | ').slice(0, 400));
  t = Date.now(); await page.click('#shAuto'); await built(); console.log('"Open just enough" (hinge) + rebuild', Date.now() - t, 'ms  ', await state());
  console.log('shell info:', (await page.evaluate(() => document.getElementById('shInfo').innerText)).replace(/\n+/g, ' | ').slice(0, 400));
  await page.evaluate(() => APP.viewer.setView('front')); await page.waitForTimeout(400); await shot(O + 'f2-shell-front-opposing.png');
  await page.evaluate(() => APP.viewer.setView('right')); await page.waitForTimeout(400); await shot(O + 'f2-shell-side-opposing.png');
  await page.click('#shMode [data-v=straight]'); await built(); await page.click('#shAuto'); await built(); console.log('straight opening, auto:', await state());
  await page.click('#shMode [data-v=hinge]'); await built(); await page.click('#shAuto'); await built(); const hinge = await state(); console.log('back to hinge, auto:', hinge);
  await setRange('shImp', 0.3); await built(); console.log('with 0.3 mm cusp imprints:', await state());
  await setRange('shImp', 0); await built();
  await page.evaluate(() => APP.shell.goto('check')); await built();
  console.log('summary:', (await page.evaluate(() => document.getElementById('ckSummary').innerText)).replace(/\n+/g, ' | '));
  await page.evaluate(() => APP.viewer.setView('front')); await page.waitForTimeout(400); await shot(O + 'f2-check-thickness.png');
  await page.click('#ckMap [data-v=contact]'); await page.waitForTimeout(300);
  await page.evaluate(() => { APP.P.showOpp = false; document.getElementById('shShow').checked = false; APP.refreshView(); APP.viewer.setView('bottom'); }); await page.waitForTimeout(500); await shot(O + 'f2-check-contacts.png');
  await page.click('#ckMap [data-v=fit]'); await page.waitForTimeout(300); await page.evaluate(() => APP.viewer.setView('top')); await page.waitForTimeout(500); await shot(O + 'f2-fit-side.png');
  await page.click('#ckMap [data-v=thick]'); await page.evaluate(() => { APP.P.showOpp = true; document.getElementById('shShow').checked = true; APP.refreshView(); }); await page.click('#ckSec'); await page.waitForTimeout(800); await shot(O + 'f2-section.png');
  await page.click('#ckSec'); await page.waitForTimeout(200);
  await page.evaluate(() => APP.shell.goto('export')); await built(); await page.click('#exPos [data-v=case]');
  { const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#exStl')]); await dl.saveAs(O + 'f2-splint-upper-case.stl'); console.log('stl', dl.suggestedFilename(), (fs.statSync(O + 'f2-splint-upper-case.stl').size / 1e6).toFixed(1), 'MB'); }
  const snap = () => page.evaluate(() => ({ P: JSON.stringify(APP.P), nv: APP.D.meshCase.positions.length, vol: APP.D.res.report.volume, thin: APP.D.thick.min, jaw: APP.D.jaw, dirty: APP.D.dirty, contacts: APP.D.contact ? APP.D.contact.patches.length : null }));
  const before = await snap();
  { const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#exCase')]); await dl.saveAs(O + 'f2-case.zip'); console.log('case', (fs.statSync(O + 'f2-case.zip').size / 1e6).toFixed(1), 'MB'); }
  await page.reload(); await page.waitForFunction(() => window.APP, { timeout: 60000 });
  await page.setInputFiles('input[data-ss=file]', [O + 'f2-case.zip']);
  await page.waitForFunction(() => APP.scans.upper && APP.D.res && !document.querySelector('#busy.show'), { timeout: 60000 });
  const after = await snap(), pb = JSON.parse(before.P), pa = JSON.parse(after.P), diff = Object.keys(pb).filter((k) => JSON.stringify(pb[k]) !== JSON.stringify(pa[k]));
  console.log('reopened: parameters that differ:', diff.length ? diff.map((k) => `${k} ${JSON.stringify(pb[k])}→${JSON.stringify(pa[k])}`).join('; ') : 'none', '| vertices', before.nv, after.nv, '| volume', before.vol.toFixed(2), after.vol.toFixed(2), '| thinnest', before.thin.toFixed(3), after.thin.toFixed(3), '| needs rebuild', after.dirty, '| jaw', after.jaw, '| contacts', before.contacts, after.contacts);
  await page.evaluate(() => APP.shell.goto('check')); await idle(); await page.waitForTimeout(600);
  console.log('after reopening, Check shows:', (await page.evaluate(() => document.getElementById('ckSummary').innerText)).replace(/\n+/g, ' | ').slice(0, 330));
  // palate side taken far down: on the demo scan this runs past the edge of the scan, which the app must say
  await page.evaluate(() => APP.shell.goto('margin')); await setRange('mgL', 12); await page.waitForTimeout(600); await page.evaluate(() => APP.viewer.setView('bottom')); await page.waitForTimeout(500); await shot(O + 'f2-margin-palate12.png');
  await page.evaluate(() => APP.shell.goto('check')); await built(); await page.waitForTimeout(400); await shot(O + 'f2-palate12-check.png');
  console.log('palate side 12 mm →', await state()); console.log('   Check shows:', (await page.evaluate(() => document.getElementById('ckSummary').innerText)).replace(/\n+/g, ' | ').slice(0, 700));
  console.log('errors', JSON.stringify(errors)); await close();
})();
