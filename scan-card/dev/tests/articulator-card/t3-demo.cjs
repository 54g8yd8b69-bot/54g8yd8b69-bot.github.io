// Articulator Card on its own, through its real controls:
//  • the demo scans: the five points found within 1 mm of the demo's own tooth tips; every movement worked out with the surfaces
//    never crossing and closed as far as they go; every contact named with the right tooth group and side (checked against the
//    demo's per-tooth truth); the guidance verdicts; moving a point by tapping the scan
//  • the step buttons, the movement buttons, the slider, Play, the view switch, the summary, “Download lower arch here”
//  • an STL in place of an arch through “STL…”: a canine-ramp appliance (synthetic, exact) over a scan that touches nothing gives
//    canine guidance at the ramp's 45°; the case file keeps the appliance and the settings and gives the same answer reopened
const { open, ok, OUT, DATA, V, deg } = require('./lib.cjs');
const fs = require('fs');
(async () => {
  const a = await open(), { page } = a;
  await page.click('[data-ss=demo]'); await page.waitForFunction(() => APP.scans.has('upper') && APP.scans.has('lower'), null, { timeout: 120000 }); await a.idle();
  const truth = await page.evaluate(() => APP.scans.demoTruth);
  const tooth = (jaw, fdi) => truth[jaw].teeth.find((t) => t.fdi === fdi);
  await page.click('#bNext'); await a.idle(); await page.click('#bNext'); await a.idle();      // Load → Orient → Mount, by the Next button
  ok(await page.evaluate(() => APP.shell.steps[APP.shell.current].id === 'mount' && !!APP.E), 'Next, Next: on the Mount step with the arches mounted');
  const pt = await page.evaluate(() => Object.fromEntries(Object.entries(APP.E.pt).map(([k, v]) => [k, v.toArray()])));
  const mid = [(tooth('lower', 31).tip[0] + tooth('lower', 41).tip[0]) / 2, (tooth('lower', 31).tip[1] + tooth('lower', 41).tip[1]) / 2, (tooth('lower', 31).tip[2] + tooth('lower', 41).tip[2]) / 2];
  const dist = (p, q) => Math.hypot(...V.sub(p, q)), dI = dist(pt.inc, mid), dC = { lcL: dist(pt.lcL, tooth('lower', 33).tip), lcR: dist(pt.lcR, tooth('lower', 43).tip), ucL: dist(pt.ucL, tooth('upper', 23).tip), ucR: dist(pt.ucR, tooth('upper', 13).tip) };
  ok(dI < 1 && Object.values(dC).every((d) => d < 1), `points found: incisal point ${dI.toFixed(2)} mm from between the lower central incisors’ edges; canine tips ${Object.entries(dC).map(([k, d]) => `${k} ${d.toFixed(2)}`).join(', ')} mm from the demo’s own`);
  const seat = await page.textContent('#mtSeat'); ok(/closed 0\.\d\d mm|just touch/.test(seat), 'Mount says how the bite was seated: ' + seat);
  await a.shot(OUT + 't3-mount.png');
  // move LL3 by tapping the 33 tip on the screen, then put it back
  await page.click('#ptSeg [data-v=lcL]');
  // (aim at a point that is on the surface and faces the camera: the labial face of 33, 1.2 mm below its tip)
  const aim = await page.evaluate((p) => { const h = {}; APP.E.lo.bvh.closestPointToPoint(new APP.THREE.Vector3(p[0] + 0.8, p[1] - 0.6, p[2] - 1.2), h); const s = APP.viewer.toScreen(h.point), r = APP.viewer.dom.getBoundingClientRect(); return { xy: [s.x + r.left, s.y + r.top], at: h.point.toArray() }; }, tooth('lower', 33).tip);
  await page.mouse.click(aim.xy[0], aim.xy[1]); await page.waitForTimeout(200);
  const moved = await page.evaluate(() => APP.P.pts.lcL); ok(moved && dist(moved, aim.at) < 0.3 && dist(moved, pt.lcL) > 0.5, `tapping the scan moved LL3 to where it was tapped (${moved && dist(moved, aim.at).toFixed(2)} mm from the spot aimed at, ${moved && dist(moved, pt.lcL).toFixed(1)} mm from where it was)`);
  await page.click('#ptAuto'); ok(await page.evaluate(() => Object.keys(APP.P.pts).length === 0), '“Find them again” puts the points back');
  await page.click('#bNext'); await a.idle();
  ok(await page.evaluate(() => APP.shell.steps[APP.shell.current].id === 'set'), 'Next: Settings'); await a.shot(OUT + 't3-settings.png');
  await page.click('#bNext'); await a.idle();
  ok(await page.evaluate(() => APP.shell.steps[APP.shell.current].id === 'move' && !!APP.E.res.prot), 'Next: Movements, protrusion worked out');
  // every movement: solid, tight, contacts named right
  const type = (n) => (n <= 2 ? 'incisor' : n === 3 ? 'canine' : n <= 5 ? 'premolar' : 'molar');
  const near = (jaw, p) => { const d = truth[jaw].teeth.map((t) => { const A = t.mesial, B = t.distal, ab = V.sub(B, A), ap = V.sub(p, A), u = Math.max(0, Math.min(1, (ab[0] * ap[0] + ab[1] * ap[1]) / (ab[0] * ab[0] + ab[1] * ab[1]))); return { t, d: Math.hypot(A[0] + u * ab[0] - p[0], A[1] + u * ab[1] - p[1]) }; }).sort((x, y) => x.d - y.d); return { t: d[0].t, sure: d[1].d - d[0].d > 1 }; };
  const verdicts = {};
  for (const id of ['prot', 'right', 'left', 'back', 'open']) {
    await page.click(`#mvSeg [data-v=${id}]`); await a.idle();
    const R = await page.evaluate((id) => { const R = APP.E.res[id]; return { verdict: R.verdict, steps: R.steps.map((s) => ({ p: s.p, min: s.min, free: s.free, contacts: s.contacts.map((c) => ({ side: c.side, upper: c.upper, lower: c.lower, at: c.at, atL: c.atL })) })) }; }, id);
    verdicts[id] = R.verdict; let n = 0, good = 0, bad = [];
    for (const s of R.steps) for (const c of s.contacts) for (const [jaw, p, reg] of [['upper', c.at, c.upper], ['lower', c.atL, c.lower]]) {
      const q = near(jaw, p); if (!q.sure) continue; n++; const sideOk = jaw === 'upper' || Math.abs(p[0]) < 1 || (Math.floor(q.t.fdi / 10) === 3) === (c.side === 'L');   // (the side shown is the lower tooth's)
      if (type(q.t.fdi % 10) === reg && sideOk) good++; else bad.push(`${s.p} ${jaw} ${c.side}${reg}≠${q.t.fdi}`);
    }
    if (id !== 'open') { const sol = await a.solid(id); ok(sol.cross === 0 && sol.notTight === 0, `${id}: ${R.steps.length} positions, surfaces never cross, each closed as far as it goes (${sol.cross} crossing, ${sol.notTight} not tight)`); }
    ok(n > 0 && good / n >= 0.95, `${id}: ${good} of ${n} contact points named with the demo tooth they lie on (tooth group and side)${bad.length ? ' — off: ' + bad.slice(0, 4).join(', ') : ''}`);
  }
  // (what the demo arches do: overbite 1.6 mm, canines overlapping 2.2 mm)
  ok(verdicts.prot.kind === 'anterior' && verdicts.right.kind === 'canine' && /right/.test(verdicts.right.head) && verdicts.left.kind === 'canine' && /left/.test(verdicts.left.head) && !verdicts.right.nonWorking && !verdicts.left.nonWorking,
    `demo verdicts: forward “${verdicts.prot.head}”, right “${verdicts.right.head}”, left “${verdicts.left.head}”`);
  // the place left for recorded jaw motion: a list of lower-jaw matrices plays as one more movement (here: the right movement's own positions)
  const rec = await page.evaluate(async () => {
    const R = APP.E.res.right; APP.setRecorded(R.steps.map((s) => s.pose)); const btn = !!document.querySelector('#mvSeg [data-v=rec]');
    await APP.setMove('rec'); const Q = APP.E.res.rec, key = (s) => s.contacts.map((c) => c.side + c.upper + c.lower).join(',');
    const same = Q.steps.length === R.steps.length && Q.steps.every((s, i) => key(s) === key(R.steps[i]) && Math.abs(s.drop - R.steps[i].drop) < 1e-6);
    APP.setRecorded(null); await APP.setMove('prot'); return { btn, same, n: Q.steps.length, gone: !document.querySelector('#mvSeg [data-v=rec]') };
  }); await a.idle();
  ok(rec.btn && rec.same && rec.gone, `recorded-motion placeholder: ${rec.n} matrices play as a “Recorded” movement with the same contacts and opening as the movement they came from; removed again cleanly`);
  // the slider, Play, the view switch
  await page.click('#mvSeg [data-v=right]'); await a.idle();
  await page.evaluate(() => { const r = document.getElementById('mvP'); r.value = 2.25; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); }); await page.waitForTimeout(250);
  const rd = await page.evaluate(() => ({ p: APP.S.p, drop: document.getElementById('rdDrop').textContent, rows: document.querySelectorAll('#ctTbl tr').length - 1, val: document.getElementById('mvVal').textContent }));
  ok(Math.abs(rd.p - 2.25) < 1e-9 && rd.rows >= 1 && (rd.val === '2.3 mm' || rd.val === '2.2 mm'), `slider to 2.25 mm: opening ${rd.drop}, ${rd.rows} contact row(s), shows ${rd.val}`);
  await page.click('#mvPlay'); await page.waitForTimeout(900); const pl = await page.evaluate(() => ({ playing: APP.S.playing, p: APP.S.p, txt: document.getElementById('mvPlay').textContent }));
  await page.click('#mvPlay'); await a.idle(); const st = await page.evaluate(() => APP.S.playing);
  ok(pl.playing && pl.p > 0 && pl.txt === 'Stop' && !st, `Play moves the jaw (${pl.p.toFixed(2)} mm after 0.9 s, button “${pl.txt}”), Stop stops it (playing afterwards: ${st})`);
  await page.evaluate(() => APP.setPos(3, true)); await page.waitForTimeout(200); await a.shot(OUT + 't3-move-right.png');
  await page.click('#mvView [data-v=lower]'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => !APP.E.up.obj.visible && APP.E.lo.obj.visible && !document.querySelector('[data-art=upper] input').checked), 'View: Lower hides the upper (and its Show box)');
  await a.shot(OUT + 't3-move-right-lower.png');
  await page.click('#mvView [data-v=upper]'); await page.waitForTimeout(300); await a.shot(OUT + 't3-move-right-upper.png');
  await page.click('#mvView [data-v=both]'); await page.waitForTimeout(200);
  // download the lower arch where it is
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#mvStl')]); const f = OUT + 't3-lower.stl'; await dl.saveAs(f);
  const buf = fs.readFileSync(f), nt = buf.readUInt32LE(80), tris = await page.evaluate(() => APP.E.lo.mesh.indices.length / 3);
  const zMoved = (() => { let zmax = -Infinity; for (let k = 0; k < nt; k++) zmax = Math.max(zmax, buf.readFloatLE(84 + 50 * k + 12 + 8), buf.readFloatLE(84 + 50 * k + 24 + 8), buf.readFloatLE(84 + 50 * k + 36 + 8)); return zmax; })();
  ok(buf.length === 84 + 50 * nt && nt === tris && /^lower-right-3\.0mm\.stl$/.test(dl.suggestedFilename()), `“Download lower arch here”: ${dl.suggestedFilename()}, ${nt} triangles, highest point ${zMoved.toFixed(2)} mm (moved down with the jaw)`);
  // the summary
  await page.click('#bNext'); await a.idle();
  const sum = await page.textContent('#rText');
  ok(/Protrusion: Front-tooth guidance/.test(sum) && /Right side movement: Canine guidance on the right/.test(sum) && /Left side movement: Canine guidance on the left/.test(sum) && /101\.6 mm apart/.test(sum), 'Summary text for the notes: ' + sum.split('\n').slice(2, 5).join(' / '));
  ok(await page.evaluate(() => document.querySelectorAll('#rOut table.tbl tr').length === 10), 'Summary: opening table, 0–8 mm in 1 mm steps');
  await page.click('#rCopy'); await page.waitForTimeout(200);
  await a.shot(OUT + 't3-report.png');
  const e1 = a.errors.filter((e) => !/font-src/.test(e)); ok(e1.length === 0, 'no page errors (demo) ' + e1.slice(0, 3).join(' | '));
  await a.close();

  // ── an STL in place of an arch, through the real file input; then the case file
  const T = JSON.parse(fs.readFileSync(DATA + 'art-truth.json')), cn = T.cases.canine, S = T.spheres;
  const b = await open(), p2 = b.page;
  await b.pair('art-free-upper.stl'); await b.setup({}, { inc: T.landmarks.inc, lcR: T.landmarks.lcR, lcL: T.landmarks.lcL, ucR: cn.ucR, ucL: cn.ucL }); await b.goto('mount');
  const [fc] = await Promise.all([p2.waitForEvent('filechooser'), p2.click('[data-src=upper] [data-v=file]')]); await fc.setFiles(DATA + 'art-canine-upper.stl'); await b.idle();
  const m1 = await p2.evaluate(() => ({ src: APP.P.src.upper, keep: APP.P.keep.upper, info: document.querySelector('[data-info=upper]').textContent, keepShown: !document.querySelector('[data-keep=upper]').hidden, n: APP.E.up.n, nScan: APP.E.up.nScan }));
  ok(m1.src === 'file' && m1.keep && m1.keepShown && m1.n > m1.nScan && /art-canine-upper\.stl/.test(m1.info), `“STL…” on the upper: the file stands in, on the scan (${m1.info})`);
  const R1 = await b.run('right'), s1 = R1.steps.find((s) => s.p === 1), s4 = R1.steps.find((s) => s.p === 4), c1 = V.apply(s1.pose, S.CR), c4 = V.apply(s4.pose, S.CR), ang = deg(Math.atan2(c1[2] - c4[2], c1[0] - c4[0]));
  ok(R1.verdict.kind === 'canine' && Math.abs(ang - cn.beta) < 0.3 && R1.steps.filter((s) => s.p >= 0.5 && s.p <= 4).every((s) => s.contacts.every((c) => c.ap)), `…the appliance’s 45° canine ramp guides: “${R1.verdict.head}”, the canine slides at ${ang.toFixed(2)}°, every contact on the appliance`);
  await p2.evaluate(() => { APP.P.sci = [40, 40]; APP.P.ben = [10, 10]; APP.P.iss = [0.5, 0.5]; APP.changed(); });
  const R2 = await b.run('right');
  const blob = await p2.evaluate(async () => { const c = APP.scans.toCase(), it = c.get('articulator-part'); const bl = await c.toBlob('t'); return { bytes: Array.from(new Uint8Array(await bl.arrayBuffer())), role: !!it, jaw: it && it.meta.jaw, same: it && it.matrix.equals(APP.scans.upper.matrix), data: c.data.articulator }; });
  ok(blob.role && blob.jaw === 'upper' && blob.same && blob.data.src.upper === 'file' && blob.data.sci[0] === 40, 'the case holds the STL (role articulator-part, upper, with the scan’s matrix) and the settings');
  await p2.evaluate(async (bytes) => { APP.scans.useCase(await APP.N.DentalCase.fromBlob(new Blob([new Uint8Array(bytes)]))); }, blob.bytes); await b.idle();
  await b.goto('mount');
  const back = await p2.evaluate(() => ({ src: APP.P.src.upper, sci: APP.P.sci[0], ben: APP.P.ben[0], iss: APP.P.iss[0], A: !!APP.A.upper, pts: Object.keys(APP.P.pts).length }));
  const R3 = await b.run('right'), same = R3.steps.every((s, i) => Math.abs(s.theta - R2.steps[i].theta) < 1e-9);
  ok(back.src === 'file' && back.A && back.sci === 40 && back.ben === 10 && back.iss === 0.5 && back.pts === 5 && same, `reopened: the STL, the settings and the moved points are back, and the right movement comes out the same (${R3.verdict.head})`);
  await b.goto('move'); await p2.evaluate(async () => { await APP.setMove('right'); APP.setPos(3, true); }); await p2.waitForTimeout(300); await b.shot(OUT + 't3-stl-appliance.png');
  // a case holding a wax-up from Shells (role shell-shape, matrix mode): offered as “Wax-up”, replacing the scan by default
  await p2.evaluate(async () => {
    const c = APP.scans.toCase(); c.remove('articulator-part'); delete c.data.articulator;
    const m = APP.N.parseMesh(await (await fetch('/dev/data/art-canine-upper.stl')).arrayBuffer(), 'stl', 'w'), T = new APP.THREE.Matrix4().makeTranslation(3, -2, 1);   // stored in its own coordinates, placed by its matrix
    c.add({ role: 'shell-shape', name: 'waxup', mesh: APP.N.transformMesh(m, T.clone().invert()), matrix: T, meta: { jaw: 'upper' } }); c.data.shell = { mode: 'matrix' };
    APP.scans.useCase(await APP.N.DentalCase.fromBlob(await c.toBlob('t')));
  }); await b.idle(); await b.setup({}, { inc: T.landmarks.inc, lcR: T.landmarks.lcR, lcL: T.landmarks.lcL, ucR: cn.ucR, ucL: cn.ucL }); await b.goto('mount');
  const wx = await p2.evaluate(() => ({ btn: document.querySelector('[data-src=upper] [data-v=shell]'), offer: document.getElementById('mtOffer').textContent })).then(async (o) => ({ ...o, label: await p2.textContent('[data-src=upper] [data-v=shell]'), shown: await p2.isVisible('[data-src=upper] [data-v=shell]') }));
  ok(wx.shown && wx.label === 'Wax-up' && /the wax-up from the Shells tab \(upper arch\)/.test(wx.offer), `a wax-up from Shells in the case is offered: button “${wx.label}”, “${wx.offer.trim()}”`);
  await p2.click('#mtOffer [data-offer]'); await b.idle();
  const w2 = await p2.evaluate(() => ({ src: APP.P.src.upper, keep: APP.P.keep.upper, nScan: APP.E.up.nScan }));
  const RW = await b.run('right');
  ok(w2.src === 'shell' && !w2.keep && w2.nScan === 0 && RW.verdict.kind === 'canine' && RW.steps.filter((s) => s.p >= 0.5 && s.p <= 4).every((s) => s.contacts.every((c) => c.ap)), `“Use the wax-up”: it replaces the upper scan (keep: ${w2.keep}) and its ramps guide — “${RW.verdict.head}”`);
  const e2 = b.errors.filter((e) => !/font-src/.test(e)); ok(e2.length === 0, 'no page errors (STL) ' + e2.slice(0, 3).join(' | '));
  await b.close();
})();
