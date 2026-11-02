// Landing page, manifest and service worker checks. Serve this repo as the site root.
const {page,expect,test,noErrors,run,BASE}=require('./harness');
run({name:'Landing page',fn:async()=>{
  await test('shows all five apps and a sign-out link',async()=>{const pg=await page('/');
    const hrefs=await pg.$$eval('a.app',a=>a.map(x=>x.getAttribute('href')));for(const h of ['/notile/','/notile/chart/','/set-app/','/chrome-card/','/ortho-card/'])expect(hrefs.includes(h),'missing '+h);
    expect(await pg.locator('a[href="/cdn-cgi/access/logout"]').count(),'sign-out link missing');await noErrors(pg)});
  await test('manifest is valid and icons exist',async()=>{const pg=await page('/');
    const m=await (await pg.request.get(BASE+'/manifest.webmanifest')).json();expect(m.start_url==='/'&&m.icons.length>=2,'bad manifest');
    for(const i of m.icons)expect((await pg.request.get(BASE+i.src)).ok(),'icon missing '+i.src)});
  await test('service worker installs',async()=>{const pg=await page('/');const ok=await pg.evaluate(async()=>{await navigator.serviceWorker.ready;return !!(await navigator.serviceWorker.getRegistration())});expect(ok,'no service worker')});
}});
