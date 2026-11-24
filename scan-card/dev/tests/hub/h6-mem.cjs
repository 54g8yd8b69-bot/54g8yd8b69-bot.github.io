// resident memory of the page's renderer process as tools are opened (large scans), read from /proc
const { openHub } = require('./lib.cjs');
const fs = require('fs'), { execSync } = require('child_process');
const rss = () => { let best = 0; for (const line of execSync("ps -eo pid,rss,args | grep -- '--type=renderer' | grep -v grep || true").toString().split('\n')) { const m = line.trim().match(/^(\d+)\s+(\d+)/); if (m) best = Math.max(best, +m[2]); } return Math.round(best / 1024); };
(async () => {
  const a = await openHub(), { page } = a;
  console.log('empty hub:', rss(), 'MB');
  await page.evaluate(() => APP.scans.loadDemo({ res: 0.2 }));
  await page.waitForFunction(() => APP.scans.has('upper') && APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 180000 });
  await page.waitForTimeout(1500); console.log('hub with 448k + 350k triangle scans:', rss(), 'MB');
  for (const id of ['analysis', 'model', 'splint', 'tray', 'wax']) {
    await page.click(`#tabs [data-tab=${id}]`); await a.settle();
    if (id === 'model') await a.tool('model').waitForFunction(() => APP.A.lower.model && APP.A.upper.model && !APP.A.lower.dirty && !APP.A.upper.dirty, null, { timeout: 300000 });
    await page.waitForTimeout(2500); console.log(`+ ${id}:`, rss(), 'MB');
  }
  await a.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
