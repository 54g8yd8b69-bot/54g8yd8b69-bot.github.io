const { chromium } = require('playwright');
const file = 'file://' + process.argv[2];
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined }); const p = await b.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(file);
  ok(await p.locator('#home a.app').count() === 13, 'launcher shows 13 apps');
  ok(await p.evaluate(() => [...document.querySelectorAll('#bar button[data-id]')].map(x => x.dataset.id).join()) === 'notile,chart,set-app,chrome-card,ortho-card,scan-card,dentmat,dentalaudit,smile-card,trauma-card,letter-card,implantref,guide-card', 'top bar: one button per launcher app (Wax Card and Tray Card open inside Scan Card)');
  const frameFor = async id => { await p.waitForTimeout(1500); return p.frames().find(f => f.parentFrame() && f.name() === '' && f !== p.mainFrame() && f._suiteId === undefined && true) };
  const ids = ['notile','chart','set-app','chrome-card','ortho-card','scan-card','dentmat','dentalaudit','smile-card','wax-card','tray-card','trauma-card','letter-card','implantref','guide-card'];
  for (const id of ids) {
    errs.length = 0;
    await p.evaluate(i => location.hash = i, id);
    await p.waitForTimeout(2500);
    const h = await p.evaluate(i => { const f = [...document.querySelectorAll('#frames iframe')].find(x => !x.hidden); const d = f.contentDocument; return { t: f.title, n: d.body ? d.body.innerText.length : 0, app: f.contentWindow.__SUITE_APP, fonts: d.fonts.size }; }, id);
    ok(h.app === id && h.n > 50, `${id}: loaded (${h.n} chars, ${h.fonts} fonts)`);
    ok(errs.length === 0, `${id}: no errors ${errs.slice(0,3).join(' | ')}`);
  }
  // ImplantRef specifics (open it explicitly: the checks below read the visible frame)
  await p.evaluate(() => location.hash = 'implantref');
  await p.waitForTimeout(1200);
  const ir = p.frames().find(f => f.url() === 'about:srcdoc' && 0) ;
  const irInfo = await p.evaluate(() => { const f=[...document.querySelectorAll('#frames iframe')].find(x=>!x.hidden); const w=f.contentWindow; return { recs: (w.IMPLANTREF_CATALOGUE||w.CATALOGUE||{}).records ? 1:0, scan: !!w.ImplantRefScan, noscan: w.document.documentElement.classList.contains('no-scan'), scanBtn: getComputedStyle(w.document.querySelector('#scanBtn')||w.document.body).display, text: w.document.body.innerText.match(/3,?961/) ? 1 : 0 }; });
  ok(!irInfo.scan && irInfo.noscan && irInfo.scanBtn === 'none', 'implantref: scanner absent and Scan hidden');
  ok(irInfo.text === 1, 'implantref: 3,961 records shown');
  await p.evaluate(() => { const f=[...document.querySelectorAll('#frames iframe')].find(x=>!x.hidden); f.contentWindow.location.hash = '#/evidence'; });
  await p.waitForTimeout(1200);
  const ev = await p.evaluate(() => { const f=[...document.querySelectorAll('#frames iframe')].find(x=>!x.hidden); return f.contentDocument.body.innerText; });
  ok(/Ncm/.test(ev), 'implantref: torque evidence renders');
  // ImplantRef brand pages inside the single file (address changes happen in an embedded frame)
  errs.length = 0;
  const irDo = (fn) => p.evaluate((src) => { const f=[...document.querySelectorAll('#frames iframe')].find(x=>!x.hidden); return (new Function('w','d','return ('+src+')(w,d)'))(f.contentWindow, f.contentDocument); }, fn.toString());
  await irDo((w) => { w.location.hash = '#/dashboard'; }); await p.waitForTimeout(800);
  ok(await irDo((w, d) => d.querySelectorAll('.brand-tile').length) === 5, 'implantref: five brand tiles');
  await irDo((w, d) => d.querySelector('.brand-tile[data-brand-go="astra"]').click()); await p.waitForTimeout(900);
  const br = await irDo((w, d) => [w.location.hash, d.querySelector('.page-head h1').textContent, d.querySelectorAll('.sup-row').length]);
  ok(br[0] === '#/catalogue/b/astra' && br[1] === 'Astra Tech components' && br[2] > 0, 'implantref: brand page opens with its FDA-listed parts (' + br.join(' · ') + ')');
  await irDo((w, d) => d.querySelector('.brand-chips [data-brand=""]').click()); await p.waitForTimeout(700);
  ok(await irDo((w) => w.location.hash) === '#/catalogue' && errs.length === 0, 'implantref: back to all brands, no errors ' + errs.slice(0,2).join(' | '));
  // deep link + set list
  await p.evaluate(() => SUITE.go('/set-app/list.html'));
  await p.waitForTimeout(2000);
  const sl = await p.evaluate(() => { const f=[...document.querySelectorAll('#frames iframe')].find(x=>!x.hidden); return [f.contentWindow.__SUITE_APP, f.contentDocument.body.innerText.length]; });
  ok(sl[0] === 'set-list' && sl[1] > 50, 'set-app list.html route works');
  // DentalAudit lazy libs
  await p.evaluate(() => location.hash = 'dentalaudit');
  await p.waitForTimeout(800);
  const lz = await p.evaluate(async () => { const f=[...document.querySelectorAll('#frames iframe')].find(x=>!x.hidden); const w=f.contentWindow, d=w.document;
    const load = src => new Promise((res, rej) => { const s=d.createElement('script'); s.src=src; s.onload=res; s.onerror=()=>rej(src); d.head.appendChild(s); });
    try { await load('js/vendor/jspdf.umd.min.js'); await load('js/vendor/jspdf.plugin.autotable.min.js'); await load('js/vendor/docx.iife.min.js'); } catch (e) { return 'fail ' + e; }
    return [!!(w.jspdf && w.jspdf.jsPDF), !!(w.docx && w.docx.Document)].join(); });
  ok(lz === 'true,true', 'dentalaudit: export libraries resolve offline (' + lz + ')');
  // Scan Card inside the single file: its tools are frames inside its own frame, filled from this file
  errs.length = 0;
  await p.evaluate(() => location.hash = 'scan-card'); await p.waitForTimeout(1500);
  let hub = null; for (const f of p.frames()) { if (f.parentFrame() !== p.mainFrame()) continue; try { if (await f.evaluate(() => !!(window.APP && window.APP.TOOLS && window.SCANHUB))) { hub = f; break; } } catch (e) {} }
  ok(!!hub, 'scan-card: the hub page is running');
  const settle = () => hub.evaluate(() => APP.H.q), child = async (test) => { for (const f of p.frames()) { if (f.parentFrame() !== hub) continue; try { if (await f.evaluate(test)) return f; } catch (e) {} } return null; };
  await hub.evaluate(() => APP.scans.loadDemo({ res: 0.6 }));
  await hub.waitForFunction(() => APP.scans.has('upper') && APP.scans.has('lower') && !document.querySelector('#busy').classList.contains('show'), null, { timeout: 60000 });
  await hub.click('#tabs [data-tab=model]'); await settle();
  const mo = await child(() => !!(window.APP && window.APP.A && window.__SUITE_APP === 'scan-model'));
  ok(!!mo, 'scan-card: Models opened inside it from this file');
  await mo.waitForFunction(() => APP.A.lower.model && APP.A.upper.model && !APP.A.lower.dirty && !APP.A.upper.dirty, null, { timeout: 240000 });
  ok(await mo.evaluate(() => APP.N.EMBED && APP.A.lower.info.watertight && APP.A.upper.info.watertight && document.fonts.size > 0), 'scan-card: Models built both models from the hub scans (watertight), with the suite fonts');
  await mo.evaluate(() => APP.shell.goto('export'));
  const [dl] = await Promise.all([p.waitForEvent('download'), mo.click('#exStl')]);
  ok(dl.suggestedFilename() === 'models.zip', 'scan-card: Download STL works from inside the file (' + dl.suggestedFilename() + ')');
  for (const [id, app, test] of [['analysis', 'scan-analysis', () => window.__SUITE_APP === 'scan-analysis' && !!window.APP && APP.scans.has('lower')], ['splint', 'scan-splint', () => window.__SUITE_APP === 'scan-splint' && !!window.APP && APP.scans.has('lower')],
      ['tray', 'tray-card', () => window.__SUITE_APP === 'tray-card' && !!window.TC && !!TC.S.scanGeo && !!TC.S.antMesh], ['wax', 'wax-card', () => window.__SUITE_APP === 'wax-card' && !!window.__wax && !!(__wax.S.scans.upper && __wax.S.scans.lower)]]) {
    await hub.click(`#tabs [data-tab=${id}]`); await settle(); let fr = null; for (let i = 0; i < 40 && !fr; i++) { fr = await child(test); if (!fr) await p.waitForTimeout(500); }
    ok(!!fr, `scan-card: ${id} opened inside it and has the scans`);
  }
  for (const [id, test] of [['compare', () => window.__SUITE_APP === 'scan-compare' && !!window.APP && APP.scans.has('lower')], ['prep', () => window.__SUITE_APP === 'scan-prep' && !!window.APP && APP.scans.has('lower')], ['survey', () => window.__SUITE_APP === 'scan-survey' && !!window.APP && APP.scans.has('lower')], ['shell', () => window.__SUITE_APP === 'scan-shell' && !!window.APP && APP.scans.has('lower')], ['articulator', () => window.__SUITE_APP === 'scan-articulator' && !!window.APP && APP.scans.has('lower')], ['obturator', () => window.__SUITE_APP === 'scan-obturator' && !!window.APP && APP.scans.has('upper')], ['cbct', () => window.__SUITE_APP === 'scan-cbct' && !!window.APP && !!APP.loadDemo]]) {
    await hub.click(`#tabs [data-tab=${id}]`); await settle(); let fr = null; for (let i = 0; i < 40 && !fr; i++) { fr = await child(test); if (!fr) await p.waitForTimeout(500); }
    ok(!!fr, `scan-card: ${id} opened inside it and has the scans`);
  }
  { // the CBCT tab's "Outline by: Model" (the choice where the pack is) inside the single file: there is no pack beside it, so it says so, falls back to the rules, and nothing is fetched or started
    const cb = await child(() => window.__SUITE_APP === 'scan-cbct' && !!window.APP && !!APP.MODEL);
    const r = cb ? await cb.evaluate(async () => { await APP.loadDemo(); APP.shell.goto('tooth'); await new Promise((ok) => setTimeout(ok, 400)); return { state: APP.MODEL.state, by: APP.MODEL.by, off: document.querySelector('#dBy [data-v=model]').disabled, worker: !!APP.MODEL.worker, note: document.getElementById('dModel').textContent }; }) : null;
    ok(!!r && r.state === 'none' && r.by === 'rules' && r.off && !r.worker && /cannot be loaded in this copy/.test(r.note), 'scan-card: CBCT’s tooth model says it cannot be loaded in the single file (' + (r ? r.state : 'no CBCT page') + ') and the rules stay in use');
    // its "Intraoral scans" step inside the single file: the demo scan is lined up by itself, and the Scans tab's scan is on offer
    const sc = cb ? await cb.evaluate(async () => { APP.shell.goto('scans'); await APP.ioDemo(); const s = APP.S.io.lower; document.querySelector('#sJaw [data-v=upper]').click(); await new Promise((ok) => setTimeout(ok, 1200)); return { ok: !!(s && s.ok), how: s && s.how, bar: !document.getElementById('cbScans').hidden, hub: !document.getElementById('sHub').hidden }; }) : null;
    ok(!!sc && sc.ok && sc.how === 'auto' && sc.bar && sc.hub, 'scan-card: CBCT’s “Intraoral scans” step lines the demo scan up by itself in the single file and offers the Scans tab’s scan (' + JSON.stringify(sc) + ')');
  }
  await hub.click('#tabs [data-tab=scans]'); await settle();
  ok(await hub.evaluate(() => APP.users().join()) === 'Models,Analysis,Splint,Compare,Prep check,Survey,Shells,Articulator,Obturator,Trays,Wax-up', 'scan-card: all eleven tools that use the scans are working on the one pair of scans (CBCT opens its own files)');
  const [dc] = await Promise.all([p.waitForEvent('download'), hub.click('#topBtns button:nth-child(2)')]);
  ok(/^case-.*\.zip$/.test(dc.suggestedFilename()), 'scan-card: Save case works from inside the file (' + dc.suggestedFilename() + ')');
  await hub.click('#top a.brand'); await p.waitForTimeout(400);
  ok(await p.isVisible('#home'), 'scan-card: its logo returns to the launcher');
  ok(errs.length === 0, 'scan-card: no errors ' + errs.slice(0, 3).join(' | '));
  await p.evaluate(() => location.hash = ''); await p.waitForTimeout(300);
  ok(await p.isVisible('#home'), 'back to launcher');
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
