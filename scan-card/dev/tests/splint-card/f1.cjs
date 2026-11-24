// FINAL browser test 1 (1400×900, mouse): scanner-frame STL files → lower guard, tilted path, local margin edit by dragging,
// build, both STL exports, save case, reopen.  node f1.cjs
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs');
const O = '/home/claude/suite/dev/out/splint-card/', D = '/home/claude/suite/dev/data/';
(async () => {
  const { page, errors, shot, close } = await openApp('splint-card', { width: 1400, height: 900 });
  await page.waitForFunction(() => window.APP, { timeout: 60000 });
  const idle = async () => { await page.waitForTimeout(150); await page.waitForFunction(() => !document.querySelector('#busy.show'), { timeout: 240000 }); await page.waitForTimeout(200); };
  const built = async () => { await idle(); await page.waitForFunction(() => APP.D.res && !APP.D.dirty && !document.querySelector('#busy.show'), { timeout: 240000 }); };
  const setRange = (id, v) => page.evaluate(([id, v]) => { const r = document.getElementById(id); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  await page.setInputFiles('input[data-ss=file]', [D + 'scanner-upper.stl', D + 'scanner-lower.stl']);
  await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 60000 });
  console.log('loaded scanner STLs; in the same bite:', await page.evaluate(() => APP.scans.inBite));
  await page.evaluate(() => APP.shell.goto('appliance')); await page.click('#apJaw [data-v=lower]'); await page.click('#apType [data-v=guard]'); await page.waitForTimeout(200);
  // path of insertion: sliders, then "use the view direction" from the top view (must give 0, 0), then the sliders again
  await page.evaluate(() => APP.shell.goto('path')); await page.waitForTimeout(400); await setRange('paRet', 0.2); await setRange('paX', 6); await setRange('paY', -3);
  const t1 = await page.evaluate(() => [APP.P.tiltX, APP.P.tiltY]);
  await page.evaluate(() => APP.viewer.setView('top')); await page.waitForTimeout(300); await page.click('#paView'); await page.waitForTimeout(300);
  const t2 = await page.evaluate(() => [APP.P.tiltX, APP.P.tiltY]); console.log('tilt by sliders', t1.join(','), '→ after "view direction" from the top view', t2.map((v) => v.toFixed(2)).join(','));
  await setRange('paX', 4); await page.waitForTimeout(500); await page.evaluate(() => APP.viewer.setView('left')); await page.waitForTimeout(400); await shot(O + 'f1-path-undercuts.png');
  console.log('path info:', (await page.evaluate(() => document.getElementById('paInfo').innerText)).replace(/\n+/g, ' | ').slice(0, 260));
  // margin: general setting, then one control point dragged with the mouse
  await page.evaluate(() => APP.shell.goto('margin')); await setRange('mgB', 3.5); await page.waitForTimeout(500); await page.evaluate(() => APP.viewer.setView('left')); await page.waitForTimeout(400);
  const dot = await page.evaluate(() => { const r = APP.viewer.dom.getBoundingClientRect(); let best = null; for (const d of APP.dots()) { if (d.side !== 'B') continue; const q = APP.viewer.toScreen(d.sprite.position); if (!q.visible) continue; const e = Math.hypot(q.x - r.width / 2, q.y - r.height / 2); if (!best || e < best.e) best = { e, x: q.x + r.left, y: q.y + r.top, k: d.k, z: d.sprite.position.z }; } return best; });
  await page.mouse.move(dot.x, dot.y); await page.mouse.down(); await page.mouse.move(dot.x, dot.y + 15, { steps: 4 }); await page.mouse.move(dot.x, dot.y + 30, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(300);
  const adj = await page.evaluate(() => ({ B: APP.P.adjB.join(','), L: APP.P.adjL.join(',') })); console.log('dragged buccal control point', dot.k, '30 px down → adjB', adj.B); await shot(O + 'f1-margin-edited.png');
  // build and check
  let t = Date.now(); await page.evaluate(() => APP.shell.goto('check')); await built(); console.log('build (first, in the browser)', Date.now() - t, 'ms', await page.evaluate(() => JSON.stringify(APP.D.res.report.times)));
  console.log('report', await page.evaluate(() => JSON.stringify({ wt: APP.D.res.report.watertight, genus: APP.D.res.report.genus, parts: APP.D.res.report.parts, crumbs: APP.D.res.report.crumbs, vol: +(APP.D.res.report.volume / 1000).toFixed(2), thinWall: +APP.D.thick.wall.min.toFixed(3), thinOcc: +APP.D.thick.occ.min.toFixed(3) })));
  console.log('summary:', (await page.evaluate(() => document.getElementById('ckSummary').innerText)).replace(/\n+/g, ' | '));
  await page.evaluate(() => APP.viewer.setView('left')); await page.waitForTimeout(500); await shot(O + 'f1-check-thickness.png');
  await page.click('#ckMap [data-v=plain]'); await page.evaluate(() => APP.viewer.setView('front')); await page.waitForTimeout(500); await shot(O + 'f1-on-model-front.png');
  await page.click('#ckMap [data-v=fit]'); await page.waitForTimeout(500); await page.evaluate(() => APP.viewer.setView('bottom')); await page.waitForTimeout(500); await shot(O + 'f1-fit-side.png');
  await page.click('#ckMap [data-v=thick]'); await page.click('#ckSec'); await page.waitForTimeout(700); await shot(O + 'f1-section.png');
  // drag the clipping plane with its slider, then switch the section off
  await setRange('ckAt', 14); await page.waitForTimeout(500); await page.evaluate(() => APP.faceSection()); await page.waitForTimeout(500); await shot(O + 'f1-section-14.png'); await page.click('#ckSec'); await page.waitForTimeout(300);
  // export
  await page.evaluate(() => APP.shell.goto('export')); await built();
  console.log('export summary:', (await page.evaluate(() => document.getElementById('exSummary').innerText)).replace(/\n+/g, ' | ').slice(0, 300));
  for (const pos of ['case', 'scan']) { await page.click(`#exPos [data-v=${pos}]`);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#exStl')]); await dl.saveAs(O + `f1-splint-lower-${pos}.stl`); console.log('stl', pos, dl.suggestedFilename(), (fs.statSync(O + `f1-splint-lower-${pos}.stl`).size / 1e6).toFixed(1), 'MB'); }
  const snap = () => page.evaluate(() => ({ P: JSON.stringify(APP.P), nv: APP.D.meshCase.positions.length, vol: APP.D.res.report.volume, thin: APP.D.thick.min, jaw: APP.D.jaw, wt: APP.D.res.report.watertight, dirty: APP.D.dirty,
    sum: Array.from(APP.D.meshCase.positions.subarray(0, 3000)).reduce((a, b) => a + b, 0) }));
  const before = await snap();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#exCase')]); await dl.saveAs(O + 'f1-case.zip'); console.log('case', dl.suggestedFilename(), (fs.statSync(O + 'f1-case.zip').size / 1e6).toFixed(1), 'MB');
  await page.reload(); await page.waitForFunction(() => window.APP, { timeout: 60000 });
  await page.setInputFiles('input[data-ss=file]', [O + 'f1-case.zip']);
  await page.waitForFunction(() => APP.scans.lower && APP.D.res && !document.querySelector('#busy.show'), { timeout: 60000 });
  const after = await snap(), pb = JSON.parse(before.P), pa = JSON.parse(after.P), diff = Object.keys(pb).filter((k) => JSON.stringify(pb[k]) !== JSON.stringify(pa[k]));
  console.log('reopened: parameters that differ:', diff.length ? diff.map((k) => `${k} ${JSON.stringify(pb[k])}→${JSON.stringify(pa[k])}`).join('; ') : 'none', '| margin edits', pa.adjB.join(','), '| vertices', before.nv, after.nv, '| position checksum equal', Math.abs(before.sum - after.sum) < 1e-3, '| volume', before.vol.toFixed(2), after.vol.toFixed(2), '| thinnest', before.thin.toFixed(3), after.thin.toFixed(3), '| needs rebuild', after.dirty, '| jaw', after.jaw);
  await page.evaluate(() => APP.shell.goto('check')); await idle(); await page.waitForTimeout(500); await shot(O + 'f1-reopened-check.png');
  console.log('after reopening, Check shows:', (await page.evaluate(() => document.getElementById('ckSummary').innerText)).replace(/\n+/g, ' | ').slice(0, 220));
  console.log('errors', JSON.stringify(errors)); await close();
})();
