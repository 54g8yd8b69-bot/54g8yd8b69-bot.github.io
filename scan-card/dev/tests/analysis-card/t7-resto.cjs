// Restorative space on the hypodontia demo: contact / crest / vertical readings against independent calculations, what-if arithmetic.
const L = require('./lib.cjs');
(async () => {
  const t0 = Date.now(), { page, errors, shot, close } = await L.open(); let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? '  ok  ' : '  FAIL', m); };
  await L.loadDemo(page, 1);
  const truth = await page.evaluate(() => APP.scans.demoTruth), by = {}; for (const j of ['upper', 'lower']) for (const t of truth[j].teeth) by[t.fdi] = t;
  await page.evaluate(() => APP.shell.goto('widths')); for (const f of [12, 22]) { await page.click(`#chart [data-f="${f}"]`); await page.click('#wMiss'); } await page.click('#chart [data-f="16"]');
  await L.clickAllWidths(page, L.truthPoint(truth));
  await page.evaluate(() => APP.shell.goto('bolton')); await page.waitForTimeout(150); await shot(L.O + 't7-bolton-hypodontia.png');
  const rem = await page.evaluate(() => APP.calc.bolton.anterior.rem), lower6 = 2 * (L.d2(by[31].mesial, by[31].distal) + L.d2(by[32].mesial, by[32].distal) + L.d2(by[33].mesial, by[33].distal)), up4 = 2 * (L.d2(by[11].mesial, by[11].distal) + L.d2(by[13].mesial, by[13].distal));
  ok(rem && Math.abs(rem.left - (lower6 / 0.772 - up4)) < 0.08,   /* clicks beside a gap land on the crown within ~0.05 mm of the truth contact point */ `Bolton what-if: leaves ${rem.left.toFixed(2)} mm for 12 + 22; hand: ${lower6.toFixed(2)} / 0.772 − ${up4.toFixed(2)} = ${(lower6 / 0.772 - up4).toFixed(2)}`);
  console.log('   note shown:', await page.evaluate(() => [...document.querySelectorAll('#bOut .note:not(.warn)')].map((e) => e.textContent).join(' | ')));
  await page.evaluate(() => APP.shell.goto('resto')); await page.waitForTimeout(250);
  let R = await page.evaluate(() => APP.calc.resto.map((r) => ({ key: r.key, contact: r.contact, vert: r.vert, beyond: r.beyond, ridge: r.ridge && r.ridge.toArray(), auto: r.ridgeAuto })));
  const c12 = L.d2(by[13].mesial, by[11].distal), c22 = L.d2(by[21].distal, by[23].mesial);
  ok(Math.abs(R[0].contact - c12) < 0.02 && Math.abs(R[1].contact - c22) < 0.02, `contact level: 12 space ${R[0].contact.toFixed(3)} (hand ${c12.toFixed(3)}), 22 space ${R[1].contact.toFixed(3)} (hand ${c22.toFixed(3)}); the generator's arc slot is 5.5 mm (+0.4 spacing)`);
  console.log('   automatic ridge point', R[0].ridge.map((v) => v.toFixed(2)).join(','), '→ vertical', R[0].vert.toFixed(2), 'mm, opposing surface', R[0].beyond.toFixed(1), 'mm beyond the occlusal plane | warning:', await page.evaluate(() => (document.querySelector('#rSel .note.warn') || {}).textContent || 'none'));
  await shot(L.O + 't7-resto-occlusal.png');
  // crest width: two clicks at known points on the gum margin; vertical: a ridge point placed over the lower canine
  const pA = [by[13].mesial[0] + 0.4, by[13].mesial[1] - 0.2, 6.0], pB = [by[11].distal[0] - 0.4, by[11].distal[1] + 0.8, 6.0];
  await page.click('[data-r=crest]'); await L.clickWorld(page, pA); await L.clickWorld(page, pB);
  const cp = await page.evaluate(() => APP.calc.resto[0].cp.map((p) => p.toArray())), crest = await page.evaluate(() => APP.calc.resto[0].crest);
  ok(Math.abs(crest - L.d2(pA, pB)) < 0.02, `crest level: app ${crest.toFixed(3)}; clicked points are ${L.d2(pA, pB).toFixed(3)} apart in the occlusal plane (landed at z ${cp[0][2].toFixed(2)} and ${cp[1][2].toFixed(2)})`);
  const lowTip = truth.lower.teeth.find((t) => t.fdi === 43).tip, target = [lowTip[0], lowTip[1], 0];
  await page.click('[data-r=ridge]'); await L.clickWorld(page, target);
  R = await page.evaluate(() => { const r = APP.calc.resto[0]; return { vert: r.vert, ridge: r.ridge.toArray(), hit: r.vhit && r.vhit.toArray(), auto: r.ridgeAuto, beyond: r.beyond }; });
  const ind = await page.evaluate((p) => { const P = APP.scans.framed('lower').positions; let best = -Infinity; for (let i = 0; i < P.length; i += 3) if (Math.hypot(P[i] - p[0], P[i + 1] - p[1]) < 0.22 && P[i + 2] > best) best = P[i + 2]; return best; }, R.ridge);
  ok(R.hit && Math.abs(R.vert - (R.ridge[2] - ind)) < 0.15, `vertical space with the ridge point over 43's cusp: app ${R.vert.toFixed(3)} mm (ridge z ${R.ridge[2].toFixed(2)} → lower surface z ${R.hit[2].toFixed(2)}); independent: highest lower vertex under the point z ${ind.toFixed(2)} → ${(R.ridge[2] - ind).toFixed(3)} mm; 43 tip truth z ${lowTip[2].toFixed(2)}`);
  await page.click('[data-r=v-side]'); await page.waitForTimeout(300); await shot(L.O + 't7-resto-side.png'); await page.click('[data-r=v-occ]'); await page.waitForTimeout(200);
  // what-if
  await page.fill('#rProp', '77'); await page.dispatchEvent('#rProp', 'change'); await page.click('[data-r=useprop]');
  let W = await page.evaluate(() => { const r = APP.calc.resto[0]; return { plan: r.plan, total: r.planTotal, spare: r.spare, central: APP.calc.w[11] }; });
  ok(Math.abs(W.plan[12] - Math.round(W.central * 0.77 * 10) / 10) < 1e-9 && Math.abs(W.spare - (c12 - W.plan[12])) < 0.02, `what-if: 77% of 11 (${W.central.toFixed(2)}) = ${W.plan[12]} mm planned; space ${c12.toFixed(2)} − ${W.plan[12]} = ${W.spare.toFixed(2)} mm spare`);
  await page.fill('[data-plan="12"]', '8'); await page.dispatchEvent('[data-plan="12"]', 'change');
  ok((await page.evaluate(() => document.querySelector('#rSel table.tbl tr.sum td').textContent)) === 'Short by', 'planned 8.0 mm → “Short by ' + (await page.evaluate(() => document.querySelectorAll('#rSel table.tbl tr.sum td')[1].textContent)) + '”');
  await page.fill('[data-imp=impD]', '3.3'); await page.dispatchEvent('[data-imp=impD]', 'change'); await page.fill('[data-imp=impC]', '1.5'); await page.dispatchEvent('[data-imp=impC]', 'change');
  W = await page.evaluate(() => { const r = APP.calc.resto[0]; return { need: r.impNeed, at: r.impAt, spare: r.impSpare, crest: r.crest }; });
  ok(Math.abs(W.need - 6.3) < 1e-9 && W.at === 'crest' && Math.abs(W.spare - (W.crest - 6.3)) < 1e-9, `implant sum 3.3 + 2 × 1.5 = ${W.need.toFixed(1)} against crest ${W.crest.toFixed(2)} → ${W.spare.toFixed(2)}`);
  await page.evaluate(() => { const s = document.getElementById('steps'); s.scrollTop += 420; }); await page.waitForTimeout(150); await shot(L.O + 't7-resto-whatif.png');
  await page.evaluate(() => APP.shell.goto('space')); await page.waitForTimeout(200);
  console.log('   space analysis with the planned width:', await page.evaluate(() => { const s = APP.calc.space.upper; return `available ${s.avail.toFixed(2)}, required ${s.req.toFixed(2)}, planned ${s.planned == null ? 'n/a (22 has no planned width)' : s.planned}`; }));
  console.log(fails ? `${fails} FAILED` : 'all passed', '| errors', errors, (Date.now() - t0) + 'ms');
  await close();
})();
