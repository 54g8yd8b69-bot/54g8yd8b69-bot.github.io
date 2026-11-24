// browser smoke: whole flow on the demo scans, lower arch default? (upper is picked when both are loaded)
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const O = '/home/claude/suite/dev/out/splint-card/';
(async () => {
  const { page, errors, shot, close } = await openApp('splint-card', { width: 1400, height: 900 });
  await page.waitForFunction(() => window.APP, { timeout: 60000 });
  await page.click('[data-ss=demo]');
  await page.waitForFunction(() => APP.scans.upper && !document.querySelector('#busy.show'), { timeout: 60000 });
  const idle = () => page.waitForFunction(() => !document.querySelector('#busy.show'), { timeout: 120000 });
  const next = async () => { await page.click('#bNext'); await page.waitForTimeout(250); await idle(); await page.waitForTimeout(250); };
  await next(); await next();                                        // orient → appliance
  await shot(O + 'b1-appliance.png');
  await next(); await page.waitForTimeout(400); await shot(O + 'b1-path.png'); console.log('uc', await page.evaluate(() => JSON.stringify(APP.D.uc)));
  await next(); await page.waitForTimeout(300); await shot(O + 'b1-margin.png');
  let t = Date.now(); await next(); console.log('build took', Date.now() - t, 'ms', await page.evaluate(() => JSON.stringify(APP.D.res && APP.D.res.report)));
  await shot(O + 'b1-shell.png');
  await next(); await shot(O + 'b1-check.png'); console.log('thin', await page.evaluate(() => APP.D.thick && APP.D.thick.min));
  await next(); await shot(O + 'b1-export.png');
  console.log('errors', errors);
  await close();
})();
