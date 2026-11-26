// A wax-up saved the way Wax Card (and most CAD) saves it — the scan plus each waxed tooth as its own closed piece — through
// Scan Card's stent route: loaded (the pieces were dropped on loading as specks, being under 4% of the scan's triangles) → Models'
// base (the pieces were left out there too, as separate pieces) → “Use the models” → Shells' spaced model. Checks: the pieces
// survive loading and the open scrap does not; the model has the wax-up on it (its proud points on the model's surface) and says
// the pieces were joined on; Shells' spacer stands 3 mm off the wax-up, not off the teeth under it.
const { openHub, ok, OUT, DATA } = require('./lib.cjs');
const fs = require('fs');
(async () => {
  const W = JSON.parse(fs.readFileSync(DATA + 'shell-waxparts-truth.json'));
  const a = await openHub(), { page } = a;
  await page.setInputFiles('input[data-ss=file]', [DATA + 'shell-waxparts-lower.stl', DATA + 'prep-upper.stl']);
  await page.waitForFunction(() => APP.scans.has('upper') && APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 });
  const tris = await page.evaluate(() => APP.scans.lower.raw.indices.length / 3);
  ok(tris === W.scanTris + 4 * W.pieceTris, `loading keeps the four closed wax pieces (${W.pieceTris} triangles each, 0.2% of the scan) and drops the open scrap: ${tris} triangles, expected ${W.scanTris + 4 * W.pieceTris}`);
  const mo = await a.go('model'); await mo.waitForFunction(() => APP.A.lower.model && !APP.A.lower.dirty && APP.A.upper.model && !APP.A.upper.dirty, null, { timeout: 300000 });
  const m = await mo.evaluate((W) => { const THREE = APP.N.THREE, A = APP.A.lower, g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(A.model.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(A.model.indices), 1));
    const bvh = new APP.N.MeshBVH(g), h = {}, q = new THREE.Vector3(), M = APP.scans.lower.matrix, d = W.proud.map((p) => { q.set(p[0], p[1], p[2]).applyMatrix4(M); bvh.closestPointToPoint(q, h); return h.distance; });
    return { notes: A.info.notes, closed: APP.N.isWatertight(A.model), worst: Math.max(...d), n: d.length }; }, W);
  ok(m.closed && m.worst < 0.02, `Models' model has the wax-up on it: all ${m.n} points of the wax pieces that stand up to ${Math.max(...W.proud.map((p) => p[3])).toFixed(2)} mm proud of the scan are on its surface (furthest ${m.worst.toFixed(3)} mm)`);
  ok(m.notes.some((s) => /4 closed pieces \(a wax-up\) joined on/.test(s)) && !m.notes.some((s) => /left out/.test(s)), `and says so: “${m.notes.join('; ')}”`);
  await mo.evaluate(() => APP.shell.goto('export')); await a.idle(mo); await mo.click('#exUse'); await a.settle();
  const sh = await a.go('shell');
  await sh.evaluate(() => APP.shell.goto('make')); await sh.click('#mkMode [data-v=spacer]'); await sh.click('#mkJaw [data-v=lower]');
  await sh.evaluate((W) => { APP.P.taps = W.incisors.map((t) => t.tip); APP.shell.goto('design'); }, W); await sh.click('#dBuild'); await a.idle(sh);
  await sh.waitForFunction(() => APP.B && APP.B.info, null, { timeout: 300000 });
  const r = await sh.evaluate((W) => { const THREE = APP.THREE, B = APP.B, g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(B.mesh.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(B.mesh.indices), 1));
    const bvh = new APP.N.MeshBVH(g), h = {}, q = new THREE.Vector3(), M = APP.scans.lower.matrix, d = W.proud.map((p) => { q.set(p[0], p[1], p[2]).applyMatrix4(M); bvh.closestPointToPoint(q, h); return h.distance; }).sort((x, y) => x - y);
    return { med: d[d.length >> 1], p10: d[Math.floor(0.1 * (d.length - 1))], closed: APP.N.isWatertight(B.mesh), space: APP.P.space }; }, W);
  ok(r.closed && Math.abs(r.med - r.space) < 0.1 && r.p10 > r.space - 0.5, `Shells' spaced model stands ${r.space} mm off the wax-up itself: median ${r.med.toFixed(2)} mm from its proud points (10%: ${r.p10.toFixed(2)} mm, where it tapers past the end teeth), closed`);
  await a.shot(OUT + 'h17-waxparts.png');
  const errs = a.errors.filter((e) => !/font-src/.test(e)); ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await a.close();
})();
