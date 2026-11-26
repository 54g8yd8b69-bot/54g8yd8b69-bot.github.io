// Obturator Card variants on the synthetic maxilla with a defect (mkobt.mjs):
//  • open top with a lid: body and lid each closed; the body stops at the cut 2 mm under the bulb's top; the lid's plug fits the opening
//    with 0.15 mm all round and its face meets the body's rim; nothing of the lid is inside the body; body + lid + hollow = the solid shape
//  • domed top: rises the dome height in the middle; the walls under it are still the thickness set
//  • the bulb allowed to engage 1.0 mm of undercut: it reaches 1.0 mm further into the pocket, still the relief off the real tissue, and is
//    then (as it should be) caught there on the way out — nowhere else; the hollow is unchanged
//  • solid bulb: one shell, its volume is the hollow one's solid version, nothing saved
//  • the outline on the teeth's cingula and a tilted path: the plate rests on the teeth above their survey lines, goes into none of them
//    and comes out along the tilted path
//  • the case file keeps the design and the result; the STL downloads are well-formed
const { start, build, ok, TRUTH: T, DATA, OUT, HELP } = require('./lib.cjs');
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs');
const C = T.cavity, zLip = C.pocketZ - C.pocketR * C.cos, xLip = C.cx + C.ax - (zLip - C.zref) * C.tan;
/** in the page: the bulb next to the pocket (reach, relief off the real tissue), and rays out along a direction */
const POCKET = `(C) => { const P = TH.shells(APP.B.mesh)[0].mesh.positions; let reach = -Infinity, near = Infinity; for (let v = 0; v < P.length / 3; v++) { const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2]; if (Math.abs(y - C.pocket[1]) > 2 || Math.abs(z - C.pocket[2]) > 2 || x < C.cx) continue; reach = Math.max(reach, x); near = Math.min(near, TH.sdScan(x, y, z)); } return { reach, near }; }`;
(async () => {
  const a = await start([DATA + 'obt-defect-upper.stl']), { page, errors, shot } = a;
  const base = { margin: T.rim, outline: T.outline };
  // ── closed hollow first, for comparison
  const ic = await build(a, { ...base, hollow: 'closed' });
  ok(ic.closed && ic.thinnest >= 1.94, `closed hollow for comparison: ${ic.volume.toFixed(0)} mm³, solid version ${ic.solidVolume.toFixed(0)} mm³, cavity ${ic.cavity.toFixed(0)} mm³`);
  const pc = await page.evaluate(`(${POCKET})(${JSON.stringify(C)})`);
  // ── open top with a lid
  const io = await build(a, { ...base, hollow: 'open' });
  const lo = await page.evaluate((T) => {
    const { THREE, N, bvhOf, shells, q, insideDepth } = TH, B = APP.B, zc = T.zm + 12 - 2;
    const bodyShells = shells(B.mesh).length, lidShells = shells(B.lid).length, bb = N.meshBounds(B.mesh), lb = N.meshBounds(B.lid), bv = bvhOf(B.mesh), hit = {}, v3 = new THREE.Vector3(), L = B.lid.positions, plug = [], face = [];
    for (let v = 0; v < L.length / 3; v++) { const z = L[3 * v + 2]; bv.closestPointToPoint(v3.set(L[3 * v], L[3 * v + 1], z), hit); if (z < zc - 0.4 && z > zc - 1.6) plug.push(hit.distance); else if (Math.abs(z - zc) < 0.02) face.push(hit.distance); }
    const lidPts = []; for (let v = 0; v < L.length / 3; v++) lidPts.push([L[3 * v], L[3 * v + 1], L[3 * v + 2]]);
    return { bodyShells, lidShells, bodyTop: bb.max[2], lidTop: lb.max[2], lidBottom: lb.min[2], zc, plugMed: q(plug, 0.5), plugMin: Math.min(...plug), plug95: q(plug, 0.95), nPlug: plug.length, faceMin: face.length ? Math.min(...face) : NaN, nFace: face.length, inside: insideDepth(B.mesh, lidPts), watertight: N.isWatertight(B.mesh) && N.isWatertight(B.lid) };
  }, T);
  ok(io.closed && io.manifold && lo.watertight && lo.bodyShells === 1 && lo.lidShells === 1, `open top with a lid: body (${(io.volume - io.lidVolume).toFixed(0)} mm³) and lid (${io.lidVolume.toFixed(0)} mm³) each one closed shell, accepted by Manifold`);
  ok(Math.abs(lo.bodyTop - lo.zc) < 0.06 && Math.abs(lo.lidTop - (T.zm + 12)) < 0.1, `the body stops at the cut, a wall’s thickness under the top (z ${lo.bodyTop.toFixed(2)}, cut at ${lo.zc.toFixed(2)}); the lid makes the top (z ${lo.lidTop.toFixed(2)})`);
  ok(lo.nPlug > 100 && Math.abs(lo.plugMed - 0.15) < 0.03 && lo.plugMin > 0.09 && lo.plug95 < 0.2, `the lid’s plug fits the opening with 0.15 mm all round: ${lo.nPlug} points of its sides, median ${lo.plugMed.toFixed(3)} mm (min ${lo.plugMin.toFixed(3)}, 95% ${lo.plug95.toFixed(3)}) off the body`);
  ok(lo.nFace > 50 && lo.faceMin < 0.03 && !(lo.inside.worst < -0.03), `its face sits on the body’s rim (closest ${lo.faceMin.toFixed(3)} mm) and no part of the lid is inside the body (deepest ${Math.max(0, -lo.inside.worst).toFixed(3)} mm)`);
  ok(Math.abs(io.solidVolume - ic.solidVolume) < 0.005 * ic.solidVolume && Math.abs(io.saving - (io.solidVolume - io.volume) * 1.19 / 1000) < 1e-6 && io.thinnest >= 1.94, `body + lid + hollow = the same solid shape as the closed one (${io.solidVolume.toFixed(0)} against ${ic.solidVolume.toFixed(0)} mm³); ${io.saving.toFixed(2)} g saved (${io.savingPct.toFixed(1)}%); thinnest wall ${io.thinnest.toFixed(3)} mm`);
  await page.evaluate(() => { APP.V.lift = true; document.getElementById('dLift').checked = true; APP.refreshView(); }); await page.click('#dSection'); await page.waitForTimeout(500); await shot(OUT + 't2-open-lid.png');
  await page.click('#dSection'); await page.evaluate(() => { APP.V.lift = false; document.getElementById('dLift').checked = false; });
  // downloads: body and lid
  await page.evaluate(() => APP.shell.goto('export')); await a.idle();
  for (const [btn, name, tris] of [['#xStl', 'obturator-body-upper.stl', io.tris - (await page.evaluate(() => APP.B.lid.indices.length / 3))], ['#xLid', 'obturator-lid-upper.stl', await page.evaluate(() => APP.B.lid.indices.length / 3)]]) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(btn)]); const f = OUT + 't2-' + dl.suggestedFilename(); await dl.saveAs(f); const buf = fs.readFileSync(f), n = buf.readUInt32LE(80);
    ok(dl.suggestedFilename() === name && buf.length === 84 + 50 * n && n === tris, `STL download ${dl.suggestedFilename()}: ${n} triangles, well-formed`);
  }
  // ── domed top
  const id = await build(a, { ...base, hollow: 'closed', top: 'dome', dome: 3 });
  const zTop = await page.evaluate(() => TH.N.meshBounds(APP.B.mesh).max[2]);
  ok(id.closed && id.manifold && id.shells === 2 && id.thinnest >= 1.94 && Math.abs(zTop - (T.zm + 15)) < 0.2, `domed top: closed, two shells; it rises 3 mm in the middle (top at z ${zTop.toFixed(2)}, the flat one’s at ${(T.zm + 12).toFixed(2)}); walls under it at least 2.0 mm (thinnest ${id.thinnest.toFixed(3)})`);
  await page.click('#dSection'); await page.waitForTimeout(500); await shot(OUT + 't2-dome.png'); await page.click('#dSection');
  // ── the bulb allowed to engage 1.0 mm of undercut
  const iu = await build(a, { ...base, hollow: 'closed', top: 'flat', under: 1.0 });
  const pu = await page.evaluate(`(${POCKET})(${JSON.stringify(C)})`);
  const ru = await page.evaluate((C) => { const P = TH.shells(APP.B.mesh)[0].mesh, inPocket = (x, y, z) => Math.hypot(x - C.pocket[0], y - C.pocket[1], z - C.pocket[2]) < C.pocketR + 1.2; return { pocket: TH.rayHits(P, [0, 0, -1], inPocket), rest: TH.rayHits(P, [0, 0, -1], (x, y, z) => !inPocket(x, y, z)) }; }, C);
  ok(Math.abs(pc.reach - (xLip - 0.5)) < 0.06 && Math.abs(pu.reach - pc.reach - 1.0) < 0.1, `allowed 1.0 mm of undercut, the bulb reaches into the pocket to x = ${pu.reach.toFixed(3)} mm, ${(pu.reach - pc.reach).toFixed(3)} mm further than when blocked out (${pc.reach.toFixed(3)})`);
  ok(pu.near > 0.42, `…still keeping the relief off the real tissue there (closest ${pu.near.toFixed(3)} mm)`);
  ok(ru.pocket.hits > 0 && ru.rest.hits === 0, `…and it is now caught in the pocket on the way out (${ru.pocket.hits} of ${ru.pocket.n} points there meet the tissue going straight down), nowhere else (${ru.rest.hits} of ${ru.rest.n})`);
  ok(Math.abs(iu.cavity - ic.cavity) < 0.005 * ic.cavity && iu.thinnest >= 1.94 && iu.volume > ic.volume + 10, `the hollow is unchanged (${iu.cavity.toFixed(0)} mm³); the bulb is ${(iu.volume - ic.volume).toFixed(0)} mm³ bigger`);
  // ── solid bulb
  const is = await build(a, { ...base, under: 0, hollow: 'solid' });
  const ns = await page.evaluate(() => TH.shells(APP.B.mesh).length);
  ok(is.closed && ns === 1 && Math.abs(is.volume - ic.solidVolume) < 0.005 * ic.solidVolume && is.saving === 0 && !/Saved by hollowing/.test(await page.textContent('#dOut')), `solid bulb: one shell, ${is.volume.toFixed(0)} mm³ (the hollow one’s solid version: ${ic.solidVolume.toFixed(0)}), nothing saved`);
  // ── the outline over the teeth's cingula, and a path tilted 6° (front up) and 3° (patient's left up)
  const BL = (t) => t.bl, PC = [0, 4], onCrown = T.teeth.map((t) => { const ux = PC[0] - t.centre[0], uy = PC[1] - t.centre[1], L = Math.hypot(ux, uy), s = BL(t) / 2 - 0.9; return [t.centre[0] + ux / L * s, t.centre[1] + uy / L * s]; });
  const outline2 = await page.evaluate(({ T, onCrown }) => { const b = TH.scanBvh(), ray = new TH.THREE.Ray();
    const keep = T.outline.filter((p) => !T.teeth.some((t) => Math.abs(Math.hypot(p[0] - t.centre[0], p[1] - t.centre[1]) - (t.bl / 2 + 2)) < 0.05));   // drop the gingival points beside the teeth…
    const cand = keep.map((p) => [p[0], p[1]]).concat(onCrown); cand.sort((a, b) => Math.atan2(a[1] - 4, a[0]) - Math.atan2(b[1] - 4, b[0]));          // …and put them on the crowns
    return cand.map(([x, y]) => { ray.origin.set(x, y, -40); ray.direction.set(0, 0, 1); const h = b.raycastFirst(ray, TH.THREE.DoubleSide); return [x, y, h ? h.point.z : 5]; }); }, { T, onCrown });
  const it = await build(a, { ...base, outline: outline2, ap: 6, lat: 3, hollow: 'closed' });
  const tt = await page.evaluate((T) => {
    const outer = TH.shells(APP.B.mesh)[0].mesh, S = APP.scans.framed('upper').positions, tooth = [];
    for (let v = 0; v < S.length / 3; v++) { const x = S[3 * v], y = S[3 * v + 1], z = S[3 * v + 2]; if (z < 6.5 && T.teeth.some((t) => Math.hypot(x - t.centre[0], y - t.centre[1]) < t.bl / 2 + 0.6)) tooth.push([x, y, z]); }
    const ins = TH.insideDepth(outer, tooth), b = TH.bvhOf(outer), hit = {}, v3 = new TH.THREE.Vector3(); let touch = 0; for (const p of tooth) { b.closestPointToPoint(v3.set(...p), hit); if (hit.distance < 0.05) touch++; }
    const d = APP.dirOf(APP.P.ap, APP.P.lat), out = [d.x, d.y, d.z];
    return { ins, touch, nTooth: tooth.length, raysT: TH.rayHits(outer, out, (x, y, z) => T.teeth.some((t) => Math.hypot(x - t.centre[0], y - t.centre[1]) < t.bl / 2 + 3)), rays: TH.rayHits(outer, out), straight: TH.rayHits(outer, [0, 0, -1], (x, y, z) => T.teeth.some((t) => Math.hypot(x - t.centre[0], y - t.centre[1]) < t.bl / 2 + 3)) };
  }, T);
  ok(it.closed && it.manifold && tt.touch > 300, `outline on the cingula, path tilted (front up 6°, left up 3°): closed; the plate rests on the teeth (${tt.touch} points of their crowns within 0.05 mm of it)`);
  ok(!(tt.ins.worst < -0.05), `…and goes into none of them beyond the grid’s rounding: of ${tt.nTooth} crown points the deepest is ${Math.max(0, -tt.ins.worst).toFixed(3)} mm inside it`);
  ok(tt.raysT.n > 3000 && tt.raysT.hits === 0, `…and comes out along the tilted path without catching a tooth: ${tt.raysT.hits} of ${tt.raysT.n} points near the teeth meet one going out along it`);
  ok(tt.rays.hits <= 2, `(over the whole obturator ${tt.rays.hits} of ${tt.rays.n} points catch along that path ${JSON.stringify(tt.rays.first)})`);
  console.log(`    (along a different path — straight down — ${tt.straight.hits} of ${tt.straight.n} points near the teeth would catch: the block-out follows the path chosen)`);
  await page.evaluate(() => APP.viewer.setView('bottom')); await page.waitForTimeout(400); await shot(OUT + 't2-cingula-tilted.png');
  // ── the case file keeps the design and the result
  await page.evaluate(() => APP.shell.goto('export')); await a.idle();
  const [dc] = await Promise.all([page.waitForEvent('download'), page.click('#xCase')]); const zip = OUT + 't2-case.zip'; await dc.saveAs(zip);
  ok(errors.length === 0, 'no page errors ' + errors.slice(0, 3).join(' | '));
  await a.close();
  { const b = await openApp('obturator-card', { width: 1200, height: 800 }); await b.page.waitForFunction(() => window.APP);
    await b.page.setInputFiles('input[data-ss=file]', zip); await b.page.waitForFunction(() => APP.scans.has('upper') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 }); await b.page.waitForTimeout(300);
    const re = await b.page.evaluate(() => ({ vol: APP.B && APP.N.meshVolume(APP.B.mesh), ap: APP.P.ap, lat: APP.P.lat, n: APP.P.outline.length, m: APP.P.margin.length, kind: APP.B && APP.B.info.kind, bulb: APP.B && APP.B.part.reduce((s, x) => s + x, 0) }));
    ok(Math.abs(re.vol - it.volume) < 0.01 && re.ap === 6 && re.lat === 3 && re.n === outline2.length && re.m === T.rim.length && re.kind === 'closed' && re.bulb > 1000, `a fresh page opens the case: the obturator (${re.vol && re.vol.toFixed(0)} mm³), the path, ${re.m} margin and ${re.n} outline points come back`);
    ok(b.errors.length === 0, 'no page errors (reopened) ' + b.errors.slice(0, 3).join(' | ')); await b.close(); }
})();
