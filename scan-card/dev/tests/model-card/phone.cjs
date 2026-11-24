const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const O = '/home/claude/suite/dev/out/model-card/';
(async () => {
  const { page, errors, shot, close } = await openApp('model-card', { width: 390, height: 780, touch: true, dpr: 2 });
  await page.waitForFunction(() => window.APP); await page.waitForTimeout(300); await shot(O + '50-phone-empty.png');
  await page.tap('[data-ss=demo]'); await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 60000 });
  await page.waitForTimeout(300); await shot(O + '51-phone-loaded.png');
  await page.evaluate(() => APP.shell.goto('base')); await page.waitForFunction(() => APP.A.upper.info && APP.A.lower.info && !document.querySelector('#busy.show'), { timeout: 120000 });
  await page.waitForTimeout(300); await shot(O + '52-phone-base.png');
  const m = await page.evaluate(() => ({ topOverflow: document.querySelector('#top').scrollWidth > document.querySelector('#top').clientWidth, bodyW: document.documentElement.scrollWidth, panel: document.querySelector('.panel').getBoundingClientRect().width, view: document.querySelector('#view').getBoundingClientRect().height }));
  console.log(JSON.stringify(m), 'errors', errors); await close();
})();
