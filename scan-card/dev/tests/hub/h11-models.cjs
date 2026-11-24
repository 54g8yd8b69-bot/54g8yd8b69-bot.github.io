// Design on the model: build models with bases on the Models tab, choose “Use the models in the other tools”, and check that
// Analysis, Splint and Tray Card get the model (base and all) in place of the scan, in the same place; back to the scans;
// the choice kept in the case file and read back in a fresh Scan Card.
const { openHub, ok, OUT } = require('./lib.cjs');
(async () => {
  const a = await openHub(), { page } = a; await a.demo();
  const raw = await page.evaluate(() => Object.fromEntries(['upper', 'lower'].map((j) => [j, { n: APP.scans[j].raw.positions.length, b: APP.N.meshBounds(APP.N.transformMesh(APP.scans[j].raw, APP.scans[j].matrix)) }])));
  ok(await page.evaluate(() => [...document.querySelectorAll('#srcSeg button')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')).join()) === 'The scans*,Models with base', 'Choose a tool: “Tools work on” shows The scans (chosen) and Models with base');
  // ── build the models, then use them
  const mo = await a.go('model'); await mo.waitForFunction(() => APP.A.lower.model && APP.A.upper.model && !APP.A.lower.dirty && !APP.A.upper.dirty, null, { timeout: 300000 });
  await mo.evaluate(() => APP.shell.goto('export')); await a.idle(mo);
  ok(await mo.isVisible('#exUse') && (await mo.textContent('#exUse')) === 'Use the models in the other tools', 'Models’ Export step offers “Use the models in the other tools”');
  await mo.click('#exUse'); await a.settle(); await page.waitForTimeout(500);
  const st = await page.evaluate(() => ({ src: APP.H.src, got: ['upper', 'lower'].filter((j) => !!APP.modelItem(j)), toast: document.getElementById('hubToast').textContent }));
  ok(st.src === 'model' && st.got.join() === 'upper,lower' && /now work on the upper and lower models with base/.test(st.toast), 'the hub now hands out both models: ' + st.toast);
  ok((await mo.textContent('#exUse')) === 'Back to the scans in the other tools', 'the button now offers the way back');
  const mod = await page.evaluate(() => Object.fromEntries(['upper', 'lower'].map((j) => { const it = APP.modelItem(j); return [j, { n: it.mesh.positions.length, b: APP.N.meshBounds(APP.N.transformMesh(it.mesh, it.matrix)) }]; })));
  // ── Analysis gets the models
  const an = await a.go('analysis');
  const ag = await an.evaluate(() => Object.fromEntries(['upper', 'lower'].map((j) => [j, { n: APP.scans[j].raw.positions.length, b: APP.N.meshBounds(APP.N.transformMesh(APP.scans[j].raw, APP.scans[j].matrix)) }])));
  const same = (p, q) => p.b.min.every((v, i) => Math.abs(v - q.b.min[i]) < 1e-3) && p.b.max.every((v, i) => Math.abs(v - q.b.max[i]) < 1e-3);
  ok(['upper', 'lower'].every((j) => ag[j].n === mod[j].n && same(ag[j], mod[j])), 'Analysis received the models (same vertices, same place in the case frame)');
  ok(raw.lower.b.min[2] - ag.lower.b.min[2] > 3 && ag.upper.b.max[2] - raw.upper.b.max[2] > 3, `…and they reach past the scans by their bases (lower ${(raw.lower.b.min[2] - ag.lower.b.min[2]).toFixed(1)} mm further down, upper ${(ag.upper.b.max[2] - raw.upper.b.max[2]).toFixed(1)} mm further up)`);
  ok(['upper', 'lower'].every((j) => Math.abs(ag[j].b.max[0] - raw[j].b.max[0]) < 6 && Math.abs(ag[j].b.min[1] - raw[j].b.min[1]) < 6), 'the models sit where the scans are (teeth in the same place)');
  // ── Tray Card gets the lower model as an STL file, and builds a tray on it
  await page.click('#tabs [data-tab=tray]'); await a.settle(); const tr = page.frames().find((f) => /tray/.test(f.url()) || f.name() === 'tray') || (await (await page.$('iframe[data-tool=tray]')).contentFrame());
  await tr.waitForFunction(() => window.TC && !!TC.S.scanGeo && TC.S.scanSrc, null, { timeout: 120000 }); await page.waitForTimeout(800);
  const tf = await tr.evaluate(() => ({ name: TC.S.scanSrc.file && TC.S.scanSrc.file.name || TC.S.scanSrc.name, ant: !!TC.S.antMesh }));
  ok(/lower-model\.stl/.test(JSON.stringify(tf)), 'Tray Card was given lower-model.stl (and the upper as the opposing arch: ' + tf.ant + ') ' + JSON.stringify(tf));
  await tr.evaluate(() => { const S = TC.S, pts = []; S.scanGeo.computeBoundingBox(); const bb = S.scanGeo.boundingBox, c = bb.getCenter(new TC.V()), rx = (bb.max.x - bb.min.x) * 0.45, ry = (bb.max.y - bb.min.y) * 0.45; for (let k = 0; k < 24; k++) { const t = k / 24 * 2 * Math.PI; pts.push(new TC.V(c.x + rx * Math.cos(t), c.y + ry * Math.sin(t), bb.max.z)); } S.margin.pts = pts; S.margin.closed = true; TC.drawMargin(); });
  await tr.evaluate(() => TC.generate()); await tr.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 240000 });
  const tg = await tr.evaluate(() => ({ ok: !!TC.S.trayMesh, info: document.getElementById('genInfo').textContent }));
  ok(tg.ok, 'a tray was generated on the model: ' + tg.info.slice(0, 80));
  await page.waitForTimeout(500); await a.shot(OUT + 'h11-tray-on-model.png');
  // ── back to the scans
  await a.go('scans'); await page.evaluate(() => APP.shell.goto('tools')); await page.click('#srcSeg [data-v=scan]'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => APP.H.src === 'scan' && !APP.modelItem('lower')), 'Tools work on: The scans again');
  const an2 = await a.go('analysis'); const n2 = await an2.evaluate(() => APP.scans.lower.raw.positions.length);
  ok(n2 === raw.lower.n, 'Analysis is back on the lower scan itself');
  await page.click('#tabs [data-tab=tray]'); await a.settle(); await page.waitForTimeout(500);
  const off = await page.evaluate(() => document.getElementById('offer').classList.contains('show') && document.getElementById('offer').textContent);
  ok(/changed on the Scans tab/.test(off || ''), 'Tray Card is not overwritten without asking (it holds a tray): ' + off);
  // ── the choice in the case file
  await a.go('scans'); await page.evaluate(() => APP.shell.goto('tools')); await page.click('#srcSeg [data-v=model]'); await page.waitForTimeout(300);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#topBtns button:nth-child(2)')]); const f1 = OUT + 'h11-case.zip'; await dl.saveAs(f1);
  const kept = await page.evaluate(() => { const c = APP.buildCase(); return c.items.map((i) => i.role).sort().join() + ' / ' + JSON.stringify(c.data.scanCard); });
  ok(kept === 'lower-model,lower-scan,upper-model,upper-scan / {"source":"model"}', 'the case holds the scans, the models and the choice: ' + kept);
  // (the site's Tray Card page asks for the site's own /fonts/, which only this test harness's artifact-like policy refuses)
  const errs = a.errors.filter((e) => !/fonts\/.*Content Security Policy|font-src/.test(e));
  ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await a.close();
  const b = await openHub(), p2 = b.page; await p2.setInputFiles('input[data-ss=file]', f1); await p2.waitForFunction(() => APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 }); await p2.waitForTimeout(300);
  const re = await p2.evaluate(() => ({ src: APP.H.src, got: ['upper', 'lower'].filter((j) => !!APP.modelItem(j)).join(), on: document.querySelector('#srcSeg .on') && document.querySelector('#srcSeg .on').dataset.v }));
  ok(re.src === 'model' && re.got === 'upper,lower' && re.on === 'model', 'a fresh Scan Card opens the case with the models in use: ' + JSON.stringify(re));
  const an3 = await b.go('analysis'); ok((await an3.evaluate(() => APP.scans.lower.raw.positions.length)) === mod.lower.n, 'and Analysis gets the lower model from it');
  ok(b.errors.length === 0, 'no page errors (reopened) ' + b.errors.slice(0, 3).join(' | '));
  await b.close();
})();
