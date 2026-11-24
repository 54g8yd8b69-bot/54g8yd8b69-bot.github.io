// Compare Card on its own: the made-up After (moved copy with 0.5 mm off the incisal edges) is lined up and the wear is measured.
// Then a real second file (the same demo arch meshed at a different resolution, worn, moved, written to STL) is loaded.
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs'), OUT = '/home/claude/suite/dev/out/compare-card/';
let bad = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { bad++; process.exitCode = 1; } };
(async () => {
  const { page, errors, shot, close } = await openApp('compare-card', { width: 1400, height: 900 });
  const idle = async () => { await page.waitForTimeout(150); await page.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 }); };
  await page.waitForFunction(() => window.APP); await page.click('[data-ss=demo]'); await idle();
  await page.evaluate(() => APP.shell.goto('second')); await page.click('#cmJaw [data-v=lower]');
  const t0 = Date.now(); await page.click('#cmMade'); await idle();
  const a = await page.evaluate(() => ({ fit: APP.C.fit, s: APP.C.stats, step: APP.shell.steps[APP.shell.current].id }));
  ok(a.step === 'align' && a.fit.rms < 0.01, `made-up After lined up in ${Date.now() - t0} ms: fit error ${a.fit.rms.toFixed(4)} mm`);
  ok(Math.abs(a.s.lo + 0.5) < 0.03 && a.s.hi < 0.12, `most lost ${a.s.lo.toFixed(3)} mm (worn 0.5), most gained ${a.s.hi.toFixed(3)} mm (nothing added)`);
  ok(a.s.within > 0.85 && a.s.loss > 0.005 && a.s.gain < 0.002, `unchanged ${(a.s.within * 100).toFixed(1)}%, less ${(a.s.loss * 100).toFixed(1)}%, more ${(a.s.gain * 100).toFixed(2)}%`);
  // where is the loss? only on the incisors
  const where = await page.evaluate(() => { const d = APP.C.dev, P = APP.C.mesh.positions; let inc = 0, other = 0; for (let v = 0; v < d.length; v++) if (d[v] < -0.15) { if (Math.abs(P[3 * v]) < 13 && P[3 * v + 1] < -12) inc++; else other++; } return { inc, other }; });
  ok(where.inc > 200 && where.other === 0, `every point lost by more than 0.15 mm is on the incisors (${where.inc} there, ${where.other} elsewhere)`);
  await page.evaluate(() => APP.shell.goto('map')); await page.waitForTimeout(400); await shot(OUT + 'c1-map.png');
  // tap to read
  const xy = await page.evaluate(() => { const p = APP.C.stats.loAt, q = APP.viewer.toScreen(new APP.THREE.Vector3(...p)), r = APP.viewer.dom.getBoundingClientRect(); return [q.x + r.left, q.y + r.top]; });
  await page.mouse.click(xy[0], xy[1]); await page.waitForTimeout(200);
  const lbl = await page.evaluate(() => [...document.querySelectorAll('.lbl')].map((e) => e.textContent).filter((t) => /mm|no match/.test(t) && !/most/.test(t)).join('|'));
  ok(/^−?-0\.[45]\d mm$/.test(lbl), 'tapping the deepest spot reads ' + lbl);
  // a real second file: different triangles, worn, moved
  const made = await page.evaluate(() => { const N = APP.N, b0 = N.makeDemoPair({ res: 0.37 }).lower, P = b0.positions, out = Float32Array.from(P); let zt = -1e9; for (let i = 2; i < P.length; i += 3) zt = Math.max(zt, P[i]);
    for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i]) < 11 && P[i + 1] < -15 && P[i + 2] > zt - 3) out[i + 2] -= 0.3 * N.clamp((P[i + 2] - (zt - 3)) / 1.5, 0, 1);
    const T = new N.THREE.Matrix4().makeRotationFromEuler(new N.THREE.Euler(0.4, -0.2, 2.2)).setPosition(10, -30, 22); return Array.from(new Uint8Array(N.stlBinary(N.transformMesh({ positions: out, indices: b0.indices }, T)))); });
  fs.writeFileSync(OUT + 'after-worn.stl', Buffer.from(made));
  await page.evaluate(() => APP.shell.goto('second'));
  await page.setInputFiles('#cmInp', OUT + 'after-worn.stl'); await idle();
  const b = await page.evaluate(() => ({ fit: APP.C.fit, s: APP.C.stats, name: APP.C.after.name }));
  ok(b.name === 'after-worn.stl' && b.fit.rms < 0.02, `a second file in the scanner's own position (turned 125°, moved 40 mm, other triangles) lined up: fit error ${b.fit.rms.toFixed(4)} mm`);
  ok(Math.abs(b.s.lo + 0.3) < 0.04, `its 0.3 mm of wear measured as ${b.s.lo.toFixed(3)} mm`);
  // case round trip
  const blob = await page.evaluate(async () => Array.from(new Uint8Array(await (await APP.scans.toCase().toBlob('t')).arrayBuffer())));
  await page.evaluate(async (a) => { await APP.scans.useCase(await APP.N.DentalCase.fromBlob(new Blob([new Uint8Array(a)]))); }, blob); await idle();
  const c = await page.evaluate(() => APP.C.stats && APP.C.stats.lo);
  ok(Math.abs(c - b.s.lo) < 1e-6, 'the case file keeps the After scan and its position: same result after reopening');
  console.log('errors:', JSON.stringify(errors.slice(0, 4))); ok(errors.length === 0, 'no page errors');
  await close(); console.log(bad ? bad + ' FAILED' : 'all passed');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
