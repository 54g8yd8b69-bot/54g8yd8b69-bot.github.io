// The artifact copy (source pages + CDN libraries, Tray Card and Wax Card beside them), under an artifact-like CSP:
// Needs the artifact folder copied to /home/claude/suite/art-test with two test variants of its index.html (see dev/README.md).
//   1. as published (frames by address)   2. frames filled by fetch + srcdoc (the fallback)   3. saving through a stand-in for the artifact's downloads
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
let bad = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { bad++; process.exitCode = 1; } };
(async () => {
  for (const [label, file] of [['frames by address', 'index.html'], ['frames by fetch + srcdoc', 'index-srcdoc.html'], ['with the artifact’s downloads', 'index-claude.html']]) {
    console.log(label);
    const a = await openApp('art-test', { width: 1400, height: 900, file }), { page } = a;
    await page.waitForFunction(() => window.APP && APP.scans, null, { timeout: 60000 });
    const settle = () => page.evaluate(() => APP.H.q);
    const frameOf = async (id) => { const h = await page.$(`iframe[data-tool=${id}]`); if (!h) { console.log('   no frame for', id, '| toast:', await page.evaluate(() => document.getElementById('hubToast').textContent), '| errors:', a.errors.slice(0, 4).join(' | ')); return null; } return h.contentFrame(); };
    await page.evaluate(() => APP.scans.loadDemo({ res: 0.6 }));
    await page.waitForFunction(() => APP.scans.has('upper') && APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 60000 });
    await page.click('#tabs [data-tab=model]'); await settle(); const m = await frameOf('model');
    await m.waitForFunction(() => window.APP && APP.A.lower.model && APP.A.upper.model && !APP.A.lower.dirty && !APP.A.upper.dirty, null, { timeout: 240000 });
    ok(await m.evaluate(() => APP.N.EMBED && APP.A.lower.info.watertight && APP.A.upper.info.watertight), 'Models: both models built from the hub scans, watertight (' + (await m.evaluate(() => location.href.slice(0, 14))) + '…)');
    for (const id of ['analysis', 'splint']) { await page.click(`#tabs [data-tab=${id}]`); await settle(); const f = await frameOf(id); await f.waitForFunction(() => window.APP && APP.scans.has('lower'), null, { timeout: 60000 }); ok(true, id + ' has the scans'); }
    await page.click('#tabs [data-tab=tray]'); await settle(); const t = await frameOf('tray'); await t.waitForFunction(() => window.TC && !!TC.S.scanGeo && !!TC.S.antMesh, null, { timeout: 90000 }); ok(true, 'Tray Card has the scan and the opposing arch');
    await page.click('#tabs [data-tab=wax]'); await settle(); const w = await frameOf('wax'); await w.waitForFunction(() => window.__wax && !!(__wax.S.scans.upper && __wax.S.scans.lower), null, { timeout: 90000 }); ok(true, 'Wax Card has both scans');
    if (file === 'index-claude.html') {
      await page.click('#tabs [data-tab=model]'); await settle(); await m.evaluate(() => APP.shell.goto('export')); await m.click('#exStl');
      await page.waitForFunction(() => window.__saved.length >= 1, null, { timeout: 60000 });
      await page.click('#topBtns button:nth-child(2)'); await page.waitForFunction(() => window.__saved.length >= 2, null, { timeout: 60000 });
      for (const id of ['tray', 'wax']) { const f = await frameOf(id); await f.evaluate(async (id) => { const ns = await window.claude.use('downloads'); await ns.save({ filename: id + '.zip', data: new Blob([new Uint8Array(1234)]) }); }, id); }
      const saved = await page.evaluate(() => window.__saved);
      ok(saved.length === 4 && saved.every((s) => s.own && s.size > 0) && saved.map((s) => s.filename).join() === `models.zip,${saved[1].filename},tray.zip,wax.zip` && /^case-/.test(saved[1].filename), 'every save reaches the top page’s downloads as its own data: ' + JSON.stringify(saved.map((s) => s.filename + ' ' + s.tag + ' ' + s.size)));
      ok(await t.evaluate(() => typeof window.claude.use === 'function') && await w.evaluate(() => typeof window.claude.use === 'function'), 'Tray Card and Wax Card were handed the downloads door before their own scripts ran');
    }
    ok(a.errors.length === 0, 'no page errors ' + a.errors.slice(0, 3).join(' | '));
    await a.close();
  }
  console.log(bad ? bad + ' FAILED' : 'all passed');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
