// Prep Card on a preparation that leans: the demo 46 stump tipped 25° towards the buccal (mkprep.mjs with LEAN=25), as an upper incisor
// leans. Seen from straight above, the top of the stump lies partly outside its own margin, so the prepared surface has to be judged along
// the tooth's own axis. Checks: the axis found, the whole stump counted (as much as on the upright preparation), the walls about that axis.
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs'), DATA = '/home/claude/suite/dev/data/';
const T = JSON.parse(fs.readFileSync(DATA + 'prep-lean-truth.json')), U = JSON.parse(fs.readFileSync(DATA + 'prep-truth.json'));
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const run = async (file, T) => {
    const { page, errors, close } = await openApp('prep-card', { width: 1400, height: 900 });
    await page.waitForFunction(() => window.APP);
    await page.setInputFiles('input[data-ss=file]', [DATA + file, DATA + 'prep-upper.stl']);
    await page.waitForFunction(() => APP.scans.has('lower') && APP.scans.has('upper') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 });
    const r = await page.evaluate((T) => { const M = APP.scans.lower.matrix, V = (p) => new APP.THREE.Vector3(...p).applyMatrix4(M).toArray();
      APP.P.jaw = 'lower'; APP.P.seed = V(T.seed); APP.P.loop = T.loop.map(V); APP.P.dir = null; APP.analyse(); const R = APP.R;
      const truthAxis = new APP.THREE.Vector3(...T.axis).transformDirection(M), found = new APP.THREE.Vector3(...R.d), s = R.sides;
      return { off: found.angleTo(truthAxis) * 180 / Math.PI, area: R.total, b: s.buccal.angle, m: s.mesial.angle, d: s.distal.angle, l: s.lingual.angle, md: R.tocMD, under: R.uSelf };
    }, T);
    await close(); return { ...r, errors };
  };
  const up = await run('prep-lower.stl', U), le = await run('prep-lean-lower.stl', T);
  const f = (r) => `${r.area.toFixed(1)} mm², walls B ${r.b.toFixed(1)}° M ${r.m.toFixed(1)}° D ${r.d.toFixed(1)}° L ${r.l.toFixed(1)}°`;
  // (this preparation's buccal wall converges 6° and its lingual wall flares 6°, so its walls themselves lean 6° lingually: the axis found follows them)
  ok(up.off < 7, `upright preparation: axis ${up.off.toFixed(1)}° from upright — its walls lean 6° by design (${f(up)})`);
  ok(le.off < 7 && Math.abs(le.off - up.off) < 2, `leaning preparation (25°): axis ${le.off.toFixed(1)}° from the built one, as on the upright one`);
  ok(Math.abs(le.area - up.area) < 0.15 * up.area, `…the whole stump counted: ${le.area.toFixed(1)} mm² (upright ${up.area.toFixed(1)} mm²)`);
  ok([up, le].every((r) => Math.abs(r.md - 12) < 2 && Math.abs(r.b + r.l) < 2), `total occlusal convergence as built on both (MD 12°, BL 0°): upright MD ${up.md.toFixed(1)}° BL ${(up.b + up.l).toFixed(1)}°, leaning MD ${le.md.toFixed(1)}° BL ${(le.b + le.l).toFixed(1)}°`);
  ok(!up.errors.length && !le.errors.length, 'no page errors ' + [...up.errors, ...le.errors].slice(0, 2).join(' | '));
})();
