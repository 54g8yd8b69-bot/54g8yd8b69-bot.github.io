// Shell Card's spaced model (VFR): the wax-up model with its base (mkshell.mjs) and a spacer over the waxed-up incisors.
// Checks: closed solid; the spacer stands its thickness off the tapped teeth; the teeth not tapped and the base are left exactly
// as they were; both STLs download; a scan without a base is refused with a clear message.
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs'), DATA = '/home/claude/suite/dev/data/', OUT = '/home/claude/suite/dev/out/shell-card/';
fs.mkdirSync(OUT, { recursive: true });
const W = JSON.parse(fs.readFileSync(DATA + 'shell-truth.json'));
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const { page, errors, shot, close } = await openApp('shell-card', { width: 1400, height: 900 });
  const idle = async () => { await page.waitForTimeout(150); await page.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 }); };
  await page.waitForFunction(() => window.APP);
  // first a scan without a base: refused, with the way to fix it
  await page.setInputFiles('input[data-ss=file]', DATA + 'shell-waxup-lower.stl'); await idle();
  await page.evaluate(() => APP.shell.goto('make')); await page.click('#mkMode [data-v=spacer]'); await page.evaluate(() => APP.shell.goto('shape'));
  const no = await page.evaluate(() => document.getElementById('shModel').innerText);
  ok(/not a solid model/.test(no) && /Models/.test(no), 'a wax-up scan without a base is not accepted, and the step says to build its model on Models: ' + no.split('\n')[0]);
  // the wax-up model with its base
  await page.setInputFiles('input[data-ss=file]', DATA + 'shell-waxup-model-lower.stl'); await idle();
  await page.evaluate(() => { APP.P.jaw = 'lower'; APP.shell.goto('shape'); });
  ok(/closed solid/.test(await page.evaluate(() => document.getElementById('shModel').innerText)), 'the wax-up model with its base is accepted');
  const def = await page.evaluate(() => ({ p: APP.P.space, ui: +document.getElementById('dSpace').value, max: +document.getElementById('dSpace').max }));
  ok(def.p === 3 && def.ui === 3 && def.max >= 6, `the spacer starts at 3 mm (slider up to ${def.max} mm); this run uses 1.5 mm`);
  await page.evaluate((W) => { APP.P.taps = W.incisors.map((t) => t.tip); APP.RB.space.set(1.5); APP.P.space = 1.5; APP.shell.goto('design'); }, W);
  await page.click('#dBuild'); await idle();
  if (!(await page.evaluate(() => !!APP.B))) { console.log('  status: ' + await page.evaluate(() => [...document.querySelectorAll('[class*=status],[id*=status],.toast')].map((e) => e.className + ': ' + e.textContent).join(' || ').slice(0, 500))); console.log(errors); }
  const r = await page.evaluate((W) => {
    const THREE = APP.THREE, B = APP.B, M = APP.scans.lower.matrix, model = APP.scans.framed('lower'), g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(B.mesh.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(B.mesh.indices), 1)); const bvh = new APP.N.MeshBVH(g), hit = {};
    const P = model.positions, onT = [], offT = [], q = new THREE.Vector3(), inc = W.incisors.map((t) => ({ c: new THREE.Vector3(t.centre[0], t.centre[1], t.tip[2]).applyMatrix4(M), w: t.width }));
    let molar = null; { const all = APP.N.makeDemoArch ? null : null; }
    for (let v = 0; v < P.length / 3; v += 2) { q.set(P[3 * v], P[3 * v + 1], P[3 * v + 2]);
      const t = inc.find((t) => Math.hypot(q.x - t.c.x, q.y - t.c.y) < t.w * 0.3 && q.z < t.c.z - 0.8 && q.z > t.c.z - 6);
      if (t) { bvh.closestPointToPoint(q, hit); onT.push(hit.distance); }
      else if (Math.abs(q.x) > 18 && q.y > 0 && q.z > -4) { bvh.closestPointToPoint(q, hit); offT.push(hit.distance); } }   // molars and premolars, well away from the spacer
    const Q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(f * (s.length - 1))]; };
    let zm = Infinity, zb = Infinity; for (let i = 2; i < P.length; i += 3) zm = Math.min(zm, P[i]); const Bp = B.mesh.positions; for (let i = 2; i < Bp.length; i += 3) zb = Math.min(zb, Bp[i]);
    const gm = new THREE.BufferGeometry(); gm.setAttribute('position', new THREE.BufferAttribute(model.positions, 3)); gm.setIndex(new THREE.BufferAttribute(Uint32Array.from(model.indices), 1)); const bm = new APP.N.MeshBVH(gm), hm = {};
    const can = W.canines.map((t) => { q.set(...t.tip).applyMatrix4(M); bm.closestPointToPoint(q, hm); const on = hm.point.clone(); bvh.closestPointToPoint(on, hit); return hit.distance; });   // the model's surface point at each canine tip, against the spaced model
    return { can, info: B.info, closed: APP.N.isWatertight(B.mesh), nOn: onT.length, on05: Q(onT, 0.05), onMed: Q(onT, 0.5), on95: Q(onT, 0.95), nOff: offT.length, off99: Q(offT, 0.99), base: zb - zm };
  }, W);
  ok(r.closed && r.info.closed, `spaced model made: closed solid, ${r.info.added.toFixed(0)} mm³ added, ${r.info.tris} triangles, in ${r.info.seconds.toFixed(1)} s`);
  ok(Math.abs(r.onMed - 1.5) < 0.08 && r.on05 > 1.35 && r.on95 < 1.6, `the spacer stands 1.5 mm off the four waxed-up incisors: ${r.nOn} points, median ${r.onMed.toFixed(3)} mm (5–95%: ${r.on05.toFixed(3)}–${r.on95.toFixed(3)})`);
  ok(r.off99 < 0.02, `the teeth not tapped are left exactly as they were (${r.nOff} points, 99% within ${r.off99.toFixed(4)} mm), so the retainer seats on them`);
  ok(r.can.every((d) => d < 0.02), `the canines beside the waxed incisors are not spaced (tips ${r.can.map((d) => d.toFixed(3)).join(' and ')} mm off), so the spacer stops at the contacts`);
  ok(Math.abs(r.base) < 1e-3, `the base is the wax-up model’s own (lowest point ${r.base.toFixed(4)} mm from it), so both prints sit the same`);
  await page.waitForTimeout(300); await page.evaluate(() => APP.viewer.setView('front')); await shot(OUT + 't2-spacer.png');
  await page.evaluate(() => APP.shell.goto('export')); await idle();
  const [d1] = await Promise.all([page.waitForEvent('download'), page.click('#xStl')]); const f1 = OUT + 't2-spaced.stl'; await d1.saveAs(f1);
  const [d2] = await Promise.all([page.waitForEvent('download'), page.click('#xWax')]); const f2 = OUT + 't2-waxup.stl'; await d2.saveAs(f2);
  const tri = (f) => { const b = fs.readFileSync(f), n = b.readUInt32LE(80); return b.length === 84 + 50 * n ? n : -1; };
  ok(d1.suggestedFilename() === 'spaced-model-lower.stl' && tri(f1) === r.info.tris && d2.suggestedFilename() === 'waxup-model-lower.stl' && tri(f2) > 1000, `both downloads well-formed: ${d1.suggestedFilename()} (${tri(f1)} triangles) and ${d2.suggestedFilename()} (${tri(f2)})`);
  ok(errors.length === 0, 'no page errors ' + errors.slice(0, 3).join(' | '));
  await close();
})();
