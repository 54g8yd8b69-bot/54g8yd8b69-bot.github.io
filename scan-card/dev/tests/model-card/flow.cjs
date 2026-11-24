const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs');
const O = '/home/claude/suite/dev/out/model-card/', D = '/home/claude/suite/dev/data/';
const idle = (page) => page.waitForFunction(() => !document.querySelector('#busy.show'), { timeout: 120000 });
(async () => {
  const { page, errors, shot, close } = await openApp('model-card', { width: 1400, height: 900 });
  await page.waitForFunction(() => window.APP, { timeout: 60000 });
  await shot(O + '01-empty.png');
  await page.click('[data-ss=demo]'); await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 60000 });
  await page.waitForTimeout(300); await shot(O + '02-loaded.png');
  // straight to Base → builds both
  let t0 = Date.now(); await page.evaluate(() => APP.shell.goto('base')); await page.waitForFunction(() => APP.A.upper.info && APP.A.lower.info && !document.querySelector('#busy.show'), { timeout: 120000 });
  console.log('build both (solid):', Date.now() - t0, 'ms', JSON.stringify(await page.evaluate(() => ['upper', 'lower'].map(j => ({ j, v: +(APP.A[j].info.volume / 1000).toFixed(2), wt: APP.A[j].info.watertight, size: APP.A[j].info.size.map(v => +v.toFixed(1)), notes: APP.A[j].info.notes })))));
  await page.waitForTimeout(300); await shot(O + '03-base.png');
  await page.evaluate(() => APP.viewer.fit(null, { dir: [0.4, -0.7, -0.6] })); await page.waitForTimeout(200); await shot(O + '03b-base-under.png');
  // full base + bar off, hinge on
  await page.click('#bsStyle [data-v=full]'); await idle(page); await page.waitForTimeout(200);
  console.log('full base:', JSON.stringify(await page.evaluate(() => ['upper', 'lower'].map(j => ({ j, v: +(APP.A[j].info.volume / 1000).toFixed(2), wt: APP.A[j].info.watertight })))));
  await page.evaluate(() => APP.viewer.fit(null, { dir: [0.4, -0.7, 0.6] })); await page.waitForTimeout(200); await shot(O + '04-full.png');
  await page.click('#bsStyle [data-v=horseshoe]'); await idle(page);
  await page.click('#bsBar'); await idle(page); await page.click('#bsHinge'); await idle(page); await page.waitForTimeout(200);
  console.log('bar + hinge:', JSON.stringify(await page.evaluate(() => ['upper', 'lower'].map(j => ({ j, v: +(APP.A[j].info.volume / 1000).toFixed(2), wt: APP.A[j].info.watertight, notes: APP.A[j].info.notes })))), JSON.stringify(await page.evaluate(() => APP.hingeSpec)));
  await page.evaluate(() => APP.viewer.fit(null, { dir: [0.75, 0.6, 0.25] })); await page.waitForTimeout(200); await shot(O + '05-hinge.png');
  // hinge geometry: lower ball centre and upper socket centre coincide in the case frame; models do not collide
  const hinge = await page.evaluate(() => { const h = APP.hingeSpec, N = APP.N, T = N.THREE; const gl = N.toGeometry(APP.A.lower.model), gu = N.toGeometry(APP.A.upper.model), o = {}; const res = [];
    for (const x of h.xs) { const top = new T.Vector3(x, h.y, h.z + h.ball); gl.boundsTree.closestPointToPoint(top, o); const ballTop = o.distance; const sock = new T.Vector3(x, h.y, h.z + h.ball + 0.12); gu.boundsTree.closestPointToPoint(sock, o); res.push({ x, ballTopOnLower: +ballTop.toFixed(3), socketTopOnUpper: +o.distance.toFixed(3) }); }
    // closest approach between the two models away from the hinge (should be the tooth contact ≈ 0.1–0.2, never negative/overlapping)
    return res; });
  console.log('hinge check:', JSON.stringify(hinge));
  // hollow open
  await page.evaluate(() => APP.shell.goto('hollow')); await idle(page); await page.click('#hoMode [data-v=hollow]'); await idle(page); await page.waitForTimeout(200);
  console.log('hollow open:', JSON.stringify(await page.evaluate(() => ['upper', 'lower'].map(j => ({ j, v: +(APP.A[j].info.volume / 1000).toFixed(2), saved: +(APP.A[j].info.cavity / 1000).toFixed(2), wt: APP.A[j].info.watertight, notes: APP.A[j].info.notes })))));
  await page.evaluate(() => { APP.A.upper.object.visible = false; APP.viewer.fit(APP.A.lower.object, { dir: [0.3, -0.5, -0.8] }); }); await page.waitForTimeout(200); await shot(O + '06-hollow-under.png');
  await page.click('#hoUnder [data-v=closed]'); await idle(page);
  console.log('hollow closed:', JSON.stringify(await page.evaluate(() => ['upper', 'lower'].map(j => ({ j, v: +(APP.A[j].info.volume / 1000).toFixed(2), wt: APP.A[j].info.watertight, notes: APP.A[j].info.notes })))));
  await page.evaluate(() => { APP.A.upper.object.visible = false; APP.viewer.fit(APP.A.lower.object, { dir: [0.3, -0.5, -0.8] }); }); await page.waitForTimeout(200); await shot(O + '07-closed-under.png');
  await page.click('#hoUnder [data-v=open]'); await idle(page);
  // label on the lower back wall (click on the model)
  await page.evaluate(() => APP.shell.goto('label')); await idle(page);
  await page.fill('#lbTlower', 'l-07x'); console.log('label input sanitised to:', await page.inputValue('#lbTlower'));
  await page.evaluate(() => { APP.A.upper.object.visible = false; APP.viewer.setView('left'); APP.viewer.fit(APP.A.lower.object, { dir: [1, 0.15, 0.1] }); }); await page.waitForTimeout(200);
  await page.click('#lbPlower');
  const pt = await page.evaluate(() => { const b = APP.N.meshBounds(APP.A.lower.model), rc = APP.viewer.dom.getBoundingClientRect(), s = APP.viewer.toScreen(new APP.N.THREE.Vector3(b.max[0], b.center[1] + 8, b.min[2] + 3)); return [s.x + rc.left, s.y + rc.top]; });
  await page.mouse.click(pt[0], pt[1]); await idle(page); await page.waitForTimeout(300);
  console.log('label placed:', JSON.stringify(await page.evaluate(() => ({ at: APP.A.lower.label.at && APP.A.lower.label.at.p.map(v => +v.toFixed(1)), n: APP.A.lower.label.at && APP.A.lower.label.at.n.map(v => +v.toFixed(2)), wt: APP.A.lower.info.watertight, v: +(APP.A.lower.info.volume / 1000).toFixed(3) }))));
  await shot(O + '08-label.png');
  // export, both positions
  await page.evaluate(() => { APP.A.upper.object.visible = true; APP.shell.goto('export'); }); await idle(page); await page.waitForTimeout(200); await shot(O + '09-export.png');
  for (const pos of ['print', 'scan']) {
    await page.click(`#exPos [data-v=${pos}]`);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#exStl')]); const f = O + `models-${pos}.zip`; await dl.saveAs(f); console.log('export', pos, dl.suggestedFilename(), (fs.statSync(f).size / 1e6).toFixed(1), 'MB');
  }
  // save case → reload page → reopen
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#exCase')]); const cf = O + 'case.zip'; await dl.saveAs(cf); console.log('case', (fs.statSync(cf).size / 1e6).toFixed(1), 'MB');
  const before = await page.evaluate(() => ({ P: JSON.stringify(APP.P), vol: APP.A.lower.info.volume, tris: APP.A.lower.model.indices.length }));
  await page.reload(); await page.waitForFunction(() => window.APP); await page.setInputFiles('input[data-ss=file]', [cf]);
  await page.waitForFunction(() => APP.scans.upper && APP.A.lower.model && !document.querySelector('#busy.show'), { timeout: 60000 });
  const after = await page.evaluate(() => ({ P: JSON.stringify(APP.P), vol: APP.A.lower.info && APP.A.lower.info.volume, tris: APP.A.lower.model.indices.length, label: APP.A.lower.label.text, dirty: APP.A.lower.dirty, hollowUI: document.querySelector('#hoMode .on').dataset.v, labelUI: document.querySelector('#lbTlower').value }));
  console.log('case reopened: params equal', before.P === after.P, '| model tris equal', before.tris === after.tris, '| info kept', before.vol === after.vol, '| label', after.label, after.labelUI, '| dirty', after.dirty, '| hollow UI', after.hollowUI);
  await page.evaluate(() => APP.shell.goto('export')); await idle(page); await page.waitForTimeout(300); await shot(O + '10-reopened.png');
  console.log('errors:', errors);
  await close();
})();
