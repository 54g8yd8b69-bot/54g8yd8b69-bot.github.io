// Obturator Card on its own: a hollow-bulb obturator on the synthetic maxilla with a defect of known shape (mkobt.mjs), level path,
// plate 2.0 mm on the palate (no relief), bulb 12 mm above the margin's mean level, 0.5 mm relief off the walls, closed hollow, 2.0 mm walls.
//  • the result is a closed manifold solid: an outer shell and one cavity
//  • the bulb follows the defect's leaning walls at the relief (measured from points on the true walls)
//  • the hollow's walls are at least the thickness set (inside → outside), and the report says so
//  • the plate is 2.0 mm thick on the palate and lies on it
//  • nothing goes into the scan, and nothing is caught in an undercut on the way out along the path (teeth, the defect's pocket)
//  • the bulb's top is at the height set; the weight saved is the cavity's volume × 1.19 g/cm³, as reported
const { start, build, ok, TRUTH: T, DATA, OUT } = require('./lib.cjs');
(async () => {
  const a = await start([DATA + 'obt-defect-upper.stl']), { page, errors, shot } = a;
  ok(await page.evaluate(() => APP.scans.has('upper') && APP.scans.upper.matrix.equals(new APP.THREE.Matrix4())), 'the defect scan is loaded in its own coordinates');
  await page.evaluate(() => APP.shell.goto('path')); await a.idle(); await page.waitForTimeout(300);
  const share = await page.evaluate(() => APP.PC && APP.PC.share);
  ok(share > 0.01 && share < 0.5, `path of insertion: ${(share * 100).toFixed(1)}% of the scan is blocked out (shown in blue)`);
  await shot(OUT + 't1-path.png');
  const info = await build(a, { margin: T.rim, outline: T.outline });
  ok(info && info.closed && info.manifold && info.shells === 2, `obturator made in ${info && info.seconds.toFixed(1)} s: closed, accepted by Manifold as a solid, ${info && info.shells} shells (outside and the cavity), ${info && info.tris} triangles, grid ${info && info.grid.toFixed(2)} mm`);
  const g = await page.evaluate((T) => {
    const { THREE, N, bvhOf, shells, q, sdScan, rayHits, polyDist } = TH, B = APP.B, sh = shells(B.mesh), outer = sh[0].mesh, inner = sh.filter((s) => s.vol < 0), C = T.cavity;
    const bo = bvhOf(outer), hit = {}, v3 = new THREE.Vector3();
    const sdfSide = (x, y, z) => { const qx = Math.abs(x - C.cx) - (C.ax - C.r), qy = Math.abs(y - C.cy) - (C.ay - C.r), d2 = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - C.r; return (d2 + (z - C.zref) * C.tan) * C.cos; };
    const capZ = T.zm + 12, rimZ = (x, y) => { let b = Infinity, z = 0; for (const r of T.rim) { const d = Math.hypot(r[0] - x, r[1] - y); if (d < b) { b = d; z = r[2]; } } return z; };
    // 1. the bulb against the defect's true walls: scan points on the leaning walls, 2 mm above the rim to 2 mm below the bulb's top, away from the pocket
    const S = APP.scans.framed('upper').positions, rel = [];
    for (let v = 0; v < S.length / 3; v++) { const x = S[3 * v], y = S[3 * v + 1], z = S[3 * v + 2]; if (Math.abs(sdfSide(x, y, z)) > 0.03 || z > capZ - 2 || z < rimZ(x, y) + 2 || Math.hypot(x - C.pocket[0], y - C.pocket[1], z - C.pocket[2]) < C.pocketR + 1.5) continue; bo.closestPointToPoint(v3.set(x, y, z), hit); rel.push(hit.distance); }
    // 2. the hollow's walls: every point of the cavity to the outside
    const wall = []; for (const s of inner) { const Q = s.mesh.positions; for (let v = 0; v < Q.length / 3; v++) { bo.closestPointToPoint(v3.set(Q[3 * v], Q[3 * v + 1], Q[3 * v + 2]), hit); wall.push(hit.distance); } }
    // 3. the plate on the palate: outside points on the right half of the palate, more than 4 mm inside the outline
    const P = outer.positions, sb = TH.scanBvh(), oral = [], fit = [];
    for (let v = 0; v < P.length / 3; v++) { const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2]; if (x > 5 || polyDist(T.outline, x, y) > -4) continue; sb.closestPointToPoint(v3.set(x, y, z), hit); (hit.distance > 1 ? oral : fit).push(hit.distance); }
    // 4. into the scan anywhere? caught in an undercut on the way out (straight down)?
    // (hard tissue: the nearest scan point is on a remaining tooth's crown — inside its outline seen from below and below the gingiva)
    const R = APP.realSurf(), hr = {}; let worstIn = Infinity, inAt = null;
    for (let v = 0; v < P.length / 3; v++) { const s = APP.realSd(R, v3.set(P[3 * v], P[3 * v + 1], P[3 * v + 2]), hr); if (s < worstIn) { worstIn = s; inAt = [P[3 * v], P[3 * v + 1], P[3 * v + 2]].map((x) => +x.toFixed(1)); } }
    // the teeth: their crowns' surface points (below the gingiva, inside each crown's outline from below) against the solid
    const tooth = []; for (let v = 0; v < S.length / 3; v++) { const x = S[3 * v], y = S[3 * v + 1], z = S[3 * v + 2]; if (z < 6.5 && T.teeth.some((t) => Math.hypot(x - t.centre[0], y - t.centre[1]) < t.bl / 2 + 0.6)) tooth.push([x, y, z]); }
    const td = TH.insideDepth(outer, tooth); let tClose = Infinity; for (const p of tooth) { bo.closestPointToPoint(v3.set(...p), hit); tClose = Math.min(tClose, hit.distance); }
    const rays = rayHits(outer, [0, 0, -1]), raysT = rayHits(outer, [0, 0, -1], (x, y, z) => T.teeth.some((t) => Math.hypot(x - t.centre[0], y - t.centre[1]) < t.bl / 2 + 3));
    // 5. the bulb near the pocket: how far it comes off the scan there, and how far out it reaches
    let near = Infinity, reach = -Infinity; for (let v = 0; v < P.length / 3; v++) { const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2]; if (Math.abs(y - C.pocket[1]) > 2 || Math.abs(z - C.pocket[2]) > 2 || x < C.cx) continue; near = Math.min(near, sdScan(x, y, z)); reach = Math.max(reach, x); }
    let zTop = -Infinity; for (let v = 0; v < P.length / 3; v++) zTop = Math.max(zTop, P[3 * v + 2]);
    return { nRel: rel.length, relMed: q(rel, 0.5), rel05: q(rel, 0.05), rel95: q(rel, 0.95), nWall: wall.length, wallMin: Math.min(...wall), wallMed: q(wall, 0.5), nOral: oral.length, oralMed: q(oral, 0.5), oral05: q(oral, 0.05), oral95: q(oral, 0.95), nFit: fit.length, fit95: q(fit, 0.95), worstIn, rays, near, reach, zTop,
      outerV: sh[0].vol, cavity: -inner.reduce((s, x) => s + x.vol, 0), text: document.getElementById('dOut').textContent, td, tClose, nToothPts: tooth.length, inAt, raysT };
  }, T);
  ok(g.nRel > 500 && Math.abs(g.relMed - 0.5) < 0.03 && g.rel05 > 0.44 && g.rel95 < 0.56, `the bulb follows the defect’s walls at the 0.5 mm relief: ${g.nRel} points on the true walls, median ${g.relMed.toFixed(3)} mm (5–95%: ${g.rel05.toFixed(3)}–${g.rel95.toFixed(3)})`);
  ok(g.nWall > 1000 && g.wallMin >= 1.94 && Math.abs(g.wallMed - 2.0) < 0.04, `the hollow’s walls are at least the 2.0 mm set: thinnest ${g.wallMin.toFixed(3)} mm, median ${g.wallMed.toFixed(3)} mm over ${g.nWall} points`);
  ok(Math.abs(info.thinnest - g.wallMin) < 0.01, `…and the report gives the same thinnest wall (${info.thinnest.toFixed(3)} mm)`);
  ok(g.nOral > 500 && Math.abs(g.oralMed - 2.0) < 0.03 && g.oral05 > 1.93 && g.oral95 < 2.07, `the plate is 2.0 mm thick on the palate: ${g.nOral} points of its oral surface, median ${g.oralMed.toFixed(3)} mm off the scan (5–95%: ${g.oral05.toFixed(3)}–${g.oral95.toFixed(3)}); reported ${info.plate.toFixed(3)} mm`);
  ok(g.nFit > 500 && g.fit95 < 0.06, `…and its fitting surface lies on the palate (no relief set): 95% of ${g.nFit} points within ${g.fit95.toFixed(3)} mm`);
  ok(g.nToothPts > 5000 && !(g.td.worst < -0.03), `nothing goes into the remaining teeth: of ${g.nToothPts} points on their crowns none is inside the obturator (closest ${g.tClose.toFixed(2)} mm — the outline here runs on the gingiva; Variants puts it on the cingula)`);
  ok(g.worstIn > -0.13, `…nor more than a grid step’s rounding into the soft tissue: deepest ${Math.max(0, -g.worstIn).toFixed(3)} mm, at [${g.inAt}] (the defect’s sharp rim, where the fit’s inside corner is rounded)`);
  ok(g.raysT.n > 3000 && g.raysT.hits === 0, `within 3 mm of the remaining teeth no point of the plate meets a tooth on the way out (block-out of their undercuts): ${g.raysT.hits} of ${g.raysT.n}`);
  ok(g.rays.n > 50000 && g.rays.hits === 0, `nothing is caught in an undercut on the way out along the path (teeth, palate, the defect and its pocket): ${g.rays.hits} of ${g.rays.n} points meet the scan going straight down ${g.rays.first.length ? JSON.stringify(g.rays.first) : ''}`);
  // the pocket is hidden from the path by the wall below it: the blocked-out wall rises straight up from the pocket's lower lip, so the bulb
  // reaches out to that lip less the relief (the lip: where the 2.5 mm sphere centred on the leaning wall meets it, lowest)
  const C = T.cavity, zLip = C.pocketZ - C.pocketR * C.cos, xLip = C.cx + C.ax - (zLip - C.zref) * C.tan;
  ok(g.near > 0.42 && Math.abs(g.reach - (xLip - 0.5)) < 0.06, `round the pocket in the lateral wall (an undercut, blocked out) the bulb keeps the relief off the real tissue (closest ${g.near.toFixed(3)} mm) and reaches x = ${g.reach.toFixed(3)} mm: the pocket’s lip (${xLip.toFixed(3)}) carried straight up the path, less the relief`);
  ok(Math.abs(g.zTop - (T.zm + 12)) < 0.1 && Math.abs(info.bulbHeight - 12) < 0.1, `the bulb’s flat top is 12 mm above the margin’s mean level: z = ${g.zTop.toFixed(2)} mm (margin mean ${T.zm.toFixed(2)}), reported ${info.bulbHeight.toFixed(2)} mm`);
  const sv = g.cavity * 1.19 / 1000;
  ok(Math.abs(info.cavity - g.cavity) < 0.01 && Math.abs(info.saving - sv) < 0.005 && Math.abs(info.savingPct - 100 * g.cavity / g.outerV) < 0.05 && Math.abs(info.solidVolume - g.outerV) < 0.5, `weight saved by hollowing: cavity ${g.cavity.toFixed(0)} mm³ × 1.19 g/cm³ = ${sv.toFixed(2)} g of ${(g.outerV * 1.19 / 1000).toFixed(2)} g with a solid bulb (${(100 * g.cavity / g.outerV).toFixed(1)}%), as reported (${info.saving.toFixed(2)} g, ${info.savingPct.toFixed(1)}%)`);
  ok(/Saved by hollowing/.test(g.text) && g.text.includes(info.saving.toFixed(1) + ' g'), 'the Design step shows the saving: ' + (g.text.match(/Saved by hollowing[^%]*%\)/) || [''])[0]);
  await page.waitForTimeout(400); await shot(OUT + 't1-result.png');
  await page.evaluate(() => APP.viewer.setView('bottom')); await page.waitForTimeout(400); await shot(OUT + 't1-bottom.png');
  await page.click('#dSection'); await page.waitForTimeout(500); await shot(OUT + 't1-section.png');
  ok(errors.length === 0, 'no page errors ' + errors.slice(0, 3).join(' | '));
  await a.close();
})();
