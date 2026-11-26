// Shells inside Scan Card: the tab gets the hub's scans; the tooth and margin marked on Prep check are offered and used;
// the scan before preparation is loaded in the tab; a provisional crown is made, downloaded, kept in the case file, and
// comes back in a fresh Scan Card.
const { openHub, ok, OUT, DATA } = require('./lib.cjs');
const fs = require('fs');
(async () => {
  const T = JSON.parse(fs.readFileSync(DATA + 'prep-truth.json'));
  const a = await openHub(), { page } = a;
  await page.setInputFiles('input[data-ss=file]', [DATA + 'prep-lower.stl', DATA + 'prep-upper.stl']);
  await page.waitForFunction(() => APP.scans.has('upper') && APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 });
  ok(await page.evaluate(() => APP.TOOLS.some((t) => t.id === 'shell') && !!document.querySelector('#tabs [data-tab=shell]')), 'Scan Card has a Shells tab');
  // mark 46 on Prep check
  const pr = await a.go('prep');
  await pr.evaluate((T) => { const M = APP.scans.lower.matrix, V = (p) => new APP.THREE.Vector3(...p).applyMatrix4(M).toArray(); APP.P.jaw = 'lower'; APP.P.seed = V(T.seed); APP.P.loop = T.loop.map(V); APP.analyse(); APP.scans.touch(); }, T);
  const sh = await a.go('shell');
  const got = await sh.evaluate(() => ({ lower: APP.scans.has('lower'), prep: !!APP.PREP }));
  ok(got.lower && got.prep, 'Shells has the hub’s scans and Prep check’s marking');
  await sh.evaluate(() => APP.shell.goto('teeth')); await a.idle(sh);
  ok(await sh.isVisible('#tPrep'), '“Use Prep check’s margin” is offered on the Teeth step');
  await sh.click('#tPrep'); const mk = await sh.evaluate(() => ({ seed: !!APP.P.seed, n: APP.P.loop.length }));
  ok(mk.seed && mk.n === T.loop.length, `…and used: the tooth and ${mk.n} margin points`);
  await sh.evaluate(() => APP.shell.goto('shape')); await sh.setInputFiles('#shIn', DATA + 'shell-preop-moved.stl'); await a.idle(sh);
  ok((await sh.evaluate(() => APP.S.fit && APP.S.fit.rms)) < 0.03, 'the scan before preparation lined up inside the hub');
  await sh.evaluate(() => APP.shell.goto('design')); await sh.click('#dBuild'); await a.idle(sh); await sh.waitForFunction(() => APP.B && APP.B.info, null, { timeout: 120000 });
  const bi = await sh.evaluate(() => APP.B.info);
  ok(bi.closed && bi.volume > 100, `provisional crown made inside the hub: closed, ${bi.volume.toFixed(1)} mm³`);
  await sh.evaluate(() => APP.shell.goto('export')); await a.idle(sh);
  const [dl] = await Promise.all([page.waitForEvent('download'), sh.click('#xStl')]); const stl = OUT + 'h15-provisional.stl'; await dl.saveAs(stl);
  const buf = fs.readFileSync(stl), n = buf.readUInt32LE(80); ok(buf.length === 84 + 50 * n && n === bi.tris && dl.suggestedFilename() === 'provisional-lower.stl', `STL through the hub: ${dl.suggestedFilename()}, ${n} triangles`);
  await a.go('scans');
  const kept = await page.evaluate(() => { const c = APP.buildCase(); return { roles: c.items.map((i) => i.role).sort().join(), shell: c.data.shell && c.data.shell.mode, prep: !!c.data.prep }; });
  ok(kept.roles === 'lower-scan,shell-part,shell-shape,upper-scan' && kept.shell === 'crown' && kept.prep, `the case holds the crown, the scan before preparation and both tools’ settings: ${kept.roles}`);
  const [dc] = await Promise.all([page.waitForEvent('download'), page.click('#topBtns button:nth-child(2)')]); const zip = OUT + 'h15-case.zip'; await dc.saveAs(zip);
  const errs = a.errors.filter((e) => !/font-src/.test(e)); ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await a.close();
  const b = await openHub(), p2 = b.page; await p2.setInputFiles('input[data-ss=file]', zip); await p2.waitForFunction(() => APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 });
  const s2 = await b.go('shell'); const re = await s2.evaluate(() => ({ vol: APP.B && APP.N.meshVolume(APP.B.mesh), shape: !!(APP.S.shape && APP.S.rel), mode: APP.P.mode }));
  ok(re.mode === 'crown' && re.shape && Math.abs(re.vol - bi.volume) < 0.01, `a fresh Scan Card opens the case with the crown (${re.vol && re.vol.toFixed(1)} mm³) and the scan before preparation`);
  const e2 = b.errors.filter((e) => !/font-src/.test(e)); ok(e2.length === 0, 'no page errors (reopened) ' + e2.slice(0, 3).join(' | '));
  await b.close();
})();
