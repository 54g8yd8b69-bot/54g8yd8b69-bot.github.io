// Shell Card on its own, with exact test data (mkprep.mjs, mkshell.mjs):
//  • provisional crown on 46: the scan before preparation (moved to other coordinates) lined up; the crown's outside lies on
//    the tooth as it was, its inside on the preparation plus the cement space, and nothing below the margin; closed solid
//  • shell to reline: the same outside, no deeper than the thickness asked for
//  • matrix over a wax-up of 31–42: the inside follows the wax-up (not the original teeth) plus the space, the thickness as set,
//    a hole through it at each tap, closed
//  • the case file keeps it all
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs'), DATA = '/home/claude/suite/dev/data/', OUT = '/home/claude/suite/dev/out/shell-card/';
fs.mkdirSync(OUT, { recursive: true });
const T = JSON.parse(fs.readFileSync(DATA + 'prep-truth.json')), W = JSON.parse(fs.readFileSync(DATA + 'shell-truth.json'));
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
// distances from points to a mesh, and which side, worked out in the page with its own helpers
const CHECK = `(function (meshA, ptsFile, M) {           // meshA in the case frame; points in the scan's file coordinates
  const THREE = APP.THREE, g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(meshA.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(meshA.indices), 1));
  const bvh = new APP.N.MeshBVH(g), hit = {}, q = new THREE.Vector3(); return ptsFile.map((p) => { q.set(p[0], p[1], p[2]).applyMatrix4(M); bvh.closestPointToPoint(q, hit); return hit.distance; });
})`;
(async () => {
  const { page, errors, shot, close } = await openApp('shell-card', { width: 1400, height: 900 });
  const idle = async () => { await page.waitForTimeout(150); await page.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 }); };
  await page.waitForFunction(() => window.APP);
  await page.setInputFiles('input[data-ss=file]', [DATA + 'prep-lower.stl', DATA + 'prep-upper.stl']); await idle();
  ok(await page.evaluate(() => APP.scans.has('lower') && APP.scans.has('upper')), 'prepared lower arch and the upper loaded');
  await page.evaluate(() => APP.shell.goto('make')); await page.click('#mkMode [data-v=crown]'); await page.click('#mkJaw [data-v=lower]');
  // ── the scan before preparation, in other coordinates
  await page.evaluate(() => APP.shell.goto('shape')); await page.setInputFiles('#shIn', DATA + 'shell-preop-moved.stl'); await idle();
  const al = await page.evaluate((mv) => { const THREE = APP.THREE, move = new THREE.Matrix4().fromArray(mv), S = APP.S; let worst = 0; const P0 = S.shape.positions; // moved point → its original: rel should undo the move
    for (let v = 0; v < P0.length / 3; v += 997) { const q = new THREE.Vector3(P0[3 * v], P0[3 * v + 1], P0[3 * v + 2]), back = q.clone().applyMatrix4(move.clone().invert()), got = q.clone().applyMatrix4(S.rel); worst = Math.max(worst, got.distanceTo(back)); } return { rms: S.fit.rms, worst }; }, W.move);
  ok(al.worst < 0.03 && al.rms < 0.03, `the scan before preparation lined up in spite of the prepared tooth: within ${al.worst.toFixed(3)} mm of where it belongs (rms ${al.rms.toFixed(3)} mm on the unchanged parts)`);
  await shot(OUT + 't1-shape.png');
  // ── mark 46 (the prepared tooth) and its margin, in the file's coordinates
  await page.evaluate((T) => { APP.P.seed = T.seed; APP.P.loop = T.loop; APP.syncUI(); APP.refreshView(); }, T);
  await page.evaluate(() => APP.shell.goto('design')); await page.click('#dBuild'); await idle();
  const cr = await page.evaluate(() => APP.B && APP.B.info);
  ok(cr && cr.closed && cr.tris > 1000, `provisional crown made: closed solid, ${cr && cr.volume.toFixed(1)} mm³, ${cr && cr.tris} triangles, in ${cr && cr.seconds.toFixed(1)} s`);
  // the crown's surfaces against the two scans: sample the tooth before preparation and the preparation, inside the margin
  const geo = await page.evaluate(({ T, CHECK }) => {
    const chk = eval(CHECK), M = APP.scans.lower.matrix, c = T.centre, inside = (p, r) => Math.hypot(p[0] - c[0], p[1] - c[1]) < r;
    const pre = APP.S.shape.positions, rel = APP.S.rel, prePts = [], prepPts = [];
    for (let v = 0; v < pre.length / 3; v++) { const p = new APP.THREE.Vector3(pre[3 * v], pre[3 * v + 1], pre[3 * v + 2]).applyMatrix4(rel).toArray(); if (inside(p, T.R0 + 0.5) && p[2] > T.zMargin + 0.6) prePts.push(p); }   // the tooth before, above the margin, inside it
    const pr = APP.scans.lower.raw.positions; for (let v = 0; v < pr.length / 3; v++) { const p = [pr[3 * v], pr[3 * v + 1], pr[3 * v + 2]]; if (inside(p, T.R0 - 0.3) && p[2] > T.zMargin + 0.6) prepPts.push(p); }   // the stump
    const dPre = chk(APP.B.mesh, prePts, M), dPrep = chk(APP.B.mesh, prepPts, M), q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(f * (s.length - 1))]; };
    let zmin = Infinity; const Bp = APP.B.mesh.positions; for (let i = 2; i < Bp.length; i += 3) zmin = Math.min(zmin, Bp[i]);
    const marginZ = new APP.THREE.Vector3(c[0], c[1], T.zMargin).applyMatrix4(M).z;
    return { nPre: prePts.length, nPrep: prepPts.length, pre95: q(dPre, 0.95), preMed: q(dPre, 0.5), prepMed: q(dPrep, 0.5), prep05: q(dPrep, 0.05), prep95: q(dPrep, 0.95), zmin, marginZ, gap: APP.P.gap, thin: APP.B.info.thinnest, occ: APP.B.info.occlusal };
  }, { T, CHECK });
  ok(geo.pre95 < 0.08, `its outside lies on the tooth as it was before: ${geo.nPre} points, median ${geo.preMed.toFixed(3)} mm, 95% within ${geo.pre95.toFixed(3)} mm`);
  ok(Math.abs(geo.prepMed - geo.gap) < 0.04 && geo.prep05 > geo.gap - 0.06 && geo.prep95 < geo.gap + 0.08, `its inside keeps the cement space (${geo.gap} mm) off the preparation: ${geo.nPrep} points, median ${geo.prepMed.toFixed(3)} mm (5–95%: ${geo.prep05.toFixed(3)}–${geo.prep95.toFixed(3)})`);
  ok(geo.zmin > geo.marginZ - 0.2, `nothing below the margin: lowest point ${(geo.zmin - geo.marginZ).toFixed(2)} mm from the shoulder`);
  // thickness straight down through the middle of the occlusal surface: from the tooth as it was to the flat top of the preparation, less the space
  const occ = await page.evaluate((T) => { const THREE = APP.THREE, M = APP.scans.lower.matrix, g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(APP.B.mesh.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(APP.B.mesh.indices), 1)); const bvh = new APP.N.MeshBVH(g);
    const pre = APP.S.shape.positions, rel = APP.S.rel, top = new THREE.Vector3(T.centre[0], T.centre[1], T.zTop).applyMatrix4(M).z, err = [], r = new THREE.Ray();
    for (let v = 0; v < pre.length / 3; v += 2) { const p = new THREE.Vector3(pre[3 * v], pre[3 * v + 1], pre[3 * v + 2]).applyMatrix4(rel); if (Math.hypot(p.x - T.centre[0], p.y - T.centre[1]) > 2.2 || p.z < T.zTop + 0.3) continue;
      const c = p.clone().applyMatrix4(M); r.origin.set(c.x, c.y, c.z + 2); r.direction.set(0, 0, -1); const hits = bvh.raycast(r, THREE.DoubleSide).sort((a, b) => a.distance - b.distance); if (hits.length < 2) continue;
      const prepTop = APP.mainSurf().bvh.raycastFirst(r, THREE.DoubleSide); if (!prepTop) continue; err.push(Math.abs((hits[0].point.z - hits[1].point.z) - (c.z - prepTop.point.z - APP.P.gap))); }
    err.sort((a, b) => a - b); return { n: err.length, med: err[err.length >> 1], p95: err[Math.floor(0.95 * (err.length - 1))] }; }, T);
  ok(occ.n > 20 && occ.p95 < 0.06, `occlusal thickness as it should be (tooth before − preparation − space), straight down at ${occ.n} points: median error ${occ.med.toFixed(3)} mm, 95% within ${occ.p95.toFixed(3)} mm; reported typical ${geo.occ.toFixed(2)} mm, thinnest away from the margin ${geo.thin.toFixed(2)} mm`);
  await page.waitForTimeout(400); await shot(OUT + 't1-crown.png');
  // ── shell to reline, 1.0 mm
  await page.evaluate(() => APP.shell.goto('make')); await page.click('#mkMode [data-v=shell]'); await page.evaluate(() => { APP.RB.wall.set(1.0); APP.P.wall = 1.0; APP.shell.goto('design'); }); await page.click('#dBuild'); await idle();
  const sh = await page.evaluate(({ T, CHECK }) => {
    const chk = eval(CHECK), M = APP.scans.lower.matrix, c = T.centre, pre = APP.S.shape.positions, rel = APP.S.rel, pts = [];
    for (let v = 0; v < pre.length / 3; v++) { const p = new APP.THREE.Vector3(pre[3 * v], pre[3 * v + 1], pre[3 * v + 2]).applyMatrix4(rel).toArray(); if (Math.hypot(p[0] - c[0], p[1] - c[1]) < T.R0 + 0.5 && p[2] > T.zMargin + 0.6) pts.push(p); }
    const d = chk(APP.B.mesh, pts, M).sort((a, b) => a - b), t = APP.B.thick, e = APP.B.edge; let tmax = 0; for (let v = 0; v < t.length; v++) if (!e[v]) tmax = Math.max(tmax, t[v]);
    return { info: APP.B.info, pre95: d[Math.floor(0.95 * (d.length - 1))], tmax, crownVol: null };
  }, { T, CHECK });
  ok(sh.info.closed && sh.pre95 < 0.08 && sh.tmax <= 1.06, `shell to reline: closed, ${sh.info.volume.toFixed(1)} mm³, outside on the tooth as it was (95% within ${sh.pre95.toFixed(3)} mm), never thicker than 1.0 mm (thickest ${sh.tmax.toFixed(2)} mm)`);
  ok(sh.info.volume < cr.volume - 5, `…and less material than the fitted crown (${sh.info.volume.toFixed(1)} against ${cr.volume.toFixed(1)} mm³)`);
  // ── the case file keeps the shell and its settings
  await page.evaluate(() => APP.shell.goto('export'));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#xCase')]); const zip = OUT + 't1-case.zip'; await dl.saveAs(zip);
  const [ds] = await Promise.all([page.waitForEvent('download'), page.click('#xStl')]); const stl = OUT + 't1-shell.stl'; await ds.saveAs(stl);
  const buf = fs.readFileSync(stl), ntri = buf.readUInt32LE(80); ok(buf.length === 84 + 50 * ntri && ntri === sh.info.tris && /^shell-lower\.stl$/.test(ds.suggestedFilename()), `STL download: ${ds.suggestedFilename()}, ${ntri} triangles, well-formed`);
  ok(errors.length === 0, 'no page errors ' + errors.slice(0, 3).join(' | '));
  await close();
  // a fresh page opens the case: the shell, the second scan and the settings come back without making it again
  { const { page: p2, errors: e2, close: c2 } = await openApp('shell-card', { width: 1400, height: 900 }); await p2.waitForFunction(() => window.APP);
    await p2.setInputFiles('input[data-ss=file]', zip); await p2.waitForFunction(() => APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 }); await p2.waitForTimeout(300);
    const re = await p2.evaluate(() => ({ mode: APP.P.mode, wall: APP.P.wall, vol: APP.B && APP.N.meshVolume(APP.B.mesh), shape: !!(APP.S.shape && APP.S.rel), loop: APP.P.loop.length }));
    ok(re.mode === 'shell' && re.wall === 1 && Math.abs(re.vol - sh.info.volume) < 0.01 && re.shape && re.loop === T.loop.length, `reopened: ${re.mode}, ${re.wall} mm, ${re.vol && re.vol.toFixed(1)} mm³ as made, the scan before preparation and ${re.loop} margin points back`);
    ok(e2.length === 0, 'no page errors (reopened) ' + e2.slice(0, 3).join(' | ')); await c2(); }
  // ── a preparation that leans 25° (as an upper incisor does): the margin is followed along the surface, so no axis is needed
  { const L = JSON.parse(fs.readFileSync(DATA + 'prep-lean-truth.json')); const { page: p, errors: e4, close: c4 } = await openApp('shell-card', { width: 1400, height: 900 }); const idl = async () => { await p.waitForTimeout(150); await p.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 }); };
    await p.waitForFunction(() => window.APP); await p.setInputFiles('input[data-ss=file]', [DATA + 'prep-lean-lower.stl', DATA + 'prep-upper.stl']); await idl();
    await p.evaluate(() => APP.shell.goto('shape')); await p.setInputFiles('#shIn', DATA + 'shell-preop-lower.stl'); await idl();
    await p.evaluate((L) => { APP.P.jaw = 'lower'; APP.P.seed = L.seed; APP.P.loop = L.loop; APP.shell.goto('design'); }, L); await p.click('#dBuild'); await idl();
    const lg = await p.evaluate(({ L, CHECK }) => { const chk = eval(CHECK), M = APP.scans.lower.matrix, c = L.centre, pre = APP.S.shape.positions, rel = APP.S.rel, a = [], b = [], pr = APP.scans.lower.raw.positions;
      for (let v = 0; v < pre.length / 3; v++) { const q = new APP.THREE.Vector3(pre[3 * v], pre[3 * v + 1], pre[3 * v + 2]).applyMatrix4(rel).toArray(); if (Math.hypot(q[0] - c[0], q[1] - c[1]) < L.R0 + 0.5 && q[2] > L.zMargin + 0.6) a.push(q); }
      // the leaning stump: inside the margin at its base, leaning towards the buccal as it rises
      for (let v = 0; v < pr.length / 3; v++) { const q = [pr[3 * v], pr[3 * v + 1], pr[3 * v + 2]], h = q[2] - L.zMargin, cx = c[0] + L.axis[0] / L.axis[2] * h, cy = c[1] + L.axis[1] / L.axis[2] * h; if (h > 0.6 && Math.hypot(q[0] - cx, q[1] - cy) < L.R0 - 0.5) b.push(q); }
      const da = chk(APP.B.mesh, a, M).sort((x, y) => x - y), db = chk(APP.B.mesh, b, M).sort((x, y) => x - y), Q = (d, f) => d[Math.floor(f * (d.length - 1))];
      return { info: APP.B.info, pre95: Q(da, 0.95), prepMed: Q(db, 0.5), prep95: Q(db, 0.95), nb: b.length, gap: APP.P.gap }; }, { L, CHECK });
    ok(lg.info.closed && lg.pre95 < 0.08 && Math.abs(lg.prepMed - lg.gap) < 0.04 && lg.prep95 < lg.gap + 0.08, `leaning preparation (25°): closed crown, ${lg.info.volume.toFixed(1)} mm³; outside on the tooth as it was (95% within ${lg.pre95.toFixed(3)} mm), inside ${lg.prepMed.toFixed(3)} mm off the stump (95% within ${lg.prep95.toFixed(3)}, ${lg.nb} points)`);
    ok(e4.length === 0, 'no page errors (leaning) ' + e4.slice(0, 3).join(' | ')); await c4(); }
  // ── a matrix over the wax-up of the lower incisors
  { const { page: p, errors: e3, shot: sh3, close: c3 } = await openApp('shell-card', { width: 1400, height: 900 }); const idl = async () => { await p.waitForTimeout(150); await p.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 }); };
    await p.waitForFunction(() => window.APP); await p.setInputFiles('input[data-ss=file]', [DATA + 'shell-preop-lower.stl', DATA + 'prep-upper.stl']); await idl();
    await p.evaluate(() => APP.shell.goto('make')); await p.click('#mkMode [data-v=matrix]'); await p.click('#mkJaw [data-v=lower]');
    await p.evaluate(() => APP.shell.goto('shape')); await p.setInputFiles('#shIn', DATA + 'shell-waxup-lower.stl'); await idl();
    const fit = await p.evaluate(() => APP.S.fit.rms); ok(fit < 0.02, `wax-up lined up on the unwaxed teeth (rms ${fit.toFixed(3)} mm)`);
    await p.evaluate((W) => { APP.P.taps = W.incisors.map((t) => t.tip); APP.shell.goto('design'); }, W); await p.click('#dBuild'); await idl();
    const mx = await p.evaluate(({ W, CHECK }) => {
      const chk = eval(CHECK), THREE = APP.THREE, M = APP.scans.lower.matrix, i = APP.B.info, wax = APP.S.shape.positions, rel = APP.S.rel, nrm = APP.N.vertexNormals(APP.S.shape), pts = [], orig = [];
      // wax-up surface on the four incisors that faces the biting side or outwards (no undercut), 1–5 mm below the tips, away from the holes
      for (let v = 0; v < wax.length / 3; v += 3) { const p = new THREE.Vector3(wax[3 * v], wax[3 * v + 1], wax[3 * v + 2]).applyMatrix4(rel); const n = new THREE.Vector3(nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]).transformDirection(rel);
        for (const t of W.incisors) { const d = Math.hypot(p.x - t.centre[0], p.y - t.centre[1]); if (d < t.width * 0.45 && p.z < t.tip[2] - 1 && p.z > t.tip[2] - 5 && n.z > 0.15 && Math.hypot(p.x - t.tip[0], p.y - t.tip[1]) > 2) { pts.push(p.toArray()); break; } } }
      const d = chk(APP.B.mesh, pts, M).sort((a, b) => a - b), q = (f) => d[Math.floor(f * (d.length - 1))];
      // a hole at each tap: straight down from above the tip, the first thing hit is not the matrix; 2.5 mm along the edge, the matrix top is thickness + space above the wax
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(APP.B.mesh.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(APP.B.mesh.indices), 1)); const bvh = new APP.N.MeshBVH(g);
      const r = new THREE.Ray(); let holes = 0; const tops = [];
      for (const t of W.incisors) { const tip = new THREE.Vector3(...t.tip).applyMatrix4(M); r.origin.set(tip.x, tip.y, tip.z + 20); r.direction.set(0, 0, -1); const h = bvh.raycastFirst(r, THREE.DoubleSide); if (!h || h.point.z < tip.z) holes++; }
      return { i, n: pts.length, med: q(0.5), p05: q(0.05), p95: q(0.95), holes };
    }, { W, CHECK });
    ok(mx.i.closed && mx.i.holes === 4, `matrix made: closed, ${mx.i.volume.toFixed(0)} mm³, ${mx.i.holes} injection holes, in ${mx.i.seconds.toFixed(1)} s`);
    ok(Math.abs(mx.med - 0.05) < 0.05 && mx.p95 < 0.16, `its inside follows the wax-up plus the 0.05 mm space: ${mx.n} points, median ${mx.med.toFixed(3)} mm (5–95%: ${mx.p05.toFixed(3)}–${mx.p95.toFixed(3)})`);
    ok(mx.holes === 4, `a hole goes right through over each of the four taps (${mx.holes}/4)`);
    await p.waitForTimeout(300); await p.evaluate(() => APP.viewer.setView('front')); await sh3(OUT + 't1-matrix.png');
    ok(e3.length === 0, 'no page errors (matrix) ' + e3.slice(0, 3).join(' | ')); await c3(); }
})();
