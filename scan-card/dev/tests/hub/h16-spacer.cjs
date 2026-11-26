// The VFR route inside Scan Card: the wax-up scan loaded as the arch → its model with a base built on Models → “Use the models in
// the other tools” → Shells’ spaced model over the waxed-up incisors with the defaults (3 mm) → closed, canines untouched → both STLs.
const { openHub, ok, OUT, DATA } = require('./lib.cjs');
const fs = require('fs');
(async () => {
  const W = JSON.parse(fs.readFileSync(DATA + 'shell-truth.json'));
  const a = await openHub(), { page } = a;
  await page.setInputFiles('input[data-ss=file]', [DATA + 'shell-waxup-lower.stl', DATA + 'prep-upper.stl']);
  await page.waitForFunction(() => APP.scans.has('upper') && APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 });
  const mo = await a.go('model'); await mo.waitForFunction(() => APP.A.lower.model && !APP.A.lower.dirty && APP.A.upper.model && !APP.A.upper.dirty, null, { timeout: 300000 });
  await mo.evaluate(() => APP.shell.goto('export')); await a.idle(mo); await mo.click('#exUse'); await a.settle();
  const sh = await a.go('shell');
  await sh.evaluate(() => APP.shell.goto('make')); await sh.click('#mkMode [data-v=spacer]'); await sh.click('#mkJaw [data-v=lower]');
  await sh.evaluate(() => APP.shell.goto('shape')); await a.idle(sh);
  ok(/closed solid/.test(await sh.evaluate(() => document.getElementById('shModel').innerText)), 'Shells has the wax-up model with its base from Models, and accepts it');
  await sh.evaluate((W) => { APP.P.taps = W.incisors.map((t) => t.tip); APP.shell.goto('design'); }, W); await sh.click('#dBuild'); await a.idle(sh);
  await sh.waitForFunction(() => APP.B && APP.B.info, null, { timeout: 300000 });
  const r = await sh.evaluate((W) => { const THREE = APP.THREE, B = APP.B, M = APP.scans.lower.matrix, model = APP.scans.framed('lower'), g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(B.mesh.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(B.mesh.indices), 1)); const bvh = new APP.N.MeshBVH(g), hit = {}, q = new THREE.Vector3(), P = model.positions, d = [];
    const inc = W.incisors.map((t) => ({ fdi: t.fdi, c: new THREE.Vector3(t.centre[0], t.centre[1], t.tip[2]).applyMatrix4(M), w: t.width })), lat = [];
    for (let v = 0; v < P.length / 3; v += 2) { q.set(P[3 * v], P[3 * v + 1], P[3 * v + 2]); const t = inc.find((t) => Math.hypot(q.x - t.c.x, q.y - t.c.y) < t.w * 0.3 && q.z < t.c.z - 0.8 && q.z > t.c.z - 4); if (t) { bvh.closestPointToPoint(q, hit); (t.fdi % 10 === 1 ? d : lat).push(hit.distance); } }   // centrals: full thickness; laterals: their distal halves taper off before the canine   // the upper part of the crowns: within 4 mm of the taper towards the gum the nearest spaced surface lies below
    const gm = new THREE.BufferGeometry(); gm.setAttribute('position', new THREE.BufferAttribute(model.positions, 3)); gm.setIndex(new THREE.BufferAttribute(Uint32Array.from(model.indices), 1)); const bm = new APP.N.MeshBVH(gm), hm = {};
    const can = W.canines.map((t) => { q.set(...t.tip).applyMatrix4(M); bm.closestPointToPoint(q, hm); bvh.closestPointToPoint(hm.point.clone(), hit); return hit.distance; });
    d.sort((x, y) => x - y); lat.sort((x, y) => x - y); return { latMed: lat[lat.length >> 1], latMin: lat[0], info: B.info, closed: APP.N.isWatertight(B.mesh), med: d[d.length >> 1], p05: d[Math.floor(0.05 * (d.length - 1))], n: d.length, can, space: APP.P.space }; }, W);
  ok(r.space === 3 && r.closed && Math.abs(r.med - 3) < 0.08 && r.p05 > 2.85, `with the defaults: closed, ${r.info.added.toFixed(0)} mm³ added, spacer ${r.med.toFixed(3)} mm over the central incisors (5%: ${r.p05.toFixed(3)}, ${r.n} points; laterals median ${r.latMed.toFixed(2)}, thinnest ${r.latMin.toFixed(2)} mm where it tapers off before the canines), in ${r.info.seconds.toFixed(1)} s`);
  ok(r.can.every((x) => x < 0.02), `the canines stay unspaced with the 3 mm spacer (tips ${r.can.map((x) => x.toFixed(3)).join(' and ')} mm off)`);
  await sh.evaluate(() => APP.shell.goto('export')); await a.idle(sh);
  const [d1] = await Promise.all([page.waitForEvent('download'), sh.click('#xStl')]); await d1.saveAs(OUT + 'h16-spaced.stl');
  const [d2] = await Promise.all([page.waitForEvent('download'), sh.click('#xWax')]); await d2.saveAs(OUT + 'h16-waxup.stl');
  const tri = (f) => { const b = fs.readFileSync(f), n = b.readUInt32LE(80); return b.length === 84 + 50 * n ? n : -1; };
  ok(tri(OUT + 'h16-spaced.stl') === r.info.tris && tri(OUT + 'h16-waxup.stl') > 1000, `both models download through the hub: ${d1.suggestedFilename()} and ${d2.suggestedFilename()}`);
  await a.shot(OUT + 'h16-spacer.png');
  const errs = a.errors.filter((e) => !/font-src/.test(e)); ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await a.close();
})();
