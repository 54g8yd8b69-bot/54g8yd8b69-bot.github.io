const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs');
const D = '/home/claude/suite/dev/data/', O = '/home/claude/suite/dev/out/';
(async () => {
  const { page, errors, shot, close } = await openApp('dev/coretest', { width: 1400, height: 860 });
  await page.waitForFunction(() => window.READY, { timeout: 60000 });
  await shot(O + 'ct-empty.png');
  // 1. scanner-frame STLs through the real file input
  await page.setInputFiles('input[data-ss=file]', [D + 'scanner-upper.stl', D + 'scanner-lower.stl']);
  await page.waitForFunction(() => T.scans.upper && T.scans.lower && !document.querySelector('#busy.show'), { timeout: 60000 });
  const truth = JSON.parse(fs.readFileSync(D + 'scanner-truth.json'));
  const r1 = await page.evaluate((tm) => { const M = new T.N.THREE.Matrix4().fromArray(tm), res = {}; for (const j of ['upper', 'lower']) { const e = T.scans[j].matrix.clone().multiply(M).elements; res[j] = { ang: Math.acos(Math.min(1, (e[0] + e[5] + e[10] - 1) / 2)) * 180 / Math.PI, x: e[12], z: e[14] }; } return { res, inBite: T.scans.inBite, same: T.scans.upper.matrix.equals(T.scans.lower.matrix), info: document.querySelector('[data-ss=info]').innerText }; }, truth.matrix);
  console.log('file load + auto-orient:', JSON.stringify(r1.res), 'inBite', r1.inBite, 'shared matrix', r1.same); console.log('  info:', r1.info.replace(/\n/g, ' | '));
  await page.waitForTimeout(300); await shot(O + 'ct-loaded.png');
  // 2. orient step: guides, flip, turn, sliders, 3-click plane
  await page.click('#bNext'); await page.waitForTimeout(300); await shot(O + 'ct-orient.png');
  const z0 = await page.evaluate(() => T.N.meshBounds(T.scans.framed('lower')).max[2]);
  await page.click('[data-so=flip]'); const z1 = await page.evaluate(() => T.N.meshBounds(T.scans.framed('lower')).min[2]);
  await page.click('[data-so=flip]'); const z2 = await page.evaluate(() => T.N.meshBounds(T.scans.framed('lower')).max[2]);
  console.log('flip twice returns: top z', z0.toFixed(2), '→ bottom z', z1.toFixed(2), '→ top z', z2.toFixed(2));
  await page.evaluate(() => { const r = document.querySelector('[data-so=pitch]'); r.value = 10; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
  const tilt = await page.evaluate(() => { const b = T.N.meshBounds(T.scans.framed('lower')); return b.size[2]; }); console.log('pitch slider 10° → lower arch height now', tilt.toFixed(1), 'mm (was ~16.5 level)');
  // 3-click plane on three cusp tips puts those points on z=0
  await page.evaluate(() => { T.scans.setVisible('upper', false); T.viewer.setView('top'); }); await page.waitForTimeout(200);
  await page.click('[data-so=plane]');
  const pts = await page.evaluate(() => { const rc = T.viewer.dom.getBoundingClientRect(), b = T.N.meshBounds(T.scans.framed('lower')); const cands = [[b.min[0] + 9, b.max[1] - 14], [b.max[0] - 9, b.max[1] - 14], [0, b.min[1] + 6]]; return cands.map(([x, y]) => { const s = T.viewer.toScreen(new T.N.THREE.Vector3(x, y, 0)); return [s.x + rc.left, s.y + rc.top]; }); });
  for (const p of pts) { await page.mouse.click(p[0], p[1]); await page.waitForTimeout(80); }
  const after = await page.evaluate(() => ({ tilt: Math.acos(Math.min(1, Math.abs(T.scans.lower.matrix.clone().multiply(new T.N.THREE.Matrix4()).elements[10]))) * 180 / Math.PI, tool: !!T.viewer.tool, log: T.log.join(',') }));
  console.log('3-click plane applied; tool cleared:', !after.tool, '| change log:', after.log);
  await page.click('[data-so=auto]'); await page.waitForTimeout(200);
  // 3. save case (download) and reopen
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#topBtns button:nth-child(2)')]);
  const cp = O + 'ct-case.zip'; await dl.saveAs(cp); console.log('case saved:', dl.suggestedFilename(), (fs.statSync(cp).size / 1e6).toFixed(2), 'MB');
  const before = await page.evaluate(() => ({ m: T.scans.lower.matrix.toArray(), n: T.scans.lower.raw.positions.length }));
  await page.evaluate(() => { T.scans.clear('upper'); T.scans.clear('lower'); });
  await page.setInputFiles('input[data-ss=file]', [cp]);
  await page.waitForFunction(() => T.scans.upper && T.scans.lower && !document.querySelector('#busy.show'), { timeout: 60000 });
  const back = await page.evaluate(() => ({ m: T.scans.lower.matrix.toArray(), n: T.scans.lower.raw.positions.length, data: window.lastCaseData, inBite: T.scans.inBite }));
  console.log('case reopened: matrix equal', JSON.stringify(before.m) === JSON.stringify(back.m), 'verts equal', before.n === back.n, 'app data', JSON.stringify(back.data), 'inBite', back.inBite);
  // 4. dirty + quadrant scans
  await page.evaluate(() => { T.scans.clear('upper'); T.scans.clear('lower'); });
  await page.setInputFiles('input[data-ss=file]', [D + 'dirty-lower.stl']); await page.waitForFunction(() => T.scans.lower && !document.querySelector('#busy.show'));
  console.log('dirty scan:', (await page.evaluate(() => document.querySelector('[data-ss=info]').innerText)).replace(/\n/g, ' | '));
  // 5. demo button, resume after reload
  await page.evaluate(() => T.shell.goto(0)); await page.click('[data-ss=demo]'); await page.waitForFunction(() => T.scans.upper && T.scans.demoTruth && !document.querySelector('#busy.show'), { timeout: 60000 });
  await page.evaluate(() => T.shell.goto(0)); await page.waitForTimeout(2500);
  await page.reload(); await page.waitForFunction(() => window.READY); await page.waitForTimeout(1500);
  const resumeVisible = await page.evaluate(() => !document.querySelector('[data-ss=resume]').hidden); console.log('resume offered after reload:', resumeVisible);
  if (resumeVisible) { await page.click('[data-ss=resume]'); await page.waitForTimeout(800); console.log('resumed scans:', await page.evaluate(() => [!!T.scans.upper, !!T.scans.lower].join(','))); }
  await shot(O + 'ct-resumed.png');
  console.log('errors:', errors);
  await close();
})();
