const { openApp } = require('/home/claude/suite/dev/pw.cjs');
(async () => {
  const { page, errors, close } = await openApp('splint-card', { width: 1400, height: 900 });
  await page.waitForFunction(() => window.APP, { timeout: 60000 });
  await page.click('[data-ss=demo]'); await page.waitForFunction(() => APP.scans.upper && !document.querySelector('#busy.show'), { timeout: 60000 });
  await page.evaluate(() => { APP.P.jaw = 'lower'; APP.shell.goto('margin'); }); await page.waitForTimeout(500);
  await page.evaluate(() => APP.viewer.setView('left')); await page.waitForTimeout(300);
  const r = await page.evaluate(() => { const T = APP.N.THREE, out = [], rc = APP.viewer.dom.getBoundingClientRect(); const d = APP.dots().find((q) => q.side === 'B' && q.k === 3), p0 = d.sprite.position.clone(), s0 = APP.viewer.toScreen(p0);
    for (const dy of [0, 20, 45]) { const ray = new T.Raycaster(); ray.setFromCamera(new T.Vector2((s0.x / rc.width) * 2 - 1, -((s0.y + dy) / rc.height) * 2 + 1), APP.viewer.camera); const dir = ray.ray.direction, w0 = p0.clone().sub(ray.ray.origin), b = dir.z, den = 1 - b * b; out.push({ dy, t: (b * dir.dot(w0) - w0.z) / den, dir: dir.toArray().map((v) => +v.toFixed(3)), dist: w0.length() }); }
    return { p0: p0.toArray(), s0, out, size: APP.viewer.size, cam: APP.viewer.camera.position.toArray() }; });
  console.log(JSON.stringify(r)); await close();
})();
