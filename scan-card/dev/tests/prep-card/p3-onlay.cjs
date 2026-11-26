// Prep check on an onlay of exactly known shape (mkpartial.mjs, KIND=onlay): the demo 46 with its whole occlusal surface lowered by
// 1.5 mm (its own cusps moved down), a flat margin 0.5 mm above the contact points, the demo upper in the bite. Checks the occlusal room
// over the occlusal surface — closest, typical and by quarter — and the area under a target against the truth worked out from the
// designed surface itself; the margin against the neighbours (it runs into the joined contacts, measured independently here); no
// occlusal contacts near the margin; the case file keeping the type and targets; and switching back to Crown.
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs'), OUT = '/home/claude/suite/dev/out/prep-card/', DATA = '/home/claude/suite/dev/data/';
const T = JSON.parse(fs.readFileSync(DATA + 'prep-onlay-truth.json'));
let bad = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { bad++; process.exitCode = 1; } };
(async () => {
  const { page, errors, shot, close } = await openApp('prep-card', { width: 1400, height: 900 });
  const idle = async () => { await page.waitForTimeout(150); await page.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 }); };
  await page.waitForFunction(() => window.APP);
  await page.setInputFiles('input[data-ss=file]', [DATA + 'prep-onlay-lower.stl', DATA + 'prep-upper.stl']); await idle();
  ok(await page.evaluate(() => APP.scans.has('lower') && APP.scans.has('upper') && APP.scans.inBite), 'both arches loaded, in the bite');
  await page.evaluate(() => APP.shell.goto('tooth')); await page.click('#ptJaw [data-v=lower]'); await page.click('#ptType [data-v=onlay]');
  ok(await page.evaluate(() => APP.P.type === 'onlay' && /cavity|prepared surface/.test(document.getElementById('ptLead').textContent)), 'Onlay chosen with a tap; the step asks for the prepared surface');
  // the margin as tapped round the shoulder (truth in file coordinates → the case frame the app oriented the scans into)
  const r = await page.evaluate((T) => {
    const THREE = APP.THREE, M = APP.scans.lower.matrix, V = (p) => new THREE.Vector3(...p).applyMatrix4(M).toArray();
    APP.P.seed = V(T.seed); APP.P.loop = T.loop.map(V); APP.P.dir = null; APP.analyse(); const R = APP.R; if (!R) return null;
    const up = new THREE.Vector3(...T.frame.up).transformDirection(M);
    return { axisOff: new THREE.Vector3(...R.d).angleTo(up) * 180 / Math.PI, area: R.total, room: R.pt.room, walls: !!R.pt.walls.min, isthmus: R.pt.isthmus, prox: R.pt.prox, occ: R.pt.occ };
  }, T);
  ok(!!r && r.area > 60, `prepared surface found: ${r ? r.area.toFixed(1) : '–'} mm²`);
  ok(r.axisOff < 3, `tooth's axis ${r.axisOff.toFixed(1)}° from the designed one (the walls and the occlusal axis)`);
  const q = r.room, TR = T.room;
  ok(Math.abs(q.min - TR.min) < 0.1, `occlusal room, closest ${q.min.toFixed(2)} mm (designed surface to the opposing scan: ${TR.min.toFixed(2)} mm; the unprepared tooth had ${TR.unpreparedMin.toFixed(2)} mm)`);
  ok(Math.abs(q.median - TR.median) < 0.15, `occlusal room, typical ${q.median.toFixed(2)} mm (designed ${TR.median.toFixed(2)} mm)`);
  const names = { mb: 'mesiobuccal', db: 'distobuccal', ml: 'mesiolingual', dl: 'distolingual' };
  const qs = Object.keys(names).map((k) => ({ k, app: q.quarters[k], t: TR.quarters[k] }));
  ok(qs.every((x) => x.app && Math.abs(x.app.min - x.t.min) < 0.12 && Math.abs(x.app.median - x.t.median) < 0.2), 'by quarter, closest · typical: ' + qs.map((x) => `${names[x.k]} ${x.app ? x.app.min.toFixed(2) + ' · ' + x.app.median.toFixed(2) : '–'} (designed ${x.t.min.toFixed(2)} · ${x.t.median.toFixed(2)})`).join(', '));
  ok(q.under === 0, `nothing under the default 1.5 mm target (the tooth stood ${TR.unpreparedMin.toFixed(1)} mm clear before it was cut)`);
  const u = await page.evaluate(() => { const out = {}; for (const t of [4.0, 4.5]) { APP.P.target = t; APP.analyse(); out[t] = APP.R.pt.room.underFrac; } APP.P.target = 1.5; APP.analyse(); return out; });
  ok(Math.abs(u[4] - TR.belowTarget['4']) < 0.05 && Math.abs(u[4.5] - TR.belowTarget['4.5']) < 0.06, `share under a 4.0 / 4.5 mm target: ${(u[4] * 100).toFixed(0)}% / ${(u[4.5] * 100).toFixed(0)}% (designed ${(TR.belowTarget['4'] * 100).toFixed(0)}% / ${(TR.belowTarget['4.5'] * 100).toFixed(0)}%)`);
  ok(!r.walls && !r.isthmus, 'every cusp covered: no cavity walls to measure and no isthmus');
  // the margin against the neighbours, measured independently: the nearest distance from the prepared surface's edge to surfaces beyond
  // the tooth's half width (the neighbours), on each side
  const ind = await page.evaluate((T) => {
    const THREE = APP.THREE, M = APP.scans.lower.matrix, g = APP.G, R = APP.R, c = new THREE.Vector3(...T.frame.centre, 0).applyMatrix4(M), m = new THREE.Vector3(...T.frame.mesial).transformDirection(M), half = T.frame.md / 2;
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
  ok(r.prox.mesial.touching && r.prox.distal.touching && ind.mesial < 0.12 && ind.distal < 0.12, `the margin runs into both contacts (the demo's neighbours are joined to the tooth from about 1 mm below to 1 mm above its contact points): reported touching mesially and distally; measured independently, the margin comes within ${ind.mesial.toFixed(2)} / ${ind.distal.toFixed(2)} mm of the neighbours`);
  ok(r.occ && !r.occ.at, 'no occlusal contacts within 4 mm of the margin (the remaining tooth is all below the margin, well clear of the upper)');
  // the Results step: what is shown
  await page.evaluate(() => APP.shell.goto('check')); await page.click('#ckMap [data-v=clear]'); await page.waitForTimeout(250);
  const ui = await page.evaluate(() => ({ text: document.getElementById('ckOut').innerText, wallBtn: document.querySelector('#ckMap [data-v=wall]'), tip: !document.getElementById('ckTipP').hidden, tgt: document.getElementById('ckTgtLab').textContent, tgtShown: !document.getElementById('ckTgtRow').hidden }));
  ok(/Occlusal room/.test(ui.text) && /Mesiobuccal/.test(ui.text) && /touching/.test(ui.text) && /Total taper/.test(ui.text) && !/Total occlusal convergence/.test(ui.text), 'Results show occlusal room by quarter, the margin touching the neighbours and total taper (not crown wording)');
  ok(ui.tip && ui.tgtShown && /occlusal room/.test(ui.tgt), `the onlay help and the room target (“${ui.tgt}”) are shown`);
  await page.evaluate((T) => { const V = APP.viewer, c = new APP.THREE.Vector3(...T.frame.centre, -2).applyMatrix4(APP.scans.lower.matrix); V.controls.target.copy(c); V.camera.position.set(c.x + 8, c.y + 16, c.z + 24); V.camera.up.set(0, 0, 1); V.camera.lookAt(c); V.controls.update(); V.invalidate(); }, T);
  await page.waitForTimeout(250); await shot(OUT + 'p3-onlay-room.png');
  // a target change is kept in the case file with the type, and the figures come back identical
  await page.evaluate(() => { const i = document.getElementById('ckTgt'); i.value = '2.5'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); });
  const before = await page.evaluate(() => APP.figuresText());
  const blob = await page.evaluate(async () => Array.from(new Uint8Array(await (await APP.scans.toCase().toBlob('t')).arrayBuffer())));
  await page.evaluate(async (a) => { APP.P.type = 'crown'; APP.P.target = 1.5; await APP.scans.useCase(await APP.N.DentalCase.fromBlob(new Blob([new Uint8Array(a)]))); }, blob); await idle();
  const after = await page.evaluate(() => ({ fig: APP.figuresText(), type: APP.P.type, target: APP.P.target, saved: APP.scans.toCase().data.prep }));
  ok(after.fig === before && after.type === 'onlay' && after.target === 2.5, `the case file keeps the onlay, its 2.5 mm room target and the marking: identical figures after reopening (saved: type ${after.saved.type}, room ${after.saved.results.room.min.toFixed(2)} mm)`);
  console.log(after.fig.split('\n').map((l) => '     ' + l).join('\n'));
  // back to Crown: the partial checks go, the crown figures come back in the crown's own wording
  await page.evaluate(() => APP.shell.goto('tooth')); await page.click('#ptType [data-v=crown]'); await page.evaluate(() => APP.shell.goto('check')); await page.waitForTimeout(200);
  const cr = await page.evaluate(() => ({ pt: !!APP.R.pt, wallHidden: document.querySelector('#ckMap [data-v=wall]').hidden, tip: document.getElementById('ckTipP').hidden, text: document.getElementById('ckOut').innerText, fig: APP.figuresText().split('\n')[5] }));
  ok(!cr.pt && cr.wallHidden && cr.tip && /Total occlusal convergence/.test(cr.text) && !/Occlusal room/.test(cr.text) && /^Total occlusal convergence/.test(cr.fig), 'switched back to Crown: crown results and wording, no partial checks, no Walls map');
  console.log('errors:', JSON.stringify(errors.slice(0, 4))); ok(errors.length === 0, 'no page errors');
  await close(); console.log(bad ? bad + ' FAILED' : 'all passed');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
