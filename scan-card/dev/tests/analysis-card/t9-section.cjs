// The section tool: cut through both lower first-molar mesiobuccal cusps, check the outline and measure on it.
const L = require('./lib.cjs');
(async () => {
  const t0 = Date.now(), { page, errors, shot, close } = await L.open(); let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? '  ok  ' : '  FAIL', m); };
  await L.loadDemo(page, 0);
  const truth = await page.evaluate(() => APP.scans.demoTruth), tip = truth.lower.teeth.find((t) => t.fdi === 46).tip;      // 46's truth tip is its mesiobuccal cusp
  await page.evaluate(() => { APP.shell.goto('measure'); APP.scans.setVisible('upper', false); APP.viewer.setView('top'); }); await page.waitForTimeout(250);
  await page.click('#mTool [data-v=s]');
  const p1 = [tip[0], tip[1], tip[2]], p2 = [-tip[0], tip[1], tip[2]];
  await L.clickWorld(page, p1); await L.clickWorld(page, p2); await page.waitForTimeout(200);
  const sec = await page.evaluate(() => { const m = APP.sec, d = m.data, lower = d.segs.find((s) => s.j === 'lower').s; let zA = -1e9, zB = -1e9, sA = 0, sB = 0; for (let i = 0; i < lower.length; i += 2) { if (Math.abs(lower[i]) < 1.5 && lower[i + 1] > zA) { zA = lower[i + 1]; sA = lower[i]; } if (Math.abs(lower[i] - d.len) < 1.5 && lower[i + 1] > zB) { zB = lower[i + 1]; sB = lower[i]; } } return { len: d.len, n: lower.length / 4, shown: d.segs.map((s) => s.j), zA, zB, sA, sB, k: m.k, ox: m.ox, oy: m.oy, panel: !document.querySelector('.secp').hidden }; });
  ok(sec.panel && Math.abs(sec.len - 2 * Math.abs(tip[0])) < 0.05 && sec.shown.join() === 'lower', `section panel open; cut ${sec.len.toFixed(3)} mm long (points ${(2 * Math.abs(tip[0])).toFixed(3)} apart); ${sec.n} outline pieces, scans cut: ${sec.shown.join('+')}`);
  ok(Math.abs(sec.zA - tip[2]) < 0.12 && Math.abs(sec.zB - tip[2]) < 0.12, `outline tops at the two ends: z ${sec.zA.toFixed(3)} and ${sec.zB.toFixed(3)} (truth cusp height ${tip[2].toFixed(3)})`);
  // measure on the outline: click the two cusp tops in the panel
  const rect = await page.evaluate(() => { const r = document.querySelector('.secp canvas').getBoundingClientRect(); return [r.left, r.top]; });
  for (const [sv, z] of [[sec.sA, sec.zA], [sec.sB, sec.zB]]) await page.mouse.click(rect[0] + sec.ox + sv * sec.k + 2, rect[1] + sec.oy - z * sec.k - 3);     // a few pixels off: the click must snap to the outline
  const m = await page.evaluate(() => { const m = APP.calc.meas[0]; return { qd: m.qd, qs: m.qs, qz: m.qz, q: m.q, cap: document.querySelector('.secp .cap').textContent, row: document.querySelector('#mOut tr[data-sec]').innerText.replace(/\s+/g, ' ') }; });
  ok(Math.abs(m.qd - 2 * Math.abs(tip[0])) < 0.15 && m.qz < 0.1, `measured on the outline: ${m.qd.toFixed(3)} mm (along ${m.qs.toFixed(3)}, vertical ${m.qz.toFixed(3)}); snapped points are ${Math.hypot(sec.sB - sec.sA, sec.zB - sec.zA).toFixed(3)} apart; truth cusp-to-cusp ${(2 * Math.abs(tip[0])).toFixed(3)}`);
  console.log('   list row:', m.row, '| caption:', m.cap);
  await shot(L.O + 't9-section.png');
  // both scans showing → both outlines; saved with the case state; report mentions it
  await page.evaluate(() => APP.scans.setVisible('upper', true)); await page.waitForTimeout(150);
  ok((await page.evaluate(() => APP.sec.data.segs.map((s) => s.j + ':' + s.s.length / 4).join(' '))).startsWith('upper:'), 'with the upper scan shown again the panel cuts both: ' + (await page.evaluate(() => APP.sec.data.segs.map((s) => s.j + ':' + s.s.length / 4).join(' '))));
  await shot(L.O + 't9-section-both.png');
  const saved = await page.evaluate(() => { const s = JSON.parse(JSON.stringify(APP.state)); APP.loadState(s); APP.changed(false); return { q: APP.state.measures[0].q, text: APP.reportText().split('\n').find((l) => l.startsWith('Other')) }; });
  ok(saved.q && saved.q.length === 2, 'section and its two measured points survive a state round trip; report line: ' + saved.text);
  // drag an end of the cut: the measurement on it is cleared (its coordinates no longer apply)
  await page.evaluate(() => { APP.scans.setVisible('upper', false); APP.ui.msel = 0; APP.changed(false); }); await L.dragWorld(page, p2, [p2[0] - 2, p2[1] + 1, p2[2]]);
  ok((await page.evaluate(() => APP.state.measures[0].q)) == null, 'dragging an end of the cut clears the measurement made on it; new length ' + (await page.evaluate(() => APP.calc.meas[0].len.toFixed(2))));
  console.log(fails ? `${fails} FAILED` : 'all passed', '| errors', errors, (Date.now() - t0) + 'ms');
  await close();
})();
