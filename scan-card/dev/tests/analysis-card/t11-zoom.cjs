// Wheel zoom and right-drag pan in the locked occlusal view: markers keep their pixel size, clicks still land where aimed.
const L = require('./lib.cjs');
(async () => {
  const { page, errors, shot, close } = await L.open(); let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? '  ok  ' : '  FAIL', m); };
  await L.loadDemo(page, 0);
  const truth = await page.evaluate(() => APP.scans.demoTruth), by = {}; for (const t of truth.upper.teeth) by[t.fdi] = t;
  await page.evaluate(() => APP.shell.goto('widths')); await page.waitForTimeout(150);
  await L.clickWorld(page, by[16].distalPick); await L.clickWorld(page, by[16].mesialPick);
  const info = () => page.evaluate(() => { const c = APP.viewer.camera, sp = APP.viewer.scene.children.filter((o) => o.isSprite), k = (c.top - c.bottom) / c.zoom / APP.viewer.size.h; return { zoom: c.zoom, px: sp.map((s) => s.scale.x / k), q: c.quaternion.toArray().map((v) => +v.toFixed(5)).join() }; });
  const a = await info(), at = await L.screenOf(page, by[13].tip);
  await page.mouse.move(at[0], at[1]); await page.mouse.wheel(0, -600); await page.waitForTimeout(250);
  const b = await info(); ok(b.zoom > a.zoom * 1.3, `wheel zooms in: ${a.zoom.toFixed(2)} → ${b.zoom.toFixed(2)}`);
  ok(b.px.every((v) => Math.abs(v - 8) < 0.01 || Math.abs(v - 11) < 0.01), 'markers keep their size on screen after zooming: ' + b.px.map((v) => v.toFixed(1)).join(', ') + ' px');
  // left-drag must not rotate while the view is locked; right-drag pans
  await page.mouse.move(at[0], at[1]); await page.mouse.down(); await page.mouse.move(at[0] + 80, at[1] + 40, { steps: 4 }); await page.mouse.up();
  const c = await info(); ok(c.q === b.q, 'left-drag does not rotate the locked occlusal view');
  const s0 = await L.screenOf(page, by[13].tip); await page.mouse.move(at[0], at[1]); await page.mouse.down({ button: 'right' }); await page.mouse.move(at[0] + 60, at[1] + 30, { steps: 4 }); await page.mouse.up({ button: 'right' }); const s1 = await L.screenOf(page, by[13].tip);
  ok(Math.abs(s1[0] - s0[0] - 60) < 3 && Math.abs(s1[1] - s0[1] - 30) < 3, `right-drag pans the view (moved ${(s1[0] - s0[0]).toFixed(0)}, ${(s1[1] - s0[1]).toFixed(0)} px)`);
  await L.clickWorld(page, by[15].distalPick); await L.clickWorld(page, by[15].mesialPick);
  ok(Math.abs((await page.evaluate(() => APP.calc.w[15])) - 6.7) < 0.01, 'a tooth clicked while zoomed and panned measures ' + (await page.evaluate(() => APP.calc.w[15].toFixed(3))) + ' (designed 6.7)');
  await shot(L.O + 't11-zoomed.png');
  await page.uncheck('#wLock'); await page.mouse.move(at[0], at[1]); await page.mouse.down(); await page.mouse.move(at[0] + 80, at[1] + 40, { steps: 4 }); await page.mouse.up();
  ok((await info()).q !== c.q, 'with “Keep the occlusal view” unticked, left-drag rotates'); await page.check('#wLock'); await page.waitForTimeout(100);
  ok((await info()).q === a.q, 'ticking it again returns to the occlusal view');
  console.log(fails ? `${fails} FAILED` : 'all passed', '| errors', errors); await close();
})();
