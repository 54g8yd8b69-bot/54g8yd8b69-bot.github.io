// t9-canal: the Root canals step through the page, on the demo CBCT. Before a tooth is picked the step says so. Molar 36 is
// picked with a tap well off to one side of its crown (the region is re-centred on the crown, so the whole tooth is found);
// on the Root canals step its chamber and two canals are found (volume, length and number against the phantom's true pulp),
// tinted red in the three slices where the true pulp is and nowhere else; in 3D the tooth is glass and the canals a bright
// solid (counted in the rendered picture), and "Hidden" leaves the canals alone; a higher threshold takes more and "Find the
// canals" goes back to the worked-out one; the STL is closed and lies on the true pulp surface; "Slices along the tooth"
// turns the slices to the tooth's axis (and the tint is still right on the turned slices); the threshold is kept in a saved
// case; changing the tooth drops its canals. Then premolar 45 (one canal).
const { open, ok, OUT, screenOf } = require('./lib.cjs');
const fs = require('fs');
let N, D;
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
function vols(t, h = 0.06) { const f = D.phantomToothField(t), g = D.phantomPulpField(t), R = Math.max(t.md, t.bl) / 2 + 3, lo = [t.base[0] - R, t.base[1] - R, t.base[2] - t.root - 2], hi = [t.base[0] + R, t.base[1] + R, t.base[2] + t.crown + 2]; let n = 0, m = 0, c0 = Infinity, c1 = -Infinity; for (let z = lo[2]; z < hi[2]; z += h) for (let y = lo[1]; y < hi[1]; y += h) for (let x = lo[0]; x < hi[0]; x += h) { if (f(x, y, z) < 0) n++; if (g(x, y, z) < 0) { m++; const c = (x - t.base[0]) * t.w[0] + (y - t.base[1]) * t.w[1] + (z - t.base[2]) * t.w[2]; if (c < c0) c0 = c; if (c > c1) c1 = c; } } return { tooth: n * h * h * h, pulp: m * h * h * h, length: c1 - c0 }; }
function readStl(file) { const b = fs.readFileSync(file); return N.cleanMesh(N.parseMesh(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), 'stl'), { keepIslands: true }).mesh; }
(async () => {
  N = await import('/home/claude/suite/shared/core.js'); D = await import('/home/claude/suite/shared/dicom.js');
  const teeth = Object.fromEntries(D.phantomTeeth().map((t) => [t.name, t]));
  const a = await open(), { page } = a; await a.demo();
  const canal = () => page.evaluate(() => { const c = APP.S.canal.seg; return c ? { err: c.error || null, volume: c.volume, length: c.length, pieces: c.pieces, canals: c.canals, T: c.T, auto: c.auto, pulp: c.pulp, dentine: c.dentine, apexGap: c.apexGap, tris: APP.S.canal.mesh ? APP.S.canal.mesh.indices.length / 3 : 0, lead: document.querySelector('#cLead').textContent, out: document.querySelector('#cOut').innerText, levels: c.levels } : null; });
  const waitCanal = async () => { await a.idle(); await page.waitForFunction(() => APP.S.canal.seg && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 }); await page.waitForTimeout(500); };
  // ── before a tooth is picked ──
  await page.click('.step[data-id=canal] h3'); await a.idle();
  const e0 = await page.evaluate(() => ({ lead: document.querySelector('#cLead').textContent, find: document.querySelector('#cFind').disabled, stl: document.querySelector('#cStl').disabled, al: document.querySelector('#cAlign').disabled, seg: APP.S.canal.seg }));
  ok(/Pick the tooth first/.test(e0.lead) && e0.find && e0.stl && e0.al && !e0.seg, `with no tooth picked the Root canals step says “${e0.lead}” and its buttons are off`);

  // ── molar 36, tapped 3 mm off to one side ──
  await page.click('.step[data-id=tooth] h3'); await a.idle();
  const pick = async (fdi, off) => {
    const t = teeth[fdi], p = [0, 1, 2].map((k) => t.base[k] + t.w[k] * t.crown * 0.5 + t.u[k] * off[0] + t.v[k] * off[1]);
    await page.evaluate((z) => { APP.S.cur[2] = Math.round(APP.D.voxelOf(APP.S.vol, 0, 0, z)[2]); APP.crossChanged(); }, p[2]); await page.waitForTimeout(250);
    const [x, y] = await screenOf(page, 'ax', p); await page.mouse.click(x, y); await a.idle(); await page.waitForFunction(() => APP.S.tooth.seg && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 }); await page.waitForTimeout(500);
    return page.evaluate(() => { const s = APP.S.tooth.seg; return s.error ? { error: s.error } : { volume: s.volume, axis: s.axis, roi: APP.S.tooth.roi, centre: s.centre }; });
  };
  const t36 = teeth[36], tv = vols(t36); let s = await pick(36, [3, 0]);
  ok(!s.error && Math.abs(s.volume / tv.tooth - 1) < 0.04 && Math.hypot(s.roi.c[0] - t36.base[0], s.roi.c[1] - t36.base[1]) < 1.5, `36 tapped 3 mm to one side of its crown: the whole tooth is found (${s.error || s.volume.toFixed(0)} mm³; true ${tv.tooth.toFixed(0)} mm³), the region re-centred on the crown (${s.error ? '' : Math.hypot(s.roi.c[0] - t36.base[0], s.roi.c[1] - t36.base[1]).toFixed(2)} mm from its axis)`);

  // ── its canals ──
  await page.click('.step[data-id=canal] h3'); await waitCanal();
  let c = await canal();
  const rootLv = c.levels.filter((L) => L.t > c.apexGap + 1.5 && L.t < t36.root - 2.5);
  ok(!c.err && Math.abs(c.volume / tv.pulp - 1) < 0.15 && Math.abs(c.length - tv.length) < 1 && c.T === c.auto && c.T > c.pulp && c.T < c.dentine, `canals found on opening the step: ${c.volume.toFixed(1)} mm³ (true ${tv.pulp.toFixed(1)}), ${c.length.toFixed(1)} mm long (true ${tv.length.toFixed(1)}), threshold ${c.T} between this tooth’s pulp ${c.pulp} and dentine ${c.dentine}`);
  ok(rootLv.length > 10 && rootLv.every((L) => L.count === 2) && c.pieces === 3 && /3 pieces/.test(c.out) && /36\.\d mm³|3\d\.\d mm³/.test(c.out), `two canals side by side at each of ${rootLv.length} levels down the roots; the phantom’s chamber and canals do not join, so ${c.pieces} pieces (“${c.out.split('\n').slice(0, 4).join(' ')}…”)`);
  // the red tint against the true pulp, slice by slice through the chamber
  const tintCheck = (fdi, label) => page.evaluate(([fdi, label]) => {
    const t = APP.D.phantomTeeth().find((x) => String(x.name) === String(fdi)), f = APP.D.phantomPulpField(t), out = {};
    for (const k of ['ax', 'co', 'sa']) {
      const v = APP.views[k], g = APP.geom(v), d = v.off.getContext('2d').getImageData(0, 0, g.cols, g.rows).data; let red = 0, redOk = 0, pulp = 0, pulpRed = 0, teal = 0;
      for (let r = 0; r < g.rows; r++) for (let cc = 0; cc < g.cols; cc++) {
        const i = 4 * (r * g.cols + cc), isRed = d[i] > 150 && d[i] > d[i + 1] + 60 && d[i] > d[i + 2] + 60; if (d[i + 1] > d[i] + 25 && d[i + 1] > 100) teal++;
        const P = g.ob ? APP.obPt(g.ob, (cc + 0.5) * g.su, (r + 0.5) * g.sv) : APP.D.worldOf(APP.S.vol, ...APP.toVox(v, (cc + 0.5) * g.su, (r + 0.5) * g.sv).map((x, ax) => (!g.ob && ax === (k === 'ax' ? 2 : k === 'co' ? 1 : 0) ? Math.round(x) : x))), val = f(...P);
        if (isRed) { red++; if (val < 0.3) redOk++; } if (val < -0.15) { pulp++; if (isRed) pulpRed++; }
      }
      out[k] = { red, redOk, pulp, pulpRed, teal, ob: !!g.ob };
    }
    return out;
  }, [fdi, label]);
  const toChamber = (t) => page.evaluate((p) => { APP.S.cur = APP.D.voxelOf(APP.S.vol, ...p).map(Math.round); APP.crossChanged(); }, [0, 1, 2].map((k) => t.base[k] + t.w[k] * 3.2));
  await toChamber(t36); await page.waitForTimeout(500);
  let tc = await tintCheck(36);
  for (const k of ['ax', 'co', 'sa']) ok(tc[k].red > 40 && tc[k].redOk / tc[k].red > 0.95 && tc[k].pulpRed / tc[k].pulp > 0.9 && tc[k].teal === 0, `${k}: the canals are red in the slice where the true pulp is (${tc[k].red} px red, ${tc[k].redOk} of them in or at the edge of the true pulp; ${tc[k].pulpRed} of ${tc[k].pulp} px well inside the pulp are red); the tooth’s own tint is off`);
  await page.screenshot({ path: OUT + 't9-canals-36.png' });
  // 3D: a glass tooth, the canals a bright solid
  const three = () => page.evaluate(() => ({ canal: !!(APP.r3objs.canal && APP.r3objs.canal.visible), tooth: !!(APP.r3objs.tooth && APP.r3objs.tooth.visible), glass: APP.r3objs.tooth.material.type === 'ShaderMaterial' && APP.r3objs.tooth.material.transparent && !APP.r3objs.tooth.material.depthWrite, vol: APP.box3.visible, planes: APP.r3objs.planes.length, emissive: APP.r3objs.canal.material.emissive.getHex() }));
  const picture = async () => { const box = await page.evaluate(() => { const r = document.querySelector('.vp.r3').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }), png = (await page.screenshot({ clip: box })).toString('base64');
    return page.evaluate(async (b64) => { const img = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], { type: 'image/png' })), cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const x = cv.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, cv.width, cv.height).data; let red = 0, glass = 0, dark = 0; for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; if (r > 200 && g > 50 && g < 200 && b < 110 && r > g + 40) red++; else if (r + g + b > 330 && b - r < 25) glass++; else if (b > r + 25) dark++; } return { red, glass, dark, n: d.length / 4 }; }, png); };   // (red: the canals' orange; glass: pale and not blue; dark: the blue ground)
  await page.waitForTimeout(600); const g1 = await three(), p1 = await picture();
  ok(g1.canal && g1.tooth && g1.glass && !g1.vol && g1.planes === 0 && p1.red > 400 && p1.glass > 1500 && p1.dark / p1.n > 0.5, `3D: the tooth is pale glass and the canals a bright orange solid on a blue ground (${p1.red} px of canal, ${p1.glass} px of pale glass, ${(100 * p1.dark / p1.n).toFixed(0)}% blue ground); the scan’s own 3D picture and the slice outlines are off`);
  await page.click('#cShow [data-v=hide]'); await page.waitForTimeout(500); const g2 = await three(), p2 = await picture();
  ok(g2.canal && !g2.tooth && p2.red >= p1.red && p2.glass < 0.3 * p1.glass, `“Hidden”: the canals on their own (${p2.red} px of canal; pale px ${p1.glass} → ${p2.glass}, the buttons and label that are left)`);
  await page.click('#cShow [data-v=glass]'); await page.waitForTimeout(300);

  // ── the threshold ──
  const setT = async (T) => { await page.evaluate((T) => { const el = document.querySelector('#cT'); el.value = String(T); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, T); await page.waitForTimeout(200); await waitCanal(); };
  await setT(c.auto + 350); const hi = await canal();
  ok(!hi.err && hi.T === c.auto + 350 && hi.volume > c.volume * 1.15 && !/worked out/.test(hi.out), `threshold raised to ${hi.T}: ${hi.volume.toFixed(1)} mm³ (was ${c.volume.toFixed(1)})`);
  const saved = await page.evaluate(() => { const cc = new APP.N.DentalCase(); APP.extendCase(cc); window.__c = cc; return cc.data.cbct.canal; });
  await page.click('#cFind'); await page.waitForTimeout(200); await waitCanal(); const back = await canal();
  ok(back.T === c.auto && Math.abs(back.volume - c.volume) < 1e-6 && /worked out/.test(back.out), `“Find the canals” goes back to the worked-out threshold ${back.T}`);

  // ── the STL ──
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#cStl')]); const file = OUT + 't9-' + dl.suggestedFilename(); await dl.saveAs(file);
  const mesh = readStl(file), pf = D.phantomPulpField(t36), dist = []; for (let i = 0; i < mesh.positions.length; i += 3) dist.push(Math.abs(pf(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]))); dist.sort((x, y) => x - y);
  ok(dl.suggestedFilename() === 'root-canals.stl' && N.isWatertight(mesh) && Math.abs(N.meshVolume(mesh) / tv.pulp - 1) < 0.15 && q(dist, 0.95) < 0.2, `${dl.suggestedFilename()}: closed, ${N.meshVolume(mesh).toFixed(1)} mm³ (true ${tv.pulp.toFixed(1)}), its surface ${q(dist, 0.5).toFixed(3)} mm (median) and ${q(dist, 0.95).toFixed(3)} mm (95th percentile) from the true pulp surface, in the scan’s coordinates`);

  // ── slices along the tooth ──
  await page.click('#cAlign'); await page.waitForTimeout(700);
  const al = await page.evaluate(() => ({ fr: APP.S.fr, axis: APP.S.tooth.seg.axis, lab: ['ax', 'co', 'sa'].map((k) => APP.views[k].lab.textContent), w: APP.D.worldOf(APP.S.vol, ...APP.S.cur), lo: APP.S.canal.seg.lo, hi: APP.S.canal.seg.hi, z: ['ax', 'co', 'sa'].map((k) => APP.views[k].z) }));
  const dot = (u, w) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2], trueAx = Math.acos(Math.abs(dot(al.axis, t36.w))) * 180 / Math.PI;
  ok(Math.abs(dot(al.fr.ax.n, al.axis) - 1) < 1e-9 && Math.abs(dot(al.fr.co.v, al.axis) + 1) < 1e-9 && Math.abs(dot(al.fr.sa.v, al.axis) + 1) < 1e-9 && Math.abs(dot(al.fr.co.n, al.fr.sa.n)) < 1e-9 && al.lab.every((l) => /oblique/.test(l)) && al.w.every((x, i) => x > al.lo[i] - 0.5 && x < al.hi[i] + 0.5) && trueAx < 6,
    `“Slices along the tooth”: the axial slice is square to the tooth’s long axis (${trueAx.toFixed(1)}° from the phantom’s true axis) and the other two run along it (“${al.lab.join('” · “')}”), cross-hair in the canals, zoomed to ${al.z.map((z) => z.toFixed(1)).join(', ')} px/mm`);
  await toChamber(t36); await page.waitForTimeout(500); tc = await tintCheck(36);
  for (const k of ['ax', 'co', 'sa']) ok(tc[k].ob && tc[k].red > 40 && tc[k].redOk / tc[k].red > 0.95 && tc[k].pulpRed / tc[k].pulp > 0.9, `${k}, turned along the tooth: red where the true pulp is (${tc[k].red} px red, ${tc[k].redOk} right; ${tc[k].pulpRed} of ${tc[k].pulp} pulp px red)`);
  await page.screenshot({ path: OUT + 't9-canals-36-along.png' });
  await page.click('[data-max=r3]'); await page.waitForTimeout(700); await page.screenshot({ path: OUT + 't9-canals-36-3d.png' }); await page.click('[data-max=r3]'); await page.waitForTimeout(300);
  await page.click('#cbStraight'); await page.waitForTimeout(300);

  // ── the threshold comes back with a saved case; a changed tooth drops its canals ──
  await page.click('.step[data-id=tooth] h3'); await a.idle(); await page.click('#dClear'); await page.waitForTimeout(300);
  const dropped = await page.evaluate(() => ({ seg: APP.S.canal.seg, mesh: APP.S.canal.mesh, obj: APP.r3objs.canal, T: APP.S.canal.T }));
  ok(!dropped.seg && !dropped.mesh && !dropped.obj && dropped.T == null, '“Start again” on the tooth drops its canals');
  await page.evaluate(() => APP.readCase(window.__c)); await page.waitForFunction(() => APP.S.tooth.seg && !APP.S.tooth.seg.error, null, { timeout: 120000 }); await a.idle(); await page.waitForTimeout(500);
  await page.click('.step[data-id=canal] h3'); await waitCanal(); const re = await canal();
  ok(saved && saved.T === c.auto + 350 && re.T === saved.T && Math.abs(re.volume - hi.volume) < 0.01, `the case keeps the raised threshold (${saved && saved.T}); read back, the tooth and its canals return as they were (${re.volume.toFixed(1)} mm³)`);

  // ── a premolar: one canal ──
  await page.click('.step[data-id=tooth] h3'); await a.idle(); await page.click('#cbTool [data-v=tooth]');
  const t45 = teeth[45], v45 = vols(t45); s = await pick(45, [0, 1.5]);
  await page.click('.step[data-id=canal] h3'); await waitCanal(); c = await canal();
  ok(!s.error && !c.err && Math.abs(s.volume / v45.tooth - 1) < 0.04 && Math.abs(c.volume / v45.pulp - 1) < 0.15 && c.canals === 1 && c.pieces === 1 && Math.abs(c.length - v45.length) < 1 && /one piece/.test(c.out), `45: one canal in one piece, ${c.volume.toFixed(1)} mm³ (true ${v45.pulp.toFixed(1)}), ${c.length.toFixed(1)} mm long (true ${v45.length.toFixed(1)})`);
  const errs = a.errors.filter((e) => !/font/.test(e)); ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | '));
  await a.close();
})().catch((e) => { console.error(e); process.exit(1); });
