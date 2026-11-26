// Prep check on an MOD inlay of exactly known shape (mkpartial.mjs, KIND=inlay): occlusal box 2.4 mm wide at its floor, buccal and lingual
// walls each flaring 6°, proximal boxes 5.0 mm wide with axial walls leaning 6°, on a demo 46 built 0.4 mm short of each neighbour. Checks
// the tooth's axis, each wall's divergence and the total taper, the isthmus, the wall heights, the remaining wall thickness against the
// truth worked out along each designed wall (and the “consider cusp coverage” flag following the target), the occlusal room over the
// floor, the gap from the box margins to the neighbours (measured independently here), occlusal contacts at the margin with the upper
// lowered onto the cusps, and the case file.
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs'), OUT = '/home/claude/suite/dev/out/prep-card/', DATA = '/home/claude/suite/dev/data/';
const T = JSON.parse(fs.readFileSync(DATA + 'prep-inlay-truth.json'));
let bad = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { bad++; process.exitCode = 1; } };
const f2 = (v) => (v == null || !isFinite(v) ? '–' : v.toFixed(2)), f1 = (v) => (v == null || !isFinite(v) ? '–' : v.toFixed(1));
(async () => {
  const { page, errors, shot, close } = await openApp('prep-card', { width: 1400, height: 900 });
  const idle = async () => { await page.waitForTimeout(150); await page.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 }); };
  const load = async (upper) => { await page.setInputFiles('input[data-ss=file]', [DATA + 'prep-inlay-lower.stl', DATA + upper]); await idle(); };
  const mark = () => page.evaluate((T) => { const M = APP.scans.lower.matrix, V = (p) => new APP.THREE.Vector3(...p).applyMatrix4(M).toArray(); APP.P.jaw = 'lower'; APP.P.seed = V(T.seed); APP.P.loop = T.loop.map(V); APP.P.dir = null; APP.analyse(); }, T);
  await page.waitForFunction(() => window.APP);
  await load('prep-upper.stl');
  ok(await page.evaluate(() => APP.scans.has('lower') && APP.scans.has('upper') && APP.scans.inBite), 'both arches loaded, in the bite');
  await page.evaluate(() => APP.shell.goto('tooth')); await page.click('#ptJaw [data-v=lower]'); await page.click('#ptType [data-v=inlay]'); await mark();
  const get = () => page.evaluate((T) => {
    const THREE = APP.THREE, M = APP.scans.lower.matrix, R = APP.R, s = R.sides, up = new THREE.Vector3(...T.frame.up).transformDirection(M);
    return { area: R.total, axisOff: new THREE.Vector3(...R.d).angleTo(up) * 180 / Math.PI, ang: { b: s.buccal.angle, m: s.mesial.angle, d: s.distal.angle, l: s.lingual.angle }, h: { b: s.buccal.height, l: s.lingual.height }, md: R.tocMD, bl: R.tocBL, uSelf: R.uSelf, uBlock: R.uBlock, pt: R.pt };
  }, T);
  let r = await get();
  ok(r.area > 60, `prepared surface found: ${f1(r.area)} mm²`);
  ok(r.axisOff < 1.5, `the tooth's axis (from the occlusal axis, turned by the walls) ${f1(r.axisOff)}° from the designed one`);
  ok(['b', 'm', 'd', 'l'].every((k) => Math.abs(r.ang[k] - 6) < 1), `wall angles on that axis B ${f1(r.ang.b)}° M ${f1(r.ang.m)}° D ${f1(r.ang.d)}° L ${f1(r.ang.l)}° (built: buccal and lingual walls flaring 6°, axial walls leaning 6°)`);
  ok(Math.abs(r.bl - 12) < 1.5 && Math.abs(r.md - 12) < 1.5, `total taper buccolingual ${f1(r.bl)}° (12° built: the box opens towards the occlusal), mesiodistal ${f1(r.md)}° (12° built, between the two axial walls)`);
  const rd = await page.evaluate((T) => { APP.P.dir = new APP.THREE.Vector3(...T.frame.up).transformDirection(APP.scans.lower.matrix).toArray(); APP.analyse(); const s = APP.R.sides; const o = [s.buccal.angle, s.mesial.angle, s.distal.angle, s.lingual.angle]; APP.P.dir = null; APP.analyse(); return o; }, T);
  ok(rd.every((a) => Math.abs(a - 6) < 0.5), `about the designed axis exactly: ${rd.map(f1).join('°, ')}° (6° each)`);
  ok(r.uSelf < 0.5 && r.uBlock < 0.5, `no undercut (${f1(r.uSelf)} mm²) and nothing in the way (${f1(r.uBlock)} mm²)`);
  ok(r.pt.isthmus && Math.abs(r.pt.isthmus.width - T.isthmusAt05) < 0.1, `isthmus, narrowest ${f2(r.pt.isthmus && r.pt.isthmus.width)} mm (built ${T.isthmus} mm at the floor, so ${T.isthmusAt05} mm half a millimetre above it)`);
  ok(Math.abs(r.h.b - T.wallHeight.buccal) < 0.3 && Math.abs(r.h.l - T.wallHeight.lingual) < 0.3, `wall heights: buccal ${f2(r.h.b)} mm, lingual ${f2(r.h.l)} mm (designed, gingival floor to the top of the wall: ${T.wallHeight.buccal} / ${T.wallHeight.lingual} mm)`);
  const w = r.pt.walls.sides;
  ok(w.buccal && w.lingual && Math.abs(w.buccal.min - T.wallThin.buccal) < 0.25 && Math.abs(w.lingual.min - T.wallThin.lingual) < 0.25, `remaining wall, thinnest: buccal ${f2(w.buccal && w.buccal.min)} mm, lingual ${f2(w.lingual && w.lingual.min)} mm (designed walls, measured the same way: ${T.wallThin.buccal} / ${T.wallThin.lingual} mm — the cusps beside the boxes)`);
  ok(Math.abs(w.buccal.median - T.wallMedian.buccal) < 0.3 && Math.abs(w.lingual.median - T.wallMedian.lingual) < 0.3, `remaining wall, typical: buccal ${f2(w.buccal.median)} mm, lingual ${f2(w.lingual.median)} mm (designed ${T.wallMedian.buccal} / ${T.wallMedian.lingual} mm)`);
  ok(!w.mesial && !w.distal, 'no mesial or distal cavity walls (both boxes open onto the proximal surfaces)');
  const room = r.pt.room;
  ok(room && Math.abs(room.min - T.floorRoom.min) < 0.1 && Math.abs(room.median - T.floorRoom.median) < 0.15, `occlusal room over the floor: closest ${f2(room && room.min)} mm, typical ${f2(room && room.median)} mm (designed floor to the opposing scan: ${T.floorRoom.min} / ${T.floorRoom.median} mm; gingival floors and wall tops left out)`);
  // the box margins against the neighbours, measured independently: the nearest distance from the prepared surface's edge, at each end, to
  // surfaces beyond the middle of the open contact
  const ind = await page.evaluate((T) => {
    const THREE = APP.THREE, M = APP.scans.lower.matrix, g = APP.G, R = APP.R, c = new THREE.Vector3(...T.frame.centre, 0).applyMatrix4(M), m = new THREE.Vector3(...T.frame.mesial).transformDirection(M), half = T.frame.md / 2 - T.open / 2;
    const rel = (p) => new THREE.Vector3(...p).sub(c).dot(m), P = g.mesh.positions, I = g.mesh.indices, edge = new Set();
    for (let f = 0; f < g.nF; f++) if (R.reg[f]) for (let k = 0; k < 3; k++) { const o = g.adj[3 * f + k]; if (o < 0 || !R.reg[o]) { edge.add(I[3 * f + k]); edge.add(I[3 * f + (k + 1) % 3]); } }
    const res = {};
    for (const [side, sg] of [['mesial', 1], ['distal', -1]]) {
      const idx = []; for (let f = 0; f < g.nF; f++) if (sg * rel([g.cen[3 * f], g.cen[3 * f + 1], g.cen[3 * f + 2]]) > half) idx.push(I[3 * f], I[3 * f + 1], I[3 * f + 2]);
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(idx), 1)); const bvh = new APP.N.MeshBVH(geo), h = {}; let min = Infinity;
      for (const v of edge) { const p = [P[3 * v], P[3 * v + 1], P[3 * v + 2]]; if (sg * rel(p) < half - 1.5) continue; bvh.closestPointToPoint(new THREE.Vector3(...p), h); min = Math.min(min, h.distance); }
      res[side] = min;
    }
    return res;
  }, T);
  const px = r.pt.prox;
  ok(!px.mesial.touching && !px.distal.touching && Math.abs(px.mesial.dist - ind.mesial) < 0.15 && Math.abs(px.distal.dist - ind.distal) < 0.15, `box margins clear of the neighbours (contacts built open by ${T.open} mm): ${f2(px.mesial.dist)} mm mesially, ${f2(px.distal.dist)} mm distally (measured independently from the edge of the prepared surface: ${f2(ind.mesial)} / ${f2(ind.distal)} mm)`);
  ok(r.pt.occ && !r.pt.occ.at, 'no occlusal contacts near the margin with the demo upper (the tooth stood 2 mm clear of it)');
  // the Results step: the flags follow the targets
  await page.evaluate(() => APP.shell.goto('check')); await page.click('#ckMap [data-v=wall]'); await page.waitForTimeout(250);
  const flags = () => page.evaluate(() => { const o = document.getElementById('ckOut'); return { text: o.innerText, note: (o.querySelector('.note.warn') || {}).textContent || '', badges: [...o.querySelectorAll('.okb')].map((b) => b.textContent + (b.classList.contains('bad') ? '!' : '')) }; });
  let fl = await flags();
  ok(/consider cusp coverage/.test(fl.note) && /buccal/i.test(fl.note) && /lingual/.test(fl.note), `default 2.0 mm wall target: “${fl.note.trim()}”`);
  const setRange = (id, v) => page.evaluate(({ id, v }) => { const i = document.getElementById(id); i.value = String(v); i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); }, { id, v });
  await setRange('ckWall', 1.2); fl = await flags();
  ok(!fl.note && fl.badges.some((b) => /Within your targets/.test(b)), `wall target 1.2 mm (under the thinnest wall): no cusp-coverage note, cavity badge “${fl.badges[1]}”`);
  await setRange('ckIsth', 3.0); fl = await flags();
  ok(fl.badges.some((b) => b === 'Check!') && /Isthmus, narrowest \(target 3\.0 mm\)/.test(fl.text), 'isthmus target 3.0 mm (over the 2.5 mm isthmus): the cavity is flagged');
  await setRange('ckIsth', 2.0); await setRange('ckWall', 2.0);
  await page.evaluate((T) => { const V = APP.viewer, c = new APP.THREE.Vector3(...T.frame.centre, -3).applyMatrix4(APP.scans.lower.matrix); V.controls.target.copy(c); V.camera.position.set(c.x + 6, c.y + 14, c.z + 26); V.camera.up.set(0, 0, 1); V.camera.lookAt(c); V.controls.update(); V.invalidate(); }, T);
  await page.waitForTimeout(250); await shot(OUT + 'p4-inlay-walls.png');
  const legend = await page.evaluate(() => [...document.querySelectorAll('.legend div')].map((d) => d.textContent).join(' | '));
  ok(/wall under 2\.0 mm/.test(legend), `Walls map legend: ${legend}`);
  await page.click('#ckMap [data-v=clear]'); await page.waitForTimeout(250); await shot(OUT + 'p4-inlay-room.png');
  // the case file keeps the type and the targets
  await setRange('ckMgn', 1.5);
  const before = await page.evaluate(() => APP.figuresText());
  const blob = await page.evaluate(async () => Array.from(new Uint8Array(await (await APP.scans.toCase().toBlob('t')).arrayBuffer())));
  await page.evaluate(async (a) => { Object.assign(APP.P, { type: 'crown', wallT: 3, isthT: 3, mgnT: 2 }); await APP.scans.useCase(await APP.N.DentalCase.fromBlob(new Blob([new Uint8Array(a)]))); }, blob); await idle();
  const after = await page.evaluate(() => ({ fig: APP.figuresText(), P: { type: APP.P.type, wallT: APP.P.wallT, isthT: APP.P.isthT, mgnT: APP.P.mgnT }, sliders: ['ckWall', 'ckIsth', 'ckMgn'].map((id) => document.getElementById(id).value) }));
  ok(after.fig === before && after.P.type === 'inlay' && after.P.wallT === 2 && after.P.isthT === 2 && after.P.mgnT === 1.5 && after.sliders.join() === '2,2,1.5', `the case file keeps the inlay and its targets (wall ${after.P.wallT}, isthmus ${after.P.isthT}, margin to contacts ${after.P.mgnT} mm): identical figures after reopening`);
  console.log(after.fig.split('\n').map((l) => '     ' + l).join('\n'));
  // occlusal contacts: the upper lowered until it touches the remaining cusps (0.05 mm), which it does right at the isthmus edge
  await load('prep-inlay-upper-close.stl');
  await page.evaluate(() => APP.shell.goto('tooth')); await page.click('#ptType [data-v=inlay]'); await mark();
  r = await get(); const oc = r.pt.occ, tc = T.closeUpper;
  ok(oc && oc.at && oc.dist >= tc.nearestToMargin - 0.15 && oc.dist <= 1.5 * tc.nearestToMargin + 0.35, `with the upper lowered ${tc.lowered} mm onto the cusps: nearest occlusal contact ${f2(oc && oc.dist)} mm from the margin along the tooth (straight-line distance from the designed contacts to the tapped margin: ${tc.nearestToMargin} mm, over ${tc.contacts} contact points)`);
  await page.evaluate(() => APP.shell.goto('check')); await page.waitForTimeout(200); fl = await flags();
  ok(fl.badges.some((b) => /Contact under 1\.5 mm!/.test(b)) && await page.evaluate(() => !document.getElementById('ckMgnRow').hidden), `…flagged against the 1.5 mm margin-to-contact target kept from the case (badge “${fl.badges.find((b) => /Contact/.test(b))}”), its slider shown`);
  ok(Math.abs(r.pt.room.min - (T.floorRoom.min - tc.lowered)) < 0.15, `occlusal room over the floor follows the upper down: ${f2(r.pt.room.min)} mm (${T.floorRoom.min} − ${tc.lowered} = ${f2(T.floorRoom.min - tc.lowered)} mm: the designed floor's closest point under the upper, lowered straight down)`);
  console.log('errors:', JSON.stringify(errors.slice(0, 4))); ok(errors.length === 0, 'no page errors');
  await close(); console.log(bad ? bad + ' FAILED' : 'all passed');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
