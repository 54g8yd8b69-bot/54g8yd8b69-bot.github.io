// close-up looks at the built appliance (demo). usage: node b2.cjs [upper|lower]
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const O = '/home/claude/suite/dev/out/splint-card/';
(async () => {
  const jaw = process.argv[2] || 'lower', tag = process.argv[3] || 'c', preset = process.argv[4] || 'guard';
  const { page, errors, shot, close } = await openApp('splint-card', { width: 1400, height: 900 });
  await page.waitForFunction(() => window.APP, { timeout: 60000 });
  await page.click('[data-ss=demo]');
  await page.waitForFunction(() => APP.scans.upper && !document.querySelector('#busy.show'), { timeout: 60000 });
  await page.evaluate((j) => { APP.P.jaw = j; APP.shell.goto('appliance'); }, jaw); await page.click(`#apType [data-v=${preset}]`);
  await page.evaluate(() => APP.shell.goto('shell'));
  await page.waitForFunction(() => APP.D.res && !APP.D.dirty && !document.querySelector('#busy.show'), { timeout: 180000 });
  if (preset === 'flat') { await page.click('#shAuto'); await page.waitForTimeout(500); await page.waitForFunction(() => APP.D.res && !APP.D.dirty && !document.querySelector('#busy.show'), { timeout: 180000 }); await page.evaluate(() => { APP.P.showOpp = false; APP.refreshView(); }); }
  const view = async (name, box, dir, opts = {}) => { await page.evaluate(([box, dir, opts]) => { const T = APP.N.THREE; if (opts.only) APP.scans.setVisible(APP.D.jaw, false); else APP.scans.setVisible(APP.D.jaw, true); APP.viewer.fit(new T.Box3(new T.Vector3(...box[0]), new T.Vector3(...box[1])), { dir }); }, [box, dir, opts]); await page.waitForTimeout(350); await shot(O + `${tag}-${jaw}-${name}.png`, { clip: { x: 340, y: 48, width: 1060, height: 852 } }); };
  const s = jaw === 'upper' ? -1 : 1;                                   // upper teeth point −Z
  await view('molars-buccal', [[18, 2, -6], [32, 24, 4]], [1, -0.25, 0.35 * s]);
  await view('front', [[-14, -30, -6], [14, -16, 4]], [0, -1, 0.3 * s]);
  await view('fit-molars', [[14, 2, -6], [32, 24, 4]], [0.3, 0.1, -1 * s], { only: true });
  await view('lingual', [[-30, 0, -7], [-12, 24, 4]], [1, -0.1, 0.25 * s]);
  console.log('errors', errors); await close();
})();
