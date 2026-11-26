// CBCT inside Scan Card: the tab opens with no intraoral scans; a CBCT folder is opened in the tab; arch, a measurement and a
// donor-tooth replica are made; the replica downloads through the hub; the CBCT work does not lock the scans; Save case keeps
// the CBCT work and the replica (and not one of the fake patient details); a fresh Scan Card opening that case puts the work
// back once the same CBCT is opened in the tab.
const { openHub, ok, OUT } = require('./lib.cjs');
const fs = require('fs');
const CB = '/home/claude/suite/dev/data/cbct/';
(async () => {
  const truth = JSON.parse(fs.readFileSync(CB + 'truth.json')), fakes = [...new Set(Object.values(truth.fake).flatMap((v) => [v, ...v.split(/[\^ ]/).filter((p) => p.length >= 6)]))];
  const a = await openHub(), { page } = a;
  ok(await page.evaluate(() => APP.TOOLS.some((t) => t.id === 'cbct' && t.scans === false) && !!document.querySelector('#tabs [data-tab=cbct]')), 'Scan Card has a CBCT tab');
  const fr = await a.go('cbct');
  ok(await fr.evaluate(() => !!APP.S && APP.N.EMBED && !APP.S.vol), 'the CBCT tab opens with no intraoral scans loaded');
  const off = await page.evaluate(() => { const r = document.querySelector('iframe[data-tool=cbct]').getBoundingClientRect(); return [r.left, r.top]; });
  await fr.setInputFiles('#lFolderIn', CB + 'a-explicit'); await fr.waitForFunction(() => APP.S.vol, null, { timeout: 120000 }); await a.idle(fr);
  const v = await fr.evaluate((s) => { const v = APP.S.vol; let bad = 0; for (const [i, j, k, val] of s) if (v.data[i + v.dims[0] * (j + v.dims[1] * k)] + v.shift !== val) bad++; return { dims: v.dims, bad }; }, truth.variants['a-explicit'].samples);
  ok(v.bad === 0 && v.dims.join() === '242,207,111', `a CBCT folder opened inside the tab: ${v.dims.join('×')}, ${v.bad} voxels wrong`);
  await page.screenshot({ path: OUT + 'h20-cbct-slices.png' });
  // arch, a measurement on the panoramic, a donor tooth and its replica
  await fr.click('.step[data-id=pano] h3'); await a.idle(fr); await fr.click('#pPropose'); await a.idle(fr); await fr.waitForFunction(() => APP.S.pano, null, { timeout: 60000 });
  const pts = await fr.evaluate(() => { const v = APP.views.pan, V = APP.S.vol, s = APP.S.arch.curve.length / 2, r = v.cv.getBoundingClientRect(), f = (z) => { const b = (V.dims[2] - 1 - (z - V.origin[2]) / V.spacing[2] + 0.5) * V.spacing[2], [X, Y] = APP.toScreen(v, s, b); return [r.left + X, r.top + Y]; }; return [f(2), f(-8)]; });
  await fr.click('#cbTool [data-v=dist]'); for (const p of pts) { await page.mouse.click(off[0] + p[0], off[1] + p[1]); await page.waitForTimeout(100); }
  const meas = await fr.evaluate(() => APP.S.measures.map((m) => m.value));
  ok(meas.length === 1 && Math.abs(meas[0] - 10) < 0.05, `a 10 mm measurement on the panoramic inside the hub: ${meas[0] && meas[0].toFixed(2)} mm`);
  await fr.click('.step[data-id=tooth] h3'); await a.idle(fr);
  const seed = await fr.evaluate(() => { const D = APP.D, t = D.phantomTeeth().find((x) => x.name === 45), p = [0, 1, 2].map((q) => t.base[q] + t.w[q] * t.crown * 0.3); APP.S.cur[2] = Math.round(D.voxelOf(APP.S.vol, 0, 0, p[2])[2]); APP.crossChanged(); return p; });
  await page.waitForTimeout(300);
  const xy = await fr.evaluate((p) => { const v = APP.views.ax, q = APP.D.voxelOf(APP.S.vol, ...p), [a, b] = APP.fromVox(v, ...q), [X, Y] = APP.toScreen(v, a, b), r = v.cv.getBoundingClientRect(); return [r.left + X, r.top + Y]; }, seed);
  await page.mouse.click(off[0] + xy[0], off[1] + xy[1]); await a.idle(fr); await fr.waitForFunction(() => APP.S.tooth.seg, null, { timeout: 120000 });
  await fr.click('.step[data-id=replica] h3'); await a.idle(fr); await fr.click('#rMake'); await a.idle(fr); await fr.waitForFunction(() => APP.S.rep.info, null, { timeout: 120000 });
  const rep = await fr.evaluate(() => APP.S.rep.info);
  const [dl] = await Promise.all([page.waitForEvent('download'), fr.click('#rStl')]); const stl = OUT + 'h20-replica.stl'; await dl.saveAs(stl);
  const sb = fs.readFileSync(stl), n = sb.readUInt32LE(80);
  ok(rep.closed && Math.abs(rep.volume - 422) < 13 && sb.length === 84 + 50 * n && n === rep.tris && dl.suggestedFilename() === 'tooth-replica.stl', `replica made inside the hub (${rep.volume.toFixed(0)} mm³, closed) and downloaded through it: ${dl.suggestedFilename()}, ${n} triangles`);
  await page.screenshot({ path: OUT + 'h20-cbct-replica.png' });
  // the scans: not locked by the CBCT work; then a case with them
  await a.go('scans');
  ok(!(await page.evaluate(() => APP.isLocked())) && (await page.evaluate(() => APP.users().length)) === 0, 'the CBCT work does not lock the Scans tab');
  await a.demo();
  const kept = await page.evaluate(() => { const c = APP.buildCase(); return { roles: c.items.map((i) => i.role).sort().join(), cbct: c.data.cbct && { arch: c.data.cbct.arch.length, measures: c.data.cbct.measures.length, tooth: !!c.data.cbct.tooth, replica: !!c.data.cbct.replica } }; });
  ok(kept.roles === 'cbct-replica,lower-scan,upper-scan' && kept.cbct && kept.cbct.arch >= 5 && kept.cbct.measures === 1 && kept.cbct.tooth && kept.cbct.replica, `the case holds the scans, the replica and the CBCT work: ${kept.roles} · ${JSON.stringify(kept.cbct)}`);
  const [dc] = await Promise.all([page.waitForEvent('download'), page.click('#topBtns button:nth-child(2)')]); const zip = OUT + 'h20-case.zip'; await dc.saveAs(zip);
  const N = await import('/home/claude/suite/shared/core.js'), entries = await N.unzip(fs.readFileSync(zip).buffer.slice(0));
  const all = entries.map((e) => Buffer.from(e.data).toString('latin1')).join('\n'), cj = JSON.parse(Buffer.from(entries.find((e) => e.name === 'case.json').data).toString('utf8'));
  const leaks = fakes.filter((s) => all.includes(s)), dom = (await fr.evaluate(() => document.documentElement.outerHTML)) + (await page.evaluate(() => document.documentElement.outerHTML)), domLeaks = fakes.filter((s) => dom.includes(s));
  ok(leaks.length === 0 && domLeaks.length === 0 && !/2024-?03-?15|20240315/.test(JSON.stringify(cj.data.cbct)), `saved case (${entries.length} files): none of the ${fakes.length} fake details in it or in either page's DOM, no scan date in the CBCT section: ${[...leaks, ...domLeaks].join(', ') || 'none'}`);
  const errs = a.errors.filter((e) => !/font-src/.test(e)); ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await a.close();
  // a fresh Scan Card: open the case, then the same CBCT in the tab — the work comes back
  const b = await openHub(), p2 = b.page;
  await p2.setInputFiles('input[data-ss=file]', zip); await p2.waitForFunction(() => APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 });
  const f2 = await b.go('cbct');
  ok(await f2.evaluate(() => !!APP.S.pending && !!APP.S.rep.mesh), 'the reopened case hands its CBCT work and replica to the tab');
  await f2.setInputFiles('#lFolderIn', CB + 'a-explicit'); await f2.waitForFunction(() => APP.S.vol && !APP.S.pending, null, { timeout: 120000 }); await b.idle(f2); await f2.waitForFunction(() => APP.S.tooth.seg, null, { timeout: 120000 });
  const back = await f2.evaluate(() => ({ arch: APP.S.arch.points.length, m: APP.S.measures.length && APP.S.measures[0].value, seg: APP.S.tooth.seg && APP.S.tooth.seg.volume }));
  ok(back.arch === kept.cbct.arch && Math.abs(back.m - meas[0]) < 1e-6 && Math.abs(back.seg - 420) < 13, `…and once the same CBCT is opened there, it is put back: ${back.arch} arch points, the ${back.m.toFixed(2)} mm measurement, the tooth (${back.seg && back.seg.toFixed(0)} mm³)`);
  const e2 = b.errors.filter((e) => !/font-src/.test(e)); ok(e2.length === 0, 'no page errors (reopened) ' + e2.slice(0, 3).join(' | '));
  await b.close();
})().catch((e) => { console.error(e); process.exitCode = 1; });
