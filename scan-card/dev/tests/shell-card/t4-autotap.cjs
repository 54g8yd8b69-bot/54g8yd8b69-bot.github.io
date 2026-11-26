// Shell Card: "Tap for me" — the teeth found and numbered automatically (N.findTeeth), a range tapped for the user (synthetic demo arches).
//  • upper demo, matrix, range 13–23: one tap on each of the six teeth (within 1.5 mm of its incisal edge or cusp tip), stored in the
//    scan's file coordinates like a hand tap; a hand tap after them, then Undo takes back the hand tap, Undo again the whole group
//  • the numbers show on the scan; tapping one offers the numbers either side; choosing another renumbers the arch, and the automatic
//    taps (the last thing done) are placed again for the new numbers
//  • hypodontia (12 and 22 missing): 13, 11, 21, 23 tapped, and the message names 12 and 22 as not found
//  • lower arch, range 33–43, spaced model mode: the six lower front teeth; the matrix is then made from the taps
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs'), OUT = '/home/claude/suite/dev/out/shell-card/';
fs.mkdirSync(OUT, { recursive: true });
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; return c; };
(async () => {
  const { page, errors, shot, close } = await openApp('shell-card', { width: 1400, height: 900 });
  const idle = async () => { await page.waitForTimeout(150); await page.waitForFunction(() => !document.querySelector('#busy').classList.contains('show'), null, { timeout: 300000 }); };
  await page.waitForFunction(() => window.APP);
  // the taps against the truth: for each truth tooth, the taps within 1.5 mm (in the plane) of its tip, in the case frame
  const match = (jaw) => page.evaluate((jaw) => { const M = APP.scans[jaw].matrix, taps = APP.P.taps.map((p) => new APP.THREE.Vector3(...p).applyMatrix4(M)), T = APP.scans.demoTruth[jaw].teeth;
    const per = {}; for (const t of T) per[t.fdi] = taps.filter((q) => Math.hypot(q.x - t.tip[0], q.y - t.tip[1]) < 1.5).length;
    const stray = taps.filter((q) => !T.some((t) => Math.hypot(q.x - t.tip[0], q.y - t.tip[1]) < 1.5)).length; return { n: taps.length, per, stray }; }, jaw);
  const tapped = (m) => Object.keys(m.per).filter((f) => m.per[f] > 0).map(Number).sort((a, b) => a - b);

  // ── upper demo, matrix over 13–23
  await page.evaluate(() => APP.scans.loadDemo({})); await idle();
  await page.evaluate(() => APP.shell.goto('make')); await page.click('#mkMode [data-v=matrix]'); await page.click('#mkJaw [data-v=upper]');
  await page.evaluate(() => APP.shell.goto('shape')); await page.click('#shSelf');
  await page.evaluate(() => APP.shell.goto('teeth')); await idle();
  ok(await page.isVisible('#tAutoRow'), 'the Teeth step offers “Tap for me” with a range');
  ok(await page.evaluate(() => document.getElementById('tFrom').value === '13' && document.getElementById('tTo').value === '23'), 'the range starts at 13 to 23 for the upper arch');
  const t0 = Date.now(); await page.click('#tAuto'); await idle(); const ms = Date.now() - t0;
  let m = await match('upper');
  ok(m.n === 6 && JSON.stringify(tapped(m)) === JSON.stringify([11, 12, 13, 21, 22, 23]) && Object.values(m.per).every((v) => v <= 1) && m.stray === 0, `six taps, one on each of 13–23 within 1.5 mm of its tip (${tapped(m).join(' ')}; ${m.stray} elsewhere) in ${ms} ms`);
  const status = await page.evaluate(() => document.querySelector('#status') ? document.querySelector('#status').textContent : ''); console.log('    status: ' + status);
  ok(/6 tooth taps placed \(13–23\)/.test(status), 'the message says how many were tapped');
  ok(await page.evaluate(() => APP.P.taps.every((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite))), 'the taps are stored like hand taps (points in the file coordinates)');
  const labs = await page.evaluate(() => [...document.querySelectorAll('#labels .lbl.tn')].map((e) => e.textContent));
  ok(labs.length === 14 && ['17', '13', '11', '21', '27'].every((f) => labs.includes(f)), `the numbers show on the scan (${labs.join(' ')})`);
  await page.waitForTimeout(300); await shot(OUT + 't4-upper-13-23.png');
  // a hand tap, then Undo twice
  const box = await page.locator('#view canvas').boundingBox();
  const tip27 = await page.evaluate(() => { const t = APP.scans.demoTruth.upper.teeth.find((q) => q.fdi === 26); const s = APP.viewer.toScreen(new APP.THREE.Vector3(...t.tip)); return s; });
  await page.mouse.click(box.x + tip27.x, box.y + tip27.y); await page.waitForTimeout(200);
  const n1 = await page.evaluate(() => APP.P.taps.length); await page.click('#tUndo'); const n2 = await page.evaluate(() => APP.P.taps.length); await page.click('#tUndo'); const n3 = await page.evaluate(() => APP.P.taps.length);
  ok(n1 === 7 && n2 === 6 && n3 === 0, `a hand tap adds one (${n1}); Undo takes it back (${n2}), Undo again the whole automatic group (${n3})`);

  // ── correcting a number: tap the label "12", choose 13 → the arch is renumbered and the taps placed again
  await page.click('#tAuto'); await idle();
  const lab12 = page.locator('#labels .lbl.tn[data-fdi="12"]'); await lab12.click(); await page.waitForTimeout(150);
  const menu = await page.evaluate(() => { const mm = document.querySelector('.tl-menu'); return mm ? [...mm.querySelectorAll('button')].map((b) => b.textContent) : null; });
  ok(menu && menu.includes('13') && menu.includes('11') && menu.includes('Not a tooth'), `tapping 12 offers the numbers either side and “Not a tooth” (${menu && menu.join(' · ')})`);
  await shot(OUT + 't4-renumber-menu.png');
  await page.click('.tl-menu button[data-fdi="13"]'); await idle();
  const after = await page.evaluate(() => ({ nums: APP.AUTO.ft.res.teeth.map((t) => t.fdi), pinned: [...document.querySelectorAll('#labels .lbl.tn.pinned')].map((e) => e.textContent), gaps: APP.AUTO.ft.res.gaps.map((g) => g.fdi.join('+')) }));
  m = await match('upper');
  // the tooth that is really 12 is now 13, so the right side moves on by one (13→14 …) and something has to give between 13 and 11
  ok(after.pinned.includes('13') && after.nums.indexOf(13) >= 0, `the chosen number sticks (${after.nums.join(' ')}; gaps ${after.gaps.join(', ') || 'none'})`);
  ok(m.n >= 4 && m.per[12] === 1 && m.per[13] === 0, `the automatic taps are placed again for the new numbers: now on the truth's ${tapped(m).join(' ')} (the truth's 13 is now numbered 14, outside the range)`);
  await page.waitForTimeout(300); await shot(OUT + 't4-renumbered.png');

  // ── hypodontia: 12 and 22 missing
  await page.evaluate(() => APP.scans.loadDemo({ missing: { 12: true, 22: true } })); await idle();
  await page.evaluate(() => APP.shell.goto('make')); await page.click('#mkMode [data-v=matrix]'); await page.click('#mkJaw [data-v=upper]');
  await page.evaluate(() => APP.shell.goto('shape')); await page.click('#shSelf'); await page.evaluate(() => APP.shell.goto('teeth')); await idle();
  await page.click('#tClear'); ok(await page.evaluate(() => APP.P.taps.length === 0), 'Start again clears the taps (they are kept when only the scan changes, as before)');
  await page.click('#tAuto'); await idle(); m = await match('upper');
  const st2 = await page.evaluate(() => document.querySelector('#status').textContent); console.log('    status: ' + st2);
  ok(m.n === 4 && JSON.stringify(tapped(m)) === JSON.stringify([11, 13, 21, 23]) && m.stray === 0, `12 and 22 missing: 13 11 21 23 tapped (${tapped(m).join(' ')})`);
  ok(/not found: 12, 22/.test(st2), 'the message names 12 and 22 as not found');
  const gl = await page.evaluate(() => [...document.querySelectorAll('#labels .lbl.tgap')].map((e) => e.textContent)); ok(gl.includes('12') && gl.includes('22'), `the missing numbers show greyed in their gaps (${gl.join(' ')})`);
  await page.waitForTimeout(300); await shot(OUT + 't4-hypodontia.png');

  // ── lower arch, 33–43, and the matrix made from the taps
  await page.evaluate(() => APP.scans.loadDemo({})); await idle();
  await page.evaluate(() => APP.shell.goto('make')); await page.click('#mkMode [data-v=matrix]'); await page.click('#mkJaw [data-v=lower]');
  await page.evaluate(() => APP.shell.goto('shape')); await page.click('#shSelf'); await page.evaluate(() => APP.shell.goto('teeth')); await idle(); await page.click('#tClear');
  ok(await page.evaluate(() => document.getElementById('tFrom').value === '33' && document.getElementById('tTo').value === '43'), 'the range starts at 33 to 43 for the lower arch');
  await page.selectOption('#tFrom', '43'); await page.selectOption('#tTo', '33');   // either way round
  await page.click('#tAuto'); await idle(); m = await match('lower');
  ok(m.n === 6 && JSON.stringify(tapped(m)) === JSON.stringify([31, 32, 33, 41, 42, 43]) && m.stray === 0, `lower 43–33: six taps on the lower front teeth (${tapped(m).join(' ')})`);
  await page.evaluate(() => APP.shell.goto('design')); await page.click('#dBuild'); await idle();
  const mx = await page.evaluate(() => APP.B && APP.B.info);
  ok(mx && mx.closed && mx.holes === 6, `the matrix is made from the automatic taps: closed, ${mx && mx.holes} injection holes, ${mx && mx.volume.toFixed(0)} mm³`);
  await page.waitForTimeout(300); await shot(OUT + 't4-lower-matrix.png');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await close();
})().catch((e) => { console.error(e); process.exit(1); });
