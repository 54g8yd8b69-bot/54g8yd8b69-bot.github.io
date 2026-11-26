// Automatic tooth numbering inside Scan Card (synthetic demo): the Shells tab taps 13–23 for the user on the hub's scans, and the
// Analysis tab fills its tooth widths with "Find the teeth"; both kept in the case.
const { openHub, ok, OUT } = require('./lib.cjs');
(async () => {
  const a = await openHub(), { page } = a;
  await a.demo();
  const truth = await page.evaluate(() => APP.scans.demoTruth);
  // Shells: matrix over the upper wax-up (the demo scan itself), taps 13–23
  const sh = await a.go('shell');
  await sh.evaluate(() => APP.shell.goto('make')); await sh.click('#mkMode [data-v=matrix]'); await sh.click('#mkJaw [data-v=upper]');
  await sh.evaluate(() => APP.shell.goto('shape')); await sh.click('#shSelf'); await sh.evaluate(() => APP.shell.goto('teeth')); await a.idle(sh);
  await sh.click('#tAuto'); await a.idle(sh);
  // taps are in the scan's file coordinates, like the demo's truth
  const per = await sh.evaluate((T) => { const taps = APP.P.taps, out = {}; for (const t of T.upper.teeth) out[t.fdi] = taps.filter((q) => Math.hypot(q[0] - t.tip[0], q[1] - t.tip[1], q[2] - t.tip[2]) < 1.5).length; return { out, n: taps.length }; }, truth);
  const hit = Object.keys(per.out).filter((f) => per.out[f]).map(Number).sort((x, y) => x - y);
  ok(per.n === 6 && JSON.stringify(hit) === '[11,12,13,21,22,23]', `Shells in the hub: 6 taps on 13–23 (${hit.join(' ')})`);
  const labs = await sh.evaluate(() => document.querySelectorAll('#labels .lbl.tn').length); ok(labs === 14, `the numbers show on the scan in the tab (${labs})`);
  await sh.waitForTimeout(300); await page.screenshot({ path: OUT + 'h19-shells-autotap.png' });
  // Analysis: Find the teeth
  const an = await a.go('analysis');
  await an.evaluate(() => APP.shell.goto('widths')); await a.idle(an); await an.click('#wFind'); await a.idle(an); await an.waitForTimeout(200);
  const w = await an.evaluate(() => { const f = []; for (const q of [1, 2, 3, 4]) for (let n = 1; n <= 6; n++) if (APP.calc.w[q * 10 + n] != null) f.push(q * 10 + n); return f.length; });
  ok(w === 24, `Analysis in the hub: all 24 widths (1–6) filled by Find the teeth (${w})`);
  await an.waitForTimeout(300); await page.screenshot({ path: OUT + 'h19-analysis-found.png' });
  await a.go('scans');
  const kept = await page.evaluate(() => { const c = APP.buildCase(); return { taps: c.data.shell && c.data.shell.taps.length, auto: c.data.analysis && Object.values(c.data.analysis.teeth).filter((t) => t.auto).length }; });
  ok(kept.taps === 6 && kept.auto >= 24, `the case keeps the taps (${kept.taps}) and the automatic widths (${kept.auto} teeth marked)`);
  const errs = a.errors.filter((e) => !/font-src/.test(e)); ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await a.close();
})().catch((e) => { console.error(e); process.exit(1); });
