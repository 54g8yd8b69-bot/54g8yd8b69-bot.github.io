// Scan Card: the awkward orders of doing things.
const { openHub, ok, OUT, DATA } = require('./lib.cjs');
const fs = require('fs');
(async () => {
  // ── 1. tools opened before any scan; one arch only; scan removed; scan replaced by dropping a file on a tool
  let a = await openHub(), { page } = a;
  const an = await a.go('analysis'), mo = await a.go('model'), sp = await a.go('splint');
  await a.shot(OUT + 'h4-splint-empty.png');
  ok(await mo.evaluate(() => !APP.scans.has('upper') && !APP.scans.has('lower') && /No scans yet/.test(document.getElementById('empty').textContent) && !document.getElementById('empty').hidden), 'tools opened with no scans say “No scans yet — load them on the Scans tab”');
  ok(a.errors.length === 0, 'three empty tools: no errors ' + a.errors.slice(0, 3).join(' | '));
  await a.go('scans');
  ok(await page.evaluate(() => !APP.isLocked()), 'no lock when no tool holds scans');
  await page.setInputFiles('input[data-ss=file]', DATA + 'scanner-lower.stl');
  await page.waitForFunction(() => APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 60000 });
  await a.go('model'); await mo.waitForFunction(() => APP.A.lower.model && !APP.A.lower.dirty, null, { timeout: 240000 });
  ok(await mo.evaluate(() => APP.scans.has('lower') && !APP.scans.has('upper') && APP.A.lower.info.watertight), 'one arch only (a scanner-position STL): Models builds the lower model');
  await a.go('splint');
  ok(await sp.evaluate(() => APP.scans.has('lower') && !APP.scans.has('upper')), 'Splint has the single lower scan');
  // drop a file on a tool: the hub takes it to the Scans tab, where the lock stops it
  const drop = (fr, name) => fr.evaluate(async (name) => { const f = new File([new Uint8Array(84)], name); await APP.scans.loadFiles([f]); }, name);
  await drop(sp, 'x.stl'); await a.settle();
  ok(await page.evaluate(() => APP.H.active === 'scans' && APP.isLocked() && document.getElementById('lock').classList.contains('flash')), 'a file dropped on a tool leads to the Scans tab, and the lock holds until “Change the scans anyway”');
  // unlock, add the upper scan properly
  await page.click('#unlock');
  await page.setInputFiles('input[data-ss=file]', DATA + 'scanner-upper.stl');
  await page.waitForFunction(() => APP.scans.has('upper') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 60000 });
  ok(await page.evaluate(() => APP.scans.inBite), 'upper scan added: the pair is in its bite');
  await a.go('model'); await mo.waitForFunction(() => APP.scans.has('upper') && APP.A.upper.model && !APP.A.upper.dirty && APP.A.lower.model && !APP.A.lower.dirty, null, { timeout: 240000 });
  ok(true, 'Models took the pair and built both');
  // remove the lower scan on the Scans tab
  await a.go('scans'); await page.click('#unlock'); await page.click('.slot[data-jaw=lower] [data-act=clear]');
  await a.go('analysis');
  ok(await an.evaluate(() => APP.scans.has('upper') && !APP.scans.has('lower')), 'lower scan removed on the Scans tab: Analysis follows');
  // remove everything
  await a.go('scans'); await page.click('#unlock'); await page.click('.slot[data-jaw=upper] [data-act=clear]');
  await a.go('model');
  ok(await mo.evaluate(() => !APP.scans.has('upper') && !APP.scans.has('lower') && !APP.A.upper.object && !APP.A.lower.object), 'all scans removed: Models is emptied');
  ok(a.errors.length === 0, 'no page errors ' + a.errors.slice(0, 3).join(' | '));
  await a.close();

  // ── 2. the copy kept in the browser: work done in tools is there after a reload
  a = await openHub(); page = a.page;
  await a.demo();
  const m2 = await a.go('model'); await m2.waitForFunction(() => APP.A.lower.model && !APP.A.lower.dirty && APP.A.upper.model && !APP.A.upper.dirty, null, { timeout: 240000 });
  await m2.evaluate(async () => { APP.P.baseH = 8; await APP.rebuild(); }); await a.idle(m2);
  await a.go('scans'); await page.waitForTimeout(3500);          // the hub keeps its copy 2 s after the last change
  await page.reload(); await page.waitForFunction(() => window.APP && APP.scans, null, { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('[data-ss=resume]').hidden, null, { timeout: 15000 });
  ok(/Scan Card/.test(await page.textContent('[data-ss=resume]')), 'after a reload: “' + (await page.textContent('[data-ss=resume]')) + '” is offered');
  await page.click('[data-ss=resume]'); await page.waitForFunction(() => APP.scans.has('upper') && APP.scans.has('lower'), null, { timeout: 60000 });
  const m3 = await a.go('model');
  await m3.waitForFunction(() => APP.scans.has('lower') && APP.A.lower.model, null, { timeout: 60000 });
  ok(await m3.evaluate(() => APP.P.baseH === 8 && !APP.A.lower.dirty && !APP.A.upper.dirty && !!APP.A.upper.model), 'resumed: Models has its setting (base 8 mm) and both built models back, nothing rebuilt');
  ok(a.errors.length === 0, 'no page errors ' + a.errors.slice(0, 3).join(' | '));
  await a.close();

  // ── 3. a tool page that never starts
  a = await openHub(); page = a.page;
  await page.evaluate(() => { APP.TOOLS.find((t) => t.id === 'splint').url = 'nothing-here.html'; });
  const t0 = Date.now(); await page.click('#tabs [data-tab=splint]'); await a.settle();
  ok(await page.evaluate(() => APP.H.active === 'scans' && /did not open/.test(document.getElementById('hubToast').textContent) && !APP.F.splint) && Date.now() - t0 < 40000, `a tool page that is missing: back on the Scans tab with a message after ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await page.evaluate(() => { APP.TOOLS.find((t) => t.id === 'splint').url = 'splint.html'; });
  const s2 = await a.go('splint'); ok(!!s2 && await s2.evaluate(() => APP.N.EMBED), 'and the tab opens normally on the next try');
  await a.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
