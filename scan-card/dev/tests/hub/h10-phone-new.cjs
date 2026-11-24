const { openHub, ok, OUT, DATA } = require('./lib.cjs');
(async () => { const a = await openHub({ width: 390, height: 844, touch: true, dpr: 3 }), { page } = a;
  await page.setInputFiles('input[data-ss=file]', [DATA + 'prep-lower.stl', DATA + 'prep-upper.stl']); await page.waitForFunction(() => APP.scans.has('upper') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 });
  for (const id of ['compare', 'prep']) { const fr = await a.go(id); if (id === 'compare') { await fr.click('#cmJaw [data-v=lower]'); await fr.click('#cmMade'); await a.idle(fr); await fr.evaluate(() => APP.shell.goto('map')); }
    const o = await fr.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); ok(o.sw <= o.cw + 1, `${id} on a phone: nothing spills sideways (${o.sw} in ${o.cw})`);
    const t = await page.evaluate((id) => { const b = document.querySelector(`#tabs [data-tab=${id}]`).getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth; }, id); ok(t, `${id} tab scrolled into view`);
    await page.waitForTimeout(400); await a.shot(OUT + `phone-${id}.png`); }
  ok(a.errors.length === 0, 'no errors ' + a.errors.slice(0, 2).join('|')); await a.close(); })();
