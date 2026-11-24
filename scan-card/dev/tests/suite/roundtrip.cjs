// One case file passed through all three apps: nothing an app does not own may be lost or altered on the way.
//   Model Card (demo, build, save) → Analysis Card (open, save) → Splint Card (open, save) → Model Card (open, save)
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs');
const O = '/home/claude/suite/dev/out/suite/';
const idle = (page) => page.waitForFunction(() => !document.querySelector('#busy.show'), { timeout: 180000 });
async function saveCase(page, file) { const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.evaluate(() => APP.scans.saveCase())]); await dl.saveAs(file); return file; }
async function openIn(app, file) {
  const s = await openApp(app, { width: 1400, height: 900 }); await s.page.waitForFunction(() => window.APP && APP.scans, { timeout: 60000 });
  if (file) { await s.page.setInputFiles('input[data-ss=file]', [file]); await s.page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 120000 }); await s.page.waitForTimeout(500); }
  return s;
}
(async () => {
  const errs = {};
  let s = await openIn('model-card'); await s.page.click('[data-ss=demo]'); await s.page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 60000 });
  await s.page.evaluate(() => { APP.P.hollow = true; APP.shell.goto('export'); }); await s.page.waitForFunction(() => APP.A.upper.info && APP.A.lower.info && !document.querySelector('#busy.show'), { timeout: 180000 }); await idle(s.page);
  const a = await saveCase(s.page, O + 'rt-1-model.zip'); errs.model1 = s.errors.slice(); await s.close();
  s = await openIn('analysis-card', a); const b = await saveCase(s.page, O + 'rt-2-analysis.zip'); errs.analysis = s.errors.slice(); await s.close();
  s = await openIn('splint-card', b); const c = await saveCase(s.page, O + 'rt-3-splint.zip'); errs.splint = s.errors.slice(); await s.close();
  s = await openIn('model-card', c);
  const back = await s.page.evaluate(() => ({ hollow: APP.P.hollow, models: [!!APP.A.upper.model, !!APP.A.lower.model], dirty: [APP.A.upper.dirty, APP.A.lower.dirty] }));
  const d = await saveCase(s.page, O + 'rt-4-model.zip'); errs.model2 = s.errors.slice(); await s.close();
  fs.writeFileSync(O + 'rt.json', JSON.stringify({ files: [a, b, c, d], back, errs }));
  console.log('back in Model Card:', JSON.stringify(back)); console.log('browser errors:', JSON.stringify(errs));
})();
