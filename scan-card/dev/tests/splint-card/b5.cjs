// flat-plane splint on the demo upper against the lower: preset → auto-open → build → contacts
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const O = '/home/claude/suite/dev/out/splint-card/';
(async () => {
  const { page, errors, shot, close } = await openApp('splint-card', { width: 1400, height: 900 });
  await page.waitForFunction(() => window.APP, { timeout: 60000 });
  const idle = async () => { await page.waitForTimeout(150); await page.waitForFunction(() => !document.querySelector('#busy.show'), { timeout: 240000 }); await page.waitForTimeout(200); };
  await page.click('[data-ss=demo]'); await page.waitForFunction(() => APP.scans.upper && !document.querySelector('#busy.show'), { timeout: 60000 });
  await page.evaluate(() => APP.shell.goto('appliance')); await page.click('#apType [data-v=flat]'); await page.waitForTimeout(200);
  let t = Date.now(); await page.evaluate(() => APP.shell.goto('shell')); await idle(); await page.waitForFunction(() => APP.D.res && !APP.D.dirty, { timeout: 240000 }); console.log('first build', Date.now() - t, 'ms');
  console.log('before opening:', await page.evaluate(() => JSON.stringify({ lift: APP.D.res.report.lift, met: APP.D.res.report.met, thin: APP.D.thick.min, contacts: APP.D.contact && APP.D.contact.patches.length, through: APP.D.contact && APP.D.contact.through })));
  t = Date.now(); await page.click('#shAuto'); await idle(); await page.waitForFunction(() => APP.D.res && !APP.D.dirty && !document.querySelector('#busy.show'), { timeout: 240000 }); console.log('auto-open + rebuild', Date.now() - t, 'ms; open =', await page.evaluate(() => APP.P.open));
  console.log('after opening:', await page.evaluate(() => JSON.stringify({ lift: APP.D.res.report.lift, thin: APP.D.thick.min, min: APP.D.contact.min, contacts: APP.D.contact.patches.length, through: APP.D.contact.through, vol: APP.D.res.report.volume, wt: APP.D.res.report.watertight, genus: APP.D.res.report.genus, times: APP.D.res.report.times })));
  await page.evaluate(() => APP.viewer.setView('front')); await page.waitForTimeout(300); await shot(O + 'b5-shell-front.png');
  await page.evaluate(() => APP.shell.goto('check')); await idle(); await page.click('#ckMap [data-v=contact]'); await page.waitForTimeout(300);
  await page.evaluate(() => { APP.P.showOpp = false; document.getElementById('shShow').checked = false; APP.refreshView(); APP.viewer.setView('bottom'); }); await page.waitForTimeout(400); await shot(O + 'b5-check-contacts.png');
  await page.click('#ckMap [data-v=thick]'); await page.waitForTimeout(300); await shot(O + 'b5-check-thick.png');
  console.log('summary:', (await page.evaluate(() => document.getElementById('ckSummary').innerText)).replace(/\n+/g, ' | '));
  console.log('errors', errors); await close();
})();
