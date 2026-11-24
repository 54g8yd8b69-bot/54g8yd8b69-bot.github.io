// node dev/tests/suite/phone.cjs <app> <stepId> [demoIndex]  → dev/out/suite/phone-<app>.png   (390×780, touch)
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
(async () => {
  const [app, step, di] = process.argv.slice(2);
  const { page, errors, shot, close } = await openApp(app, { width: 390, height: 780, touch: true, dpr: 2 });
  await page.waitForFunction(() => window.APP && APP.scans); await page.tap(`[data-ss=demo][data-i="${di || 0}"]`);
  await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 90000 });
  if (step) { await page.evaluate((s) => APP.shell.goto(s), step); await page.waitForTimeout(1500); await page.waitForFunction(() => !document.querySelector('#busy.show'), { timeout: 180000 }); }
  await page.waitForTimeout(400); await shot(`/home/claude/suite/dev/out/suite/phone-${app}.png`);
  const m = await page.evaluate(() => ({ pageW: document.documentElement.scrollWidth, topOverflow: document.querySelector('#top').scrollWidth - document.querySelector('#top').clientWidth, sideOverflow: document.querySelector('#steps').scrollWidth - document.querySelector('#steps').clientWidth }));
  console.log(app, JSON.stringify(m), 'errors', errors); await close();
})();
