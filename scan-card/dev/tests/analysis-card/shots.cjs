// Gallery: one screenshot per step on the hypodontia demo. Usage: node shots.cjs [touch]
const L = require('./lib.cjs');
(async () => {
  const touch = process.argv[2] === 'touch', tag = touch ? 'ipad' : 'pc', t0 = Date.now();
  const { page, errors, shot, close } = await L.open(touch ? { width: 820, height: 1180, touch: true } : {});
  const tap = (sel) => (touch ? page.tap(sel) : page.click(sel)), snap = async (name, wait = 300) => { await page.waitForTimeout(wait); await shot(`${L.O}${tag}-${name}.png`); };
  await snap('1-empty', 100);
  await tap('[data-ss=demo][data-i="1"]');
  await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && APP.scans.demoTruth && !document.querySelector('#busy.show'), { timeout: 120000 });
  await snap('1-load');
  await tap('#bNext'); await snap('2-orient');
  await tap('#bNext'); await page.waitForTimeout(150);
  const truth = await page.evaluate(() => APP.scans.demoTruth), by = {}; for (const j of ['upper', 'lower']) for (const t of truth[j].teeth) by[t.fdi] = t;
  for (const f of [12, 22]) { await tap(`#chart [data-f="${f}"]`); await tap('#wMiss'); }
  await tap('#chart [data-f="16"]');
  let n = 0; await L.clickAllWidths(page, (f, k) => (n++ < 9 ? L.truthPoint(truth)(f, k) : null), { touch }); await snap('3-widths-in-progress');
  await L.clickAllWidths(page, L.truthPoint(truth), { touch }); await snap('3-widths-lower');
  await tap('#wJaw [data-v=upper]'); await snap('3-widths-upper');
  await page.evaluate(() => document.querySelector('.step[data-id=widths]').classList.add('help')); await page.evaluate(() => { const s = document.getElementById('steps'); s.scrollTop = s.scrollHeight; }); await snap('3-widths-tips'); await page.evaluate(() => document.querySelector('.step[data-id=widths]').classList.remove('help'));
  await tap('#bNext'); await snap('4-bolton');
  await page.evaluate(() => document.querySelector('.step[data-id=bolton]').classList.add('help')); await page.evaluate(() => { const s = document.getElementById('steps'); s.scrollTop = s.scrollHeight; }); await snap('4-bolton-sources'); await page.evaluate(() => document.querySelector('.step[data-id=bolton]').classList.remove('help'));
  await tap('#bNext'); await snap('5-space-upper');
  await tap('#bNext'); await snap('6-arch-upper'); await tap('#aView [data-v=lower]'); await snap('6-arch-lower'); await tap('#aView [data-v=front]'); await snap('6-arch-front'); await tap('#aView [data-v=section]'); await snap('6-arch-section');
  await tap('#bNext'); await page.waitForTimeout(200);
  await tap('[data-r=crest]'); await L.clickWorld(page, [by[13].mesial[0] + 0.3, by[13].mesial[1] - 0.3, 6], { touch }); await L.clickWorld(page, [by[11].distal[0] - 0.3, by[11].distal[1] + 0.6, 6], { touch });
  await page.fill('[data-plan="12"]', '6.5'); await page.dispatchEvent('[data-plan="12"]', 'change'); await page.fill('#rProp', '77'); await page.dispatchEvent('#rProp', 'change');
  await snap('7-resto'); await page.evaluate(() => { const s = document.getElementById('steps'); s.scrollTop += 330; }); await snap('7-resto-whatif', 150);
  await tap('#bNext'); await tap('#viewBtns button:nth-child(7)'); await page.waitForTimeout(150);
  await L.clickWorld(page, by[13].tip, { touch }); await L.clickWorld(page, by[23].tip, { touch }); await tap('#mTool [data-v=a]'); await L.clickWorld(page, by[16].distalPick, { touch }); await L.clickWorld(page, by[11].mesialPick, { touch }); await L.clickWorld(page, by[26].distalPick, { touch });
  await tap('#mTool [data-v=s]'); await L.clickWorld(page, by[15].tip, { touch }); await L.clickWorld(page, by[25].tip, { touch }); await page.waitForTimeout(200);
  { const m = await page.evaluate(() => { const r = document.querySelector('.secp canvas').getBoundingClientRect(), m = APP.sec; return [r.left + m.ox, r.top + m.oy, m.k, m.data.len]; }); for (const sv of [1.5, m[3] - 1.5]) { const x = m[0] + sv * m[2], y = m[1] - 3 * m[2]; if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); } }
  await snap('8-measure');
  await tap('#bNext'); await snap('9-report', 600);
  await page.evaluate(() => { document.getElementById('sheet').scrollTop = 700; }); await snap('9-report-tables', 150);
  if (!touch) { const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#pPng')]); await dl.saveAs(L.O + 'report-sheet-hypodontia.png'); }
  console.log(tag, 'gallery done | errors', errors, (Date.now() - t0) + 'ms');
  await close();
})();
