// Obturator inside Scan Card: the tab gets the hub's scans (the synthetic maxilla with a defect, mkobt.mjs, in its own position); plate
// outline points are tapped with real clicks through the hub's page; a hollow-bulb obturator is made from the full design, downloaded
// through the hub, kept in the case file, and comes back in a fresh Scan Card.
const { openHub, ok, OUT, DATA } = require('./lib.cjs');
const fs = require('fs');
(async () => {
  const T = JSON.parse(fs.readFileSync(DATA + 'obt-truth.json'));
  const a = await openHub(), { page } = a;
  await page.setInputFiles('input[data-ss=file]', [DATA + 'obt-defect-upper.stl', DATA + 'obt-lower.stl']);
  await page.waitForFunction(() => APP.scans.has('upper') && APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 });
  ok(await page.evaluate(() => APP.TOOLS.some((t) => t.id === 'obturator') && !!document.querySelector('#tabs [data-tab=obturator]')), 'Scan Card has an Obturator tab');
  await page.evaluate(() => APP.shell.goto('orient')); await page.click('[data-so=raw]'); await page.waitForTimeout(300);   // the synthetic scans' own frame is the case frame
  // a path set on Survey (upper arch, front up 5°, patient's right up 2°) is offered on the Obturator tab
  const sv = await a.go('survey'); await sv.click('#pJaw [data-v=upper]'); await a.idle(sv); await sv.evaluate(() => APP.setTilt(5, -2)); await sv.waitForTimeout(300); await a.idle(sv);
  const ob = await a.go('obturator');
  const got = await ob.evaluate(() => ({ upper: APP.scans.has('upper'), id: APP.scans.upper.matrix.equals(new APP.THREE.Matrix4()), hidden: APP.shell.stepEl('load').hidden && APP.shell.stepEl('orient').hidden }));
  ok(got.upper && got.id && got.hidden, 'the Obturator tab has the hub’s scans, in their own position, and no loading steps of its own');
  await ob.evaluate(() => APP.shell.goto('path')); await a.idle(ob);
  const offered = await ob.evaluate(() => ({ surv: APP.SURV, shown: !document.getElementById('pSurvey').hidden }));
  await ob.click('#pSurvey'); await a.idle(ob); const used = await ob.evaluate(() => [APP.P.ap, APP.P.lat]);
  ok(offered.shown && offered.surv && offered.surv.ap === 5 && offered.surv.lat === -2 && used[0] === 5 && used[1] === -2, `Survey’s path is offered (“Use Survey’s path”) and used: front up ${used[0]}°, left/right ${used[1]}°`);
  await ob.click('#pLevel'); await a.idle(ob);
  // real taps on the palate, through the hub's page
  await ob.evaluate(() => APP.shell.goto('outline')); await a.idle(ob); await ob.evaluate(() => APP.viewer.setView('bottom')); await ob.waitForTimeout(400);
  const targets = T.outline.filter((p) => p[0] < -6 && p[1] > -16).slice(0, 5);
  for (const p of targets) { await a.clickWorld('obturator', p); await ob.waitForTimeout(250); }
  const taps = await ob.evaluate(() => APP.P.outline.slice());
  const off = targets.map((p, i) => (taps[i] ? Math.hypot(taps[i][0] - p[0], taps[i][1] - p[1], taps[i][2] - p[2]) : Infinity));
  ok(taps.length === targets.length && Math.max(...off) < 0.3, `${taps.length} outline points tapped with real clicks land where they were aimed (within ${Math.max(...off).toFixed(2)} mm)`);
  await a.shot(OUT + 'h18-taps.png');
  // the full design, made inside the hub
  await ob.evaluate((T) => { APP.P.outline = T.outline; APP.P.margin = T.rim; APP.shell.goto('design'); }, T); await a.idle(ob);
  await ob.click('#dBuild'); await a.idle(ob); await ob.waitForFunction(() => APP.B && APP.B.info, null, { timeout: 600000 });
  const bi = await ob.evaluate(() => APP.B.info);
  ok(bi.closed && bi.manifold && bi.shells === 2 && bi.thinnest >= 1.94, `hollow-bulb obturator made inside the hub: closed, ${bi.volume.toFixed(0)} mm³, ${bi.saving.toFixed(2)} g saved by the hollow, thinnest wall ${bi.thinnest.toFixed(3)} mm, in ${bi.seconds.toFixed(1)} s`);
  await a.shot(OUT + 'h18-obturator.png');
  await ob.evaluate(() => APP.shell.goto('export')); await a.idle(ob);
  const [dl] = await Promise.all([page.waitForEvent('download'), ob.click('#xStl')]); const stl = OUT + 'h18-obturator.stl'; await dl.saveAs(stl);
  const buf = fs.readFileSync(stl), n = buf.readUInt32LE(80); ok(buf.length === 84 + 50 * n && n === bi.tris && dl.suggestedFilename() === 'obturator-upper.stl', `STL through the hub: ${dl.suggestedFilename()}, ${n} triangles`);
  await a.go('scans');
  const kept = await page.evaluate(() => { const c = APP.buildCase(); return { roles: c.items.map((i) => i.role).sort().join(), margin: c.data.obturator && c.data.obturator.margin.length, kind: c.data.obturator && c.data.obturator.info && c.data.obturator.info.kind }; });
  ok(kept.roles === 'lower-scan,obturator,upper-scan' && kept.margin === T.rim.length && kept.kind === 'closed', `the case holds the obturator and its design: ${kept.roles}`);
  const [dc] = await Promise.all([page.waitForEvent('download'), page.click('#topBtns button:nth-child(2)')]); const zip = OUT + 'h18-case.zip'; await dc.saveAs(zip);
  const errs = a.errors.filter((e) => !/font-src/.test(e)); ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await a.close();
  const b = await openHub(), p2 = b.page; await p2.setInputFiles('input[data-ss=file]', zip); await p2.waitForFunction(() => APP.scans.has('upper') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 });
  const o2 = await b.go('obturator'); const re = await o2.evaluate(() => ({ vol: APP.B && APP.N.meshVolume(APP.B.mesh), m: APP.P.margin.length, n: APP.P.outline.length }));
  ok(re.vol && Math.abs(re.vol - bi.volume) < 0.01 && re.m === T.rim.length && re.n === T.outline.length, `a fresh Scan Card opens the case with the obturator (${re.vol && re.vol.toFixed(0)} mm³) and its margin and outline`);
  const e2 = b.errors.filter((e) => !/font-src/.test(e)); ok(e2.length === 0, 'no page errors (reopened) ' + e2.slice(0, 3).join(' | '));
  await b.close();
})();
