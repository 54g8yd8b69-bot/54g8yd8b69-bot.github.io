// Scan Card with the Survey tab: it appears, takes the hub's scans (the demo pair), surveys the lower arch along a tilted path,
// marks abutments (one with a clasp tip kept), blocks out; the case file keeps the path, the teeth and the blocked-out model,
// and a fresh Scan Card reads it back without rebuilding.
const { openHub, ok, OUT } = require('./lib.cjs');
const fs = require('fs');
(async () => {
  const a = await openHub(), { page } = a;
  const tabs = await page.evaluate(() => [...document.querySelectorAll('#tabs button')].map((b) => b.textContent.trim()).join(','));
  ok(/Prep check,Survey,Shells,Trays/.test(tabs), 'the Survey tab sits after Prep check, then Shells and Trays: ' + tabs);
  ok(await page.evaluate(() => !!document.querySelector('.tool[data-tool=survey]')), 'and has its card on “Choose a tool”');
  await a.demo();
  const sv = await a.go('survey');
  const se = await sv.evaluate(() => ({ embed: APP.N.EMBED, hidden: [...document.querySelectorAll('.step')].filter((s) => s.hidden).map((s) => s.dataset.id).join(), step: APP.shell.steps[APP.shell.current].id, both: APP.scans.has('upper') && APP.scans.has('lower'), jaw: APP.P.jaw, surveyed: !!APP.A }));
  ok(se.embed && se.hidden === 'load,orient' && se.step === 'path' && se.both && se.surveyed, `Survey inside Scan Card: starts at “Path of insertion” with both scans, loading steps hidden, the ${se.jaw} arch surveyed`);
  // same scans as the hub
  const same = await page.evaluate(() => ['upper', 'lower'].map((j) => APP.N.crc32(new Uint8Array(APP.scans[j].raw.positions.buffer))).join()) === await sv.evaluate(() => ['upper', 'lower'].map((j) => APP.N.crc32(new Uint8Array(APP.scans[j].raw.positions.buffer))).join());
  ok(same, 'it has exactly the hub’s scans');
  await sv.click('#pJaw [data-v=lower]');
  // tilt with the real slider (keyboard), then let go
  await sv.evaluate(() => { const r = document.getElementById('pAp'); r.value = 6; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); }); await sv.waitForFunction(() => APP.A && APP.A.key.startsWith('lower|6|0|'), null, { timeout: 60000 }).catch(() => {}); await a.idle(sv);
  const t = await sv.evaluate(() => ({ ap: APP.P.ap, key: APP.A && APP.A.key.split('|').slice(0, 3).join('|'), seg: APP.A && APP.A.seg.length }));
  ok(t.ap === 6 && t.key === 'lower|6|0' && t.seg > 600, `slider set the path to front up 6° and the arch was surveyed again (${t.seg / 6} survey line pieces)`);
  await sv.evaluate(() => APP.shell.goto('teeth')); await a.idle(sv);
  // tap two abutments through the real page (frame offset included)
  const pts = await sv.evaluate(() => { const T = APP.A, m = T.mesh.positions, find = (x, y) => { let best = -1, bd = 1e9; for (let v = 0; v < m.length / 3; v++) { const d = (m[3 * v] - x) ** 2 + (m[3 * v + 1] - y) ** 2 - 0.02 * m[3 * v + 2]; if (d < bd) { bd = d; best = v; } } return [m[3 * best], m[3 * best + 1], m[3 * best + 2]]; }; return [find(-18.4, -2.3), find(21.5, 6.2)]; });   // near the demo's 45 and 36
  await sv.evaluate(() => { APP.viewer.setView('top'); }); await sv.waitForTimeout(300);
  for (const p of pts) { await a.clickWorld('survey', p); await sv.waitForTimeout(300); }
  const teeth = await sv.evaluate(() => APP.P.teeth.map((t) => t.fdi));
  ok(teeth.length === 2 && teeth.join() === '45,36', 'two taps on the model added 45 and 36 as abutments: ' + teeth.join());
  await sv.evaluate(() => { const i = APP.P.teeth.findIndex((t) => t.fdi === 36); APP.P.sel = i; APP.syncUI(); });
  await sv.click('.tooth.sel [data-keep="0.25"]'); await sv.waitForTimeout(100);
  const sum = await sv.evaluate(() => APP.summaryText());
  ok(/^Survey of the lower arch — path of insertion: front up 6\.0°/.test(sum) && /\n45: buccal: 0\.25 /.test(sum) && /undercut left for clasp tips: 36 buccal 0\.25 mm/.test(sum), 'summary text names the path, each abutment’s gauges and the clasp tip kept');
  await sv.waitForTimeout(300); await a.shot(OUT + 'h13-survey-teeth.png');
  await sv.evaluate(() => APP.shell.goto('block')); await a.idle(sv); await sv.waitForFunction(() => APP.B.mesh, null, { timeout: 120000 });
  const bi = await sv.evaluate(() => APP.B.info);
  ok(bi.watertight && bi.kept && bi.kept.length === 1 && bi.kept[0].ok, `blocked-out model built inside the hub: closed, ${bi.tris.toLocaleString('en-GB')} triangles, clasp tip kept on 36`);
  await sv.waitForTimeout(300); await a.shot(OUT + 'h13-survey-block.png');
  // download through the hub
  const [dl] = await Promise.all([page.waitForEvent('download'), sv.click('#bStl')]); const stl = OUT + 'h13-blockout.stl'; await dl.saveAs(stl);
  const buf = fs.readFileSync(stl), ntri = buf.readUInt32LE(80);
  ok(buf.length === 84 + 50 * ntri && ntri === bi.tris && /blockout-lower/.test(dl.suggestedFilename()), `STL download through the hub: ${dl.suggestedFilename()}, ${ntri.toLocaleString('en-GB')} triangles, well-formed`);
  // back to Scans, save the case
  await a.go('scans');
  ok(await page.evaluate(() => APP.users().includes('Survey')), 'the Scans tab lists Survey as holding work');
  const kept = await page.evaluate(() => { const c = APP.buildCase(); return { roles: c.items.map((i) => i.role).sort().join(), keys: Object.keys(c.data).sort().join(), tilt: c.data.survey && c.data.survey.tilt, n: c.data.survey && c.data.survey.teeth.length }; });
  ok(kept.roles === 'lower-scan,survey-blockout,upper-scan' && /survey/.test(kept.keys) && kept.tilt.ap === 6 && kept.n === 2, `the case holds the blocked-out model and the survey (path, ${kept.n} teeth): ${kept.roles} / ${kept.keys}`);
  const [dc] = await Promise.all([page.waitForEvent('download'), page.click('#topBtns button:nth-child(2)')]); const f1 = OUT + 'h13-case.zip'; await dc.saveAs(f1);
  const before = await sv.evaluate(() => ({ text: APP.summaryText(), tris: APP.B.info.tris }));
  ok(a.errors.length === 0, 'no page errors ' + a.errors.slice(0, 3).join(' | '));
  await a.close();
  // a fresh Scan Card reads it back
  const b = await openHub(), p2 = b.page;
  await p2.setInputFiles('input[data-ss=file]', f1); await p2.waitForFunction(() => APP.scans.has('upper') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 });
  ok(await p2.evaluate(() => APP.valid(APP.TOOLS.find((t) => t.id === 'survey'))), 'opened in a fresh Scan Card: the survey counts as made on these scans');
  const sv2 = await b.go('survey');
  const r2 = await sv2.evaluate(() => ({ ap: APP.P.ap, jaw: APP.P.jaw, teeth: APP.P.teeth.map((t) => t.fdi + ':' + t.keep).join(), text: APP.summaryText(), built: !!APP.B.mesh && APP.B.sig === APP.blockSig(), tris: APP.B.info && APP.B.info.tris, slider: document.getElementById('pAp').value }));
  ok(r2.ap === 6 && r2.slider === '6' && r2.jaw === 'lower' && r2.teeth === '45:0,36:0.25', `the path (slider at ${r2.slider}°), arch and abutments are back: ${r2.teeth}`);
  ok(r2.text === before.text, 'identical summary text from the case file');
  ok(r2.built && r2.tris === before.tris, `the blocked-out model is back without rebuilding (${r2.tris} triangles)`);
  ok(b.errors.length === 0, 'no page errors in the fresh Scan Card ' + b.errors.slice(0, 3).join(' | '));
  await b.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
