// Browser test 7 (1400×900, mouse): marked teeth in the Margin step.   node f7-teeth.cjs
// Demo scans → lower guard. The Margin step finds and marks the teeth by itself; the margin then stays on them. A tooth is dropped by clicking its
// mark and added again by clicking the tooth (real mouse clicks); Clear goes back to the whole-arch margin and Find the teeth marks them again.
// The appliance is built, the case saved and reopened (the marks come back), and an old case without marks keeps the whole-arch margin.
const { openApp } = require('/home/claude/suite/dev/pw.cjs');
const fs = require('fs');
const O = '/home/claude/suite/dev/out/splint-card/';
let fails = 0; const ok = (c, m) => { console.log(`${c ? '✓' : '✗ FAIL'} ${m}`); if (!c) fails++; };
(async () => {
  const { page, errors, shot, close } = await openApp('splint-card', { width: 1400, height: 900 });
  await page.waitForFunction(() => window.APP, { timeout: 60000 });
  const idle = async () => { await page.waitForTimeout(150); await page.waitForFunction(() => !document.querySelector('#busy.show'), { timeout: 240000 }); await page.waitForTimeout(250); };
  const built = async () => { await idle(); await page.waitForFunction(() => APP.D.res && !APP.D.dirty && !document.querySelector('#busy.show'), { timeout: 240000 }); };
  const info = () => page.evaluate(() => ({ n: (APP.P.teeth || []).length, label: document.getElementById('mgN').textContent, note: document.getElementById('mgInfo').innerText.replace(/\n+/g, ' | '), marks: APP.marks().length, tm: !!APP.tmFor(), lines: APP.D.arch && APP.D.arch.fromTeeth }));
  await page.click('[data-ss=demo]'); await page.waitForFunction(() => APP.scans.upper && APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 60000 });
  await page.evaluate(() => APP.shell.goto('appliance')); await page.click('#apJaw [data-v=lower]'); await page.click('#apType [data-v=guard]'); await page.waitForTimeout(200);
  await page.evaluate(() => APP.shell.goto('margin')); await idle();
  let s = await info(); ok(s.n === 14 && s.marks === 14 && s.tm && s.lines, `Margin step found and marked the teeth by itself: ${s.label}, ${s.marks} marks shown, margin follows them | ${s.note}`);
  ok(await page.evaluate(() => [...document.querySelectorAll('#mgMark,#mgFind,#mgClr')].every((b) => b.title)), 'the three new buttons have tooltips');
  await page.evaluate(() => APP.viewer.setView('top')); await page.waitForTimeout(500); await shot(O + 'f7-marked.png');
  // drop 36 by clicking its mark, then add it back by clicking the tooth
  await page.click('#mgMark'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.getElementById('mgMark').textContent === 'Mark teeth: on' && APP.viewer.tool && APP.viewer.tool.cursor === 'crosshair'), 'Mark teeth: on (crosshair tool)');
  const at = await page.evaluate(() => { const i = APP.P.teeth.findIndex((t) => t.fdi === 36), q = APP.viewer.toScreen(APP.marks()[i].position), r = APP.viewer.dom.getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y, i }; });
  await page.mouse.click(at.x, at.y); await idle();
  s = await info(); ok(s.n === 13 && !(await page.evaluate(() => APP.P.teeth.some((t) => t.fdi === 36))), `clicking the mark on 36 dropped it: ${s.label}`);
  await shot(O + 'f7-36-dropped.png');
  await page.mouse.click(at.x + 3, at.y + 2); await idle();
  s = await info(); ok(s.n === 14 && (await page.evaluate(() => APP.P.teeth.filter((t) => !t.fdi).length)) === 1, `clicking 36 again added it back as a tap: ${s.label}`);
  // deeper margin: still stays on the teeth (the margin lines do not reach the floor of the mouth)
  const setRange = (id, v) => page.evaluate(([id, v]) => { const r = document.getElementById(id); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  await setRange('mgL', 8); await idle();
  const far = await page.evaluate(() => { const tm = APP.tmFor(), A = APP.D.arch, o = {}, mp = { buccal: APP.P.buccal, lingual: APP.P.lingual, adjB: APP.P.adjB, adjL: APP.P.adjL, tm }; let n = 0, all = 0;
    for (const l of APP.K.marginLines(APP.D.hfA, A, mp)) for (const q of l) { all++; const i = Math.round((q[0] - tm.x0) / tm.cell), j = Math.round((q[1] - tm.y0) / tm.cell), k = tm.kind[j * tm.nx + i]; if (k !== 1 && k !== 3) n++; } return { n, all }; });
  ok(far.n === 0 && far.all > 500, `tongue side 8 mm: every margin point (${far.all}) on or beside a marked tooth`);
  await shot(O + 'f7-deep.png'); await setRange('mgL', 4); await idle();
  // Clear → whole arch; Find the teeth → marked again
  await page.click('#mgMark'); await page.click('#mgClr'); await idle();
  s = await info(); ok(s.n === 0 && !s.tm && !s.lines && /whole arch/.test(s.note) && s.label === 'none', `Clear: ${s.note}`);
  await page.click('#mgFind'); await idle();
  s = await info(); ok(s.n === 14 && s.tm, `Find the teeth: ${s.label}`);
  // build
  await page.evaluate(() => APP.shell.goto('check')); await built();
  const rep = await page.evaluate(() => ({ wt: APP.D.res.report.watertight, parts: APP.D.res.report.parts, crumbs: +(APP.D.res.report.crumbVolume || 0).toFixed(2), occ: +APP.D.thick.occ.min.toFixed(2), wall: +APP.D.thick.wall.min.toFixed(2), sum: document.getElementById('ckSummary').innerText.replace(/\n+/g, ' | ') }));
  ok(rep.wt && rep.crumbs < 0.5 && rep.occ > 1.9 && rep.wall > 1.4, `built: ${rep.sum}`);
  await page.click('#ckMap [data-v=plain]'); await page.evaluate(() => APP.viewer.setView('top')); await page.waitForTimeout(500); await shot(O + 'f7-built.png');
  // case round trip
  const before = await page.evaluate(() => ({ teeth: JSON.stringify(APP.P.teeth), jaw: APP.P.teethJaw, nv: APP.D.meshCase.positions.length }));
  await page.evaluate(() => APP.shell.goto('export')); await built();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#exCase')]); await dl.saveAs(O + 'f7-case.zip');
  await page.reload(); await page.waitForFunction(() => window.APP, { timeout: 60000 });
  await page.setInputFiles('input[data-ss=file]', [O + 'f7-case.zip']); await page.waitForFunction(() => APP.scans.lower && APP.D.res && !document.querySelector('#busy.show'), { timeout: 60000 });
  const after = await page.evaluate(() => ({ teeth: JSON.stringify(APP.P.teeth), jaw: APP.P.teethJaw, nv: APP.D.meshCase.positions.length }));
  ok(after.teeth === before.teeth && after.jaw === 'lower' && after.nv === before.nv, `case reopened: the ${JSON.parse(after.teeth).length} marks and the appliance (${after.nv / 3} vertices) came back`);
  await page.evaluate(() => APP.shell.goto('margin')); await idle(); s = await info();
  ok(s.n === 14 && s.marks === 14 && s.tm, `Margin step after reopening: ${s.label}, not found again (the saved marks are used)`);
  // an old case (saved before teeth could be marked) keeps its whole-arch margin
  const old = await page.evaluate(async () => { const c = APP.scans.toCase(); delete c.data.splint.params.teeth; delete c.data.splint.params.teethJaw; const b = await c.toBlob('Splint Card'); const u8 = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); });
  fs.writeFileSync(O + 'f7-oldcase.zip', Buffer.from(old, 'base64'));
  await page.reload(); await page.waitForFunction(() => window.APP, { timeout: 60000 });
  await page.setInputFiles('input[data-ss=file]', [O + 'f7-oldcase.zip']); await page.waitForFunction(() => APP.scans.lower && !document.querySelector('#busy.show'), { timeout: 60000 });
  await page.evaluate(() => APP.shell.goto('margin')); await idle(); s = await info();
  ok(s.n === 0 && !s.tm && /whole arch/.test(s.note), `an old case without marks: ${s.note}`);
  console.log('errors', JSON.stringify(errors)); if (errors.length) fails++;
  console.log(fails ? `${fails} FAILED` : 'all passed'); await close(); process.exit(fails ? 1 : 0);
})();
