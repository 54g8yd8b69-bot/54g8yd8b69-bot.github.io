// Scan Card on an iPad (portrait and landscape) and a phone: screenshots + overflow checks.
const { openHub, ok, OUT } = require('./lib.cjs');
(async () => {
  for (const [name, w, h, dpr] of [['ipad-portrait', 834, 1112, 2], ['ipad-landscape', 1180, 820, 2], ['phone', 390, 844, 3]]) {
    const a = await openHub({ width: w, height: h, touch: true, dpr }), { page } = a;
    await a.demo();
    const over = async (fr, what) => { const o = await (fr || page).evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight })); ok(o.sw <= o.cw + 1 && o.sh <= o.ch + 1, `${name} ${what}: nothing spills outside the screen (${o.sw}×${o.sh} in ${o.cw}×${o.ch})`); };
    const bar = await page.evaluate(() => { const t = document.getElementById('top').getBoundingClientRect(), tabs = document.getElementById('tabs'), last = tabs.lastElementChild.getBoundingClientRect(), tb = document.getElementById('topBtns').getBoundingClientRect(); return { h: Math.round(t.height), tabsScroll: tabs.scrollWidth > tabs.clientWidth + 1, lastRight: Math.round(last.right), btnRight: Math.round(tb.right), w: innerWidth }; });
    ok(bar.btnRight <= bar.w && (bar.tabsScroll || bar.lastRight <= bar.w), `${name}: top bar ${bar.h}px tall, Save case on screen, tabs ${bar.tabsScroll ? 'scroll sideways' : 'all fit'}`);
    await over(null, 'Scans tab'); await a.shot(OUT + `h3-${name}-scans.png`);
    await page.evaluate(() => APP.shell.goto('tools')); await page.waitForTimeout(200); await a.shot(OUT + `h3-${name}-tools.png`);
    const m = await a.go('model'); await m.waitForFunction(() => APP.A.lower.model && !APP.A.lower.dirty, null, { timeout: 240000 }); await a.idle(m);
    await over(null, 'Models tab (hub)'); await over(m, 'Models tab (tool)'); await a.shot(OUT + `h3-${name}-model.png`);
    const an = await a.go('analysis'); await over(an, 'Analysis tab (tool)'); await a.shot(OUT + `h3-${name}-analysis.png`);
    const vis = await an.evaluate(() => { const b = document.querySelector('#topBtns button'), r = b.getBoundingClientRect(), v = document.getElementById('view').getBoundingClientRect(); return r.width > 0 && r.left >= v.left - 1 && r.top >= v.top - 1 && r.right <= innerWidth; });
    ok(vis, `${name}: the tool's own button (Measure) floats inside its view`);
    for (const id of ['tray', 'wax']) { await page.click(`#tabs [data-tab=${id}]`); await a.settle(); await page.waitForTimeout(1200); await over(null, id + ' tab (hub)'); await a.shot(OUT + `h3-${name}-${id}.png`); }
    await a.go('scans'); await a.shot(OUT + `h3-${name}-locked.png`);
    { const e = a.errors.filter((x) => !/font-src/.test(x)); ok(e.length === 0, `${name}: no page errors ` + e.slice(0, 2).join(' | ')); }   // (the site's Tray Card asks for the site's /fonts/, refused only by this harness)
    await a.close();
  }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
