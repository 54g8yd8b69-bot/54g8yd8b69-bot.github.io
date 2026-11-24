// FINAL browser test 4 (1400×900): every control not used by f1–f3 does what it says.  node f4.cjs
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
(async () => {
  const { page, errors, close } = await openApp('splint-card', { width: 1400, height: 900 });
  await page.waitForFunction(() => window.APP, { timeout: 60000 });
  const idle = async () => { await page.waitForTimeout(150); await page.waitForFunction(() => !document.querySelector('#busy.show'), { timeout: 240000 }); await page.waitForTimeout(200); };
  const built = async () => { await idle(); await page.waitForFunction(() => APP.D.res && !APP.D.dirty && !document.querySelector('#busy.show'), { timeout: 240000 }); await page.waitForTimeout(150); };
  const setRange = (id, v) => page.evaluate(([id, v]) => { const r = document.getElementById(id); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  const P = (k) => page.evaluate((k) => APP.P[k], k), go = (s) => page.evaluate((s) => APP.shell.goto(s), s);
  const untitled = await page.evaluate(() => Array.from(document.querySelectorAll('button')).filter((b) => !b.title && b.offsetParent !== null).map((b) => b.id || b.textContent.trim().slice(0, 20)));
  console.log('visible buttons without a tooltip:', JSON.stringify(untitled));
  console.log('text inputs / textareas on the page:', await page.evaluate(() => document.querySelectorAll('input[type=text], input:not([type]), textarea, [contenteditable]').length));
  await page.click('[data-ss=demo]'); await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 60000 });
  await go('appliance'); await page.click('#apJaw [data-v=upper]'); await page.click('#apType [data-v=guard]'); await page.waitForTimeout(200);
  await go('path'); await page.waitForTimeout(300); await setRange('paX', 5); await setRange('paY', 2); const a = [await P('tiltX'), await P('tiltY')]; await page.click('#paReset'); await page.waitForTimeout(200); console.log('paReset: tilt', a.join(','), '→', [await P('tiltX'), await P('tiltY')].join(','));
  await go('margin'); await page.waitForTimeout(400); await page.evaluate(() => APP.viewer.setView('left')); await page.waitForTimeout(300);
  const dot = await page.evaluate(() => { const r = APP.viewer.dom.getBoundingClientRect(); let best = null; for (const d of APP.dots()) { if (d.side !== 'L') continue; const q = APP.viewer.toScreen(d.sprite.position); if (!q.visible) continue; const e = Math.hypot(q.x - r.width / 2, q.y - r.height / 2); if (!best || e < best.e) best = { e, x: q.x + r.left, y: q.y + r.top, k: d.k }; } return best; });
  if (dot) { await page.mouse.move(dot.x, dot.y); await page.mouse.down(); await page.mouse.move(dot.x, dot.y - 12, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(200); }
  const adjL = (await P('adjL')).join(','); await page.click('#mgReset'); await page.waitForTimeout(200); console.log('tongue-side control point dragged → adjL', adjL, '| margin note shown:', await page.evaluate(() => !!document.getElementById('mgInfo').textContent), '| mgReset →', (await P('adjL')).join(','), (await P('adjB')).join(','));
  await go('shell'); await built(); const t0 = await page.evaluate(() => ({ wall: APP.D.thick.wall.min, vol: APP.D.res.report.volume }));
  await setRange('shC', 0.15); await setRange('shT', 2.5); await setRange('shMin', 1.2); await setRange('shE', 0.9); await page.waitForTimeout(200);
  console.log('shC shT shMin shE →', JSON.stringify({ c: await P('clearance'), t: await P('thickness'), m: await P('minThick'), e: await P('edge') }), '| marked for rebuild:', await page.evaluate(() => APP.D.dirty || !APP.D.res));
  await go('check'); await built(); console.log('rebuilt: thinnest wall', t0.wall.toFixed(2), '→', (await page.evaluate(() => APP.D.thick.wall.min)).toFixed(2), '| volume mL', (t0.vol / 1000).toFixed(2), '→', (await page.evaluate(() => APP.D.res.report.volume / 1000)).toFixed(2), '| contacts button disabled without the opposing arch:', await page.evaluate(() => document.querySelector('#ckMap [data-v=contact]').disabled));
  await page.click('#ckSec'); await page.waitForTimeout(500); const f0 = await P('sectionFlip'); await page.click('#ckFlip'); await page.waitForTimeout(300); await page.click('#ckFace'); await page.waitForTimeout(300); console.log('section on:', await P('section'), '| ckFlip', f0, '→', await P('sectionFlip'), '| ckFace ran'); await page.click('#ckSec'); await page.waitForTimeout(200);
  // guard shaped to the opposing arch
  await go('shell'); await page.waitForTimeout(300); await page.click('#shUse'); await page.waitForTimeout(200); await setRange('shOpen', 3); await page.click('#shShow'); await page.waitForTimeout(200); const sh1 = await P('showOpp'); await page.click('#shShow');
  await built(); console.log('shUse on, shOpen 3 (guard):', await page.evaluate(() => JSON.stringify({ useOpp: APP.P.useOpp, open: APP.P.open, contacts: APP.D.contact && APP.D.contact.patches.length, nearest: APP.D.contact && +APP.D.contact.min.toFixed(3), through: APP.D.contact && APP.D.contact.through, wt: APP.D.res.report.watertight, genus: APP.D.res.report.genus })), '| shShow toggled to', sh1, 'and back to', await P('showOpp'));
  // flat table at a set height without the opposing arch, then meeting it
  await go('appliance'); await page.click('#apType [data-v=flat]'); await page.waitForTimeout(200); await go('shell'); await page.waitForTimeout(300);
  if (await P('useOpp')) await page.click('#shUse'); await page.waitForTimeout(200); await setRange('shOcc', 3); await built();
  console.log('flat, no opposing, table 3 mm above the highest cusp:', await page.evaluate(() => JSON.stringify({ useOpp: APP.P.useOpp, occlusal: APP.P.occlusal, planeAbove: +(APP.D.res.report.plane.d - APP.D.arch.zMax).toFixed(2), occ: +APP.D.thick.occ.min.toFixed(2), wall: +APP.D.thick.wall.min.toFixed(2), lift: +(+APP.D.res.report.lift).toFixed(2), wt: APP.D.res.report.watertight, genus: APP.D.res.report.genus })));
  await page.click('#shUse'); await page.waitForTimeout(200); await page.click('#shAuto'); await built(); const m1 = await page.evaluate(() => ({ met: APP.D.res.report.met, c: APP.D.contact.patches.length }));
  await page.click('#shMeet'); await built(); console.log('shMeet on → met', m1.met, 'contacts', m1.c, '| shMeet off → met', await page.evaluate(() => APP.D.res.report.met), 'meet', await P('meet'), 'through', await page.evaluate(() => APP.D.contact && APP.D.contact.through));
  console.log('errors', JSON.stringify(errors)); await close();
})();
