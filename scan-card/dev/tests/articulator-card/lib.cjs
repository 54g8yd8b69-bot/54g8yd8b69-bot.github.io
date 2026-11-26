// Helpers shared by the Articulator Card tests (headless Chrome through dev/pw.cjs).
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs');
const OUT = '/home/claude/suite/dev/out/articulator-card/', DATA = '/home/claude/suite/dev/data/';
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { fails++; process.exitCode = 1; } };

async function open(opts = {}) {
  const a = await openApp('articulator-card', { width: 1400, height: 900, ...opts });
  await a.page.waitForFunction(() => window.APP && APP.shell, null, { timeout: 90000 });
  /** wait until the page has nothing left to do: no busy overlay, the step entered */
  a.idle = async () => { await a.page.waitForTimeout(120); await a.page.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 }); await a.page.evaluate(() => APP.entering); await a.page.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 }); };
  /** load two files from dev/data as the scans, exactly where they are (no orienting): synthetic shapes in the case frame */
  a.pair = async (upper, lower = 'art-lower.stl') => {
    await a.page.evaluate(async ({ upper, lower }) => {
      const get = async (f) => APP.N.parseMesh(await (await fetch('/dev/data/' + f)).arrayBuffer(), 'stl', f);
      const I = new APP.THREE.Matrix4(), lo = await get(lower), up = await get(upper);
      APP.scans.setScan('lower', lo, lower, { matrix: I }); APP.scans.setScan('upper', up, upper, { matrix: I });
    }, { upper, lower });
    await a.idle();
  };
  /** settings (defaults first) and the five points, then on to a step */
  a.setup = async (o = {}, pts = null) => {
    await a.page.evaluate(({ o, pts }) => { const d = APP.DEF(); for (const k of ['icw', 'side', 'balk', 'sci', 'ben', 'iss', 'apart', 'guide', 'table', 'tol', 'travel']) APP.P[k] = o[k] !== undefined ? o[k] : d[k]; if (pts) APP.P.pts = pts; APP.changed(); APP.putControls(); }, { o, pts });
  };
  a.goto = async (id) => { await a.page.evaluate((id) => APP.shell.goto(id), id); await a.idle(); };
  /** work a movement out (from scratch) and return its steps */
  a.run = async (id) => {
    await a.page.evaluate(async (id) => { await APP.ensure(); if (APP.E) delete APP.E.res[id]; APP.theta0(); await APP.run(id); }, id);
    return a.page.evaluate((id) => { const R = APP.E.res[id]; return { verdict: R.verdict, steps: R.steps.map((s) => ({ p: s.p, theta: s.theta, pose: s.pose, inc: s.inc, drop: s.drop, min: s.min, free: s.free, stuck: s.stuck, by: s.by, contacts: s.contacts.map((c) => ({ side: c.side, upper: c.upper, lower: c.lower, d: c.d, at: c.at, atL: c.atL, ap: c.ap })) })) }; }, id);
  };
  /** at every worked-out position: do the surfaces cross (they must not), and do they cross if the jaw closes `by` mm more at the incisal point (they must: it closed as far as it could) */
  a.solid = async (id, by = 0.01) => a.page.evaluate(({ id, by }) => {
    const E = APP.E, R = E.res[id], M = new APP.THREE.Matrix4(), out = { cross: 0, notTight: 0, n: 0, worst: [] };
    for (const s of R.steps) {
      if (s.free) continue; out.n++;
      M.fromArray(s.pose); if (E.up.bvh.intersectsGeometry(E.lo.geo, M)) { out.cross++; out.worst.push(s.p); }
      if (s.by !== 'teeth') continue;
      const C = APP.K.condyles(E.F, APP.P, id, s.p), M2 = APP.K.pose(E.F, C, s.theta - by / E.F.rInc); if (!E.up.bvh.intersectsGeometry(E.lo.geo, M2)) out.notTight++;
    }
    return out;
  }, { id, by });
  return a;
}
// small vector helpers for Node-side checks
const V = {
  sub: (a, b) => a.map((x, i) => x - b[i]), dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  /** a point moved by a column-major 4×4 (as THREE.Matrix4.toArray) */
  apply: (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]],
};
const deg = (r) => r * 180 / Math.PI;
module.exports = { open, ok, OUT, DATA, V, deg, failed: () => fails };
