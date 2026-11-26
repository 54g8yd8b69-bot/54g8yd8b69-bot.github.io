// Shell Card's spaced model on an upper model with a sharp-edged base, solid and hollow (mkshell.mjs), canine to canine, defaults.
// Before the fix, points just off the base's edges were judged inside and sheets of false material ran out along its faces (up to
// 22 mm off the model); a hollow model's cavity also took a layer of spacer. Checks: closed; nothing stands further off the model
// than the spacer's thickness; the hollow model takes no more spacer than the solid one; the first premolars are untouched.
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs'), DATA = '/home/claude/suite/dev/data/', OUT = '/home/claude/suite/dev/out/shell-card/';
const U = JSON.parse(fs.readFileSync(DATA + 'shell-upper-truth.json'));
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const res = {};
  for (const which of ['solid', 'hollow']) {
    const { page, errors, shot, close } = await openApp('shell-card', { width: 1400, height: 900 });
    const idle = async () => { await page.waitForTimeout(150); await page.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 }); };
    await page.waitForFunction(() => window.APP); await page.setInputFiles('input[data-ss=file]', DATA + `shell-upper-model-${which}.stl`); await idle();
    await page.evaluate(() => APP.shell.goto('make')); await page.click('#mkMode [data-v=spacer]');
    await page.evaluate((U) => { APP.P.jaw = 'upper'; APP.P.taps = U.teeth.map((t) => t.tip); APP.shell.goto('design'); }, U); await page.click('#dBuild'); await idle();
    const r = await page.evaluate((U) => { const THREE = APP.THREE, B = APP.B; if (!B) return null; let mx = 0; for (let v = 0; v < B.off.length; v++) mx = Math.max(mx, B.off[v]);
      const M = APP.scans.upper.matrix, model = APP.scans.framed('upper'), g = new THREE.BufferGeometry(), gm = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(B.mesh.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(B.mesh.indices), 1)); gm.setAttribute('position', new THREE.BufferAttribute(model.positions, 3)); gm.setIndex(new THREE.BufferAttribute(Uint32Array.from(model.indices), 1));
      const bvh = new APP.N.MeshBVH(g), bm = new APP.N.MeshBVH(gm), h1 = {}, h2 = {}, q = new THREE.Vector3();
      const nb = U.neighbours.map((t) => { q.set(...t.tip).applyMatrix4(M); bm.closestPointToPoint(q, h1); bvh.closestPointToPoint(h1.point.clone(), h2); return h2.distance; });
      return { space: APP.P.space, maxOff: mx, closed: APP.N.isWatertight(B.mesh), added: B.info.added, sec: B.info.seconds, nb }; }, U);
    res[which] = r;
    ok(r && r.closed && r.space === 3, `${which} upper model: spaced model made with the defaults (${r && r.space} mm), closed, ${r && r.added.toFixed(0)} mm³ added, in ${r && r.sec.toFixed(1)} s`);
    ok(r && r.maxOff <= r.space + 0.12, `${which}: nothing stands further off the model than the spacer (furthest ${r && r.maxOff.toFixed(2)} mm) — no sheets off the base’s edges`);
    ok(r && r.nb.every((d) => d < 0.02), `${which}: the first premolars beside the canines are untouched (${r && r.nb.map((d) => d.toFixed(3)).join(' and ')} mm)`);
    await page.evaluate(() => APP.viewer.setView('front')); await page.waitForTimeout(300); await shot(OUT + `t3-${which}.png`);
    ok(errors.length === 0, `${which}: no page errors ` + errors.slice(0, 2).join(' | ')); await close();
  }
  ok(res.solid && res.hollow && res.hollow.added < res.solid.added * 1.03, `the hollow model takes no more spacer than the solid one, so none goes into its cavity (${res.hollow && res.hollow.added.toFixed(0)} against ${res.solid && res.solid.added.toFixed(0)} mm³)`);
})();
