// helpers shared by the Scan Card hub tests
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const OUT = '/home/claude/suite/dev/out/hub/', DATA = '/home/claude/suite/dev/data/';
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { fails++; process.exitCode = 1; } };
async function openHub(opts = {}) {
  const a = await openApp('scan-card', { width: 1400, height: 900, ...opts });
  await a.page.waitForFunction(() => window.APP && APP.scans, null, { timeout: 60000 });
  a.settle = () => a.page.evaluate(() => APP.H.q);
  a.tool = (id) => a.page.frames().find((f) => f !== a.page.mainFrame() && new RegExp('/scan-card/' + id + '(\\.html|/)').test(f.url()));
  a.idle = async (fr) => { await a.page.waitForTimeout(120); await (fr || a.page).waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 240000 }); };
  a.go = async (id) => { await a.page.click(`#tabs [data-tab=${id}]`); await a.settle(); if (id === 'scans') return a.page; const fr = a.tool(id); await fr.waitForFunction(() => window.APP, null, { timeout: 60000 }); await a.idle(fr); return fr; };
  a.demo = async () => { await a.page.click('[data-ss=demo]'); await a.page.waitForFunction(() => APP.scans.has('upper') && APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 }); };
  /** click a case-frame point in a tool's viewer, through the real page (frame offset included) */
  a.clickWorld = async (id, p) => {
    const fr = a.tool(id), off = await a.page.evaluate((id) => { const r = document.querySelector(`iframe[data-tool=${id}]`).getBoundingClientRect(); return [r.left, r.top]; }, id);
    const [x, y] = await fr.evaluate((p) => { const s = APP.viewer.toScreen(new APP.THREE.Vector3(p[0], p[1], p[2])), r = APP.viewer.dom.getBoundingClientRect(); return [s.x + r.left, s.y + r.top]; }, p);
    await a.page.mouse.click(off[0] + x, off[1] + y);
  };
  return a;
}
module.exports = { openHub, openApp, ok, OUT, DATA, failed: () => fails };
