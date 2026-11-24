// "Line up with a bite scan" in Scan Card's Load step, driven through the page (synthetic data from mkbite.mjs):
//   1. a pair already in its bite → "Already in the bite", nothing moved
//   2. the upper exported on its own (moved), the bite scan in the lower's coordinates → fitted automatically
//   3. the bite scan in neither arch's coordinates → three taps on the bite scan and three on the lower (real clicks), then the upper fits
const { openHub, ok, OUT, DATA } = require('../hub/lib.cjs');
const fs = require('fs'), T = JSON.parse(fs.readFileSync(DATA + 'bite-truth.json'));
(async () => {
  const a = await openHub(), { page } = a;
  const idle = () => a.idle();
  const load = async (files) => { await page.evaluate(() => { for (const j of ['upper', 'lower']) if (APP.scans.has(j)) APP.scans.clear(j); }); await page.setInputFiles('input[data-ss=file]', files.map((f) => DATA + f)); await page.waitForFunction(() => APP.scans.has('upper') && APP.scans.has('lower'), null, { timeout: 120000 }); await idle(); };
  const bite = async (f) => { await page.setInputFiles('input[data-ss=bitefile]', DATA + f); await page.waitForTimeout(300); await idle(); };
  // where the upper is relative to the lower, against the demo truth (identity in file coordinates of the made pair)
  const relErr = (moved) => page.evaluate(({ moved, Tu }) => { const THREE = APP.THREE || APP.N.THREE, U = APP.scans.upper, L = APP.scans.lower, P = U.raw.positions, back = moved ? new THREE.Matrix4().fromArray(Tu).invert() : new THREE.Matrix4(); let e = 0;
    // the upper's current file points should equal the original upper's points (moved back) — compare via the case frame: U.matrix·p vs L.matrix·original
    const Ui = U.matrix, Li = L.matrix; return { sameMatrix: Ui.equals(Li), inBite: APP.scans.inBite }; }, { moved, Tu: T.upperMoved });
  // 1
  await load(['bite-upper.stl', 'bite-lower.stl']);
  ok(await page.isVisible('[data-ss=bite]'), 'the “Line up with a bite scan…” button shows once both arches are loaded');
  const before = await page.evaluate(() => APP.N.crc32(new Uint8Array(APP.scans.upper.raw.positions.buffer)));
  await bite('bite-key.stl');
  const r1 = await page.evaluate(() => document.querySelector('[data-ss=bitebox]').innerText);
  ok(/Already in the bite/.test(r1) && (await page.evaluate(() => APP.N.crc32(new Uint8Array(APP.scans.upper.raw.positions.buffer)))) === before, 'pair already in its bite: “Already in the bite”, nothing moved');
  console.log('   ' + r1.replace(/\n/g, ' | '));
  // reference: the true upper in the lower's coordinates, to measure 2 and 3 against
  const truthUpper = await page.evaluate(() => Array.from(APP.scans.upper.raw.positions.filter((_, i) => i % 300 < 3)));
  // worst and mean over the upper; and over its teeth (points within 6 mm of the biting plane)
  const errNow = () => page.evaluate((t) => { const P = APP.scans.upper.raw.positions; let e = 0, m = 0, n = 0, et = 0; for (let i = 0, k = 0; i < P.length; i += 300, k += 3) { const d = Math.hypot(P[i] - t[k], P[i + 1] - t[k + 1], P[i + 2] - t[k + 2]); e = Math.max(e, d); m += d; n++; if (t[k + 2] < 6) et = Math.max(et, d); } return { worst: e, mean: m / n, teeth: et }; }, truthUpper);
  // 2
  await load(['bite-upper-moved.stl', 'bite-lower.stl']);
  console.log('   upper exported on its own: Scan Card takes the pair to be ' + (await page.evaluate(() => APP.scans.inBite) ? 'in its bite (its check is loose)' : 'not in its bite'));
  await bite('bite-key.stl');
  const r2 = await page.evaluate(() => ({ t: document.querySelector('[data-ss=bitebox]').innerText, inBite: APP.scans.inBite, same: APP.scans.upper.matrix.equals(APP.scans.lower.matrix) }));
  // limits: the made-up teeth are smooth and alike, so the fit can slide a little along the arch (worst ~0.9 mm here);
  // on a real patient's scans the same steps give teeth mean 0.17–0.37 mm, worst ≤0.56 mm (checked privately, not in the repo)
  const e2 = await errNow();
  ok(/Lined up with the bite scan/.test(r2.t) && /upper fitted/.test(r2.t) && r2.inBite && r2.same && e2.teeth < 1 && e2.mean < 0.5, `fitted automatically: now one articulated pair; upper teeth within ${e2.teeth.toFixed(3)} mm of the true bite (mean over the arch ${e2.mean.toFixed(3)}, worst ${e2.worst.toFixed(3)} mm)`);
  console.log('   ' + r2.t.replace(/\n/g, ' | '));
  await a.shot(OUT + 'b1-fitted.png');
  // 3: the key in neither coordinate system → taps
  await load(['bite-upper-moved.stl', 'bite-lower.stl']);
  await bite('bite-key-moved.stl');
  const ask = await page.evaluate(() => ({ t: document.querySelector('[data-ss=bitebox]').innerText, st: APP.scans.biteScan.stage }));
  ok(ask.st && ask.st.on === 'key' && ask.st.arch === 'lower' && /Tap three spots on the bite scan/.test(ask.t), 'bite scan in neither arch’s coordinates: asks for three spots on the bite scan, then the lower');
  await a.shot(OUT + 'b1-taps-key.png');
  // spots: three key vertices on the lower part, far apart (key-moved coordinates), and the same on the lower
  const spots = await page.evaluate((Tk) => { const THREE = APP.N.THREE, st = APP.scans.biteScan.state, K = st.key.positions, M = new THREE.Matrix4().fromArray(Tk), Mi = M.clone().invert(), c = [];
    for (let i = 0; i < K.length; i += 3) { const p = new THREE.Vector3(K[i], K[i + 1], K[i + 2]).applyMatrix4(Mi); if (p.z > -3.5 && p.z < -1) c.push([K[i], K[i + 1], K[i + 2], p.x, p.y, p.z]); }
    c.sort((u, v) => u[4] - v[4]);   // in each stretch, the point furthest out from the arch: in plain view from the cheek side
    return [0.1, 0.5, 0.9].map((f) => { const a = Math.floor(c.length * (f - 0.04)), b = Math.floor(c.length * (f + 0.04)); let best = c[a]; for (let i = a; i < b; i++) if (Math.hypot(c[i][3], c[i][4] - 5) > Math.hypot(best[3], best[4] - 5)) best = c[i]; return best; }); }, T.keyMoved);
  const clickAt = async (world, up = -6) => { await page.evaluate(({ w, up }) => { const THREE = APP.N.THREE, V = APP.viewer, t = new THREE.Vector3(...w); V.controls.target.copy(t); const L = APP.scans.lower.matrix.clone().invert(), f = t.clone().applyMatrix4(L), out = new THREE.Vector3(f.x, f.y - 5, 0).normalize().transformDirection(APP.scans.lower.matrix); V.camera.position.copy(t).addScaledVector(out, 35).add(new THREE.Vector3(0, 0, up)); V.camera.up.set(0, 0, 1); V.camera.lookAt(t); V.camera.updateProjectionMatrix(); V.controls.update(); V.invalidate(); }, { w: world, up }); await page.waitForTimeout(60);
    const xy = await page.evaluate((w) => { const q = APP.viewer.toScreen(new APP.N.THREE.Vector3(...w)), r = APP.viewer.dom.getBoundingClientRect(); return [q.x + r.left, q.y + r.top]; }, world); await page.mouse.click(xy[0], xy[1]); await page.waitForTimeout(120); };
  // key taps: the key is shown placed with the lower's matrix
  for (const s of spots) { const w = await page.evaluate((s) => new APP.N.THREE.Vector3(s[0], s[1], s[2]).applyMatrix4(APP.scans.lower.matrix).toArray(), s); await clickAt(w); }
  ok(await page.evaluate(() => APP.scans.biteScan.stage && APP.scans.biteScan.stage.on === 'arch'), 'three spots tapped on the bite scan: now asks for the lower');
  const dbg = await page.evaluate(() => ({ keyPts: APP.scans.biteScan.state.keyPts }));
  console.log('   key taps vs aimed: ' + dbg.keyPts.map((p, i) => Math.hypot(p[0] - spots[i][0], p[1] - spots[i][1], p[2] - spots[i][2]).toFixed(2)).join(', ') + ' mm');
  for (const [i, s] of spots.entries()) { const w = await page.evaluate((s) => new APP.N.THREE.Vector3(s[3], s[4], s[5]).applyMatrix4(APP.scans.lower.matrix).toArray(), s); await clickAt(w, 8); if (i < 2) { const q = await page.evaluate(() => APP.scans.biteScan.state.pts.map((p) => p.file)); console.log('   arch tap ' + (i + 1) + ' vs aimed: ' + Math.hypot(q[i][0] - s[3], q[i][1] - s[4], q[i][2] - s[5]).toFixed(2) + ' mm'); } }
  await page.waitForTimeout(300); await idle();
  const r3 = await page.evaluate(() => ({ t: document.querySelector('[data-ss=bitebox]').innerText, inBite: APP.scans.inBite, stage: APP.scans.biteScan.stage }));
  const e3 = await errNow();
  ok(!r3.stage && r3.inBite && /lower fitted from your three spots, upper fitted/.test(r3.t) && e3.teeth < 1 && e3.mean < 0.5, `after the taps: lower from the three spots, upper fitted; upper teeth within ${e3.teeth.toFixed(3)} mm of the true bite (mean ${e3.mean.toFixed(3)}, worst ${e3.worst.toFixed(3)} mm)`);
  console.log('   ' + r3.t.replace(/\n/g, ' | '));
  // the tools get the articulated pair
  const sp = await a.go('splint');
  ok(await sp.evaluate(() => APP.scans.inBite && APP.scans.has('upper') && APP.scans.has('lower')), 'Splint receives the pair in its bite');
  ok(a.errors.length === 0, 'no page errors ' + a.errors.slice(0, 3).join(' | '));
  await a.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
