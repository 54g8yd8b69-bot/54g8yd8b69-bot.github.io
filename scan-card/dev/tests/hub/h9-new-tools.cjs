// Scan Card with the three additions: Prep check (on the prepared demo arch), Compare (made-up After) and Splint guidance —
// all inside the hub on one pair of scans, saved in one case file and read back in a fresh Scan Card.
const { openHub, ok, OUT, DATA } = require('./lib.cjs');
const fs = require('fs');
(async () => {
  const T = JSON.parse(fs.readFileSync(DATA + 'prep-truth.json'));
  const a = await openHub(), { page } = a;
  await page.setInputFiles('input[data-ss=file]', [DATA + 'prep-lower.stl', DATA + 'prep-upper.stl']);
  await page.waitForFunction(() => APP.scans.has('upper') && APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 });
  // ── Prep check
  const pr = await a.go('prep');
  const pe = await pr.evaluate(() => ({ embed: APP.N.EMBED, hidden: [...document.querySelectorAll('.step')].filter((s) => s.hidden).map((s) => s.dataset.id).join(), step: APP.shell.steps[APP.shell.current].id }));
  ok(pe.embed && pe.hidden === 'load,orient' && pe.step === 'tooth', 'Prep check inside Scan Card: starts at “The prepared tooth”, loading steps hidden');
  const fig = await pr.evaluate((T) => { const M = APP.scans.lower.matrix, V = (p) => new APP.THREE.Vector3(...p).applyMatrix4(M).toArray(); APP.P.jaw = 'lower'; APP.P.seed = V(T.seed); APP.P.loop = T.loop.map(V); APP.P.dir = new APP.THREE.Vector3(0, 0, 1).transformDirection(M).toArray(); APP.analyse(); APP.scans.touch(); APP.shell.goto('check'); const s = APP.R.sides; return { b: s.buccal.angle, l: s.lingual.angle, md: APP.R.tocMD, clear: APP.R.clear && APP.R.clear.min, text: APP.figuresText() }; }, T);
  ok(Math.abs(fig.b - 6) < 1 && Math.abs(fig.l + 6) < 1 && Math.abs(fig.md - 12) < 1.5 && fig.clear > 1, `figures as on its own: buccal ${fig.b.toFixed(1)}°, lingual ${fig.l.toFixed(1)}°, MD convergence ${fig.md.toFixed(1)}°, clearance ${fig.clear.toFixed(2)} mm (uses the hub's opposing arch)`);
  await page.waitForTimeout(300); await a.shot(OUT + 'h9-prep.png');
  // ── Compare
  const cm = await a.go('compare');
  ok(await cm.evaluate(() => APP.shell.steps[APP.shell.current].id === 'second'), 'Compare inside Scan Card: starts at “Second scan”');
  await cm.click('#cmJaw [data-v=lower]'); await cm.click('#cmMade'); await a.idle(cm);
  const cs = await cm.evaluate(() => ({ rms: APP.C.fit.rms, lo: APP.C.stats.lo }));
  ok(cs.rms < 0.01 && Math.abs(cs.lo + 0.5) < 0.04, `made-up After lined up (fit ${cs.rms.toFixed(4)} mm), wear ${cs.lo.toFixed(3)} mm`);
  await cm.evaluate(() => APP.shell.goto('map')); await page.waitForTimeout(400); await a.shot(OUT + 'h9-compare.png');
  // ── Splint with guidance (upper splint, lower opposing)
  const sp = await a.go('splint');
  await sp.evaluate(() => APP.shell.goto('appliance')); await sp.click('#apJaw [data-v=upper]'); await sp.click('#apType [data-v=flat]');
  await sp.evaluate(() => APP.shell.goto('shell')); await a.idle(sp); await sp.check('#shUse'); await a.idle(sp); await sp.click('#shAuto'); await a.idle(sp);
  await sp.check('#gdOn'); await a.idle(sp); await sp.waitForFunction(() => APP.D.res && !APP.D.dirty, null, { timeout: 300000 });
  const gs = await sp.evaluate(() => ({ ramps: APP.D.res.report.ramps, exc: ['right', 'left', 'forward'].map((k) => APP.D.exc[k][1]) }));
  ok(gs.ramps && gs.ramps.length === 3 && gs.exc.every((q) => q.guide === 'front'), 'Splint inside Scan Card: three ramps, back teeth clear in all excursions: ' + gs.exc.map((q) => q.back.toFixed(2)).join(', '));
  await page.waitForTimeout(300); await a.shot(OUT + 'h9-splint-guidance.png');
  // ── back to the Scans tab: all three hold work; save
  await a.go('scans');
  const users = await page.evaluate(() => APP.users().join());
  ok(users === 'Splint,Compare,Prep check', 'the Scans tab lists Splint, Compare and Prep check as holding work: ' + users);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#topBtns button:nth-child(2)')]); const f1 = OUT + 'h9-case.zip'; await dl.saveAs(f1);
  const kept = await page.evaluate(() => { const c = APP.buildCase(); return c.items.map((i) => i.role).sort().join() + ' / ' + Object.keys(c.data).sort().join(); });
  ok(kept === 'compare-second,lower-scan,splint,upper-scan / compare,prep,splint', 'the case holds the After scan, the splint and all three tools’ settings: ' + kept);
  ok(a.errors.length === 0, 'no page errors ' + a.errors.slice(0, 3).join(' | '));
  await a.close();
  // ── a fresh Scan Card reads it back
  const b = await openHub(), p2 = b.page;
  await p2.setInputFiles('input[data-ss=file]', f1); await p2.waitForFunction(() => APP.scans.has('upper') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 });
  const pr2 = await b.go('prep'); ok(await pr2.evaluate(() => APP.figuresText()) === fig.text, 'Prep check: identical figures from the case file');
  const cm2 = await b.go('compare'); const c2 = await cm2.evaluate(() => APP.C.stats && APP.C.stats.lo); ok(Math.abs(c2 - cs.lo) < 1e-6, 'Compare: the After scan and its position are back (same wear figure)');
  const sp2 = await b.go('splint'); const s2 = await sp2.evaluate(() => ({ g: APP.P.guide, built: !!APP.D.res && !APP.D.dirty, ramps: APP.D.res && APP.D.res.report.ramps }));
  ok(s2.g && s2.built && s2.ramps && s2.ramps.length === 3, 'Splint: guidance settings and the built splint with its ramps are back without rebuilding');
  ok(b.errors.length === 0, 'no page errors in the fresh Scan Card ' + b.errors.slice(0, 3).join(' | '));
  await b.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
