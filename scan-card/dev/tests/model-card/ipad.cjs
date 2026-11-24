const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const O = '/home/claude/suite/dev/out/model-card/';
(async () => {
  // iPad portrait with touch
  { const { page, errors, shot, close } = await openApp('model-card', { width: 820, height: 1180, touch: true, dpr: 2 });
    await page.waitForFunction(() => window.APP); await page.tap('[data-ss=demo]'); await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 60000 });
    await page.waitForTimeout(300); await shot(O + '30-ipad-load.png');
    await page.evaluate(() => APP.shell.goto('hollow')); await page.waitForFunction(() => APP.A.upper.info && APP.A.lower.info && !document.querySelector('#busy.show'), { timeout: 120000 });
    await page.tap('#hoMode [data-v=hollow]'); await page.waitForFunction(() => APP.A.lower.info && APP.A.lower.info.cavity > 0 && !document.querySelector('#busy.show'), { timeout: 120000 });
    await page.tap('#hoUnder [data-v=closed]'); await page.waitForTimeout(300); await page.waitForFunction(() => !document.querySelector('#busy.show'), { timeout: 120000 });
    await page.evaluate(() => { APP.A.upper.object.visible = false; APP.viewer.fit(APP.A.lower.object, { dir: [0.2, -0.4, -0.9] }); }); await page.waitForTimeout(300); await shot(O + '31-ipad-hollow.png');
    // touch: one-finger drag rotates the view
    const c0 = await page.evaluate(() => APP.viewer.camera.position.toArray());
    const cdp = await page.context().newCDPSession(page);
    const tp = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    await tp('touchStart', [{ x: 400, y: 300 }]); for (let i = 1; i <= 6; i++) await tp('touchMove', [{ x: 400 + 12 * i, y: 300 - 8 * i }]); await tp('touchEnd', []);
    const c1 = await page.evaluate(() => APP.viewer.camera.position.toArray()); console.log('one-finger drag moved camera by', Math.hypot(c0[0] - c1[0], c0[1] - c1[1], c0[2] - c1[2]).toFixed(1), 'mm');
    console.log('drain notes', JSON.stringify(await page.evaluate(() => APP.A.lower.info.notes)), 'errors', errors); await close(); }
  // a scan the size of a real one
  { const { page, errors, close } = await openApp('model-card', { width: 1400, height: 900 });
    await page.waitForFunction(() => window.APP); let t0 = Date.now(); await page.evaluate(() => APP.scans.loadDemo({ res: 0.2 })); await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 120000 });
    const tris = await page.evaluate(() => [APP.scans.upper.raw.indices.length / 3, APP.scans.lower.raw.indices.length / 3]); console.log('big demo', tris, 'made in', Date.now() - t0, 'ms');
    t0 = Date.now(); await page.evaluate(() => APP.shell.goto('base')); await page.waitForFunction(() => APP.A.upper.info && APP.A.lower.info && !document.querySelector('#busy.show'), { timeout: 240000 }); console.log('solid build both:', Date.now() - t0, 'ms');
    t0 = Date.now(); await page.evaluate(() => { APP.P.hollow = true; return APP.rebuild(); }); console.log('hollow build both:', Date.now() - t0, 'ms', JSON.stringify(await page.evaluate(() => ['upper', 'lower'].map(j => ({ wt: APP.A[j].info.watertight, tris: APP.A[j].info.tris, notes: APP.A[j].info.notes })))));
    const mem = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1); console.log('JS heap MB', mem, 'errors', errors); await close(); }
})();
