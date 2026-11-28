// The CBCT tab's “Intraoral scans” step inside Scan Card: it can borrow a scan from the Scans tab (SCANHUB.scan — the surface
// only, no name) and line it up with the CBCT; the switch in the bar works inside the hub; the case keeps where the scan was
// put, and a fresh Scan Card opening that case puts the Scans tab's scan back there by itself once the same CBCT is opened.
// The scan is the phantom CBCT's own lower teeth, made here and written as a file in "scanner" coordinates: nothing from a patient.
const { openHub, ok, OUT } = require('./lib.cjs');
const fs = require('fs');
const CB = '/home/claude/suite/dev/data/cbct/';
(async () => {
  const N = await import('/home/claude/suite/shared/core.js'), D = await import('/home/claude/suite/shared/dicom.js');
  const f = D.phantomScanField({}), g = N.isoMesh(f.F, f.n[0], f.n[1], f.n[2], f.origin, f.h, {}), S = new N.THREE.Matrix4().makeRotationFromEuler(new N.THREE.Euler(-0.7, 0.4, 1.3)).setPosition(-22, 35, 9);
  const file = OUT + 'h21-lower.stl'; fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(file, Buffer.from(N.stlBinary(N.transformMesh({ positions: g.positions, indices: g.indices }, S), null, 'scan')));
  const offBy = (fr) => fr.evaluate((s) => { const sc = APP.S.io.lower; if (!sc || !sc.matrix) return null; const E = sc.matrix.clone().multiply(new APP.THREE.Matrix4().fromArray(s)).elements; let mx = 0; for (const p of [[30, 10, 5], [-30, 10, 5], [0, -35, 8]]) mx = Math.max(mx, Math.hypot(E[0] * p[0] + E[4] * p[1] + E[8] * p[2] + E[12] - p[0], E[1] * p[0] + E[5] * p[1] + E[9] * p[2] + E[13] - p[1], E[2] * p[0] + E[6] * p[1] + E[10] * p[2] + E[14] - p[2])); return mx; }, S.toArray());
  const green = (fr) => fr.evaluate(() => { const v = APP.views.ax, d = v.ctx.getImageData(0, 0, v.cv.width, v.cv.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 170 && d[i] < 150 && d[i + 2] < 175 && d[i + 1] - d[i + 2] > 45 && d[i + 1] - d[i] > 60) n++; return n; });

  const a = await openHub(), { page } = a;
  const none = await page.evaluate(() => ({ fn: typeof SCANHUB.scan, lower: SCANHUB.scan('lower'), junk: SCANHUB.scan('constructor') }));
  ok(none.fn === 'function' && none.lower === null && none.junk === null, 'Scan Card offers its scans to a tool that asks (SCANHUB.scan): none yet');
  let fr = await a.go('cbct'); await fr.setInputFiles('#lFolderIn', CB + 'a-explicit'); await fr.waitForFunction(() => APP.S.vol, null, { timeout: 120000 }); await a.idle(fr);
  await fr.evaluate(() => APP.shell.goto('scans')); await a.idle(fr);
  await fr.click('#sJaw [data-v=lower]'); await page.waitForTimeout(150);
  ok(await fr.evaluate(() => document.getElementById('sHub').hidden && !document.getElementById('sOpen').disabled), 'with no scan on the Scans tab the CBCT tab offers only to open a file');
  // the lower scan is loaded on the Scans tab
  await a.go('scans'); await page.setInputFiles('input[data-ss=file]', file); await page.waitForFunction(() => APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 });
  const got = await page.evaluate(() => { const s = SCANHUB.scan('lower'); return { keys: Object.keys(s).sort().join(), nV: s.positions.length / 3, nT: s.indices.length / 3, upper: SCANHUB.scan('upper') }; });
  ok(got.keys === 'indices,positions' && got.nT > 100000 && got.upper === null, `once a lower scan is loaded it hands over its surface and nothing else (${got.keys}: ${got.nT.toLocaleString('en-GB')} triangles)`);
  fr = await a.go('cbct'); await page.waitForTimeout(400);
  ok(await fr.evaluate(() => !document.getElementById('sHub').hidden && !!APP.S.vol), 'back on the CBCT tab (the CBCT still open) “Use the Scans tab’s scan” is offered for the lower arch, without anything being pressed');
  await fr.click('#sJaw [data-v=upper]'); await page.waitForTimeout(150); ok(await fr.evaluate(() => document.getElementById('sHub').hidden), '… and not for the upper, which the Scans tab does not have'); await fr.click('#sJaw [data-v=lower]');
  await fr.click('#sHub'); await fr.waitForFunction(() => APP.S.io.lower && APP.S.io.lower.matrix && !APP.S.busy, null, { timeout: 180000 }); await a.idle(fr); await page.waitForTimeout(400);
  const st = await fr.evaluate(() => { const sc = APP.S.io.lower; return { ok: sc.ok, how: sc.how, src: sc.src, tris: sc.mesh.indices.length / 3, hubBtn: document.getElementById('sHub').hidden, bar: document.getElementById('cbScans').innerText.trim() }; }), off = await offBy(fr);
  ok(st.ok && st.how === 'auto' && st.src === 'hub' && st.tris === got.nT && off < 0.15 && st.hubBtn && /Lower scan/.test(st.bar), `the Scans tab’s scan is lined up with the CBCT by itself, within ${off.toFixed(3)} mm of where it belongs`);
  await fr.evaluate(() => { const t = APP.S.demo ? null : APP.D.phantomTeeth().find((x) => x.name === 45); APP.S.cur = APP.D.voxelOf(APP.S.vol, t.base[0] + t.w[0] * t.crown * 0.6, t.base[1] + t.w[1] * t.crown * 0.6, t.base[2] + t.w[2] * t.crown * 0.6).map(Math.round); APP.crossChanged(); }); await page.waitForTimeout(400);
  const on = await green(fr); await fr.click('#cbScans [data-j=lower]'); await page.waitForTimeout(400); const offPx = await green(fr); await fr.click('#cbScans [data-j=lower]'); await page.waitForTimeout(300);
  ok(on > 300 && offPx === 0 && (await green(fr)) > 300, `its outline is in the slices (${on} pixels) and the switch in the bar takes it away and brings it back`);
  await page.screenshot({ path: OUT + 'h21-cbct-scans.png' });
  ok(!(await page.evaluate(() => APP.isLocked())), 'borrowing the scan does not lock the Scans tab');
  // the case
  await a.go('scans');
  const kept = await page.evaluate(() => { const c = APP.buildCase(); return { roles: c.items.map((i) => i.role).sort().join(), scans: c.data.cbct && c.data.cbct.scans }; });
  ok(kept.roles === 'lower-scan' && kept.scans && kept.scans.lower && kept.scans.lower.matrix.length === 16 && !kept.scans.upper, 'the case holds the scan once (the Scans tab’s) and, in the CBCT’s part, where it was put');
  const [dc] = await Promise.all([page.waitForEvent('download'), page.click('#topBtns button:nth-child(2)')]); const zip = OUT + 'h21-case.zip'; await dc.saveAs(zip);
  const errs = a.errors.filter((e) => !/font-src/.test(e)); ok(errs.length === 0, 'no page errors ' + errs.slice(0, 3).join(' | ')); await a.close();
  // a fresh Scan Card: the case, then the same CBCT — the scan goes back by itself
  const b = await openHub(), p2 = b.page;
  await p2.setInputFiles('input[data-ss=file]', zip); await p2.waitForFunction(() => APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 });
  const f2 = await b.go('cbct'); await f2.setInputFiles('#lFolderIn', CB + 'a-explicit'); await f2.waitForFunction(() => APP.S.vol, null, { timeout: 120000 });
  await f2.waitForFunction(() => APP.S.io.lower && APP.S.io.lower.matrix && !APP.S.busy, null, { timeout: 180000 }); await b.idle(f2);
  const back = await f2.evaluate(() => ({ how: APP.S.io.lower.how, src: APP.S.io.lower.src, ok: APP.S.io.lower.ok, M: APP.S.io.lower.matrix.toArray() })), off2 = await offBy(f2);
  ok(back.src === 'hub' && back.ok && back.how === 'auto' && back.M.every((v, i) => Math.abs(v - kept.scans.lower.matrix[i]) < 1e-9) && off2 < 0.15, `reopened, and the same CBCT opened in the tab: the Scans tab’s scan is put back where it was lined up, without being asked (${off2.toFixed(3)} mm)`);
  const e2 = b.errors.filter((e) => !/font-src/.test(e)); ok(e2.length === 0, 'no page errors (reopened) ' + e2.slice(0, 3).join(' | '));
  await b.close();
})().catch((e) => { console.error(e); process.exitCode = 1; });
