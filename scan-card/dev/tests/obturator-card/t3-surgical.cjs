// Obturator Card: a surgical obturator on the synthetic maxilla before surgery (the full demo upper arch, mkobt.mjs). The planned
// resection line runs from palatal of the 22/23 contact back along the left of the palate; the patient's left is to be removed.
//  • a closed plate, one shell, 2.0 mm thick on the palate, lying on it
//  • it covers the kept (right) side out to the outline, and carries on past the resection line by exactly the distance set (4 mm)
//  • nothing goes into the teeth and nothing is caught on the way out along the path
const { start, build, ok, TRUTH: T, DATA, OUT } = require('./lib.cjs');
(async () => {
  const a = await start([DATA + 'obt-preop-upper.stl']), { page, errors, shot } = a, S = T.surgical;
  await page.evaluate(() => APP.shell.goto('make')); await page.click('#mkMode [data-v=surgical]');
  await page.evaluate(() => APP.shell.goto('margin')); await a.idle();
  const ui = await page.evaluate(() => ({ title: APP.shell.stepEl('margin').querySelector('h3').textContent, side: !document.getElementById('mSideRow').hidden }));
  ok(/Resection line/.test(ui.title) && ui.side, 'in the surgical mode the margin step becomes “Resection line”, with the side to be removed');
  await page.click('#mSide [data-v=left]');
  const info = await build(a, { cut: S.cut, outline: S.outline, beyond: 4, plate: 2.0 });
  ok(info && info.closed && info.manifold && info.mode === 'surgical', `surgical obturator made in ${info && info.seconds.toFixed(1)} s: closed, accepted by Manifold, ${info && info.volume.toFixed(0)} mm³ (${info && info.weight.toFixed(1)} g)`);
  const g = await page.evaluate((S) => {
    const { THREE, shells, q, polyDist, insideDepth, rayHits } = TH, sh = shells(APP.B.mesh), P = sh[0].mesh.positions, sb = TH.scanBvh(), hit = {}, v3 = new THREE.Vector3();
    // signed distance in plan past the resection line (+ on the patient's left), the line carried on straight past its ends (as the tool does)
    const L = S.cut.map((p) => [p[0], p[1]]), ext = (a, b) => { const l = Math.hypot(a[0] - b[0], a[1] - b[1]); return [a[0] + (a[0] - b[0]) / l * 60, a[1] + (a[1] - b[1]) / l * 60]; }, line = [ext(L[0], L[1]), ...L, ext(L[L.length - 1], L[L.length - 2])];
    const past = (x, y) => { let best = Infinity, side = 1; for (let i = 0; i + 1 < line.length; i++) { const a = line[i], b = line[i + 1], ex = b[0] - a[0], ey = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey))), dx = x - a[0] - t * ex, dy = y - a[1] - t * ey, d = Math.hypot(dx, dy); if (d < best) { best = d; side = ex * dy - ey * dx; } } return best * (side < 0 ? 1 : -1); };
    // (which sign is the patient's left: a point far out on the left)
    const sL = past(60, 4) > 0 ? 1 : -1; let maxPast = -Infinity; for (let v = 0; v < P.length / 3; v++) maxPast = Math.max(maxPast, sL * past(P[3 * v], P[3 * v + 1]));
    // the kept side reaches its outline: each outline tap on the right, to the plate seen from below
    const right = S.outline.filter((p) => p[0] < -4), reach = right.map((p) => { let b = Infinity; for (let v = 0; v < P.length / 3; v++) b = Math.min(b, Math.hypot(P[3 * v] - p[0], P[3 * v + 1] - p[1])); return b; });
    // thickness on the palate (right half, well inside the outline)
    const oral = [], fit = []; for (let v = 0; v < P.length / 3; v++) { const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2]; if (x > 0 || polyDist(S.outline, x, y) > -4) continue; sb.closestPointToPoint(v3.set(x, y, z), hit); (hit.distance > 1 ? oral : fit).push(hit.distance); }
    const Sc = APP.scans.framed('upper').positions, tooth = []; for (let v = 0; v < Sc.length / 3; v++) { const x = Sc[3 * v], y = Sc[3 * v + 1], z = Sc[3 * v + 2]; if (z < 6.5 && S.teeth.some((t) => Math.hypot(x - t.centre[0], y - t.centre[1]) < t.bl / 2 + 0.6)) tooth.push([x, y, z]); }
    return { shells: sh.length, maxPast, reachMax: Math.max(...reach), nRight: right.length, oralMed: q(oral, 0.5), oral05: q(oral, 0.05), oral95: q(oral, 0.95), nOral: oral.length, fit95: q(fit, 0.95), ins: insideDepth(sh[0].mesh, tooth), rays: rayHits(sh[0].mesh, [0, 0, -1]) };
  }, S);
  ok(g.shells === 1, 'one shell (a plate, no bulb)');
  ok(Math.abs(g.maxPast - 4) < 0.15, `it carries on past the resection line by the 4.0 mm set: furthest ${g.maxPast.toFixed(3)} mm onto the side to be removed`);
  ok(g.reachMax < 0.5, `on the kept side it reaches the outline: each of ${g.nRight} outline points within ${g.reachMax.toFixed(2)} mm of its edge (seen from below)`);
  ok(g.nOral > 500 && Math.abs(g.oralMed - 2) < 0.03 && g.oral05 > 1.93 && g.oral95 < 2.07 && g.fit95 < 0.06, `2.0 mm thick on the palate (median ${g.oralMed.toFixed(3)}, 5–95% ${g.oral05.toFixed(3)}–${g.oral95.toFixed(3)} over ${g.nOral} points), lying on it (95% within ${g.fit95.toFixed(3)} mm); reported ${info.plate.toFixed(3)} mm`);
  ok(!(g.ins.worst < -0.05) && g.rays.hits === 0, `goes into no tooth (deepest ${Math.max(0, -(g.ins.worst === Infinity ? 0 : g.ins.worst)).toFixed(3)} mm) and nothing is caught on the way out (${g.rays.hits} of ${g.rays.n} points)`);
  await page.evaluate(() => APP.viewer.setView('bottom')); await page.waitForTimeout(400); await shot(OUT + 't3-surgical.png');
  await page.evaluate(() => APP.shell.goto('export')); await a.idle();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#xStl')]); ok(dl.suggestedFilename() === 'surgical-obturator-upper.stl', 'download: ' + dl.suggestedFilename());
  ok(errors.length === 0, 'no page errors ' + errors.slice(0, 3).join(' | '));
  await a.close();
})();
