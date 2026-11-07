// Landing page, manifest and service worker checks. Serve this repo as the site root.
const {page,expect,test,noErrors,run,BASE}=require('./harness');
run({name:'Landing page',fn:async()=>{
  await test('shows all seven apps and a sign-out link',async()=>{const pg=await page('/');
    const hrefs=await pg.$$eval('a.app',a=>a.map(x=>x.getAttribute('href')));for(const h of ['/notile/','/notile/chart/','/set-app/','/chrome-card/','/ortho-card/','/dentmat/','/dentalaudit/'])expect(hrefs.includes(h),'missing '+h);
    expect(await pg.locator('a[href="/cdn-cgi/access/logout"]').count(),'sign-out link missing');await noErrors(pg)});
  await test('manifest is valid and icons exist',async()=>{const pg=await page('/');
    const m=await (await pg.request.get(BASE+'/manifest.webmanifest')).json();expect(m.start_url==='/'&&m.icons.length>=2,'bad manifest');
    for(const i of m.icons)expect((await pg.request.get(BASE+i.src)).ok(),'icon missing '+i.src)});
  await test('service worker installs',async()=>{const pg=await page('/');const ok=await pg.evaluate(async()=>{await navigator.serviceWorker.ready;return !!(await navigator.serviceWorker.getRegistration())});expect(ok,'no service worker')});
  await test('DentMat opens with its catalogue and no errors',async()=>{const pg=await page('/dentmat/');
    await pg.waitForFunction(()=>window.DentMat&&DentMat.products.length>0,null,{timeout:15000});
    const n=await pg.evaluate(()=>DentMat.products.length);expect(n>=80,'only '+n+' products');
    expect((await pg.request.get(BASE+'/dentmat/manifest.webmanifest')).ok(),'DentMat manifest missing');await noErrors(pg)});
  await test('DentalAudit opens with its dashboard and no errors',async()=>{const pg=await page('/dentalaudit/');
    await pg.waitForFunction(()=>window.DA&&DA.store&&document.querySelectorAll('.metric').length===4,null,{timeout:15000});
    const n=await pg.evaluate(()=>DA.store.getAudits().length);expect(n>=5,'only '+n+' audits');
    expect((await pg.request.get(BASE+'/dentalaudit/manifest.webmanifest')).ok(),'DentalAudit manifest missing');await noErrors(pg)});
  await test('DentalAudit reports, quality improvement and PDF export work under the site CSP',async()=>{const pg=await page('/dentalaudit/');
    await pg.waitForFunction(()=>window.DA&&DA.store,null,{timeout:15000});
    const rid=await pg.evaluate(()=>{const a=DA.store.getAudit('aud_medhx');const r=DA.reportEngine.newReport(a,{});DA.store.createReport(r);return r.id});
    await pg.evaluate(id=>{location.hash='#/reports/'+id},rid);await pg.waitForSelector('#re-paper .doc-figure img',{timeout:15000});
    const pdf=await pg.evaluate(async id=>{const r=await DA.reportExport.buildPdf(DA.store.getReport(id));return r.stats.pages},rid);expect(pdf>=8,'PDF only '+pdf+' pages');
    const docx=await pg.evaluate(async id=>{const r=await DA.reportExport.buildDocx(DA.store.getReport(id));return r.blob.size},rid);expect(docx>10000,'Word file too small');
    await pg.evaluate(()=>{location.hash='#/qi'});await pg.waitForSelector('.qi-kpis',{timeout:10000});
    await pg.evaluate(()=>{location.hash='#/compare/aud_consent_c2'});await pg.waitForSelector('.cmp-table',{timeout:10000});
    await noErrors(pg)});
}});
