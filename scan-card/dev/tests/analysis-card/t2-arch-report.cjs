// Arch dimensions, overjet / overbite / midline and the report exports on the standard demo (UI-driven).
const L = require('./lib.cjs'); const fs = require('fs');
(async () => {
  const t0 = Date.now(), { page, ctx, errors, shot, close } = await L.open();
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await L.loadDemo(page, 0);
  const truth = await page.evaluate(() => APP.scans.demoTruth);
  console.log('width clicks:', await L.clickAllWidths(page, L.truthPoint(truth)));
  await page.click('#bNext'); await page.click('#bNext'); await page.click('#bNext'); await page.waitForTimeout(250);          // → Bolton → Space → Arch
  console.log('step:', await page.evaluate(() => APP.ui.step));
  const by = {}; for (const j of ['upper', 'lower']) for (const t of truth[j].teeth) by[t.fdi] = t;
  const got = await page.evaluate(() => { const c = APP.calc, f = (v) => (v == null ? null : +v.toFixed(3)); return { icwU: f(c.arch.upper.icw), icwL: f(c.arch.lower.icw), imwU: f(c.arch.upper.imw), imwL: f(c.arch.lower.imw), dU: f(c.arch.upper.depth), dL: f(c.arch.lower.depth), oj: f(c.occ.overjet), ob: f(c.occ.overbite), mid: f(c.occ.mid), ojTo: c.occ.ojTo, U: c.occ.U && c.occ.U.toArray(), Lp: c.occ.L && c.occ.L.toArray(), tips: Object.fromEntries(Object.entries(APP.state.tips).map(([k, v]) => [k, v.p])) }; });
  // independent expectations from the demo truth
  const depth = (m1, m2, a, b) => { const I = [(m1[0] + m2[0]) / 2, (m1[1] + m2[1]) / 2], bx = b[0] - a[0], byy = b[1] - a[1]; return Math.abs((I[0] - a[0]) * byy - (I[1] - a[1]) * bx) / Math.hypot(bx, byy); };
  const exp = { icwU: L.d2(by[13].tip, by[23].tip), icwL: L.d2(by[33].tip, by[43].tip), imwU: 2 * Math.abs(by[26].tip[0]), imwL: 2 * Math.abs(by[46].tip[0]), dU: depth(by[11].mesial, by[21].mesial, by[16].mesial, by[26].mesial), dL: depth(by[31].mesial, by[41].mesial, by[36].mesial, by[46].mesial) };
  for (const k of Object.keys(exp)) console.log(k.padEnd(5), 'app', got[k], 'expected', exp[k].toFixed(3), 'diff', (got[k] - exp[k]).toFixed(3));
  for (const f of [13, 23, 33, 43, 26, 46]) console.log('  tip', f, 'found', got.tips['t' + f].map((v) => v.toFixed(2)).join(','), 'truth', by[f].tip.map((v) => v.toFixed(2)).join(','), 'off by', L.d3(got.tips['t' + f], by[f].tip).toFixed(3));
  // overjet / overbite: independent brute force over the lower mesh vertices
  const ind = await page.evaluate((U) => { const P = APP.scans.framed('lower').positions; let minY = Infinity, maxZ = -Infinity; for (let i = 0; i < P.length; i += 3) { if (Math.abs(P[i] - U[0]) <= 1.5 && Math.abs(P[i + 2] - U[2]) < 0.12 && P[i + 1] < minY && P[i + 1] > U[1] - 40) minY = P[i + 1]; if (Math.abs(P[i] - U[0]) <= 2.5 && P[i + 1] > U[1] - 12 && P[i + 1] < U[1] + 15 && P[i + 2] > maxZ) maxZ = P[i + 2]; } return { oj: minY - U[1], ob: maxZ - U[2] }; }, got.U);
  console.log('incisal point U', got.U.map((v) => v.toFixed(2)).join(','), '| truth tips 11', by[11].tip.map((v) => v.toFixed(2)).join(','), '21', by[21].tip.map((v) => v.toFixed(2)).join(','));
  console.log('overjet  app', got.oj, '(' + got.ojTo + ') brute force', ind.oj.toFixed(3)); console.log('overbite app', got.ob, 'brute force', ind.ob.toFixed(3), '| truth tip z lower 41', by[41].tip[2].toFixed(3), 'upper 11', by[11].tip[2].toFixed(3), '→', (by[41].tip[2] - by[11].tip[2]).toFixed(3));
  console.log('midline  app', got.mid, 'expected 0 (symmetric demo)');
  await shot(L.O + 't2-arch-upper.png');
  await page.click('#aView [data-v=lower]'); await page.waitForTimeout(250); await shot(L.O + 't2-arch-lower.png');
  await page.click('#aView [data-v=front]'); await page.waitForTimeout(250); await shot(L.O + 't2-arch-front.png');
  await page.click('#aView [data-v=section]'); await page.waitForTimeout(350); await shot(L.O + 't2-arch-section.png');
  // in the section view a landmark is dragged within the cut and snaps to the surface: drag the lower incisal point 1.5 mm down the labial face and undo
  { const Lp = await page.evaluate(() => APP.calc.occ.L.toArray()), ob0 = await page.evaluate(() => APP.calc.occ.overbite); await L.dragWorld(page, Lp, [Lp[0], Lp[1] - 0.6, Lp[2] - 1.5]);
    const r = await page.evaluate(() => ({ ob: APP.calc.occ.overbite, auto: APP.state.occ.lAuto, d: APP.N.closestOnMesh(APP.scans.lower.object, APP.calc.occ.L).distance, dx: APP.calc.occ.L.x - APP.calc.occ.U.x }));
    console.log(`section drag of the lower incisal point: overbite ${ob0.toFixed(2)} → ${r.ob.toFixed(2)}; point stays on the lower scan (${r.d.toFixed(4)} mm) and ${Math.abs(r.dx).toFixed(2)} mm from the cut; marked as placed by hand: ${!r.auto}`);
    await page.click('#aUndo'); console.log('  after Undo: overbite', (await page.evaluate(() => APP.calc.occ.overbite)).toFixed(2)); }
  // report
  await page.evaluate(() => APP.shell.goto('report')); await page.waitForTimeout(500); await shot(L.O + 't2-report.png');
  const text = await page.evaluate(() => document.querySelector('#pText').textContent); console.log('--- report text ---\n' + text + '\n---');
  await page.click('#pCopy'); await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => 'clipboard read failed: ' + e.message); console.log('clipboard equals text:', clip === text, '| status:', await page.evaluate(() => document.querySelector('#status').textContent));
  let [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#pPng')]); await dl.saveAs(L.O + 't2-report-sheet.png'); console.log('png:', dl.suggestedFilename(), fs.statSync(L.O + 't2-report-sheet.png').size, 'bytes');
  [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#pCsv')]); await dl.saveAs(L.O + 't2-report.csv'); const csv = fs.readFileSync(L.O + 't2-report.csv', 'utf8'); console.log('csv:', dl.suggestedFilename(), csv.split('\r\n').length - 1, 'rows; first rows:\n' + csv.split('\r\n').slice(0, 6).join('\n'));
  console.log('errors', errors, (Date.now() - t0) + 'ms');
  await close();
})();
