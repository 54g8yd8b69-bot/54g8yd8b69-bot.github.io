const { chromium } = require('playwright');
const file = 'file://' + process.argv[2];
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(file);
  ok(await p.locator('#home a.app').count() === 10, 'launcher shows 10 apps');
  const frameFor = async id => { await p.waitForTimeout(1500); return p.frames().find(f => f.parentFrame() && f.name() === '' && f !== p.mainFrame() && f._suiteId === undefined && true) };
  const ids = ['notile','chart','set-app','chrome-card','ortho-card','dentmat','dentalaudit','smile-card','implantref','guide-card'];
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
  await p.evaluate(() => location.hash = ''); await p.waitForTimeout(300);
  ok(await p.isVisible('#home'), 'back to launcher');
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
