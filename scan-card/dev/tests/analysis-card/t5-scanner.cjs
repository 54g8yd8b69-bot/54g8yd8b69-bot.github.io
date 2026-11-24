// The scanner-frame STL files: load through the real file input, let the core auto-orient, measure, compare with the truth file.
const L = require('./lib.cjs'); const fs = require('fs');
(async () => {
  const t0 = Date.now(), { page, errors, shot, close } = await L.open();
  await page.setInputFiles('input[data-ss=file]', [L.D + 'scanner-upper.stl', L.D + 'scanner-lower.stl']);
  await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 120000 }); await page.waitForTimeout(300);
  const T = JSON.parse(fs.readFileSync(L.D + 'scanner-truth.json'));
  const info = await page.evaluate((tm) => { const M = new APP.THREE.Matrix4().fromArray(tm), e = APP.scans.lower.matrix.clone().multiply(M).elements; return { inBite: APP.scans.inBite, same: APP.scans.upper.matrix.equals(APP.scans.lower.matrix), ang: Math.acos(Math.min(1, (e[0] + e[5] + e[10] - 1) / 2)) * 180 / Math.PI, shift: [e[12], e[13], e[14]] }; }, T.matrix);
  console.log('auto-orient: residual rotation', info.ang.toFixed(2), '°, shift', info.shift.map((v) => v.toFixed(2)).join(' '), '| inBite', info.inBite, '| shared matrix', info.same);
  await shot(L.O + 't5-scanner-loaded.png');
  // truth points are in scanner coordinates → case frame through each scan's own matrix
  const toCase = (jaw, p) => page.evaluate(([jaw, p]) => APP.toWorld(jaw, p).toArray(), [jaw, p]);
  const by = {}; for (const j of ['upper', 'lower']) for (const t of T.truth[j].teeth) by[t.fdi] = { ...t, jaw: j };
  const cache = {}; const pt = async (f, k) => { const key = f + k; if (!cache[key]) cache[key] = await toCase(by[f].jaw, by[f][k === 'm' ? 'mesialPick' : 'distalPick']); return cache[key]; };
  // clickAllWidths wants a synchronous lookup: precompute
  for (const f of Object.keys(by)) for (const k of ['m', 'd']) await pt(+f, k);
  console.log('width clicks:', await L.clickAllWidths(page, (f, k) => cache[f + k]));
  const got = await page.evaluate(() => ({ w: APP.calc.w, a: APP.calc.bolton.anterior.ratio, o: APP.calc.bolton.overall.ratio }));
  let worst = 0, worstF = 0; const rows = [];
  for (const f of Object.keys(by).map(Number)) { if (f % 10 > 6) continue; const d = got.w[f] - by[f].width; if (Math.abs(d) > worst) { worst = Math.abs(d); worstF = f; } rows.push(`${f}:${got.w[f].toFixed(2)}(${(d >= 0 ? '+' : '') + d.toFixed(2)})`); }
  console.log(rows.join(' ')); console.log('worst |measured − designed width| =', worst.toFixed(3), 'mm at', worstF, '| Bolton anterior', got.a.toFixed(3), 'overall', got.o.toFixed(3), '(aligned demo: 79.565 / 92.223)');
  // the same clicks measured as straight 3D, for information
  await page.click('#wMode [data-v="3d"]'); const w3 = await page.evaluate(() => APP.calc.w); let worst3 = 0; for (const f of Object.keys(by).map(Number)) if (f % 10 < 7) worst3 = Math.max(worst3, Math.abs(w3[f] - by[f].width)); console.log('same points as straight 3D: worst difference from designed width', worst3.toFixed(3), 'mm'); await page.click('#wMode [data-v=plane]');
  // second pass: clear both arches through the UI and click where a user would aim in this view — the contact points themselves
  // (the pick points above are where a vertical ray landed in the *designed* frame; some lie on the gum 7 mm below the contact)
  for (const j of ['upper', 'lower']) { await page.click(`#wJaw [data-v=${j}]`); await page.click('#wClear'); }
  const cache2 = {}; for (const f of Object.keys(by)) for (const k of ['m', 'd']) cache2[f + k] = await toCase(by[f].jaw, by[f][k === 'm' ? 'mesial' : 'distal']);
  await page.click('#wJaw [data-v=upper]');
  console.log('second pass, clicks at the contact points:', await L.clickAllWidths(page, (f, k) => cache2[f + k]));
  const got2 = await page.evaluate(() => ({ w: APP.calc.w, a: APP.calc.bolton.anterior.ratio, o: APP.calc.bolton.overall.ratio })); let worstB = 0, worstBF = 0; const rows2 = [];
  for (const f of Object.keys(by).map(Number)) { if (f % 10 > 6) continue; const d = got2.w[f] - by[f].width; if (Math.abs(d) > worstB) { worstB = Math.abs(d); worstBF = f; } rows2.push(`${f}:${got2.w[f].toFixed(2)}(${(d >= 0 ? '+' : '') + d.toFixed(2)})`); }
  console.log(rows2.join(' ')); console.log('worst |measured − designed width| =', worstB.toFixed(3), 'mm at', worstBF, '| Bolton anterior', got2.a.toFixed(3), 'overall', got2.o.toFixed(3));
  await page.click('#wJaw [data-v=upper]'); await page.waitForTimeout(250); await shot(L.O + 't5-scanner-widths.png');
  await page.evaluate(() => APP.shell.goto('arch')); await page.waitForTimeout(250);
  console.log('arch:', await page.evaluate(() => { const c = APP.calc, f = (v) => (v == null ? null : +v.toFixed(2)); return JSON.stringify({ icwU: f(c.arch.upper.icw), imwU: f(c.arch.upper.imw), dU: f(c.arch.upper.depth), icwL: f(c.arch.lower.icw), imwL: f(c.arch.lower.imw), dL: f(c.arch.lower.depth), overjet: f(c.occ.overjet), overbite: f(c.occ.overbite), mid: f(c.occ.mid) }); }), '(aligned demo: 30.62 51.27 28.73 | 24.99 46.49 24.79 | 2.1 1.61 0)');
  // re-orient after landmarking: the landmarks must stay on the scan and the widths follow the new plane
  await page.evaluate(() => APP.shell.goto('orient')); await page.evaluate(() => { const r = document.querySelector('[data-so=pitch]'); r.value = 6; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(150);
  const tilt = await page.evaluate(() => { let far = 0; for (const f in APP.state.teeth) for (const k of ['m', 'd']) { const jaw = f < 30 ? 'upper' : 'lower', a = APP.state.teeth[f][k]; if (a) far = Math.max(far, APP.N.closestOnMesh(APP.scans[jaw].object, APP.toWorld(jaw, a)).distance); } return { far, w16: APP.calc.w[16], w11: APP.calc.w[11] }; });
  console.log('after tilting the scans 6° in step 2: landmarks still on the surface (max distance', tilt.far.toFixed(4), 'mm); 16 now', tilt.w16.toFixed(3), '11 now', tilt.w11.toFixed(3));
  console.log('errors', errors, (Date.now() - t0) + 'ms');
  await close();
})();
