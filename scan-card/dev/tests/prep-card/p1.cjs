// Prep Card on its own, on the demo arch with 46 prepared to a known shape (mkprep.mjs): marking by real taps, the region,
// wall angles against the design, undercut where it was built, the best path removing it, clearance checked independently.
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs'), OUT = '/home/claude/suite/dev/out/prep-card/', DATA = '/home/claude/suite/dev/data/';
const T = JSON.parse(fs.readFileSync(DATA + 'prep-truth.json'));
let bad = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { bad++; process.exitCode = 1; } };
(async () => {
  const { page, errors, shot, close } = await openApp('prep-card', { width: 1400, height: 900 });
  const idle = async () => { await page.waitForTimeout(150); await page.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 }); };
  await page.waitForFunction(() => window.APP);
  await page.setInputFiles('input[data-ss=file]', [DATA + 'prep-lower.stl', DATA + 'prep-upper.stl']); await idle();
  ok(await page.evaluate(() => APP.scans.has('lower') && APP.scans.has('upper') && APP.scans.inBite), 'both arches loaded, in the bite');
  // the truth is in the file's coordinates; the app works in the case frame it oriented the scans into
  Object.assign(T, await page.evaluate((T) => { const M = APP.scans.lower.matrix, V = (p) => new APP.THREE.Vector3(...p).applyMatrix4(M).toArray(), D = (v) => new APP.THREE.Vector3(v[0], v[1], 0).transformDirection(M).toArray();
    const c3 = V([T.centre[0], T.centre[1], T.zTop]), m3 = V([T.centre[0], T.centre[1], T.zMargin]), ax = new APP.THREE.Vector3(0, 0, 1).transformDirection(M).toArray();
    return { seed: V(T.seed), loop: T.loop.map(V), centre: [c3[0], c3[1]], zTop: c3[2], zMargin: m3[2], buccal: D(T.buccal), axis: ax, rawCentre: T.centre, rawZTop: T.zTop, rawZMargin: T.zMargin }; }, T));
  await page.evaluate(() => APP.shell.goto('tooth')); await page.click('#ptJaw [data-v=lower]');
  // look straight down on 46, zoomed in
  await page.evaluate((c) => { const V = APP.viewer, t = new APP.THREE.Vector3(c[0], c[1], -3); V.controls.target.copy(t); V.camera.position.set(c[0], c[1] + 0.01, 60); V.camera.up.set(0, -1, 0); if (V.camera.isOrthographicCamera) V.camera.zoom = 6; else V.camera.position.set(c[0], c[1] + 0.01, 25); V.camera.lookAt(t); V.camera.updateProjectionMatrix(); V.controls.update(); V.invalidate(); }, T.centre);
  await page.waitForTimeout(300);
  const tap = async (p) => { const xy = await page.evaluate((p) => { const q = APP.viewer.toScreen(new APP.THREE.Vector3(...p)), r = APP.viewer.dom.getBoundingClientRect(); return [q.x + r.left, q.y + r.top]; }, p); await page.mouse.click(xy[0], xy[1]); await page.waitForTimeout(60); };
  await tap(T.seed);
  // for each margin point, a view from which it can be seen (as a user turns the model): straight down, or from outside and above
  const lookFrom = async (p) => page.evaluate(({ p, c }) => { const THREE = APP.THREE, V = APP.viewer, g = APP.G, t = new THREE.Vector3(...p), out = new THREE.Vector3(p[0] - c[0], p[1] - c[1], 0).normalize(), ray = new THREE.Ray();
    for (const [o, u] of [[0, 25], [8, 20], [14, 18], [18, 10]]) { const cam = t.clone().addScaledVector(out, o).add(new THREE.Vector3(0, 0, u)); ray.origin.copy(cam); ray.direction.copy(t).sub(cam).normalize(); const h = g.bvh.raycastFirst(ray, THREE.DoubleSide);
      if (h && h.point.distanceTo(t) < 0.3) { V.controls.target.copy(t); V.camera.position.copy(cam); V.camera.up.set(0, o ? 0 : -1, o ? 1 : 0); V.camera.lookAt(t); V.camera.updateProjectionMatrix(); V.controls.update(); V.invalidate(); return true; } }
    return false; }, { p, c: T.centre });
  let unseen = 0; for (const p of T.loop) { if (!(await lookFrom(p))) unseen++; await page.waitForTimeout(80); await tap(p); }
  ok(unseen === 0, 'every margin point could be seen from one of the views tried');
  const tapped = await page.evaluate((T) => APP.P.loop.map((q, i) => Math.hypot(q[0] - T.loop[i][0], q[1] - T.loop[i][1], q[2] - T.loop[i][2])), T);
  ok(Math.max(...tapped) < 0.6, 'every margin tap landed within 0.6 mm of the point aimed at (worst ' + Math.max(...tapped).toFixed(2) + ' mm)');
  // the walls were built about the tooth's own axis; the app re-oriented the scan a little, so judge them about that axis
  await page.evaluate((T) => { APP.P.dir = T.axis; APP.analyse(); }, T);
  await page.evaluate(() => APP.shell.goto('check')); await page.waitForTimeout(200);
  const r = await page.evaluate(() => { const s = APP.R.sides; return { b: s.buccal.angle, m: s.mesial.angle, d: s.distal.angle, l: s.lingual.angle, md: APP.R.tocMD, bl: APP.R.tocBL, hb: s.buccal.height, uSelf: APP.R.uSelf, uBlock: APP.R.uBlock, axial: APP.R.axialA }; });
  console.log('   wall angles  B ' + r.b.toFixed(2) + '  M ' + r.m.toFixed(2) + '  D ' + r.d.toFixed(2) + '  L ' + r.l.toFixed(2) + ' | TOC MD ' + r.md.toFixed(2) + ' BL ' + r.bl.toFixed(2));
  ok(Math.abs(r.b - 6) < 1.5 && Math.abs(r.m - 6) < 1.5 && Math.abs(r.d - 6) < 1.5 && Math.abs(r.l + 6) < 1.5, 'each wall angle within 1.5° of the design (6°, 6°, 6°, −6°)');
  ok(Math.abs(r.hb - T.wallHeight) < 0.3, `buccal wall height ${r.hb.toFixed(2)} mm (${T.wallHeight.toFixed(2)} built)`);
  ok(Math.abs(r.md - 12) < 2.5 && Math.abs(r.bl) < 2.5, `total occlusal convergence MD ${r.md.toFixed(1)}° (12° built), BL ${r.bl.toFixed(1)}° (0° built)`);
  // undercut sits on the lingual wall
  const uc = await page.evaluate(() => { const g = APP.G, R = APP.R; let ling = 0, other = 0; for (let f = 0; f < g.nF; f++) if (R.reg[f] && R.kind[f] === 1) { const n = [g.nrm[3 * f], g.nrm[3 * f + 1], g.nrm[3 * f + 2]], b = R.S.b; if (-(n[0] * b.x + n[1] * b.y) > 0.5) ling += g.area[f]; else other += g.area[f]; } return { ling, other }; });
  ok(uc.ling > 3 && uc.other < 0.15 * uc.ling, `undercut found on the lingual wall (${uc.ling.toFixed(1)} mm² there, ${uc.other.toFixed(1)} mm² elsewhere)`);
  await page.click('#ckMap [data-v=undercut]'); await page.waitForTimeout(200); await shot(OUT + 'p1-undercut.png');
  // best path: tilts lingually and clears the undercut
  await page.evaluate(() => APP.shell.goto('path')); await page.click('#pbBest'); await page.waitForTimeout(300);
  const bp = await page.evaluate(() => { const d = APP.R.d, b = APP.R.S.b; return { tilt: APP.R.tilt, toward: -(d[0] * b.x + d[1] * b.y), uSelf: APP.R.uSelf, l: APP.R.sides.lingual.angle, b: APP.R.sides.buccal.angle }; });
  ok(bp.uSelf < 0.15 * uc.ling && bp.toward > 0.05 && bp.tilt > 4 && bp.tilt < 12, `“Fewest undercuts”: tilted ${bp.tilt.toFixed(1)}° towards the lingual, undercut ${uc.ling.toFixed(1)} → ${bp.uSelf.toFixed(1)} mm², lingual wall now ${bp.l.toFixed(1)}°, buccal ${bp.b.toFixed(1)}°`);
  await page.evaluate((T) => { APP.P.dir = T.axis; APP.analyse(); }, T);
  // clearance against an independent BVH measurement from the stump's flat top to the opposing scan
  await page.evaluate(() => APP.shell.goto('check')); await page.click('#ckMap [data-v=clear]'); await page.waitForTimeout(200);
  const cl = await page.evaluate(() => { const THREE = APP.THREE, g = APP.G, R = APP.R, Pm = g.mesh.positions, I = g.mesh.indices, d = new THREE.Vector3(...R.d), idx = [];
    for (let f = 0; f < g.nF; f++) if (R.reg[f] && g.nrm[3 * f] * d.x + g.nrm[3 * f + 1] * d.y + g.nrm[3 * f + 2] * d.z >= 0.3) idx.push(I[3 * f], I[3 * f + 1], I[3 * f + 2]);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(Pm, 3)); geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(idx), 1)); const bvh = new APP.N.MeshBVH(geo), hit = {}, up = APP.scans.framed('upper').positions, q = new THREE.Vector3(); let m = Infinity;
    for (let i = 0; i < up.length; i += 3) { q.set(up[i], up[i + 1], up[i + 2]); bvh.closestPointToPoint(q, hit); if (hit.distance < m) m = hit.distance; }
    return { tool: R.clear.min, indep: m, below: R.clear.below }; });
  ok(cl.tool >= cl.indep - 0.01 && cl.tool - cl.indep < 0.12, `closest to the opposing teeth ${cl.tool.toFixed(2)} mm (measured the other way, from every opposing point to the prepared surface: ${cl.indep.toFixed(2)} mm)`);
  await shot(OUT + 'p1-clearance.png');
  console.log(await page.evaluate(() => APP.figuresText()));
  // case round trip
  const blob = await page.evaluate(async () => Array.from(new Uint8Array(await (await APP.scans.toCase().toBlob('t')).arrayBuffer())));
  const before = await page.evaluate(() => APP.figuresText());
  await page.evaluate(async (a) => { await APP.scans.useCase(await APP.N.DentalCase.fromBlob(new Blob([new Uint8Array(a)]))); }, blob); await idle();
  ok(await page.evaluate(() => APP.figuresText()) === before, 'the case file keeps the marking and the path: identical figures after reopening');
  console.log('errors:', JSON.stringify(errors.slice(0, 4))); ok(errors.length === 0, 'no page errors');
  await close(); console.log(bad ? bad + ' FAILED' : 'all passed');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
