// Save a case with every kind of landmark, reopen it in a fresh page, and check nothing changed.
const L = require('./lib.cjs'); const fs = require('fs'); const { execFileSync } = require('child_process');
const summary = () => { const c = APP.calc, r = (v) => (v == null ? null : +v.toFixed(4)); return { w: Object.fromEntries(Object.entries(c.w).map(([k, v]) => [k, r(v)])), ant: r(c.bolton.anterior.ratio), ov: r(c.bolton.overall.ratio), gapsU: c.gaps.upper.map((g) => [g.key, g.kind, r(g.width)]), spaceU: [r(c.space.upper.avail), r(c.space.upper.req)], arch: [r(c.arch.upper.icw), r(c.arch.upper.imw), r(c.arch.upper.depth), r(c.arch.lower.icw), r(c.arch.lower.imw), r(c.arch.lower.depth)], occ: [r(c.occ.overjet), r(c.occ.overbite), r(c.occ.mid)], resto: c.resto.map((x) => [x.key, r(x.contact), r(x.crest), r(x.vert), r(x.spare)]), meas: c.meas.map((m) => [m.t, r(m.d), r(m.ang)]), text: APP.reportText() }; };
(async () => {
  const t0 = Date.now(); let a = await L.open(); let { page, errors } = a;
  await L.loadDemo(page, 1);                                                       // hypodontia demo: exercises missing teeth and spans too
  const truth = await page.evaluate(() => APP.scans.demoTruth);
  // mark 12 and 22 missing through the UI, then click everything else
  for (const f of [12, 22]) { await page.evaluate(() => APP.shell.goto('widths')); await page.click(`#chart [data-f="${f}"]`); await page.click('#wMiss'); }
  await page.click('#chart [data-f="16"]');
  console.log('width clicks:', await L.clickAllWidths(page, L.truthPoint(truth)));
  await page.evaluate(() => APP.shell.goto('arch')); await page.waitForTimeout(200);
  // restorative: crest width by two clicks on the 12 space, planned width, implant sum
  await page.evaluate(() => APP.shell.goto('resto')); await page.waitForTimeout(200);
  const by = {}; for (const t of truth.upper.teeth) by[t.fdi] = t;
  await page.click('[data-r=crest]'); await L.clickWorld(page, [by[13].mesial[0] + 0.3, by[13].mesial[1] - 0.3, 6]); await L.clickWorld(page, [by[11].distal[0] - 0.3, by[11].distal[1] + 0.6, 6]);
  await page.fill('[data-plan="12"]', '6.5'); await page.dispatchEvent('[data-plan="12"]', 'change');
  await page.fill('[data-imp=impD]', '3.3'); await page.dispatchEvent('[data-imp=impD]', 'change'); await page.fill('[data-imp=impC]', '1.5'); await page.dispatchEvent('[data-imp=impC]', 'change');
  // a free distance and an angle
  await page.click('#topBtns button:nth-child(3)'); await page.waitForTimeout(250); await page.click('#viewBtns button:nth-child(7)'); await page.waitForTimeout(200);      // Measure, then Fit
  await L.clickWorld(page, by[16].tip); await L.clickWorld(page, by[26].tip);
  await page.click('#mTool [data-v=a]'); await L.clickWorld(page, by[16].tip); await L.clickWorld(page, by[11].tip); await L.clickWorld(page, by[26].tip);
  await page.click('#mTool [data-v=s]'); await L.clickWorld(page, by[14].tip); await L.clickWorld(page, by[24].tip); await page.waitForTimeout(150);
  { const m = await page.evaluate(() => { const r = document.querySelector('.secp canvas').getBoundingClientRect(), m = APP.sec; return [r.left + m.ox, r.top + m.oy, m.k, m.data.len]; }); await page.mouse.click(m[0] + 1 * m[2], m[1] - 4 * m[2]); await page.mouse.click(m[0] + (m[3] - 1) * m[2], m[1] - 4 * m[2]); }
  // space line: drag one handle so the edited line is saved too
  await page.evaluate(() => APP.shell.goto('space')); await page.waitForTimeout(200);
  const h3 = await page.evaluate(() => APP.calc.space.upper.ctrl[3].toArray()); await L.dragWorld(page, h3, [h3[0], h3[1] + 1.5, h3[2]]);
  await page.evaluate(() => { APP.scans.toCase().data.model = { fromAnotherApp: 42 }; });        // a section this app does not know about
  const before = await page.evaluate(summary), stateBefore = await page.evaluate(() => JSON.stringify(APP.state));
  console.log('before: ant', before.ant, 'ov', before.ov, 'gapsU', JSON.stringify(before.gapsU.filter((g) => g[1] !== 'contact')), 'space', before.spaceU, 'arch', before.arch, 'occ', before.occ, 'resto', JSON.stringify(before.resto), 'meas', JSON.stringify(before.meas));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#topBtns button:nth-child(2)')]);
  const cp = L.O + 't3-case.zip'; await dl.saveAs(cp); console.log('case saved', dl.suggestedFilename(), (fs.statSync(cp).size / 1e6).toFixed(2), 'MB');
  console.log('case.json data keys:', execFileSync('python3', ['-I', '-c', 'import zipfile,json,sys; j=json.load(zipfile.ZipFile(sys.argv[1]).open("case.json")); print(sorted(j["data"].keys()), "teeth:", len(j["data"]["analysis"]["teeth"]), "app:", j["app"])', cp]).toString().trim());
  console.log('errors (first page)', errors); await a.close();
  // fresh page → open the case
  a = await L.open(); page = a.page; errors = a.errors;
  await page.setInputFiles('input[data-ss=file]', [cp]);
  await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 60000 }); await page.waitForTimeout(300);
  const after = await page.evaluate(summary), stateAfter = await page.evaluate(() => JSON.stringify(APP.state));
  console.log('state identical after reopen:', stateBefore === stateAfter, '| derived values identical:', JSON.stringify(before) === JSON.stringify(after));
  if (JSON.stringify(before) !== JSON.stringify(after)) for (const k of Object.keys(before)) if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) console.log('  differs:', k, JSON.stringify(before[k]).slice(0, 300), '→', JSON.stringify(after[k]).slice(0, 300));
  console.log('other app section kept:', await page.evaluate(() => JSON.stringify(APP.scans.toCase().data.model)));
  await page.evaluate(() => APP.shell.goto('widths')); await page.waitForTimeout(300); await a.shot(L.O + 't3-reopened-widths.png');
  await page.evaluate(() => APP.shell.goto('resto')); await page.waitForTimeout(300); await a.shot(L.O + 't3-reopened-resto.png');
  console.log('errors (second page)', errors, (Date.now() - t0) + 'ms');
  await a.close();
})();
