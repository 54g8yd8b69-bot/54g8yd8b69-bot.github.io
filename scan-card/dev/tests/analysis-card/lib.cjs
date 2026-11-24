// helpers shared by the Analysis Card browser tests
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const O = '/home/claude/suite/dev/out/analysis-card/', D = '/home/claude/suite/dev/data/';
const idle = (page) => page.waitForFunction(() => !document.querySelector('#busy.show'), { timeout: 120000 });
async function open(opts = {}) { const a = await openApp('analysis-card', { width: 1400, height: 900, ...opts }); await a.page.waitForFunction(() => window.APP, { timeout: 60000 }); return a; }
async function loadDemo(page, i = 0) {
  await page.evaluate(() => APP.shell.goto('load'));
  await page.click(`[data-ss=demo][data-i="${i}"]`);
  await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && APP.scans.demoTruth && !document.querySelector('#busy.show'), { timeout: 120000 });
  await page.waitForTimeout(150);
}
/** screen position (page coordinates) of a case-frame point in the current view */
const screenOf = (page, p) => page.evaluate((p) => { const s = APP.viewer.toScreen(new APP.THREE.Vector3(p[0], p[1], p[2])), r = APP.viewer.dom.getBoundingClientRect(); return [s.x + r.left, s.y + r.top]; }, p);
async function clickWorld(page, p, o = {}) { const [x, y] = await screenOf(page, p); if (o.touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y, o); }
async function dragWorld(page, from, to) { const a = await screenOf(page, from), b = await screenOf(page, to); await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps: 3 }); await page.mouse.move(b[0], b[1], { steps: 3 }); await page.mouse.up(); }
/**
 * Drive the tooth-width step exactly as a user would: read the prompt, click that point, repeat until the app has no
 * more points to ask for. `pointFor(fdi, 'm'|'d')` returns the case-frame point to click (or null to stop).
 */
async function clickAllWidths(page, pointFor, o = {}) {
  await page.evaluate(() => APP.shell.goto('widths')); await page.waitForTimeout(100);
  let n = 0;
  for (let guard = 0; guard < 80; guard++) {
    const cur = await page.evaluate(() => APP.ui.cur && { f: APP.ui.cur.f, k: APP.ui.cur.k, prompt: document.querySelector('#wPrompt b').textContent });
    if (!cur) break;
    const p = pointFor(cur.f, cur.k, cur); if (!p) break;
    await clickWorld(page, p, o); n++;
    await page.waitForFunction((c) => !APP.ui.cur || APP.ui.cur.f !== c.f || APP.ui.cur.k !== c.k, cur, { timeout: 5000 });
  }
  return n;
}
const truthPoint = (truth) => (f, k) => { const jaw = f < 30 ? 'upper' : 'lower', t = truth[jaw].teeth.find((x) => x.fdi === f); return t ? t[k === 'm' ? 'mesialPick' : 'distalPick'] : null; };
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]), d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
module.exports = { open, loadDemo, screenOf, clickWorld, dragWorld, clickAllWidths, truthPoint, idle, d2, d3, O, D };
