// FINAL browser test 5: page opens clean; every button has a tooltip; requests made while loading the demo and building.  node f5.cjs
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
(async () => {
  const { page, errors, close } = await openApp('splint-card', { width: 1400, height: 900 });
  const reqs = []; page.on('request', (r) => { const u = r.url(); if (!u.startsWith('http://localhost') && !u.startsWith('http://127.0.0.1') && !u.startsWith('data:') && !u.startsWith('blob:')) reqs.push(u.slice(0, 90)); });
  await page.waitForFunction(() => window.APP, { timeout: 60000 });
  await page.click('[data-ss=demo]'); await page.waitForFunction(() => APP.scans.upper && !document.querySelector('#busy.show'), { timeout: 60000 });
  for (const s of ['orient', 'appliance', 'path', 'margin', 'shell', 'check', 'export']) { await page.evaluate((s) => APP.shell.goto(s), s); await page.waitForTimeout(300); }
  await page.waitForFunction(() => APP.D.res && !APP.D.dirty && !document.querySelector('#busy.show'), { timeout: 240000 });
  console.log('buttons without a tooltip:', JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('button')).filter((b) => !b.title).map((b) => b.id || b.textContent.trim().slice(0, 24)))));
  console.log('export note:', await page.evaluate(() => Array.from(document.querySelectorAll('.tip, .note')).map((e) => e.textContent).filter((t) => /design aid|medical device/i.test(t)).join(' / ').slice(0, 200)));
  console.log('sources tip:', (await page.evaluate(() => document.getElementById('srcTip').textContent)).slice(0, 1500));
  console.log('requests to other hosts seen by the page:', JSON.stringify(reqs)); console.log('errors', JSON.stringify(errors)); await close();
})();
