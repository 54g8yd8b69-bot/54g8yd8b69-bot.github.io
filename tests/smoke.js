// Landing page, manifest and service worker checks. Serve this repo as the site root.
const {page,expect,test,noErrors,run,BASE}=require('./harness');
run({name:'Landing page',fn:async()=>{
  await test('shows all six apps and a sign-out link',async()=>{const pg=await page('/');
    const hrefs=await pg.$$eval('a.app',a=>a.map(x=>x.getAttribute('href')));for(const h of ['/notile/','/notile/chart/','/set-app/','/chrome-card/','/ortho-card/','/dentmat/'])expect(hrefs.includes(h),'missing '+h);
    expect(await pg.locator('a[href="/cdn-cgi/access/logout"]').count(),'sign-out link missing');await noErrors(pg)});
  await test('manifest is valid and icons exist',async()=>{const pg=await page('/');
    const m=await (await pg.request.get(BASE+'/manifest.webmanifest')).json();expect(m.start_url==='/'&&m.icons.length>=2,'bad manifest');
    for(const i of m.icons)expect((await pg.request.get(BASE+i.src)).ok(),'icon missing '+i.src)});
  await test('service worker installs',async()=>{const pg=await page('/');const ok=await pg.evaluate(async()=>{await navigator.serviceWorker.ready;return !!(await navigator.serviceWorker.getRegistration())});expect(ok,'no service worker')});
  await test('DentMat opens with its catalogue and no errors',async()=>{const pg=await page('/dentmat/');
    await pg.waitForFunction(()=>window.DentMat&&DentMat.products.length>0,null,{timeout:15000});
    const n=await pg.evaluate(()=>DentMat.products.length);expect(n>=80,'only '+n+' products');
    expect((await pg.request.get(BASE+'/dentmat/manifest.webmanifest')).ok(),'DentMat manifest missing');await noErrors(pg)});
}});
