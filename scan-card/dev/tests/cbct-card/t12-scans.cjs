// t12-scans: the “Intraoral scans” step — a surface scan of the teeth lined up with the CBCT and switched on and off.
// On the demo CBCT with the demo scan (the phantom's lower teeth and gum, handed over in "scanner" coordinates of its own, so
// where it belongs is known): it is lined up by itself; its outline is drawn in the three slices and in the cross-sections
// and the scan itself in 3D; the switch in the bar above the slices takes it away and brings it back on every step; the fine
// fit; matching points marked by real taps on the scan (3D) and in the slices; the lined-up STL; a scan opened from a file
// with a patient's name in its name — taken for the wrong arch, it finds the right one — and that name nowhere in the page
// or the case; the case brings the scan back where it was put once the same file is opened on the same CBCT; a new CBCT
// leaves the scans loaded but no longer lined up. Nothing here comes from a patient.
const { open, ok, OUT, screenOf } = require('./lib.cjs');
const fs = require('fs');
(async () => {
  const a = await open(), { page, errors } = a;
  const settle = (ms = 400) => page.waitForTimeout(ms), done = async () => { await page.waitForFunction(() => !APP.S.busy && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 }); await a.idle(); await settle(250); };
  /** where the scan stands against where it belongs: the page's matrix · the scanner's pose should be "no motion" */
  const offBy = (jaw = 'lower') => page.evaluate((jaw) => { const sc = APP.S.io[jaw]; if (!sc || !sc.matrix) return null; const T = new APP.THREE.Matrix4().makeRotationFromEuler(new APP.THREE.Euler(0.9, -0.5, 2.1)).setPosition(18, -31, 44), E = sc.matrix.clone().multiply(T).elements; let mx = 0; for (const p of [[30, 10, 5], [-30, 10, 5], [0, -35, 8], [0, 0, -4]]) mx = Math.max(mx, Math.hypot(E[0] * p[0] + E[4] * p[1] + E[8] * p[2] + E[12] - p[0], E[1] * p[0] + E[5] * p[1] + E[9] * p[2] + E[13] - p[1], E[2] * p[0] + E[6] * p[1] + E[10] * p[2] + E[14] - p[2])); return mx; }, jaw);
  /** pixels of a view's picture in a scan's own colour (lower: green, upper: orange) */
  const inColour = (view, jaw = 'lower') => page.evaluate(([view, jaw]) => { const v = APP.views[view]; if (!v || v.cell.offsetParent === null) return -1; const d = v.ctx.getImageData(0, 0, v.cv.width, v.cv.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; if (jaw === 'lower' ? (g > 170 && r < 150 && b < 175 && g - b > 45 && g - r > 60) : (r > 215 && g > 120 && g < 200 && b < 150 && r - b > 90)) n++; } return n; }, [view, jaw]);
  const st = () => page.evaluate(() => { const io = APP.S.io, q = (id) => document.getElementById(id); return { jaw: io.jaw, upper: io.upper && { ok: io.upper.ok, how: io.upper.how, lined: !!io.upper.matrix, show: io.upper.show, vis: io.upper.obj.visible, src: io.upper.src }, lower: io.lower && { ok: io.lower.ok, how: io.lower.how, lined: !!io.lower.matrix, show: io.lower.show, vis: io.lower.obj.visible, src: io.lower.src, med: io.lower.fit && io.lower.fit.median, tris: io.lower.mesh.indices.length / 3 }, bar: [...q('cbScans').querySelectorAll('button')].map((b) => `${b.dataset.j}:${b.classList.contains('on') ? 'on' : 'off'}:${b.getAttribute('aria-pressed')}`).join(), barHidden: q('cbScans').hidden, status: q('status').textContent, out: q('sOut').innerText, lead: q('sLead').textContent, demoBtn: !q('sDemo').hidden, dis: ['sOpen', 'sAuto', 'sPts', 'sFine', 'sStl', 'sRemove'].filter((id) => q(id).disabled).join(), seg: (q('sShow').querySelector('.on') || {}).dataset?.v, box: APP.box3 ? APP.box3.visible : null, tools: [...q('cbTool').querySelectorAll('button')].map((b) => b.textContent).join(), tool: APP.S.tool, done: APP.shell.stepEl('scans').classList.contains('done') }; });

  // ── before a CBCT is open
  const order = await page.evaluate(() => APP.shell.steps.map((s) => s.id).join());
  ok(order === 'load,view,d3,pano,scans,tooth,replica,canal', `“Intraoral scans” is a step of its own, after the panoramic (${order})`);
  await page.evaluate(() => APP.shell.goto('scans')); await settle(); let s = await st();
  ok(/Open the CBCT first/.test(s.lead) && s.dis === 'sOpen,sAuto,sPts,sFine,sStl,sRemove' && s.barHidden && !s.demoBtn, 'with no CBCT open the step says to open it first, and nothing can be pressed');

  // ── the demo scan, lined up by itself
  await page.evaluate(() => APP.shell.goto('load')); await a.demo(); await page.evaluate(() => APP.shell.goto('scans')); await a.idle(); s = await st();
  ok(s.demoBtn && s.dis === 'sAuto,sPts,sFine,sStl,sRemove' && /Open the scan of the upper or the lower teeth/.test(s.lead), 'with the demo CBCT open a scan can be opened, and the demo scan is offered');
  const none = { ax: await inColour('ax'), co: await inColour('co'), sa: await inColour('sa') };
  let t0 = Date.now(); await page.click('#sDemo'); await page.waitForFunction(() => APP.S.io.lower && APP.S.io.lower.matrix, null, { timeout: 180000 }); await done(); const secs = (Date.now() - t0) / 1000;
  s = await st(); let off = await offBy();
  const cut = await page.evaluate(() => ['ax', 'co', 'sa'].map((k) => (APP.views[k].cut && APP.views[k].cut.lower ? APP.views[k].cut.lower.seg.length / 6 : 0)));
  ok(cut.every((n) => n > 100), `the cross-hair has gone to the middle of the scan: all three slices cut it (${cut.join(', ')} short lines of outline)`);
  ok(s.lower && s.lower.ok && s.lower.how === 'auto' && s.jaw === 'lower' && !s.upper && off < 0.15, `the demo scan (${s.lower.tris.toLocaleString('en-GB')} triangles, in a scanner’s coordinates) is lined up by itself in ${secs.toFixed(1)} s: within ${off.toFixed(3)} mm of where it belongs`);
  ok(/Lower scan lined up/.test(s.status) && /lined up/.test(s.out) && /by itself/.test(s.out) && /Half of the crown points within\s*0\.0\d mm/.test(s.out) && s.done, `the step says so: “${s.status}”`);
  ok(s.bar === 'lower:on:true' && !s.barHidden && s.seg === 'show' && s.lower.vis && s.dis === '', 'a switch for the lower scan appears in the bar above the slices; the scan shows in 3D');
  // the cross-hair onto a premolar's crown, so each slice cuts teeth
  await page.evaluate(() => { const t = APP.S.demo.teeth.find((x) => x.name === '45') || APP.S.demo.teeth[4]; APP.S.cur = APP.D.voxelOf(APP.S.vol, t.base[0] + t.w[0] * t.crown * 0.6, t.base[1] + t.w[1] * t.crown * 0.6, t.base[2] + t.w[2] * t.crown * 0.6).map(Math.round); APP.crossChanged(); }); await settle();
  const on = { ax: await inColour('ax'), co: await inColour('co'), sa: await inColour('sa') };
  ok(none.ax === 0 && none.co === 0 && none.sa === 0 && on.ax > 300 && on.co > 150 && on.sa > 150, `its outline is drawn in green in all three slices (${on.ax}, ${on.co} and ${on.sa} pixels; none before)`);
  // the outline lies on the edge of the crown: just inside it the CBCT is enamel, just outside it air or soft tissue
  const edge = await page.evaluate(() => { const v = APP.views.ax, sc = APP.S.io.lower, V = APP.S.vol, z = V.origin[2] + Math.round(APP.S.cur[2]) * V.spacing[2], seg = APP.D.meshCut(sc.mesh, sc.matrix.elements, [0, 0, z], [0, 0, 1]), val = (x, y) => { const q = APP.D.voxelOf(V, x, y, z).map(Math.round); return V.data[q[0] + V.dims[0] * (q[1] + V.dims[1] * q[2])] + (V.shift || 0); };
    const teeth = APP.S.demo.teeth; let n = 0, good = 0; for (let i = 0; i < seg.length; i += 6) { const mx = (seg[i] + seg[i + 3]) / 2, my = (seg[i + 1] + seg[i + 4]) / 2; let best = null, bd = 1e9; for (const t of teeth) { const d = Math.hypot(mx - t.base[0], my - t.base[1]); if (d < bd) { bd = d; best = t; } } if (bd > 6) continue; const ux = (best.base[0] - mx) / bd, uy = (best.base[1] - my) / bd, inside = val(mx + 0.7 * ux, my + 0.7 * uy), outside = val(mx - 0.7 * ux, my - 0.7 * uy); n++; if (inside > outside + 400) good++; } return { n, good, segs: seg.length / 6 }; });
  ok(edge.n > 300 && edge.good / edge.n > 0.9, `round the crowns the outline lies on the CBCT’s own edge: at ${edge.good} of ${edge.n} places it has tooth 0.7 mm inside it and none 0.7 mm outside`);
  await page.screenshot({ path: OUT + 't12-scans-lined-up.png' });

  // ── on and off, from the bar and from the step, on every step
  await page.click('#cbScans [data-j=lower]'); await settle(); s = await st(); const offPx = { ax: await inColour('ax'), co: await inColour('co'), sa: await inColour('sa') };
  ok(s.bar === 'lower:off:false' && !s.lower.show && !s.lower.vis && s.seg === 'hide' && offPx.ax === 0 && offPx.co === 0 && offPx.sa === 0 && /hidden/.test(s.out) && s.lower.lined, 'the switch takes the scan out of the slices and the 3D view (it stays lined up); the step shows “Hidden”');
  await page.click('#sShow [data-v=show]'); await settle(); s = await st();
  ok(s.bar === 'lower:on:true' && s.lower.vis && (await inColour('ax')) > 300, '“Shown” on the step brings it back, and the switch follows');
  await page.evaluate(() => APP.shell.goto('view')); await a.idle(); await settle(); s = await st();
  ok(!s.barHidden && s.lower.vis && (await inColour('ax')) > 300, 'on the Slices step the outline and the switch are there too');
  await page.click('#cbScans [data-j=lower]'); await settle(); ok((await inColour('ax')) === 0 && !(await st()).lower.vis, '… and the switch works from there'); await page.click('#cbScans [data-j=lower]'); await settle();
  await page.evaluate(() => APP.shell.goto('pano')); await a.idle(); await page.click('#pPropose'); await page.waitForFunction(() => APP.S.pano && APP.S.xs.length, null, { timeout: 60000 }); await a.idle(); await settle(600);
  const xs = await page.evaluate(() => Object.keys(APP.views).filter((k) => APP.views[k].kind === 'xs' && APP.views[k].cell.offsetParent !== null)), xsPx = []; for (const k of xs) xsPx.push(await inColour(k));
  ok(xs.length >= 3 && xsPx.every((n) => n > 40), `in the cross-sections along the arch the scan’s outline is drawn as well (${xsPx.join(', ')} pixels)`);
  await page.screenshot({ path: OUT + 't12-scans-cross-sections.png' });
  await page.evaluate(() => APP.shell.goto('tooth')); await a.idle(); await settle(); s = await st();
  ok(!s.lower.vis && s.lower.show && (await inColour('ax')) > 300, 'on “Pick a tooth” the 3D view is left to the tooth; the outline stays in the slices');

  // ── the fine fit
  await page.evaluate(() => APP.shell.goto('scans')); await a.idle();
  await page.evaluate(() => { const sc = APP.S.io.lower; sc.matrix = new APP.THREE.Matrix4().makeTranslation(0.7, -0.5, 0.6).multiply(sc.matrix); sc.ver++; APP.invalidate(); }); const out0 = await offBy();
  await page.click('#sFine'); await done(); s = await st(); off = await offBy();
  ok(out0 > 0.9 && off < 0.15 && s.lower.how === 'auto+fine' && /by itself, then fine fit/.test(s.out), `nudged ${out0.toFixed(1)} mm out, “Fine fit” settles the scan back within ${off.toFixed(3)} mm`);

  // ── matching points, by taps on the scan (3D) and in the slices
  await page.click('#sPts'); await settle(900); s = await st();
  ok(s.tool === 'match' && /Match point/.test(s.tools) && s.box === false && s.lower.vis && /0 of 3 or more/.test(await page.evaluate(() => document.getElementById('sPairs').innerText)) && s.dis.includes('sAuto') && (await inColour('ax')) === 0, '“By matching points”: the scan stands alone in the 3D view, “Match point” is the tool in the bar, and the scan’s outline is out of the slices meanwhile');
  const goDis = () => page.evaluate(() => document.querySelector('#sPairs [data-p=go]').disabled);
  // four cusp tips round the arch: on the scan they are tapped in 3D; in the CBCT, in the axial slice through each
  const tips = await page.evaluate(() => APP.S.demo.teeth.filter((t, i, all) => [1, 4, 9, 12].includes(i)).map((t) => [t.base[0] + t.w[0] * t.crown, t.base[1] + t.w[1] * t.crown, t.base[2] + t.w[2] * t.crown]));
  let pairsOk = 0;
  for (let i = 0; i < tips.length; i++) {
    const p3 = await page.evaluate((p) => { const pk = APP.S.io.pick, sc = APP.S.io.lower, w = new APP.THREE.Vector3(...p).applyMatrix4(sc.matrix.clone().invert()).applyMatrix4(pk.M), q = APP.viewer.toScreen(w), r = APP.viewer.container.getBoundingClientRect(); return [r.left + q.x, r.top + q.y]; }, tips[i]);
    await page.mouse.click(p3[0], p3[1]); await settle(200);
    await page.evaluate((p) => { APP.S.cur = APP.D.voxelOf(APP.S.vol, p[0], p[1], p[2] - 0.6).map(Math.round); APP.crossChanged(); }, tips[i]); await settle(200);
    const p2 = await screenOf(page, 'ax', [tips[i][0], tips[i][1], tips[i][2] - 0.6]); await page.mouse.click(p2[0], p2[1]); await settle(200);
    if (i === 1) ok(await goDis(), 'with two points marked “Line up on these” still waits');
  }
  const pk = await page.evaluate(() => { const pk = APP.S.io.pick, sc = APP.S.io.lower, T = sc.matrix; return { n: pk.pairs.length, full: pk.pairs.filter((x) => x.a && x.b).length, marks: pk.marks.length, err: pk.pairs.map((x) => (x.a && x.b ? new APP.THREE.Vector3(...x.a).applyMatrix4(T).distanceTo(new APP.THREE.Vector3(...x.b)) : 99)), text: document.getElementById('sPairs').innerText }; });
  ok(pk.n === 4 && pk.full === 4 && pk.marks === 4 && pk.err.every((e) => e < 1.6) && /4 of 3 or more/.test(pk.text) && !(await goDis()), `four cusp tips tapped on the scan and in the axial slice: four numbered pairs, each within ${Math.max(...pk.err).toFixed(1)} mm of matching`);
  await page.screenshot({ path: OUT + 't12-scans-points.png' });
  await page.click('#sPairs [data-p=undo]'); await settle(150); const un = await page.evaluate(() => { const pk = APP.S.io.pick; return { n: pk.pairs.length, full: pk.pairs.filter((x) => x.a && x.b).length }; });
  ok(un.n === 4 && un.full === 3, '“Undo point” takes back the last tap');
  // start the scan well out, so that it is the points that bring it home
  await page.evaluate(() => { const sc = APP.S.io.lower; sc.matrix = new APP.THREE.Matrix4().makeTranslation(9, -7, 6).multiply(new APP.THREE.Matrix4().makeRotationZ(0.3)).multiply(sc.matrix); sc.ver++; }); const far = await offBy();
  await page.click('#sPairs [data-p=go]'); await done(); s = await st(); off = await offBy();
  ok(far > 8 && off < 0.15 && s.lower.how === 'points' && s.lower.ok && /on matching points/.test(s.out) && !s.tools.includes('Match point') && s.tool === 'browse' && s.box === true && (await page.evaluate(() => !APP.S.io.pick && document.getElementById('sPairs').hidden)), `“Line up on these”, with the scan ${far.toFixed(0)} mm out: the three points bring it home and the fine fit settles it within ${off.toFixed(3)} mm; the views are as before`);
  await page.click('#sPts'); await settle(500); await page.click('#sPairs [data-p=cancel]'); await settle(300); s = await st();
  ok(s.tool === 'browse' && s.box === true && s.lower.how === 'points' && (await offBy()) === off, '“Cancel” leaves the scan as it was');

  // ── the lined-up STL
  let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#sStl')]); const stl = OUT + 't12-lower-on-cbct.stl'; await dl.saveAs(stl);
  const buf = fs.readFileSync(stl), nT = buf.readUInt32LE(80), head = buf.subarray(0, 80).toString('latin1').replace(/\0+$/, ''); let zmin = 1e9, zmax = -1e9, xmin = 1e9, xmax = -1e9; for (let t = 0; t < nT; t += 7) { const o = 84 + 50 * t + 12; const x = buf.readFloatLE(o), z = buf.readFloatLE(o + 8); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); }
  ok(dl.suggestedFilename() === 'lower-scan-on-cbct.stl' && nT === s.lower.tris && /lower scan lined up with the CBCT, LPS mm/.test(head) && Math.abs(zmin + 5) < 0.3 && Math.abs(zmax - 10) < 0.5 && Math.abs(xmin + 36) < 0.5 && Math.abs(xmax - 36) < 0.5, `“Download STL, lined up” gives ${dl.suggestedFilename()}: ${nT.toLocaleString('en-GB')} triangles in the CBCT’s coordinates (x ${xmin.toFixed(1)} … ${xmax.toFixed(1)}, z ${zmin.toFixed(1)} … ${zmax.toFixed(1)} mm)`);

  // ── a scan from a file with a patient's name in its name, opened as the wrong arch
  // (the file is the demo's scan again, written here in node — the same shapes in the same "scanner" pose)
  const NAME = 'Zebedee_Quillfeather_-_mandibular_IO_scan.stl', file = OUT + NAME;
  { const N = await import('/home/claude/suite/shared/core.js'), D = await import('/home/claude/suite/shared/dicom.js'), f = D.phantomScanField({}), g = N.isoMesh(f.F, f.n[0], f.n[1], f.n[2], f.origin, f.h, {});
    fs.writeFileSync(file, Buffer.from(N.stlBinary(N.transformMesh({ positions: g.positions, indices: g.indices }, new N.THREE.Matrix4().makeRotationFromEuler(new N.THREE.Euler(0.9, -0.5, 2.1)).setPosition(18, -31, 44)), null, 'scan'))); }
  const saved = await page.evaluate(() => { const c = new APP.N.DentalCase(); APP.extendCase(c); return c.data.cbct.scans; });
  ok(saved && saved.lower && saved.lower.matrix.length === 16 && saved.lower.how === 'points' && typeof saved.lower.key === 'string' && !saved.upper && Object.keys(saved.lower).sort().join() === 'how,key,matrix,show', `the case keeps where the scan was put — a fingerprint of the mesh and its motion (${Object.keys(saved.lower).sort().join(', ')}), not the scan`);
  await page.click('#sRemove'); await settle(); s = await st();
  ok(!s.lower && s.barHidden && (await inColour('ax')) === 0 && !s.done, '“Remove the scan” takes it out of the views and the bar');
  await page.click('#sJaw [data-v=upper]'); await settle(150);
  t0 = Date.now(); await page.setInputFiles('#sFile', file); await page.waitForFunction(() => APP.S.io.lower && APP.S.io.lower.matrix, null, { timeout: 180000 }); await done(); s = await st(); off = await offBy();
  ok(!s.upper && s.lower && s.lower.ok && s.lower.src === 'file' && s.jaw === 'lower' && off < 0.15 && /scan of the lower teeth: it was put under Lower/.test(s.status), `the file opened under “Upper” does not fit as an upper scan and does as a lower one: “${s.status}” (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  const leak = await page.evaluate((words) => { const c = new APP.N.DentalCase(); APP.extendCase(c); const hay = [document.documentElement.outerHTML, JSON.stringify(c.data), JSON.stringify(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]))].join('\n'); return words.filter((w) => hay.includes(w)); }, ['Zebedee', 'Quillfeather', 'mandibular_IO']);
  ok(leak.length === 0, 'the file’s name — a patient’s name in it — is nowhere in the page, the case or what the browser keeps');

  // ── the case brings it back: a fresh page, the same CBCT, the same file
  const blob = await page.evaluate(async () => { const c = new APP.N.DentalCase(); APP.extendCase(c); const b = await c.toBlob('CBCT Card', { compress: false }); return Array.from(new Uint8Array(await b.arrayBuffer())); });
  const M1 = await page.evaluate(() => APP.S.io.lower.matrix.toArray());
  ok(!blob.some((_, i) => i + 7 < blob.length && String.fromCharCode(...blob.slice(i, i + 7)) === 'Zebedee') && blob.length < 200000, `the case file is ${(blob.length / 1024).toFixed(0)} kB: the scan itself is not in it, nor the name`);
  const b = await open(), p2 = b.page; await b.demo();
  await p2.evaluate(async (bytes) => { APP.readCase(await APP.N.DentalCase.fromBlob(new Blob([new Uint8Array(bytes)]))); }, blob); await b.idle(); await p2.waitForTimeout(400);
  await p2.evaluate(() => APP.shell.goto('scans')); await p2.setInputFiles('#sFile', file); await p2.waitForFunction(() => APP.S.io.lower && APP.S.io.lower.matrix && !APP.S.busy, null, { timeout: 180000 }); await b.idle(); await p2.waitForTimeout(300);
  const back = await p2.evaluate(() => ({ M: APP.S.io.lower.matrix.toArray(), how: APP.S.io.lower.how, status: document.getElementById('status').textContent, ok: APP.S.io.lower.ok }));
  ok(back.M.every((v, i) => Math.abs(v - M1[i]) < 1e-9) && back.how === 'auto' && back.ok && /put back where it was lined up/.test(back.status), `a fresh page with the same CBCT and the saved case: the same file goes straight back where it was (“${back.status}”)`);
  // a new CBCT: the scan stays, where it was put does not
  await p2.evaluate(() => APP.shell.goto('load')); await p2.click('#lDemo'); await p2.waitForFunction(() => APP.S.loads === 2, null, { timeout: 120000 }); await b.idle(); await p2.evaluate(() => APP.shell.goto('scans')); await p2.waitForTimeout(300);
  const again = await p2.evaluate(() => ({ lined: !!APP.S.io.lower.matrix, loaded: !!APP.S.io.lower, bar: document.getElementById('cbScans').hidden, out: document.getElementById('sOut').innerText, vis: APP.S.io.lower.obj.visible }));
  ok(again.loaded && !again.lined && again.bar && /not lined up/.test(again.out) && !again.vis, 'when another CBCT is opened the scan stays loaded but is no longer lined up');
  // matching points on a scan that is not lined up yet: it stands in the 3D view as an arch, to be tapped
  await p2.click('#sPts'); await p2.waitForTimeout(900);
  const parked = await p2.evaluate(() => { const pk = APP.S.io.pick, sc = APP.S.io.lower, b = new APP.THREE.Box3().setFromObject(sc.obj, true), c = b.getCenter(new APP.THREE.Vector3()), q = APP.viewer.toScreen(c), r = APP.viewer.container.getBoundingClientRect(), vc = APP.D.worldOf(APP.S.vol, ...APP.S.vol.dims.map((n) => (n - 1) / 2)); return { on: !!pk, vis: sc.obj.visible, box: APP.box3.visible, size: b.getSize(new APP.THREE.Vector3()).toArray(), near: c.distanceTo(new APP.THREE.Vector3(...vc)), at: [r.left + q.x, r.top + q.y] }; });
  // a tap on the scan: on its right side, where the molars are
  const tapAt = await p2.evaluate(() => { const pk = APP.S.io.pick, sc = APP.S.io.lower, P = sc.mesh.positions, e = pk.M.elements; let best = null, bz = -1e9; for (let v = 0; v < P.length; v += 3) { const x = e[0] * P[v] + e[4] * P[v + 1] + e[8] * P[v + 2] + e[12], y = e[1] * P[v] + e[5] * P[v + 1] + e[9] * P[v + 2] + e[13], z = e[2] * P[v] + e[6] * P[v + 1] + e[10] * P[v + 2] + e[14]; if (z > bz) { bz = z; best = [x, y, z]; } } const q = APP.viewer.toScreen(new APP.THREE.Vector3(...best)), r = APP.viewer.container.getBoundingClientRect(); return [r.left + q.x, r.top + q.y]; });
  await p2.mouse.click(tapAt[0], tapAt[1]); await p2.waitForTimeout(250);
  const one = await p2.evaluate(() => { const pk = APP.S.io.pick; return { n: pk.pairs.length, a: !!(pk.pairs[0] && pk.pairs[0].a), b: !!(pk.pairs[0] && pk.pairs[0].b), marks: pk.marks.length, text: document.getElementById('sPairs').innerText }; });
  ok(parked.on && parked.vis && !parked.box && parked.size[0] > 60 && parked.size[2] < 25 && parked.near < 40 && one.n === 1 && one.a && !one.b && one.marks === 1 && /Now tap the same spot in a slice/.test(one.text), `“By matching points” on a scan that is not lined up: it stands level in the 3D view (${parked.size.map((v) => v.toFixed(0)).join(' × ')} mm), a tap marks point 1 on it and the step asks for the same spot in a slice`);
  await p2.click('#sPairs [data-p=cancel]'); await p2.waitForTimeout(300);
  await p2.click('#sAuto'); await p2.waitForFunction(() => APP.S.io.lower.matrix && !APP.S.busy, null, { timeout: 180000 }); await b.idle();
  ok(await p2.evaluate(() => APP.S.io.lower.ok && APP.S.io.lower.how === 'auto'), '“By itself” lines it up with the new one');
  // dropped on the page from another step, a scan file goes to this step (not to the DICOM reader)
  await p2.evaluate(async () => { const bytes = APP.N.stlBinary(APP.S.io.lower.mesh, null, 'scan'); APP.ioDrop('lower'); APP.shell.goto('view'); await APP.openFiles([new File([bytes], 'Zebedee_Quillfeather_lower.STL')]); }); await p2.waitForFunction(() => APP.S.io.lower && APP.S.io.lower.matrix && !APP.S.busy, null, { timeout: 180000 }); await b.idle();
  const drop = await p2.evaluate(() => ({ step: APP.shell.steps[APP.shell.current].id, ok: APP.S.io.lower.ok, vol: !!APP.S.vol, leak: document.documentElement.outerHTML.includes('Zebedee') }));
  ok(drop.step === 'scans' && drop.ok && drop.vol && !drop.leak, 'a scan file dropped on the page while on another step is taken to this step and lined up; the CBCT stays open');
  // a file that is not a scan
  await p2.evaluate(async () => { await APP.ioOpenFiles([new File([new Uint8Array([1, 2, 3, 4, 5])], 'Zebedee_notes.stl')]); }); await p2.waitForTimeout(300);
  const bad = await p2.evaluate(() => ({ status: document.getElementById('status').textContent, still: !!APP.S.io.lower }));
  ok(/could not be read as a scan/.test(bad.status) && !/Zebedee/.test(bad.status) && bad.still, `a file that is no scan is turned away without its name: “${bad.status}”`);

  const errs = errors.concat(b.errors);
  ok(errs.length === 0 && !errs.some((e) => /Zebedee|Quillfeather/.test(e)), `no errors in either page${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await b.close(); await a.close();
})().catch((e) => { console.error(e); process.exit(1); });
