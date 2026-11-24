// Prep check on a model with a base (a closed surface): the prepared surface stops at the margin instead of running down
// the base's walls and onto its back. Same exact preparation (46, walls 6°, lingual −6°) checked on the scan and on the model,
// with the real margin and with a margin drawn much too wide (out past the edge of the base).
const { openHub, ok, DATA } = require('./lib.cjs');
const fs = require('fs');
(async () => {
  const T = JSON.parse(fs.readFileSync(DATA + 'prep-truth.json'));
  const a = await openHub(), { page } = a;
  await page.setInputFiles('input[data-ss=file]', [DATA + 'prep-lower.stl', DATA + 'prep-upper.stl']);
  await page.waitForFunction(() => APP.scans.has('upper') && APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 });
  const mark = (pr, wide) => pr.evaluate(({ T, wide }) => {
    const M = APP.scans.lower.matrix, V = (p) => new APP.THREE.Vector3(...p).applyMatrix4(M).toArray(), c = T.loop.reduce((s, p) => [s[0] + p[0] / T.loop.length, s[1] + p[1] / T.loop.length], [0, 0]);
    APP.P.jaw = 'lower'; APP.P.seed = V(T.seed); APP.P.loop = T.loop.map((p) => V(wide ? [c[0] + (p[0] - c[0]) * wide, c[1] + (p[1] - c[1]) * wide, p[2]] : p)); APP.P.dir = null; APP.analyse();
    const R = APP.R; return R ? { area: R.total, b: R.sides.buccal.angle, l: R.sides.lingual.angle, md: R.tocMD, neg: Object.values(R.sides).filter((s) => s.angle < -45).length } : null;
  }, { T, wide });
  let pr = await a.go('prep'); const sc = await mark(pr), scW = await mark(pr, 4);
  const mo = await a.go('model'); await mo.waitForFunction(() => APP.A.lower.model && !APP.A.lower.dirty && APP.A.upper.model && !APP.A.upper.dirty, null, { timeout: 300000 });
  await mo.evaluate(() => APP.shell.goto('export')); await a.idle(mo); await mo.click('#exUse'); await a.settle();
  pr = await a.go('prep'); ok(await pr.evaluate(() => APP.scans.lower.raw.positions.length) === await page.evaluate(() => APP.modelItem('lower').mesh.positions.length), 'Prep check is working on the lower model with its base');
  const md = await mark(pr), mdW = await mark(pr, 4);
  const f = (r) => r ? `${r.area.toFixed(1)} mm², buccal ${r.b.toFixed(1)}°, lingual ${r.l.toFixed(1)}°, MD ${r.md.toFixed(1)}°` : 'no result';
  ok(md && Math.abs(md.area - sc.area) < 0.05 * sc.area && Math.abs(md.b - sc.b) < 0.5 && Math.abs(md.l - sc.l) < 0.5 && Math.abs(md.md - sc.md) < 0.5, `real margin: the same on the model (${f(md)}) as on the scan (${f(sc)})`);
  ok(mdW && mdW.neg === 0 && mdW.area < 1.3 * scW.area, `margin drawn 4× too wide: nothing runs onto the base (model ${f(mdW)}; scan ${f(scW)})`);
  ok(a.errors.length === 0, 'no page errors ' + a.errors.slice(0, 3).join(' | '));
  await a.close();
})();
