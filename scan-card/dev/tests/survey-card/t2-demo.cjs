// Survey Card on its own, on the demo arches (synthetic): the path set with the sliders, “Use this view” and “Level”; a tap
// reading on the undercut map; abutments added by real taps and named from where they sit; Palmer numbers; a clasp tip kept;
// the block-out (closed, nothing facing away from the path, holds the scan), relief, both STL positions; the case file round
// trip; the upper arch; and a phone-sized screen.
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs'), OUT = '/home/claude/suite/dev/out/survey-card/';
let bad = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) { bad++; process.exitCode = 1; } };
(async () => {
  const { page, errors, shot, close } = await openApp('survey-card', { width: 1400, height: 900 });
  const idle = async () => { await page.waitForTimeout(150); await page.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 }); };
  const click3d = async (p) => { const xy = await page.evaluate((p) => { const q = APP.viewer.toScreen(new APP.THREE.Vector3(...p)), r = APP.viewer.dom.getBoundingClientRect(); return [q.x + r.left, q.y + r.top]; }, p); await page.mouse.click(xy[0], xy[1]); await page.waitForTimeout(120); };
  const lookAlong = (d, target) => page.evaluate(({ d, target }) => { const V = APP.viewer, T = APP.THREE, t = new T.Vector3(...target); V.controls.target.copy(t); V.camera.position.copy(t).addScaledVector(new T.Vector3(...d), 150); V.camera.up.set(0, 1, 0); V.camera.lookAt(t); V.camera.updateProjectionMatrix(); V.controls.update(); V.invalidate(); }, { d, target });
  await page.waitForFunction(() => window.APP); await page.click('[data-ss=demo]'); await idle();
  await page.evaluate(() => APP.shell.goto('path')); await idle();
  const s0 = await page.evaluate(() => ({ jaw: APP.P.jaw, ap: APP.P.ap, lat: APP.P.lat, t: APP.A.time, n: APP.A.depth.length, len: APP.A.lineLength }));
  ok(s0.jaw === 'lower' && s0.ap === 0 && s0.lat === 0, `the lower arch is surveyed along the occlusal axis to start with (${s0.n.toLocaleString('en-GB')} points in ${s0.t.toFixed(0)} ms, ${Math.round(s0.len)} mm of survey line)`);
  // ── the path: “Use this view”, then “Level”, then a slider
  await lookAlong(await page.evaluate(() => APP.dirOf('lower', 5, -4).toArray()), [0, 0, 0]);
  await page.click('#pView'); await page.waitForTimeout(100); await idle();
  const v1 = await page.evaluate(() => ({ ap: APP.P.ap, lat: APP.P.lat, key: APP.A.key.split('|').slice(0, 3).join('|'), info: document.getElementById('pInfo').textContent }));
  ok(v1.ap === 5 && v1.lat === -4 && v1.key === 'lower|5|-4' && /front up 5\.0°, patient’s right up 4\.0°/.test(v1.info), `“Use this view” looking down a path 5° front up, 4° right up sets exactly that and surveys it again (${v1.info.match(/Model on the surveyor table(.*?)From/)[1]})`);
  await lookAlong([0.9, 0, 0.44], [0, 0, 0]); await page.click('#pView'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => APP.P.ap === 5 && APP.P.lat === -4 && /from their biting side/.test(document.getElementById('status').textContent)), '…but a view more than 35° off the biting side is refused, with a message');
  await page.click('#pLevel'); await page.waitForFunction(() => APP.A && APP.A.key.startsWith('lower|0|0|'), null, { timeout: 60000 }).catch(() => {}); await idle();
  ok(await page.evaluate(() => APP.P.ap === 0 && APP.P.lat === 0 && APP.A.key.startsWith('lower|0|0|')), '“Level” puts the path back square to the biting surfaces');
  await page.evaluate(() => { const r = document.getElementById('pAp'); r.value = 7; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); }); await page.waitForFunction(() => APP.A && APP.A.key.startsWith('lower|7|0|'), null, { timeout: 60000 }).catch(() => {}); await idle();
  ok(await page.evaluate(() => APP.P.ap === 7 && APP.A.key.startsWith('lower|7|0|') && document.querySelector('#pAp').parentElement.querySelector('.val').textContent === 'front 7.0°'), 'the front / back slider (front 7.0°) re-surveys when let go');
  // ── reading the map by tapping it
  await page.evaluate(() => APP.shell.goto('survey')); await idle(); await page.evaluate(() => APP.viewer.setView('front')); await page.waitForTimeout(250);
  const target = await page.evaluate(() => { const A = APP.A, P = A.mesh.positions, cam = APP.viewer.camera.position, ray = new APP.THREE.Raycaster(); let best = null;
    const map = APP.viewer.scene.getObjectByName('survey-map');
    for (let v = 0; v < A.depth.length; v++) { const d = A.depth[v]; if (!(d > 0.3 && d < 0.6) || A.s[v] > -0.1) continue; const p = new APP.THREE.Vector3(P[3 * v], P[3 * v + 1], P[3 * v + 2]); if (Math.abs(p.x) > 20) continue;
      ray.set(cam, p.clone().sub(cam).normalize()); const h = ray.intersectObject(map, false)[0]; if (h && h.point.distanceTo(p) < 0.05) { best = { v, p: p.toArray(), d }; break; } }
    return best; });
  ok(!!target, 'found a point of undercut (0.3 – 0.6 mm) facing the camera to tap');
  if (target) { await click3d(target.p); const lbl = await page.evaluate(() => [...document.querySelectorAll('.lbl')].map((e) => e.textContent).find((t) => /undercut/.test(t)) || ''); const m = lbl.match(/^([\d.]+) mm undercut · ([\d.]+) mm below the survey line$/);
    ok(!!m && Math.abs(+m[1] - target.d) < 0.06 && +m[2] > 0, `tapping it reads “${lbl}” (the point holds ${target.d.toFixed(2)} mm)`); }
  await page.waitForTimeout(150); await shot(OUT + 't2-map-front.png');
  await page.click('#sShow [data-v=lines]'); await page.waitForTimeout(150);
  ok(await page.evaluate(() => { const c = APP.viewer.scene.getObjectByName('survey-map').geometry.attributes.color; let same = true; for (let v = 0; v < c.count; v += 97) if (Math.abs(c.getX(v) - c.getX(0)) > 1e-6) same = false; return same; }), '“Survey lines” shows the plain scan with the lines on it');
  await shot(OUT + 't2-lines-front.png'); await page.click('#sShow [data-v=map]');
  // ── abutment teeth by real taps, seen from above
  await page.evaluate(() => APP.shell.goto('teeth')); await idle(); await page.evaluate(() => APP.viewer.setView('top')); await page.waitForTimeout(250);
  const truth = await page.evaluate(() => APP.scans.demoTruth.lower.teeth.filter((t) => [33, 36, 45].includes(t.fdi)).map((t) => ({ fdi: t.fdi, centre: t.centre, tip: t.tip })));
  for (const t of truth) { const p = await page.evaluate((c) => { const ray = new APP.THREE.Ray(new APP.THREE.Vector3(c[0], c[1], 40), new APP.THREE.Vector3(0, 0, -1)), h = APP.viewer.scene.getObjectByName('survey-map').geometry.boundsTree.raycastFirst(ray, APP.THREE.DoubleSide); return h.point.toArray(); }, t.centre); await click3d(p); }
  const got = await page.evaluate(() => APP.P.teeth.map((t) => t.fdi));
  ok(got.join() === truth.map((t) => t.fdi).join(), `three taps on the biting surfaces add ${got.join(', ')} — each named right from where it sits (${truth.map((t) => t.fdi).join(', ')})`);
  await click3d(truth[1].tip); ok(await page.evaluate(() => APP.P.teeth.length === 3 && APP.P.sel === 1), 'tapping a tooth already added selects it instead of adding it again');
  const sums = await page.evaluate(() => APP.summaryData());
  const mono = sums.every((t) => ['buccal', 'lingual'].every((k) => { const g = t.sides[k].gauges.filter((x) => x != null); return g.every((x, i) => i === 0 || x >= g[i - 1] - 1e-9); }));
  const reach = sums.every((t) => ['buccal', 'lingual'].every((k) => { const q = t.sides[k]; return q.gauges.every((g, i) => (g != null) === (q.deepest >= [0.25, 0.5, 0.75][i] - 0.02)); }));
  ok(mono && reach, 'per side, deeper gauges touch further below the survey line, and a gauge touches exactly when the deepest undercut reaches it: ' + sums.map((t) => `${t.fdi} B ${t.sides.buccal.deepest} L ${t.sides.lingual.deepest}`).join(' · '));
  await page.click('#tNot [data-v=palmer]'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => /^LL3: /m.test(APP.summaryText()) && /LR5/.test(APP.summaryText()) && [...document.querySelectorAll('.tooth select')][0].selectedOptions[0].textContent === 'LL3'), 'Palmer numbers in the list and the summary (LL3, LL6, LR5)');
  await page.selectOption('.tooth[data-i="2"] select', '44'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => APP.P.teeth[2].fdi === 44 && /LR4/.test(APP.summaryText())), 'a tooth number corrected from the list (LR5 → LR4)');
  await page.selectOption('.tooth[data-i="2"] select', '45'); await page.click('#tNot [data-v=fdi]');
  await page.click('.tooth[data-i="1"] [data-keep="0.5"]'); await page.click('.tooth[data-i="1"] [data-side="lingual"]');
  ok(await page.evaluate(() => APP.P.teeth[1].keep === 0.5 && APP.P.teeth[1].side === 'lingual'), 'clasp tip set on 36: keep 0.5 mm lingually');
  console.log(await page.evaluate(() => APP.summaryText()).then((t) => t.split('\n').map((l) => '     ' + l).join('\n')));
  await page.waitForTimeout(150); await shot(OUT + 't2-teeth.png');
  // ── block-out
  let t0 = Date.now(); await page.evaluate(() => APP.shell.goto('block')); await idle(); const bi = await page.evaluate(() => APP.B.info);
  ok(bi.watertight && bi.kept.length === 1 && bi.kept[0].ok, `blocked out with the clasp tip kept in ${Date.now() - t0} ms: closed solid, ${bi.tris.toLocaleString('en-GB')} triangles`);
  const chk = await page.evaluate(async () => {   // without the clasp tip: parallel everywhere, holds the scan
    const THREE = APP.THREE, N = APP.N, A = APP.A, r = APP.blockOut(A), m = r.meshD, Pm = m.positions, Im = m.indices; let away = 0;
    for (let f = 0; f < Im.length; f += 3) { const a = Im[f] * 3, b = Im[f + 1] * 3, c = Im[f + 2] * 3; if (Pm[a + 2] <= r.baseZ + 1e-4 && Pm[b + 2] <= r.baseZ + 1e-4 && Pm[c + 2] <= r.baseZ + 1e-4) continue; const ux = Pm[b] - Pm[a], uy = Pm[b + 1] - Pm[a + 1], uz = Pm[b + 2] - Pm[a + 2], vx = Pm[c] - Pm[a], vy = Pm[c + 1] - Pm[a + 1], vz = Pm[c + 2] - Pm[a + 2], nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz); if (l > 1e-9 && nz / l < -0.02) away++; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(Pm, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(Im), 1)); const bvh = new N.MeshBVH(g), hit = {}, q = new THREE.Vector3(), P = A.Pd, pr = new THREE.Ray();
    const dirs = [new THREE.Vector3(0.3, 0.5, 0.81).normalize(), new THREE.Vector3(-0.6, 0.2, 0.77).normalize(), new THREE.Vector3(0.1, -0.7, 0.7).normalize()], inside = (p) => { let n = 0; for (const d of dirs) { pr.origin.copy(p); pr.direction.copy(d); if (bvh.raycast(pr, THREE.DoubleSide).length % 2 === 1) n++; } return n >= 2; };
    let out = 0, worst = 0, tested = 0; for (let v = 0; v < P.length / 3; v += 5) { q.set(P[3 * v], P[3 * v + 1], P[3 * v + 2]); bvh.closestPointToPoint(q, hit); tested++; if (hit.distance < 0.002) continue; if (!inside(q)) { out++; worst = Math.max(worst, hit.distance); } }
    // undercut left after block-out: survey the blocked-out model itself along the same path
    const S2 = APP.computeSurvey(r.mesh, APP.dirOf('lower', APP.P.ap, APP.P.lat), { jaw: 'lower' }); let deep = 0; for (let v = 0; v < S2.depth.length; v++) if (S2.s[v] < -0.05 && S2.depth[v] > deep && S2.depth[v] !== Infinity) deep = S2.depth[v];
    return { away, out, worst, tested, wt: r.watertight, deep };
  });
  ok(chk.wt && chk.away === 0, 'parallel block-out of the demo arch: closed, and no face (above the base) faces away from the path');
  ok(chk.worst < 0.06, `it holds the scan to within 0.06 mm: ${chk.out} of ${chk.tested} scan points tested lie outside it, by at most ${chk.worst.toFixed(3)} mm`);
  ok(chk.deep < 0.06, `surveying the blocked-out model along the same path finds no undercut left on it (deepest ${chk.deep.toFixed(3)} mm)`);
  await page.evaluate(() => APP.viewer.setView('iso')); await page.waitForTimeout(250); await shot(OUT + 't2-block-wax.png');
  // relief
  const vol0 = await page.evaluate(() => APP.N.meshVolume(APP.B.mesh));
  await page.evaluate(() => { const r = document.getElementById('bRelief'); r.value = 0.2; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); }); await page.waitForTimeout(100); await idle();
  const rel = await page.evaluate(() => { const THREE = APP.THREE, A = APP.A, d = APP.dirOf('lower', APP.P.ap, APP.P.lat), t = APP.scans.demoTruth.lower.teeth.find((x) => x.fdi === 46).tip, g = APP.N.toGeometry(APP.B.mesh), ray = new THREE.Ray(new THREE.Vector3(...t).addScaledVector(d, 10), d.clone().negate()), h = g.boundsTree.raycastFirst(ray, THREE.DoubleSide);
    const g0 = APP.N.toGeometry(A.mesh), h0 = g0.boundsTree.raycastFirst(ray, THREE.DoubleSide); return { info: APP.B.info, vol: APP.N.meshVolume(APP.B.mesh), lift: h0.distance - h.distance }; });
  ok(rel.info.watertight && rel.info.relief === 0.2 && rel.vol > vol0 && Math.abs(rel.lift - 0.2) < 0.03, `relief 0.2 mm: closed, ${((rel.vol - vol0) / 1000).toFixed(2)} mL added, ${rel.lift.toFixed(3)} mm over the 46 cusp tip`);
  // STL in both positions
  const dl = async (pos) => { await page.click(`#bPos [data-v=${pos}]`); const [d] = await Promise.all([page.waitForEvent('download'), page.click('#bStl')]); const f = OUT + `t2-blockout-${pos}.stl`; await d.saveAs(f); return { name: d.suggestedFilename(), buf: fs.readFileSync(f) }; };
  const stlInfo = (buf) => { const n = buf.readUInt32LE(80), mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; let z0 = 0; for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) { const o = 84 + t * 50 + 12 + k * 12; for (let a = 0; a < 3; a++) { const v = buf.readFloatLE(o + 4 * a); mn[a] = Math.min(mn[a], v); mx[a] = Math.max(mx[a], v); } if (Math.abs(buf.readFloatLE(o + 8)) < 1e-4) z0++; } return { n, mn, mx, z0, ok: buf.length === 84 + 50 * n }; };
  const sA = await dl('scan'), iA = stlInfo(sA.buf), rawB = await page.evaluate(() => { const b = APP.N.meshBounds(APP.scans.lower.raw); return [b.min, b.max]; });
  ok(iA.ok && /blockout-lower\.stl/.test(sA.name) && iA.mn.every((v, a) => v <= rawB[0][a] + 0.2) && iA.mx.every((v, a) => v >= rawB[1][a] - 0.2), `“As scanned” STL (${sA.name}, ${iA.n.toLocaleString('en-GB')} triangles) sits where the scan does: it encloses the scan's own box`);
  const sB = await dl('path'), iB = stlInfo(sB.buf);
  ok(iB.ok && Math.abs(iB.mn[2]) < 1e-4 && iB.z0 > 100 && Math.abs(iB.mn[0] + iB.mx[0]) < 0.01, `“Base square to the path” STL: flat base on Z = 0 (${iB.z0} base corners there), centred, ${(iB.mx[2]).toFixed(1)} mm tall`);
  // case round trip
  const before = await page.evaluate(() => ({ text: APP.summaryText(), tris: APP.B.info.tris, sig: APP.B.sig }));
  const blob = await page.evaluate(async () => Array.from(new Uint8Array(await (await APP.scans.toCase().toBlob('t')).arrayBuffer())));
  await page.evaluate(async (a) => { await APP.scans.useCase(await APP.N.DentalCase.fromBlob(new Blob([new Uint8Array(a)]))); }, blob); await idle();
  const after = await page.evaluate(() => ({ text: APP.summaryText(), tris: APP.B.info && APP.B.info.tris, built: APP.B.sig === APP.blockSig(), ap: APP.P.ap, relief: APP.P.relief, keep: APP.P.teeth.map((t) => t.keep + t.side).join() }));
  ok(after.text === before.text && after.built && after.tris === before.tris && after.ap === 7 && after.relief === 0.2 && after.keep === '0buccal,0.5lingual,0buccal', 'case file round trip: the path, relief, abutments, clasp tip and the blocked-out model come back as they were (no rebuild)');
  // the upper arch
  await page.evaluate(() => APP.shell.goto('path')); await page.click('#pJaw [data-v=upper]'); await idle();
  ok(await page.evaluate(() => APP.P.jaw === 'upper' && APP.A.jaw === 'upper' && APP.P.teeth.length === 0), 'switching to the upper arch surveys it (abutments are per arch, so the list starts empty)');
  await lookAlong(await page.evaluate(() => APP.dirOf('upper', 4, 3).toArray()), [0, 0, 0]); await page.click('#pView'); await idle();
  ok(await page.evaluate(() => APP.P.ap === 4 && APP.P.lat === 3), '“Use this view” from below the upper teeth: front up 4°, left up 3°, as looked');
  await page.evaluate(() => APP.shell.goto('survey')); await idle(); await page.evaluate(() => APP.viewer.setView('bottom')); await page.waitForTimeout(250); await shot(OUT + 't2-upper-survey.png');
  ok(errors.length === 0, 'no page errors ' + errors.slice(0, 3).join(' | '));
  await close();
  // ── a phone
  const ph = await openApp('survey-card', { width: 390, height: 844, touch: true, dpr: 3 });
  await ph.page.waitForFunction(() => window.APP); await ph.page.click('[data-ss=demo]'); await ph.page.waitForTimeout(300); await ph.page.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 });
  for (const id of ['path', 'survey', 'teeth', 'block']) {
    await ph.page.evaluate((id) => APP.shell.goto(id), id); await ph.page.waitForTimeout(200); await ph.page.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 });
    if (id === 'teeth') await ph.page.evaluate(() => APP.addTooth(APP.scans.demoTruth.lower.teeth.find((t) => t.fdi === 36).tip));
    const o = await ph.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, side: document.getElementById('steps').scrollWidth <= document.getElementById('steps').clientWidth + 1 })); ok(o.sw <= o.cw + 1 && o.side, `phone, ${id} step: nothing spills sideways (${o.sw} in ${o.cw})`);
    await ph.page.waitForTimeout(200); await ph.shot(OUT + `t2-phone-${id}.png`);
  }
  ok(ph.errors.length === 0, 'phone: no page errors ' + ph.errors.slice(0, 3).join(' | '));
  await ph.close(); console.log(bad ? bad + ' FAILED' : 'all passed');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
