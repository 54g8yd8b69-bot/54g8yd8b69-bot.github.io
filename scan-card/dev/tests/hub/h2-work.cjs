// Scan Card: real work done inside the tools — widths clicked in Analysis, a splint built, hollow models — survives tab
// switches, goes into one case file, and comes back in a fresh Scan Card and in a stand-alone tool page.
const { openHub, openApp, ok, OUT } = require('./lib.cjs');
const fs = require('fs');
(async () => {
  const a = await openHub(), { page } = a;
  await a.demo();
  const truth = await page.evaluate(() => APP.scans.demoTruth);
  // ── Analysis: all tooth widths, clicked on the truth contact points
  const an = await a.go('analysis');
  let n = 0;
  for (let guard = 0; guard < 80; guard++) {
    const cur = await an.evaluate(() => APP.ui.cur && { f: APP.ui.cur.f, k: APP.ui.cur.k }); if (!cur) break;
    const jaw = cur.f < 30 ? 'upper' : 'lower', t = truth[jaw].teeth.find((x) => x.fdi === cur.f), p = t && t[cur.k === 'm' ? 'mesialPick' : 'distalPick']; if (!p) break;
    await a.clickWorld('analysis', p); n++;
    await an.waitForFunction((c) => !APP.ui.cur || APP.ui.cur.f !== c.f || APP.ui.cur.k !== c.k, cur, { timeout: 5000 });
  }
  const got = await an.evaluate(() => ({ w: APP.calc.w, bolton: APP.calc.bolton }));
  let worst = 0, cnt = 0; for (const jaw of ['upper', 'lower']) for (const t of truth[jaw].teeth) { if (t.fdi % 10 > 6) continue; cnt++; worst = Math.max(worst, Math.abs(got.w[t.fdi] - t.width)); }
  ok(n === 48 && cnt === 24 && worst < 0.2, `Analysis inside Scan Card: ${n} clicks, 24 widths, worst ${worst.toFixed(3)} mm from the designed widths (stand-alone test: 0.14)`);
  ok(got.bolton && got.bolton.overall && Number.isFinite(got.bolton.overall.ratio), `Bolton overall ${got.bolton.overall.ratio.toFixed(2)} %, anterior ${got.bolton.anterior.ratio.toFixed(2)} %`);
  await a.shot(OUT + 'h2-analysis-widths.png');
  // ── Splint: default design, built
  const sp = await a.go('splint');
  await sp.evaluate(() => APP.shell.goto('check'));
  await sp.waitForFunction(() => APP.D.res && !APP.D.dirty && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 });
  const srep = await sp.evaluate(() => ({ jaw: APP.D.jaw, wt: APP.D.res.report.watertight, vol: APP.D.res.report.volume, tris: APP.D.meshCase.indices.length / 3 }));
  ok(srep.wt && srep.vol > 500, `Splint inside Scan Card: built on the ${srep.jaw} arch, watertight, ${(srep.vol / 1000).toFixed(2)} mL, ${srep.tris} triangles`);
  await a.shot(OUT + 'h2-splint-built.png');
  // ── Models: hollow
  const mo = await a.go('model');
  await mo.waitForFunction(() => APP.A.lower.model && !APP.A.lower.dirty, null, { timeout: 240000 });
  await mo.evaluate(async () => { APP.P.hollow = true; await APP.rebuild(); }); await a.idle(mo);
  const mrep = await mo.evaluate(() => ['upper', 'lower'].map((j) => ({ v: APP.A[j].info.volume, c: APP.A[j].info.cavity, wt: APP.A[j].info.watertight, tris: APP.A[j].model.indices.length / 3 })));
  ok(mrep.every((r) => r.wt && r.c > 0), `Models inside Scan Card: both hollow and watertight (${mrep.map((r) => (r.v / 1000).toFixed(1) + ' mL').join(', ')})`);
  // a download made by a tool goes through the hub page
  await mo.evaluate(() => APP.shell.goto('export'));
  const [dlm] = await Promise.all([page.waitForEvent('download'), mo.click('#exStl')]);
  const fm = OUT + 'h2-models.zip'; await dlm.saveAs(fm);
  ok(dlm.suggestedFilename() === 'models.zip' && fs.statSync(fm).size > 1e6, `“Download STL” inside Models saves ${dlm.suggestedFilename()} (${(fs.statSync(fm).size / 1e6).toFixed(1)} MB) through the hub`);
  // “Save case” inside a tool = the hub's save, with everything in it
  const [dl] = await Promise.all([page.waitForEvent('download'), mo.click('#exCase')]);
  const f1 = OUT + 'h2-case.zip'; await dl.saveAs(f1);
  ok(/^case-/.test(dl.suggestedFilename()), `“Save case” inside Models saves the hub's case (${(fs.statSync(f1).size / 1e6).toFixed(1)} MB)`);
  const inCase = await page.evaluate(() => { const c = APP.buildCase(); return { roles: c.items.map((i) => i.role).sort().join(), keys: Object.keys(c.data).sort().join(), hollow: c.data.model.params.hollow, widths: Object.keys((c.data.analysis && (c.data.analysis.widths || c.data.analysis.w || c.data.analysis.pts || {})) || {}).length }; });
  ok(inCase.roles === 'lower-model,lower-scan,splint,upper-model,upper-scan' && inCase.keys === 'analysis,model,splint' && inCase.hollow === true, 'the case holds scans, both models, the splint and all three tools’ settings: ' + JSON.stringify(inCase));
  ok(a.errors.length === 0, 'no page errors so far ' + a.errors.slice(0, 3).join(' | '));
  await a.close();

  // ── a fresh Scan Card opens that file
  const b = await openHub();
  await b.page.setInputFiles('input[data-ss=file]', f1);
  await b.page.waitForFunction(() => APP.scans.has('upper') && APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 });
  ok(await b.page.evaluate(() => APP.TOOLS.filter((t) => t.kind === 'case').every((t) => APP.valid(t))), 'opened in a fresh Scan Card: the work of all three tools counts as made on these scans');
  const an2 = await b.go('analysis');
  const got2 = await an2.evaluate(() => ({ w: APP.calc.w, bolton: APP.calc.bolton }));
  ok(JSON.stringify(got2.w) === JSON.stringify(got.w) && got2.bolton.overall.ratio === got.bolton.overall.ratio, 'Analysis: every width and the Bolton result are back, identical');
  const sp2 = await b.go('splint');
  const s2 = await sp2.evaluate(() => ({ has: !!APP.D.res, dirty: APP.D.dirty, jaw: APP.D.jaw, tris: APP.D.meshCase ? APP.D.meshCase.indices.length / 3 : 0 }));
  ok(s2.has && !s2.dirty && s2.jaw === srep.jaw && s2.tris === srep.tris, 'Splint: the built splint is back without rebuilding (' + JSON.stringify(s2) + ')');
  const t0 = Date.now(), mo2 = await b.go('model');
  const m2 = await mo2.evaluate(() => ({ hollow: APP.P.hollow, r: ['upper', 'lower'].map((j) => ({ has: !!APP.A[j].model, dirty: APP.A[j].dirty, tris: APP.A[j].model ? APP.A[j].model.indices.length / 3 : 0, v: APP.A[j].info && APP.A[j].info.volume })) }));
  ok(m2.hollow && m2.r.every((r, i) => r.has && !r.dirty && r.tris === mrep[i].tris && Math.abs(r.v - mrep[i].v) < 1e-6), `Models: both hollow models are back without rebuilding (${Date.now() - t0} ms to open the tab)`);
  await b.shot(OUT + 'h2-reopened-models.png');
  ok(b.errors.length === 0, 'no page errors in the fresh Scan Card ' + b.errors.slice(0, 3).join(' | '));
  await b.close();

  // ── and the stand-alone Analysis page opens the same file
  const c = await openApp('analysis-card', { width: 1400, height: 900 });
  await c.page.waitForFunction(() => window.APP);
  await c.page.setInputFiles('input[data-ss=file]', f1);
  await c.page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 });
  const got3 = await c.page.evaluate(() => APP.calc.w);
  ok(JSON.stringify(got3) === JSON.stringify(got.w), 'the stand-alone Analysis Card page reads the same widths from the Scan Card case');
  ok(c.errors.length === 0, 'no page errors stand-alone ' + c.errors.slice(0, 3).join(' | '));
  await c.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
