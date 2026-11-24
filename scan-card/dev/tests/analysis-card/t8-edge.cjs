// Edge cases: resume after a reload, one scan only, scans not in the same bite, part-arch and dirty scans, a different scan in the same slot.
const L = require('./lib.cjs');
(async () => {
  const t0 = Date.now(); let a = await L.open(), { page, errors } = a, fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? '  ok  ' : '  FAIL', m); };
  await L.loadDemo(page, 0);
  const truth = await page.evaluate(() => APP.scans.demoTruth), by = {}; for (const j of ['upper', 'lower']) for (const t of truth[j].teeth) by[t.fdi] = t;
  let n = 0; await L.clickAllWidths(page, (f, k) => (n++ < 7 ? L.truthPoint(truth)(f, k) : null));
  const before = await page.evaluate(() => JSON.stringify(APP.state.teeth));
  await page.waitForTimeout(3600);                                                  // the app stashes the case 2.5 s after the last change
  await page.reload(); await page.waitForFunction(() => window.APP); await page.waitForTimeout(1200);
  const offered = await page.evaluate(() => !document.querySelector('[data-ss=resume]').hidden); ok(offered, 'after a reload “Resume last case” is offered: ' + (await page.evaluate(() => document.querySelector('[data-ss=resume]').textContent)));
  await page.click('[data-ss=resume]'); await page.waitForTimeout(800);
  ok((await page.evaluate(() => JSON.stringify(APP.state.teeth))) === before, 'resumed with the 7 landmarks placed before the reload');
  await page.evaluate(() => APP.shell.goto('widths')); await page.waitForTimeout(150); ok((await page.evaluate(() => document.querySelector('#wPrompt b').textContent)) === '13 — mesial contact', 'and carries on at ' + (await page.evaluate(() => document.querySelector('#wPrompt b').textContent)));
  // finish, then remove the lower scan
  await L.clickAllWidths(page, L.truthPoint(truth));
  await page.evaluate(() => APP.shell.goto('load')); await page.click('.slot[data-jaw=lower] [data-act=clear]'); await page.waitForTimeout(200);
  let st = await page.evaluate(() => ({ lower: Object.keys(APP.state.teeth).filter((f) => f > 30).length, upper: Object.keys(APP.state.teeth).filter((f) => f < 30).length }));
  ok(st.lower === 0 && st.upper === 12, `lower scan removed → its ${st.lower} landmarks dropped, upper keeps ${st.upper} teeth`);
  for (const id of ['widths', 'bolton', 'space', 'arch', 'resto', 'measure', 'report']) { await page.evaluate((s) => APP.shell.goto(s), id); await page.waitForTimeout(120); }
  ok((await page.evaluate(() => APP.calc.occ.why)).includes('both'), 'upper only: every step opens; occlusion says: ' + (await page.evaluate(() => APP.calc.occ.why)));
  await page.evaluate(() => APP.shell.goto('bolton')); ok((await page.evaluate(() => document.querySelector('#bOut .note').textContent)).includes('both scans'), 'Bolton says: ' + (await page.evaluate(() => document.querySelector('#bOut .note').textContent)));
  await page.evaluate(() => APP.shell.goto('report')); await page.waitForTimeout(400); await a.shot(L.O + 't8-upper-only-report.png');
  // a different scan in the upper slot: the hypodontia upper has other geometry → landmarks must go
  await page.evaluate(() => APP.shell.goto('load')); await page.setInputFiles('input[data-ss=file]', [L.D + 'hypodontia-upper.stl']);
  await page.waitForFunction(() => APP.scans.upper && APP.scans.upper.name.includes('hypodontia') && !document.querySelector('#busy.show'), { timeout: 60000 }); await page.waitForTimeout(200);
  ok((await page.evaluate(() => Object.values(APP.state.teeth).filter((t) => t.m || t.d).length)) === 0, 'different scan loaded into the upper slot → old landmarks cleared (' + (await page.evaluate(() => document.querySelector('#status').textContent)) + ')');
  // not in the same bite (flag set as the core does when the pair is implausible)
  await page.setInputFiles('input[data-ss=file]', [L.D + 'hypodontia-lower.stl']); await page.waitForFunction(() => APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 60000 });
  await page.evaluate(() => { APP.scans.inBite = false; APP.shell.goto('arch'); }); await page.waitForTimeout(150);
  ok((await page.evaluate(() => (document.querySelector('#aOut .note.warn') || {}).textContent || '')).includes('same bite') && (await page.evaluate(() => document.querySelector('#aView [data-v=front]').disabled)), 'not in bite: ' + (await page.evaluate(() => document.querySelector('#aOut .note.warn').textContent)));
  console.log('errors so far', errors); await a.close();
  // part-arch and dirty scans
  a = await L.open(); page = a.page; errors = a.errors;
  for (const f of ['quadrant-lower.stl', 'dirty-lower.stl']) {
    await page.evaluate(() => APP.shell.goto('load')); await page.setInputFiles('input[data-ss=file]', [L.D + f]);
    await page.waitForFunction((f) => APP.scans.lower && APP.scans.lower.name === f && !document.querySelector('#busy.show'), f, { timeout: 60000 }); await page.waitForTimeout(200);
    for (const id of ['widths', 'bolton', 'space', 'arch', 'resto', 'measure', 'report']) { await page.evaluate((s) => APP.shell.goto(s), id); await page.waitForTimeout(100); }
    await page.evaluate(() => APP.shell.goto('widths')); await page.waitForTimeout(250);
    // place two points on whatever is under the middle of the view, to show clicks land on the scan
    const r = await page.evaluate(() => { const b = APP.N.meshBounds(APP.scans.framed('lower')); return b; });
    await L.clickWorld(page, [r.center[0] + r.size[0] * 0.3, r.center[1], 0]); await L.clickWorld(page, [r.center[0] + r.size[0] * 0.3, r.center[1] - 6, 0]);
    ok((await page.evaluate(() => Object.values(APP.state.teeth).filter((t) => t.m || t.d).length)) >= 1, `${f}: loads in the ${await page.evaluate(() => (APP.scans.lower ? 'lower' : 'upper'))} slot, all steps open, clicks land (${await page.evaluate(() => document.querySelector('#wPrompt span').textContent)}); info: ${(await page.evaluate(() => document.querySelector('[data-ss=info]').innerText)).replace(/\n/g, ' ')}`);
    if (f.startsWith('quadrant')) await a.shot(L.O + 't8-quadrant.png');
  }
  console.log(fails ? `${fails} FAILED` : 'all passed', '| errors', errors, (Date.now() - t0) + 'ms');
  await a.close();
})();
