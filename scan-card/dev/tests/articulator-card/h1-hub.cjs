// Articulator inside Scan Card:
//  • the tab exists, opens on Mount with the hub's demo scans, and gives the same answers as on its own
//  • a flat upper splint with canine and front ramps, built on the Splint tab, is offered on the Articulator tab and put in place:
//    the bite opens by about the splint's own opening; the side movements are canine-guided by the splint's ramps (every contact
//    on the splint), protrusion by its front ramp; the surfaces never cross
//  • the case keeps the articulator's settings (with the splint chosen), and a fresh Scan Card opened on that case is back on the splint
//  • the tools working on the models with base (with Models' bite hinge): the articulator mounts the models, leaves the hinge posts
//    out and gives the same answers as on the scans (ART_QUICK=1 skips this part)
const { openHub, ok } = require('../hub/lib.cjs');
const OUT = '/home/claude/suite/dev/out/articulator-card/';
const fs = require('fs'); fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const a = await openHub(), { page } = a;
  await a.demo();
  ok(await page.evaluate(() => APP.TOOLS.some((t) => t.id === 'articulator' && t.url === 'articulator.html') && !!document.querySelector('#tabs [data-tab=articulator]')), 'Scan Card has an Articulator tab');
  const idleOf = (h) => async (fr) => { await h.idle(fr); await fr.evaluate(() => APP.entering); await h.idle(fr); }, idle = idleOf(a);
  let ar = await a.go('articulator'); await idle(ar);
  const m = await ar.evaluate(() => ({ step: APP.shell.steps[APP.shell.current].id, E: !!APP.E, up: APP.E && APP.E.up.n, embed: APP.N.EMBED, load: APP.shell.stepEl('load').hidden }));
  ok(m.step === 'mount' && m.E && m.embed && m.load, `the tab opens on Mount with the hub’s scans mounted (load and orient steps hidden)`);
  await page.waitForTimeout(300); await a.shot(OUT + 'h1-mount.png');
  await ar.evaluate(() => APP.shell.goto('report')); await idle(ar);
  const v0 = await ar.evaluate(() => ({ prot: APP.E.res.prot.verdict.kind, right: APP.E.res.right.verdict.head, left: APP.E.res.left.verdict.head }));
  ok(v0.prot === 'anterior' && v0.right === 'Canine guidance on the right' && v0.left === 'Canine guidance on the left', `same answers as on its own: ${JSON.stringify(v0)}`);
  ok(await ar.evaluate(() => !document.querySelector('[data-src=upper] [data-v=splint]').offsetParent && !document.getElementById('mtOffer').textContent), 'no splint offered yet');
  // ── a guided upper splint on the Splint tab
  const sp = await a.go('splint');
  await sp.evaluate(() => APP.shell.goto('appliance')); await sp.click('#apJaw [data-v=upper]'); await sp.click('#apType [data-v=flat]');
  await sp.evaluate(() => APP.shell.goto('shell')); await a.idle(sp); await sp.check('#shUse'); await a.idle(sp); await sp.click('#shAuto'); await a.idle(sp);
  await sp.check('#gdOn'); await a.idle(sp); await sp.waitForFunction(() => APP.D.res && !APP.D.dirty, null, { timeout: 300000 });
  const sres = await sp.evaluate(() => ({ ramps: APP.D.res.report.ramps, open: APP.P.open, mode: APP.P.openMode, tris: APP.D.meshCase.indices.length / 3 }));
  ok(sres.ramps && sres.ramps.length === 3, `Splint: upper flat splint with ${sres.ramps.join(', ')} ramps, bite opened ${sres.open} mm (${sres.mode}), ${sres.tris} triangles`);
  ar = await a.go('articulator'); await idle(ar);
  const off = await ar.evaluate(() => ({ step: APP.shell.steps[APP.shell.current].id, ca: APP.CA.splint && { jaw: APP.CA.splint.jaw, tris: APP.CA.splint.mesh.indices.length / 3 }, offer: document.getElementById('mtOffer').textContent, btn: !document.querySelector('[data-src=upper] [data-v=splint]').hidden }));
  ok(off.ca && off.ca.jaw === 'upper' && off.ca.tris === sres.tris && off.btn && /splint from the Splint tab \(upper arch\)/.test(off.offer), `back on the Articulator tab (on ${off.step}) the splint is offered: “${off.offer.trim()}”`);
  await ar.evaluate(() => APP.shell.goto('move')); await idle(ar);
  ok(await ar.isVisible('#mvOffer [data-offer]'), '…on the Movements step too');
  await ar.evaluate(() => APP.shell.goto('mount')); await idle(ar);
  await page.waitForTimeout(200); await a.shot(OUT + 'h1-offer.png');
  await ar.click('#mtOffer [data-offer]'); await idle(ar);
  const on = await ar.evaluate(() => ({ src: APP.P.src.upper, keep: APP.P.keep.upper, n: APP.E.up.n, nScan: APP.E.up.nScan, seat: APP.E.F.rInc * APP.E.th0, note: document.getElementById('mtSeat').textContent, info: document.querySelector('[data-info=upper]').textContent }));
  ok(on.src === 'splint' && on.keep && on.n > on.nScan, `“Use the splint”: the splint stands for the upper arch, on the scan (${on.info})`);
  ok(Math.abs(on.seat - sres.open) < 0.35, `the bite opens ${on.seat.toFixed(2)} mm at the incisal point to seat the lower on the splint (Splint opened it ${sres.open} mm): ${on.note}`);
  await page.waitForTimeout(200); await a.shot(OUT + 'h1-splint-mounted.png');
  await ar.evaluate(() => APP.shell.goto('move')); await idle(ar);
  const res = {};
  for (const id of ['right', 'left', 'prot']) {
    await ar.evaluate(async (id) => { await APP.setMove(id); }, id); await idle(ar);
    res[id] = await ar.evaluate((id) => { const R = APP.E.res[id], w = R.steps.filter((s) => s.p >= 1 && s.p <= 4); return { kind: R.verdict.kind, head: R.verdict.head, notes: R.verdict.notes.join(' '), nw: R.verdict.nonWorking, allAp: w.every((s) => s.contacts.length && s.contacts.every((c) => c.ap)), regions: [...new Set(w.flatMap((s) => s.contacts.map((c) => c.side + ' ' + c.upper)))].join(', '), drop3: R.verdict.drop3 }; }, id);
    const sol = await ar.evaluate((id) => { const E = APP.E, R = E.res[id], M = new APP.THREE.Matrix4(); let cross = 0, loose = 0; for (const s of R.steps) { if (s.free) continue; M.fromArray(s.pose); if (E.up.bvh.intersectsGeometry(E.lo.geo, M)) cross++; const C = APP.K.condyles(E.F, APP.P, id, s.p); if (s.by === 'teeth' && !E.up.bvh.intersectsGeometry(E.lo.geo, APP.K.pose(E.F, C, s.theta - 0.01 / E.F.rInc))) loose++; } return { cross, loose }; }, id);
    ok(sol.cross === 0 && sol.loose === 0, `${id} on the splint: surfaces never cross and every position is closed as far as it goes`);
  }
  ok(res.right.kind === 'canine' && /right/.test(res.right.head) && res.right.allAp && !res.right.nw, `right movement on the splint: “${res.right.head}” — contacts ${res.right.regions}, all on the splint`);
  ok(res.left.kind === 'canine' && /left/.test(res.left.head) && res.left.allAp && !res.left.nw, `left movement on the splint: “${res.left.head}” — contacts ${res.left.regions}, all on the splint`);
  ok(res.prot.kind === 'anterior' && res.prot.allAp, `protrusion on the splint: “${res.prot.head}” — contacts ${res.prot.regions}, all on the splint`);
  await ar.evaluate(async () => { await APP.setMove('right'); APP.setPos(3, true); APP.setView('lower'); }); await page.waitForTimeout(400); await a.shot(OUT + 'h1-splint-right-lower.png');
  await ar.evaluate(() => APP.setView('upper')); await page.waitForTimeout(400); await a.shot(OUT + 'h1-splint-right-upper.png');
  await ar.evaluate(() => APP.setView('both')); await page.waitForTimeout(400); await a.shot(OUT + 'h1-splint-right.png');
  // ── the case
  await a.go('scans');
  const c = await page.evaluate(() => { const c = APP.buildCase(); return { roles: c.items.map((i) => i.role).sort().join(), art: c.data.articulator && c.data.articulator.src.upper, users: APP.users().join() }; });
  ok(c.art === 'splint' && /Articulator/.test(c.users) && /splint/.test(c.roles), `the case keeps the articulator’s settings (upper: ${c.art}); tools holding work: ${c.users}`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#topBtns button:nth-child(2)')]); const zip = OUT + 'h1-case.zip'; await dl.saveAs(zip);
  const e1 = a.errors.filter((e) => !/font-src/.test(e)); ok(e1.length === 0, 'no page errors ' + e1.slice(0, 3).join(' | '));
  await a.close();
  const b = await openHub(), p2 = b.page;
  await p2.setInputFiles('input[data-ss=file]', zip); await p2.waitForFunction(() => APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 120000 });
  const idleB = idleOf(b), ar2 = await b.go('articulator'); await idleB(ar2);
  const re = await ar2.evaluate(() => ({ src: APP.P.src.upper, ca: !!APP.CA.splint, n: APP.E && APP.E.up.n, nScan: APP.E && APP.E.up.nScan }));
  ok(re.src === 'splint' && re.ca && re.n > re.nScan, 'a fresh Scan Card on that case: the Articulator tab is back on the splint');
  const e2 = b.errors.filter((e) => !/font-src/.test(e)); ok(e2.length === 0, 'no page errors (reopened) ' + e2.slice(0, 3).join(' | '));
  if (!process.env.ART_QUICK) {
    // models with base, with Models' bite hinge (ball-and-socket posts behind the arches): the posts are left out, the answers are the scans'
    const mo = await b.go('model'); await mo.waitForFunction(() => APP.A.lower.model && !APP.A.lower.dirty && APP.A.upper.model && !APP.A.upper.dirty, null, { timeout: 600000 });
    await mo.evaluate(async () => { APP.P.hinge = true; await APP.rebuild(); }); await b.idle(mo);
    await mo.waitForFunction(() => APP.A.lower.model && !APP.A.lower.dirty && APP.A.upper.model && !APP.A.upper.dirty && APP.hingeSpec, null, { timeout: 600000 });
    const hs = await mo.evaluate(() => APP.hingeSpec);
    await b.go('scans'); await p2.evaluate(() => APP.setSource('model')); await b.settle();
    const ar3 = await b.go('articulator'); await idleB(ar3);
    const mm = await ar3.evaluate(() => ({ raw: APP.scans.lower.raw.indices.length, e: !!APP.E, maxY: Math.max(APP.E.up.box.max.y, APP.E.lo.box.max.y), note: document.getElementById('mtWarn').textContent, src: APP.P.src.upper }));
    const mt = await p2.evaluate(() => APP.modelItem('lower').mesh.indices.length);
    ok(mm.e && mm.raw === mt, `with “Models with base” the articulator mounts the models (${mt / 3} triangles on the lower)`);
    ok(mm.maxY < hs.y - hs.r && /bite-hinge posts/.test(mm.note), `the bite-hinge posts (at ${hs.y.toFixed(1)} mm back, radius ${hs.r}) are left out: nothing mounted beyond ${mm.maxY.toFixed(1)} mm — “${mm.note.match(/The bite-hinge[^.]*\./)}”`);
    await ar3.evaluate(() => APP.shell.goto('report')); await idleB(ar3);
    const vm = await ar3.evaluate(() => ({ prot: APP.E.res.prot.verdict.kind, right: APP.E.res.right.verdict.head, left: APP.E.res.left.verdict.head, back: Math.max(...['prot', 'right', 'left'].flatMap((id) => APP.E.res[id].steps.flatMap((s) => s.contacts.map((c) => c.at[1])))) }));
    ok(vm.prot === 'anterior' && vm.right === 'Canine guidance on the right' && vm.left === 'Canine guidance on the left' && vm.back < hs.y - 5, `…and gives the scans’ answers on the models: ${JSON.stringify({ prot: vm.prot, right: vm.right, left: vm.left })}; furthest-back contact ${vm.back.toFixed(1)} mm`);
    await ar3.evaluate(() => APP.shell.goto('mount')); await idleB(ar3); await p2.waitForTimeout(300); await b.shot(OUT + 'h1-models-hinge.png');
    const e3 = b.errors.filter((e) => !/font-src/.test(e)); ok(e3.length === 0, 'no page errors (models) ' + e3.slice(0, 3).join(' | '));
  }
  await b.close();
})();
