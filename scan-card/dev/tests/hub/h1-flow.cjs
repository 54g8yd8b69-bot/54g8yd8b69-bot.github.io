// Scan Card hub: scans loaded once, tools take them, work comes back, lock, restart on changed scans, save.
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs');
const OUT = '/home/claude/suite/dev/out/hub/';
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const { page, errors, shot, close } = await openApp('scan-card', { width: 1400, height: 900 });
  const idle = async (fr) => { await (fr || page).waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 }); };
  const settle = () => page.evaluate(() => APP.H.q);
  const tool = (id) => page.frames().find((f) => f !== page.mainFrame() && new RegExp('/scan-card/' + id + '(\\.html|/)').test(f.url()));
  await page.waitForFunction(() => window.APP);
  ok(await page.evaluate(() => document.querySelectorAll('#tabs button').length) === 6, 'six tabs (Scans + five tools)');
  await page.click('[data-ss=demo]'); await idle();
  ok(await page.evaluate(() => APP.scans.has('upper') && APP.scans.has('lower')), 'demo scans loaded on the Scans tab');
  await shot(OUT + 'h1-scans.png');
  for (let i = 0; i < 3; i++) await page.click('#bNext');
  ok(await page.evaluate(() => APP.shell.steps[APP.shell.current].id) === 'tools', 'Next walks load → orient → trim → choose a tool');
  await shot(OUT + 'h1-tools-step.png');

  // Models
  await page.click('.tool[data-tool=model]'); await settle();
  const m = tool('model'); ok(!!m, 'Models frame opened');
  await m.waitForFunction(() => window.APP && APP.scans.has('lower') && APP.A.lower.model && APP.A.upper.model, null, { timeout: 120000 }); await idle(m);
  const ms = await m.evaluate(() => ({ embed: APP.N.EMBED, step: APP.shell.steps[APP.shell.current].id, hidden: [...document.querySelectorAll('.step')].filter((s) => s.hidden).map((s) => s.dataset.id), nums: [...document.querySelectorAll('.step:not([hidden]) .n')].map((n) => n.textContent).join(''), top: getComputedStyle(document.querySelector('#top .brand')).display, btns: document.querySelectorAll('#topBtns button').length, wt: APP.A.lower.info.watertight && APP.A.upper.info.watertight, back: document.getElementById('bBack').disabled }));
  ok(ms.embed && ms.step === 'base' && ms.hidden.join() === 'load,orient,trim' && ms.nums === '1234' && ms.top === 'none' && ms.btns === 0 && ms.back, 'Models: embedded, starts at Base, own load/orient/trim hidden, steps renumbered 1–4: ' + JSON.stringify(ms));
  ok(ms.wt, 'Models built both models from the hub scans, watertight');
  await shot(OUT + 'h1-models.png');
  // same scans in the tool as in the hub (exact)
  const same = async (fr) => { const a = await page.evaluate(() => ['upper', 'lower'].map((j) => [APP.scans[j].raw.positions.length, APP.N.crc32(new Uint8Array(APP.scans[j].raw.positions.buffer)), APP.N.crc32(new Uint8Array(APP.scans[j].raw.indices.buffer)), Array.from(APP.scans[j].matrix.elements)])); const b = await fr.evaluate(() => ['upper', 'lower'].map((j) => [APP.scans[j].raw.positions.length, APP.N.crc32(new Uint8Array(APP.scans[j].raw.positions.buffer)), APP.N.crc32(new Uint8Array(APP.scans[j].raw.indices.buffer)), Array.from(APP.scans[j].matrix.elements)])); return JSON.stringify(a) === JSON.stringify(b); };
  ok(await same(m), 'Models holds byte-identical scans and matrices');
  // change a setting in Models, put a label on
  await m.evaluate(async () => { APP.P.baseH = 7; await APP.rebuild(); });
  const volM = await m.evaluate(() => APP.A.lower.info.volume);

  // Analysis
  await page.click('#tabs [data-tab=analysis]'); await settle();
  const a = tool('analysis'); ok(!!a, 'Analysis frame opened');
  await a.waitForFunction(() => window.APP && APP.scans.has('lower'), null, { timeout: 60000 }); await idle(a);
  const as = await a.evaluate(() => ({ step: APP.ui.step, hidden: [...document.querySelectorAll('.step')].filter((s) => s.hidden).map((s) => s.dataset.id).join(), btns: [...document.querySelectorAll('#topBtns button')].map((b) => b.textContent).join('|') }));
  ok(as.step === 'widths' && as.hidden === 'load,orient', 'Analysis: starts at tooth widths, load/orient hidden: ' + JSON.stringify(as));
  ok(await same(a), 'Analysis holds byte-identical scans and matrices');
  ok(await page.evaluate(() => APP.valid(APP.TOOLS[0]) && !!APP.scans.dcase.get('lower-model') && APP.scans.dcase.data.model.params.baseH === 7), 'leaving Models brought its work (params + model meshes) into the master case');
  await shot(OUT + 'h1-analysis.png');

  // Splint
  await page.click('#tabs [data-tab=splint]'); await settle();
  const s = tool('splint'); ok(!!s, 'Splint frame opened');
  await s.waitForFunction(() => window.APP && (APP.scans.has('lower') || APP.scans.has('upper')), null, { timeout: 60000 }); await idle(s);
  const ss = await s.evaluate(() => ({ step: APP.shell.steps[APP.shell.current].id, hidden: [...document.querySelectorAll('.step')].filter((x) => x.hidden).map((x) => x.dataset.id).join() }));
  ok(ss.hidden === 'load,orient', 'Splint: load/orient hidden, starts at ' + ss.step);
  ok(await same(s), 'Splint holds byte-identical scans and matrices');
  await shot(OUT + 'h1-splint.png');

  // back to Scans: locked
  await page.click('#tabs [data-tab=scans]'); await settle();
  const lk = await page.evaluate(() => ({ note: !document.getElementById('lock').hidden, text: document.querySelector('#lock span').textContent, inert: ['load', 'orient', 'trim'].map((id) => APP.shell.stepEl(id).querySelector('.body').inert).join(), locked: APP.isLocked() }));
  ok(lk.note && lk.locked && lk.inert === 'true,true,true' && /Models, Analysis and Splint hold work made on them/.test(lk.text), 'Scans tab is locked while tools use the scans: ' + lk.text);
  await shot(OUT + 'h1-locked.png');
  // save now: everything valid
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#topBtns button:nth-child(2)')]);
  const f1 = OUT + 'h1-case.zip'; await dl.saveAs(f1);
  ok(/^case-\d{4}-\d\d-\d\d\.zip$/.test(dl.suggestedFilename()), 'Save case downloads ' + dl.suggestedFilename() + ' (' + (fs.statSync(f1).size / 1e6).toFixed(1) + ' MB)');

  // unlock, trim, tools restart on the changed scans
  await page.click('#unlock');
  ok(await page.evaluate(() => !APP.isLocked() && document.getElementById('lock').hidden), 'unlock button unlocks the steps');
  await page.evaluate(() => APP.shell.goto('trim'));
  await page.evaluate(() => { const r = document.getElementById('trDepth'); r.value = 9; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); });
  const t0 = await page.evaluate(() => APP.scans.lower.raw.indices.length);
  await page.click('#trApply'); await idle();
  const t1 = await page.evaluate(() => APP.scans.lower.raw.indices.length);
  ok(t1 < t0, `hub trim cut the lower scan (${t0 / 3} → ${t1 / 3} triangles)`);
  ok(await page.evaluate(() => !APP.valid(APP.TOOLS[0]) && APP.users().length === 0), 'after the trim the tools’ earlier work no longer counts as current');
  await page.click('#tabs [data-tab=model]'); await settle();
  await m.waitForFunction((n) => APP.scans.lower.raw.indices.length === n && APP.A.lower.model && !APP.A.lower.dirty, t1, { timeout: 120000 }); await idle(m);
  ok(await same(m), 'Models took the trimmed scans');
  const volM2 = await m.evaluate(() => APP.A.lower.info.volume);
  ok(volM2 < volM, `Models rebuilt on the trimmed scan (lower ${(volM / 1000).toFixed(1)} → ${(volM2 / 1000).toFixed(1)} mL)`);
  ok(/started again/.test(await page.evaluate(() => document.getElementById('hubToast').textContent)), 'hub says the tool started again');
  // undo the trim on the Scans tab: signature returns
  await page.click('#tabs [data-tab=scans]'); await settle();
  await page.click('#unlock'); await page.evaluate(() => APP.shell.goto('trim')); await page.click('#trUndo'); await idle();
  ok(await page.evaluate((n) => APP.scans.lower.raw.indices.length === n, t0), 'undo on the Scans tab restores the scan');
  console.log('errors:', JSON.stringify(errors));
  ok(errors.length === 0, 'no page errors');
  await close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
