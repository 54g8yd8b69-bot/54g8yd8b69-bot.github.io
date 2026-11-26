// helpers shared by the CBCT Card browser tests
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs');
const OUT = '/home/claude/suite/dev/out/cbct-card/', DATA = '/home/claude/suite/dev/data/cbct/';
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { fails++; process.exitCode = 1; } };
const truth = () => JSON.parse(fs.readFileSync(DATA + 'truth.json'));
const idle = async (fr) => { await fr.waitForTimeout(150); await fr.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 }); await fr.waitForTimeout(100); };
async function open(opts = {}) {
  const a = await openApp('cbct-card', { width: 1400, height: 900, ...opts });
  await a.page.waitForFunction(() => window.APP && APP.S, null, { timeout: 60000 });
  a.idle = () => idle(a.page);
  a.demo = async () => { await a.page.click('#lDemo'); await a.page.waitForFunction(() => APP.S.vol, null, { timeout: 120000 }); await a.idle(); };
  return a;
}
/** screen position (page coordinates) of a patient point on a view; fr: the frame the tool lives in, off: that frame's offset */
async function screenOf(fr, view, p, off = [0, 0]) {
  const xy = await fr.evaluate(([view, p]) => { const v = APP.views[view], q = APP.D.voxelOf(APP.S.vol, ...p), [a, b] = APP.fromVox(v, ...q), [X, Y] = APP.toScreen(v, a, b), r = v.cv.getBoundingClientRect(); return [r.left + X, r.top + Y]; }, [view, p]);
  return [xy[0] + off[0], xy[1] + off[1]];
}
/** the patient's fake details written into the test files: none may ever show up */
function fakeStrings() { const F = truth().fake; const out = new Set(); for (const v of Object.values(F)) { out.add(v); for (const part of v.split(/[\^ ]/)) if (part.length >= 6) out.add(part); } return [...out]; }
module.exports = { open, ok, OUT, DATA, truth, idle, screenOf, fakeStrings, failed: () => fails };
