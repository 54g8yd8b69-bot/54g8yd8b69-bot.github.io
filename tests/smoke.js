// Landing page, manifest and service worker checks. Serve this repo as the site root.
const {page,expect,test,noErrors,run,BASE}=require('./harness');
// Makes JPEG photos in the page with an EXIF capture time; slates carry a Photo Card QR.
const MAKE_JPEGS=async ({shots,slateFor})=>{
  const exif=(dt)=>{const b=new Uint8Array(64),v=new DataView(b.buffer);b.set([0x49,0x49,0x2A,0,8,0,0,0]);
    v.setUint16(8,1,true);v.setUint16(10,0x8769,true);v.setUint16(12,4,true);v.setUint32(14,1,true);v.setUint32(18,26,true);v.setUint32(22,0,true);
    v.setUint16(26,1,true);v.setUint16(28,0x9003,true);v.setUint16(30,2,true);v.setUint32(32,20,true);v.setUint32(36,44,true);v.setUint32(40,0,true);
    for(let i=0;i<19;i++)b[44+i]=dt.charCodeAt(i);
    const seg=new Uint8Array(4+6+64);seg.set([0xFF,0xE1,0,72,0x45,0x78,0x69,0x66,0,0]);seg.set(b,10);return seg};
  const out=[];
  for(const s of shots){const c=document.createElement('canvas');c.width=1200;c.height=800;const x=c.getContext('2d');
    if(s.slate){x.fillStyle='#ddd';x.fillRect(0,0,1200,800);const q=document.createElement('canvas');photoCard.drawQR(q,photoCard.slateUrl(slateFor[s.slate],s.stage),6);x.drawImage(q,(1200-q.width)/2,(800-q.height)/2)}
    else{x.fillStyle=s.col||'#c88';x.fillRect(0,0,1200,800);x.fillStyle='#fff';x.font='120px sans-serif';x.fillText(s.name,100,400)}
    const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.9)),u8=new Uint8Array(await blob.arrayBuffer()),seg=exif(s.dt);
    const j=new Uint8Array(u8.length+seg.length);j.set(u8.subarray(0,2));j.set(seg,2);j.set(u8.subarray(2),2+seg.length);
    let bin='';for(let i=0;i<j.length;i++)bin+=String.fromCharCode(j[i]);out.push({name:s.name+'.JPG',b64:btoa(bin)})}
  return out};
run({name:'Landing page',fn:async()=>{
  await test('shows all fifteen apps and a sign-out link',async()=>{const pg=await page('/');
    const hrefs=await pg.$$eval('a.app',a=>a.map(x=>x.getAttribute('href')));for(const h of ['/notile/','/dictate/','/snip-card/','/notile/chart/','/letter-card/','/trauma-card/','/set-app/','/chrome-card/','/ortho-card/','/scan-card/','/dentmat/','/dentalaudit/','/smile-card/','/implantref/','/guide-card/'])expect(hrefs.includes(h),'missing '+h);
    expect(hrefs.length===15&&!hrefs.includes('/wax-card/')&&!hrefs.includes('/tray-card/'),'Wax Card and Tray Card are opened from inside Scan Card now, not from tiles of their own');
    expect(await pg.locator('a[href="/cdn-cgi/access/logout"]').count(),'sign-out link missing');await noErrors(pg)});
  await test('manifest is valid and icons exist',async()=>{const pg=await page('/');
    const m=await (await pg.request.get(BASE+'/manifest.webmanifest')).json();expect(m.start_url==='/'&&m.icons.length>=2,'bad manifest');
    for(const i of m.icons)expect((await pg.request.get(BASE+i.src)).ok(),'icon missing '+i.src)});
  await test('service worker installs',async()=>{const pg=await page('/');const ok=await pg.evaluate(async()=>{await navigator.serviceWorker.ready;return !!(await navigator.serviceWorker.getRegistration())});expect(ok,'no service worker')});
  await test('Dictate opens under the site CSP, cleans up text, and loads the speech engine when Notile is served',async()=>{const pg=await page('/dictate/');
    expect((await pg.request.get(BASE+'/dictate/manifest.webmanifest')).ok(),'Dictate manifest missing');
    const c=await pg.evaluate(()=>dictateClean('Pain from the upper left six full stop new line G.I.C. placed'));expect(c==='Pain from the UL6.\nGIC placed','clean-up: '+JSON.stringify(c));
    const engine=(await pg.request.get(BASE+'/notile/dictate-worker.js')).ok();
    if(engine){await pg.waitForFunction(()=>/Ready/.test(document.getElementById('status').textContent),null,{timeout:120000});expect(!(await pg.isDisabled('#mic')),'mic disabled');
      await pg.selectOption('#mode','fast');await pg.waitForFunction(()=>/Ready/.test(document.getElementById('status').textContent),null,{timeout:120000});expect(await pg.evaluate(()=>localStorage.getItem('dictate.model'))==='"fast"','Fast mode not saved')}
    else{await pg.waitForFunction(()=>/not available/.test(document.getElementById('status').textContent),null,{timeout:15000})}
    await noErrors(pg)});
  await test('Snip Card opens under the site CSP, joins wrapped lines, and reads text from an image on the device',async()=>{const pg=await page('/snip-card/');
    expect((await pg.request.get(BASE+'/snip-card/manifest.webmanifest')).ok(),'Snip Card manifest missing');
    const j=await pg.evaluate(()=>snipCard.tidy('Pain from the up-\nper left six  \nsince Monday.\n\n\n\n- item one\n- item two',false));
    expect(j==='Pain from the upper left six since Monday.\n\n- item one\n- item two','tidy: '+JSON.stringify(j));
    await pg.evaluate(async()=>{const c=document.createElement('canvas');c.width=900;c.height=260;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,900,260);x.fillStyle='#111';x.font='26px Arial, sans-serif';
      x.fillText('Review in three months',40,90);x.fillText('Tooth 26 crown fitted',40,180);const b=await new Promise(r=>c.toBlob(r,'image/png'));await snipCard.load(b,'Test image')});
    expect(await pg.isVisible('#stagecard'),'image not shown');
    const all=await pg.evaluate(()=>snipCard.readAll());expect(/Review in three months/.test(all)&&/Tooth 26 crown fitted/.test(all),'whole image misread: '+JSON.stringify(all));
    expect((await pg.inputValue('#out'))===all,'text box not filled');
    const box=await pg.locator('#view').boundingBox(),k=box.width/900;await pg.mouse.move(box.x+20*k,box.y+130*k);await pg.mouse.down();await pg.mouse.move(box.x+700*k,box.y+215*k,{steps:6});await pg.mouse.up();
    await pg.waitForFunction(()=>/crown/.test(document.getElementById('out').value)&&!/Review/.test(document.getElementById('out').value),null,{timeout:60000});
    expect(/Tooth 26 crown fitted/.test(await pg.inputValue('#out')),'dragged area misread: '+await pg.inputValue('#out'));await noErrors(pg)});
  // Snip Card: a picture of some lines of text, and a helper that puts one on the clipboard (as a snipping tool would)
  const SNIP_PNG=`window._png=async lines=>{const c=document.createElement('canvas');c.width=640;c.height=60+lines.length*70;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.fillStyle='#111';x.font='28px Arial, sans-serif';lines.forEach((l,i)=>x.fillText(l,30,70+i*70));return new Promise(r=>c.toBlob(r,'image/png'))};
    window._clip=async lines=>navigator.clipboard.write([new ClipboardItem({'image/png':await _png(lines)})]);`;
  const outHas=(pg,re)=>pg.waitForFunction(s=>new RegExp(s).test(document.getElementById('out').value),re,{timeout:60000});
  await test('Snip Card reads a pasted snip whole straight away and copies the text, with no dragging',async()=>{const pg=await page('/snip-card/',{permissions:['clipboard-read','clipboard-write']});await pg.evaluate(SNIP_PNG);
    await pg.evaluate(async()=>{const dt=new DataTransfer();dt.items.add(new File([await _png(['Review in three months'])],'snip.png',{type:'image/png'}));
      document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))});
    await outHas(pg,'Review in three months');
    expect(await pg.evaluate(()=>navigator.clipboard.readText())===await pg.inputValue('#out'),'text not copied');
    expect(await pg.evaluate(()=>document.getElementById('stagecard').classList.contains('snip')),'snip not shown as a snip');
    expect(/^Copied 4 words/.test(await pg.textContent('#status')),'status: '+await pg.textContent('#status'));await noErrors(pg)});
  await test('Snip Card auto-read: once turned on, coming back to the page reads a new snip from the clipboard, and never the same one twice',async()=>{const pg=await page('/snip-card/',{permissions:['clipboard-read','clipboard-write']});await pg.evaluate(SNIP_PNG);
    expect(await pg.isVisible('#auto-off')&&!(await pg.isVisible('#auto-on')),'auto-read offer not shown');
    await pg.click('#arOn');await pg.waitForSelector('#auto-on:not([hidden])');expect(await pg.evaluate(()=>localStorage.getItem('snip.autoread'))==='true','choice not remembered');
    expect(/come back to this page/.test(await pg.textContent('#howto')),'how-to not updated');
    await pg.evaluate(()=>_clip(['Tooth 26 crown fitted']));await pg.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await outHas(pg,'Tooth 26 crown fitted');expect(await pg.evaluate(()=>navigator.clipboard.readText())===await pg.inputValue('#out'),'auto-read text not copied');
    // with copying off the snip stays on the clipboard: it is read once only
    await pg.uncheck('#autocopy');await pg.evaluate(()=>_clip(['Floss once a day']));await pg.evaluate(()=>window.dispatchEvent(new Event('focus')));await outHas(pg,'Floss once a day');
    const reads=(await pg.evaluate(()=>snipCard.autoRead.state())).reads;await pg.click('#clear');
    await pg.evaluate(()=>window.dispatchEvent(new Event('focus')));await pg.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await pg.waitForTimeout(900);
    expect(await pg.inputValue('#out')===''&&(await pg.evaluate(()=>snipCard.autoRead.state())).reads===reads,'the same snip was read twice');
    expect(await pg.evaluate(()=>snipCard.autoRead.check())==='seen','same snip not recognised');
    // a new snip is read when the page becomes visible again
    await pg.evaluate(()=>_clip(['Recall in six months']));await pg.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await outHas(pg,'Recall in six months');
    // text copied from a document (a picture plus its text) is left alone
    await pg.evaluate(async()=>navigator.clipboard.write([new ClipboardItem({'image/png':await _png(['From a letter']),'text/plain':new Blob(['From a letter'],{type:'text/plain'})})]));
    expect(await pg.evaluate(()=>snipCard.autoRead.check())==='none','copied document text was read as a snip');
    await pg.click('#arOff');expect(await pg.isVisible('#auto-off')&&!(await pg.evaluate(()=>snipCard.autoRead.state())).live,'auto-read did not turn off');await noErrors(pg)});
  await test('Snip Card mini window reads a snip, and a kept screen share gives fresh pictures until Stop sharing',async()=>{const pg=await page('/snip-card/',{permissions:['clipboard-read','clipboard-write']});await pg.evaluate(SNIP_PNG);
    expect(await pg.isVisible('#pop'),'Pop out missing in Chromium');
    const [mini]=await Promise.all([pg.context().waitForEvent('page'),pg.click('#pop')]);await mini.waitForSelector('#mread');
    await pg.evaluate(()=>_clip(['Mini window works']));await mini.click('#mread');await outHas(pg,'Mini window works');
    await mini.waitForFunction(()=>/Mini window works/.test(document.getElementById('mtext').textContent));
    expect(await pg.evaluate(()=>navigator.clipboard.readText())===await pg.inputValue('#out'),'mini window text not copied');
    await pg.click('#pop');await pg.waitForFunction(()=>/Pop out/.test(document.getElementById('pop').textContent));
    await pg.check('#keepshare');await pg.click('#cap');await pg.waitForSelector('#sharebar:not([hidden])',{timeout:10000});
    expect(await pg.evaluate(()=>snipCard.sharing())&&!(await pg.isVisible('#cap')),'share not kept');
    const before=await pg.evaluate(()=>document.getElementById('view').toDataURL());await pg.waitForTimeout(300);
    await pg.keyboard.press('Alt+s');await pg.waitForFunction(b=>document.getElementById('view').toDataURL()!==b,before,{timeout:5000});
    await pg.click('#stopshare');expect(!(await pg.evaluate(()=>snipCard.sharing()))&&!(await pg.isVisible('#sharebar'))&&await pg.isVisible('#cap'),'sharing did not stop');
    await pg.uncheck('#keepshare');await pg.click('#cap');await pg.waitForTimeout(1000);expect(!(await pg.evaluate(()=>snipCard.sharing())),'one-off capture kept sharing');await noErrors(pg)});
  await test('Task Card keeps letters tied to the clinic rota and a misc list on this device only, and its tile shows only where it has been used',async()=>{
    const lp=await page('/');expect(!(await lp.$$eval('a.app',a=>a.map(x=>x.getAttribute('href')))).includes('/task-card/'),'Task Card tile should not show on a device that has not used it');
    const pg=await lp.context().newPage();pg._errors=[];pg.on('pageerror',e=>pg._errors.push(e.message));await pg.goto(BASE+'/task-card/');await pg.waitForTimeout(500);
    expect((await pg.request.get(BASE+'/task-card/manifest.webmanifest')).ok(),'Task Card manifest missing');
    const iso=d=>d.toISOString().slice(0,10),now=new Date(),wed=new Date(now);wed.setDate(now.getDate()-((now.getDay()+4)%7));const old=new Date(now);old.setDate(now.getDate()-14);
    await pg.click('[data-tab="letters"]');await pg.click('#addLetter');await pg.fill('#fDate',iso(wed));await pg.dispatchEvent('#fDate','change');
    const clin=await pg.$$eval('#fClinics .chip',a=>a.map(x=>x.textContent));expect(clin.join('|')==='A Asuni NP clinic|A Asuni Tx clinic','Wednesday should offer both Asuni clinics, got '+clin.join('|'));
    await pg.click('#fClinics .chip >> text=A Asuni NP clinic');await pg.click('#fTypes .chip >> text=Clinic letter to GDP');await pg.fill('#fRef','1203851234');await pg.click('#fSave');
    expect(await pg.isVisible('#fErr')&&/CHI or NHS/.test(await pg.innerText('#fErr')),'a CHI-like number should be refused');
    await pg.fill('#fRef','10:30 slot, UR1');await pg.click('#fAgain');await pg.fill('#fDate',iso(old));await pg.dispatchEvent('#fDate','change');
    await pg.fill('#fClinicOther','Restorative A+E');await pg.click('#fTypes .chip >> text=Referral');await pg.fill('#fRef','14:00 new patient');await pg.click('#fSave');await pg.waitForTimeout(200);
    let d=await pg.evaluate(()=>taskCard.data());expect(d.letters.length===2,'expected two letters, got '+d.letters.length);
    const a=d.letters.find(l=>l.clinic==='A Asuni NP clinic');expect(a&&a.date===iso(wed)&&a.type==='Clinic letter to GDP'&&a.due===iso(new Date(wed.getFullYear(),wed.getMonth(),wed.getDate()+7,12)),'letter not linked to clinic and date: '+JSON.stringify(a));
    await pg.click('[data-tab="dash"]');expect(await pg.innerText('#sOut')==='2'&&await pg.innerText('#sOver')==='1','dashboard counts wrong');
    expect(/A Asuni NP clinic/.test(await pg.innerText('#week')),'week strip should show the Wednesday clinics');
    await pg.click('[data-tab="letters"]');await pg.click('[data-lf="over"]');expect(/14:00 new patient/.test(await pg.innerText('#groups'))&&!/10:30 slot/.test(await pg.innerText('#groups')),'overdue filter wrong');
    await pg.click('[data-lf="out"]');await pg.click('.item:has-text("10:30 slot") [data-st$="|sent"]');expect((await pg.evaluate(()=>taskCard.data())).letters.filter(l=>l.status!=='sent').length===1,'marking sent failed');
    await pg.click('#toastUndo');expect((await pg.evaluate(()=>taskCard.data())).letters.filter(l=>l.status!=='sent').length===2,'undo failed');
    await pg.click('[data-tab="misc"]');await pg.fill('#miscText','Book study day');await pg.press('#miscText','Enter');expect(await pg.innerText('#nMisc')==='1','misc not added');
    await pg.fill('#miscText','call re 120 385 1234');await pg.press('#miscText','Enter');expect(await pg.isVisible('#miscErr'),'CHI-like number accepted in misc');
    await pg.reload();await pg.waitForTimeout(400);d=await pg.evaluate(()=>taskCard.data());expect(d.letters.length===2&&d.misc.length===1,'list not kept after reload');
    await lp.reload();await lp.waitForTimeout(300);const tile=lp.locator('a.app[href="/task-card/"]');expect(await tile.count()===1,'Task Card tile missing after use');
    expect(/2 letters to do · 1 overdue · 1 misc/.test(await tile.innerText()),'tile summary wrong: '+await tile.innerText());await noErrors(pg);await noErrors(lp)});
  await test('Photo Card files photos after each QR slate into that case, labels the series, and keeps them on this device only',async()=>{
    const lp=await page('/');expect(!(await lp.$$eval('a.app',a=>a.map(x=>x.getAttribute('href')))).includes('/photo-card/'),'Photo Card tile should not show on a device that has not used it');
    const pg=await lp.context().newPage();pg._errors=[];pg.on('pageerror',e=>pg._errors.push(e.message));pg.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource|favicon/.test(m.text()))pg._errors.push(m.text())});
    await pg.goto(BASE+'/photo-card/');await pg.waitForTimeout(500);
    expect((await pg.request.get(BASE+'/photo-card/manifest.webmanifest')).ok(),'Photo Card manifest missing');
    // a case made on this device shows its slate, and the slate's link names it
    await pg.click('#newCase');await pg.fill('#cName','Case A');await pg.fill('#cLabel','UL1 implant');await pg.fill('#cTags','implant, teaching');await pg.click('#cSave');
    await pg.waitForSelector('#dSlate[open]');expect(await pg.innerText('#slName')==='Case A'&&/UL1 implant · Pre-op/.test(await pg.innerText('#slLine')),'slate text wrong: '+await pg.innerText('#slLine'));
    const caseA=(await pg.evaluate(()=>photoCard.cases()))[0];
    const parsed=await pg.evaluate(c=>photoCard.parseSlate(photoCard.slateUrl(c,'post')),caseA);expect(parsed.id===caseA.id&&parsed.stage==='post'&&parsed.label==='UL1 implant','slate link did not round-trip: '+JSON.stringify(parsed));
    await pg.click('#slClose');
    // import: two strays, slate A (pre) + 5 shots, slate for a case not yet on this device (B, post) + 2 shots; out of order on purpose
    const caseB={id:'zz9b2k1q',name:'Case B',label:''};
    const shots=[
      {name:'IMG_0007',dt:'2026:11:20 10:01:30'},{name:'IMG_0001',dt:'2026:11:20 09:00:00',col:'#888'},{name:'IMG_0002',dt:'2026:11:20 09:00:10',col:'#888'},
      {name:'IMG_0003',dt:'2026:11:20 10:00:00',slate:'A',stage:'pre'},{name:'IMG_0004',dt:'2026:11:20 10:00:20'},{name:'IMG_0005',dt:'2026:11:20 10:00:40'},{name:'IMG_0006',dt:'2026:11:20 10:01:00'},
      {name:'IMG_0008',dt:'2026:11:20 10:02:00'},{name:'IMG_0009',dt:'2026:11:20 11:00:00',slate:'B',stage:'post'},{name:'IMG_0010',dt:'2026:11:20 11:00:30',col:'#8c8'},{name:'IMG_0011',dt:'2026:11:20 11:01:00',col:'#8c8'}];
    const files=await pg.evaluate(MAKE_JPEGS,{shots,slateFor:{A:caseA,B:caseB}});
    await pg.setInputFiles('#fileIn',files.map(f=>({name:f.name,mimeType:'image/jpeg',buffer:Buffer.from(f.b64,'base64')})));
    await pg.waitForSelector('#impReview:not([hidden])',{timeout:20000});
    const sum=await pg.innerText('#impSummary');expect(/11 photos read/.test(sum)&&/2 slates found/.test(sum)&&/2 photos not after a slate/.test(sum),'summary: '+sum);
    await pg.selectOption('#impSeries','intra5');
    const grp=await pg.$$eval('#impGroups .grp',g=>g.map(x=>x.querySelector('b').textContent+':'+[...x.querySelectorAll('.ph:not(.off) .lab')].map(l=>l.textContent).join(',')));
    expect(grp[0]==='Slate: Case A:Frontal,Right buccal,Left buccal,Upper occlusal,Lower occlusal','group A wrong: '+grp[0]);
    expect(/^Slate: Case B:/.test(grp[1])&&grp[1].split(',').length===2,'group B wrong: '+grp[1]);
    // leave out the last shot in A
    await pg.click('#impGroups .grp >> nth=0 >> [data-imp] >> nth=5');
    await pg.click('#impSave');await pg.waitForFunction(()=>!document.getElementById('dImp').open,null,{timeout:15000});await pg.waitForTimeout(300);
    let cs=await pg.evaluate(()=>photoCard.cases()),ps=await pg.evaluate(()=>photoCard.photos());
    expect(cs.length===2&&cs.some(c=>c.id===caseB.id&&c.name==='Case B'),'case B not created from its slate');
    const inA=ps.filter(p=>p.caseId===caseA.id&&!p.tags.includes('slate')),inB=ps.filter(p=>p.caseId===caseB.id&&!p.tags.includes('slate'));
    expect(inA.length===4&&inA.every(p=>p.stage==='pre'&&p.date==='2026-11-20'),'case A photos wrong: '+inA.map(p=>p.name+p.stage).join(','));
    expect(inA.find(p=>p.name==='IMG_0007.JPG').view==='occ-u','EXIF order not used for the series labels');
    expect(inB.length===2&&inB.every(p=>p.stage==='post'),'case B photos wrong');
    expect(ps.filter(p=>!p.caseId).length===2,'strays should be unsorted');
    expect(ps.filter(p=>p.tags.includes('slate')).length===0,'slates should be left out by default');
    // a later download from the same clinic, with no slate in it, carries on into the case of the last slate
    const more=await pg.evaluate(MAKE_JPEGS,{shots:[{name:'IMG_0012',dt:'2026:11:20 11:05:00',col:'#8c8'},{name:'IMG_0011',dt:'2026:11:20 11:01:00',col:'#8c8'}],slateFor:{}});
    await pg.setInputFiles('#fileIn',more.map(f=>({name:f.name,mimeType:'image/jpeg',buffer:Buffer.from(f.b64,'base64')})));await pg.waitForSelector('#impReview:not([hidden])',{timeout:20000});
    expect(await pg.inputValue('#impGroups [data-gt="u"]')===caseB.id&&/Carrying on from the Case B slate/.test(await pg.innerText('#impGroups')),'no carry-on from the earlier slate: '+await pg.innerText('#impGroups'));
    expect(/1 photo read/.test(await pg.innerText('#impSummary'))||/already in the library/.test(await pg.innerText('#impSummary')),'re-imported photo not skipped: '+await pg.innerText('#impSummary'));await pg.click('#impCancel');
    // case view: series checklist, compare, collage
    await pg.click(`[data-case="${caseA.id}"]`);await pg.click('[data-stg="pre"]');
    expect(/4 of 10 standard views/.test(await pg.innerText('#seriesLbl')),'series checklist: '+await pg.innerText('#seriesLbl'));
    await pg.click('#selToggle');await pg.click('#photoGroups .ph >> nth=0');await pg.click('#photoGroups .ph >> nth=1');await pg.click('#sCompare');await pg.waitForSelector('#dCmp[open]');
    expect(await pg.evaluate(()=>document.getElementById('cmpA').width>100&&document.getElementById('cmpB').width>100),'compare not drawn');await pg.click('#cmpClose');
    await pg.click('#photoGroups .ph >> nth=2');await pg.click('#sCollage');await pg.waitForSelector('#dCol[open]');await pg.waitForTimeout(300);
    const dl=pg.waitForEvent('download');await pg.click('#colDown');const d=await dl;expect(/\.jpg$/.test(d.suggestedFilename()),'collage download name');await pg.click('#colClose');await pg.click('#sDone');
    // viewer edits
    await pg.click('#photoGroups .ph >> nth=0');await pg.waitForSelector('#dView[open]');await pg.fill('#vTeeth','ul1 ur1 xx');await pg.dispatchEvent('#vTeeth','change');await pg.click('#vFlipH');
    await pg.waitForTimeout(150);const p0=(await pg.evaluate(()=>photoCard.photos())).find(p=>p.teeth.length);expect(p0&&p0.teeth.join()==='UL1,UR1'&&p0.fh,'viewer edits not kept: '+JSON.stringify(p0&&p0.teeth));await pg.click('#vClose');
    // ZIP export makes case folders with the originals, readable by the importer
    await pg.click('#cvMore');const zdl=pg.waitForEvent('download');await pg.click('#cvZip');const z=await zdl;const zp=await z.path();
    const names=await pg.evaluate(async b64=>{const bin=atob(b64),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);const out=[];await photoCard.unzip(new File([u],'x.zip'),async f=>out.push(f.name+':'+f.size));return out},require('fs').readFileSync(zp).toString('base64'));
    expect(names.length===4,'zip should hold 4 photos, got '+names.length);
    expect(z.suggestedFilename()==='Case A - UL1 implant.zip','zip name '+z.suggestedFilename());
    // search and the tile
    await pg.click('#back');await pg.fill('#q','teaching');expect((await pg.$$eval('#caseList .ccard',a=>a.length))===1,'tag search');await pg.fill('#q','');
    await pg.reload();await pg.waitForTimeout(500);expect((await pg.evaluate(()=>photoCard.photos())).length===8,'photos not kept after reload');
    await lp.reload();await lp.waitForTimeout(300);const tile=lp.locator('a.app[href="/photo-card/"]');expect(await tile.count()===1,'Photo Card tile missing after use');
    expect(/2 cases · 8 photos · 2 unsorted/.test(await tile.innerText()),'tile summary wrong: '+await tile.innerText());
    // opening a slate link (scanned with the phone camera) opens that case
    const pg2=await lp.context().newPage();await pg2.goto(BASE+'/photo-card/#case=q1w2e3r4&n=Case%20C&s=pre');await pg2.waitForTimeout(600);
    expect(await pg2.innerText('#cvName')==='Case C','slate link did not open a new case');
    await noErrors(pg);await noErrors(lp)});
  await test('Photo Card files photos arriving in a watched folder by their slates with no checking step, and only once',async()=>{
    const pg=await page('/photo-card/');await pg.evaluate(()=>{});
    const caseC={id:'cccc1111',name:'Case C',label:'veneers'};
    const shots=[{name:'IMG_0101',dt:'2026:11:21 09:00:00',slate:'C',stage:'pre'},{name:'IMG_0102',dt:'2026:11:21 09:00:30'},{name:'IMG_0103',dt:'2026:11:21 09:01:00'},{name:'IMG_0104',dt:'2026:11:21 13:30:00'}];
    const files=await pg.evaluate(MAKE_JPEGS,{shots,slateFor:{C:caseC}});
    const r1=await pg.evaluate(async files=>{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('image.canon',{create:true}),sub=await dir.getDirectoryHandle('2026',{create:true});
      for(const f of files){const bin=atob(f.b64),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);const h=await sub.getFileHandle(f.name,{create:true}),w=await h.createWritable();await w.write(u);await w.close()}
      const raw=await sub.getFileHandle('IMG_0101.CR3',{create:true}),w=await raw.createWritable();await w.write('raw');await w.close();
      localStorage.setItem('photoCard.keepOrig','false');photoCard._watch(dir);await photoCard.checkWatch(false);return photoCard.photos().map(p=>p.name+':'+(p.caseId||'-')+':'+p.stage)},files);
    expect(!(await pg.evaluate(()=>document.getElementById('dImp').open)),'the checking step opened for the watched folder');
    const inC=r1.filter(x=>x.includes(':cccc1111:pre'));expect(inC.length===2&&r1.length===3,'watched folder photos not filed: '+r1.join(', '));
    expect(r1.some(x=>/IMG_0104.JPG:-:/.test(x)),'a photo 4 hours after the slate should be unsorted: '+r1.join(', '));
    expect((await pg.evaluate(()=>photoCard.cases())).some(c=>c.id==='cccc1111'&&c.label==='veneers'),'case not made from the slate');
    const n2=await pg.evaluate(async()=>{await photoCard.checkWatch(false);return photoCard.photos().length});expect(n2===3,'photos imported twice: '+n2);
    // with "keep full-size originals" off, only the screen copy is stored, and downloads use it
    const kept=await pg.evaluate(()=>new Promise(res=>{const r=indexedDB.open('notile-photo-card');r.onsuccess=()=>{const q=r.result.transaction('orig').objectStore('orig').count();q.onsuccess=()=>res(q.result)}}));
    expect(kept===0&&(await pg.evaluate(()=>photoCard.photos().every(p=>p.orig===false))),'originals kept despite the setting: '+kept);
    await pg.click('[data-case="cccc1111"]');await pg.click('#photoGroups .ph >> nth=0');await pg.waitForSelector('#dView[open]');
    expect(/Screen copy on this device/.test(await pg.innerText('#vInfo')),'viewer should say only the screen copy is here');
    const dl=pg.waitForEvent('download');await pg.click('#vDown');expect((await (await dl).path())!==null,'download of the screen copy failed');await pg.click('#vClose');
    await noErrors(pg)});
  await test('The Photo Card Google Drive script files image.canon photos into case and visit folders, with RAW files, across checks',async()=>{
    const fs=require('fs'),path=require('path'),root=path.join(__dirname,'..','photo-card');
    expect(fs.readFileSync(path.join(root,'PhotoCardSorter.gs'),'utf8').startsWith(fs.readFileSync(path.join(root,'drive-sorter','core.js'),'utf8').trimEnd()),'PhotoCardSorter.gs is out of date: run python3 photo-card/tools/build_drive_sorter.py');
    const pg=await page('/photo-card/');
    const makeJpeg=async(kind,url)=>Buffer.from(await pg.evaluate(async ({kind,url})=>{const c=document.createElement('canvas');c.width=1200;c.height=800;const x=c.getContext('2d');x.fillStyle='#b88';x.fillRect(0,0,1200,800);
      if(kind==='slate'){const q=document.createElement('canvas');photoCard.drawQR(q,url,6);x.drawImage(q,(1200-q.width)/2,(800-q.height)/2)}
      const b=await new Promise(r=>c.toBlob(r,'image/jpeg',.85)),u=new Uint8Array(await b.arrayBuffer());let s='';for(let i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s)},{kind,url}),'base64');
    const r=await require('../photo-card/tests/drive-sorter-sim.js').simulate(async(k,u)=>new Uint8Array(await makeJpeg(k,u)));
    const A='Photo Cases/Case A - UL1 implant/2026-11-20 Pre-op',B='Photo Cases/Case B/2026-11-20 Post-op';
    expect(JSON.stringify(r.first[A])===JSON.stringify(['IMG_0002.CR3','IMG_0002.JPG','IMG_0003.CR3','IMG_0003.JPG','IMG_0004.JPG']),'case A folder: '+JSON.stringify(r.first));
    expect(JSON.stringify(r.first[B])===JSON.stringify(['IMG_0005.JPG','IMG_0006.JPG']),'case B folder: '+JSON.stringify(r.first[B]));
    expect(JSON.stringify(r.first['image.canon'])===JSON.stringify(['IMG_0001.JPG','IMG_0007.JPG','IMG_0008.JPG']),'left in image.canon: '+JSON.stringify(r.first['image.canon']));
    expect(r.second[B].includes('IMG_0009.JPG'),'a later photo should join case B on the next check');
    expect(r.second['image.canon'].includes('IMG_0011.JPG'),'a photo after one with no preview yet should wait');
    expect(r.caseFolders.length===2,'case folders made twice: '+r.caseFolders.join(', '));expect(r.thumbsSecond===1,'previews read again: '+r.thumbsSecond);
    expect(/^Filed 3 photos into 2 cases \(2 slates found\)/.test(r.runs[0]),'summary: '+r.runs[0]);await noErrors(pg)});
  await test('DentMat opens with its catalogue, no errors, and its logo returns to the launcher',async()=>{const pg=await page('/dentmat/');
    await pg.waitForFunction(()=>window.DentMat&&DentMat.products.length>0,null,{timeout:15000});
    const n=await pg.evaluate(()=>DentMat.products.length);expect(n>=80,'only '+n+' products');
    expect((await pg.request.get(BASE+'/dentmat/manifest.webmanifest')).ok(),'DentMat manifest missing');await noErrors(pg);
    await pg.goto(BASE+'/dentmat/#/materials');await pg.waitForTimeout(400);
    await Promise.all([pg.waitForURL(BASE+'/'),pg.click('header a.brand')]);expect(await pg.locator('a.app[href="/dentmat/"]').count()===1,'logo did not return to the launcher')});
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
  await test('Smile Card opens under the site CSP, designs, saves a case and exports',async()=>{const pg=await page('/smile-card/');
    await pg.waitForFunction(()=>typeof S==='object'&&S.photos&&S.photos.length===1,null,{timeout:15000});
    expect(!(await pg.locator('#patRef').count()),'patient reference box must not exist');
    await pg.click('#styleGrid button[data-k="naturalst"]');await pg.click('#viewMode button[data-v="colour"]');
    await pg.evaluate(()=>{analyse();applyAnalysis()});expect(await pg.evaluate(()=>S.an.found)>=8,'analysis found too few teeth');
    await pg.click('.steps button[data-step="photo"]');await pg.fill('#caseNotes','Test case');await pg.click('#caseSave');
    await pg.waitForFunction(()=>document.querySelectorAll('#caseList .prow').length===1,null,{timeout:5000});
    await pg.click('#exportTop');await pg.click('#expView button[data-v="report"]');
    const w=await pg.evaluate(()=>lastCanvas.width);expect(w===1240,'report not rendered');
    expect((await pg.request.get(BASE+'/smile-card/manifest.webmanifest')).ok(),'Smile Card manifest missing');await noErrors(pg)});
  await test('Wax Card opens under the site CSP, loads a scan and a tooth library, places teeth and exports',async()=>{const pg=await page('/wax-card/');
    await pg.waitForFunction(()=>window.__wax&&window.__wax.S,null,{timeout:15000});
    expect((await pg.request.get(BASE+'/wax-card/manifest.webmanifest')).ok(),'Wax Card manifest missing');
    // a small closed box stands in for the upper scan, and two boxes named 11 and 21 for a tooth library
    const box=(w,h,d,ox=0)=>{const v=[[0,0,0],[w,0,0],[w,h,0],[0,h,0],[0,0,d],[w,0,d],[w,h,d],[0,h,d]].map(p=>[p[0]+ox,p[1],p[2]]);
      const f=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
      const b=Buffer.alloc(84+f.length*50);b.writeUInt32LE(f.length,80);let o=84;
      for(const t of f){o+=12;for(const i of t){b.writeFloatLE(v[i][0],o);b.writeFloatLE(v[i][1],o+4);b.writeFloatLE(v[i][2],o+8);o+=12}o+=2}return b};
    const idle=()=>pg.waitForFunction(()=>!document.querySelector('#busy').classList.contains('show'),null,{timeout:30000});
    await pg.setInputFiles('#fileUpper',{name:'upper.stl',mimeType:'model/stl',buffer:box(50,20,40)});await idle();
    expect(await pg.evaluate(()=>!!__wax.S.scans.upper),'scan did not load');
    await pg.setInputFiles('#fileLibrary',[{name:'11.stl',mimeType:'model/stl',buffer:box(8,10,7)},{name:'21.stl',mimeType:'model/stl',buffer:box(8,10,7,9)}]);await idle();
    expect(await pg.evaluate(()=>__wax.S.library&&__wax.S.library.sets.length===1),'library did not load');
    await pg.evaluate(()=>__wax.placeSet(__wax.S.library.sets[0]));await idle();
    expect(await pg.evaluate(()=>__wax.teeth().length)===2,'teeth not placed');
    // a smile photo opens under the site CSP (blob: image) and the photo view takes over
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwnwEJMDEgAaQ8AAA1pgIC8yQb9wAAAABJRU5ErkJggg==','base64');
    await pg.setInputFiles('#filePhoto',{name:'smile.png',mimeType:'image/png',buffer:png});
    await pg.waitForFunction(()=>__wax.S.photo.img&&__wax.S.photo.on,null,{timeout:10000});
    expect(await pg.evaluate(()=>__wax.S.photo.iw===2&&document.querySelector('#view').classList.contains('photo')),'photo view did not open');
    await pg.click('#photoBtn');
    expect(await pg.evaluate(()=>!__wax.S.photo.on),'photo view did not close');
    // the step bar: 7 steps, Save is the last
    expect(await pg.evaluate(()=>document.querySelectorAll('#steps button').length)===7,'step bar missing');
    await pg.click('#steps button[data-step="save"]');
    const [dl]=await Promise.all([pg.waitForEvent('download',{timeout:30000}),pg.click('[data-act="export"]')]);
    expect(/^waxup-.*\.zip$/.test(dl.suggestedFilename()),'export file '+dl.suggestedFilename());
    await noErrors(pg)});
  await test('Tray Card opens under the site CSP, loads its solid engine, builds a tray from a scan, saves a design and keeps the ID label short',async()=>{const pg=await page('/tray-card/');
    await pg.waitForFunction(()=>window.TC&&TC.mf(),null,{timeout:30000});
    expect((await pg.request.get(BASE+'/tray-card/manifest.webmanifest')).ok(),'Tray Card manifest missing');
    // a ridge round a horseshoe stands in for a lower scan: a height field, 1 mm grid
    const N=61,h=(x,y)=>{const r=Math.hypot(x,y-8),a=Math.atan2(y-8,x);return (a<-0.35&&a>-2.8)?0:8*Math.exp(-((r-18)**2)/40)},P=(i,j)=>[i-30,j-30,h(i-30,j-30)];
    const tris=[];for(let j=0;j<N-1;j++)for(let i=0;i<N-1;i++){tris.push([P(i,j),P(i+1,j),P(i+1,j+1)],[P(i,j),P(i+1,j+1),P(i,j+1)])}
    const b=Buffer.alloc(84+tris.length*50);b.writeUInt32LE(tris.length,80);let o=84;for(const t of tris){o+=12;for(const v of t){b.writeFloatLE(v[0],o);b.writeFloatLE(v[1],o+4);b.writeFloatLE(v[2],o+8);o+=12}o+=2}
    const idle=()=>pg.waitForFunction(()=>!document.querySelector('#busy').classList.contains('show'),null,{timeout:60000});
    const [fc]=await Promise.all([pg.waitForEvent('filechooser'),pg.click('#dropScan')]);await fc.setFiles({name:'lower.stl',mimeType:'model/stl',buffer:b});await pg.waitForFunction(()=>!!TC.S.scanGeo,null,{timeout:30000});await idle();
    expect(await pg.evaluate(()=>!!TC.S.scanGeo),'scan did not load');
    await pg.evaluate(()=>{const S=TC.S,pts=[];S.scanGeo.computeBoundingBox();const c=S.scanGeo.boundingBox.getCenter(new TC.V());for(let k=0;k<24;k++){const a=k/24*2*Math.PI;pts.push(new TC.V(c.x+24*Math.cos(a),c.y+24*Math.sin(a),S.scanGeo.boundingBox.max.z))}S.margin.pts=pts;S.margin.closed=true;TC.drawMargin()});
    await pg.evaluate(()=>TC.generate());await idle();
    expect(await pg.evaluate(()=>!!TC.S.trayMesh&&/generated/.test(document.getElementById('genInfo').textContent)),'tray not generated');
    const saved=await pg.evaluate(async()=>{const d=await TC.saveData();return d.app==='Tray Card'&&d.margin.pts.length===24&&!!d.scan.b64});expect(saved,'design did not save');
    await pg.evaluate(()=>TC.gotoStep(6));await pg.fill('#tText','');await pg.type('#tText','john smith 1234');
    const label=await pg.inputValue('#tText');expect(label.length<=4&&/^[A-Z0-9-]*$/.test(label),'ID label not limited: '+label);
    await noErrors(pg)});
  // Scan Card: one app for everything that starts from a scan. The hub loads the scans once; each tool is a tab.
  await test('Scan Card opens under the site CSP: scans loaded once feed Models, Analysis and Splint, and their work comes back as one case',async()=>{const pg=await page('/scan-card/');
    await pg.waitForFunction(()=>window.APP&&APP.scans,null,{timeout:20000});
    expect((await pg.request.get(BASE+'/scan-card/manifest.webmanifest')).ok(),'Scan Card manifest missing');
    expect(await pg.locator('#tabs button').count()===13,'expected the Scans tab and twelve tools');
    const tool=id=>pg.frames().find(f=>f!==pg.mainFrame()&&f.url().endsWith('/scan-card/'+id+'/')),settle=()=>pg.evaluate(()=>APP.H.q);
    const sig=fr=>fr.evaluate(()=>['upper','lower'].map(j=>APP.scans[j]?[APP.scans[j].raw.positions.length,APP.N.crc32(new Uint8Array(APP.scans[j].raw.positions.buffer)),APP.N.crc32(new Uint8Array(APP.scans[j].raw.indices.buffer)),Array.from(APP.scans[j].matrix.elements).join()].join(':'):'-').join('|'));
    await pg.click('[data-ss=demo]');await pg.waitForFunction(()=>APP.scans.has('upper')&&APP.scans.has('lower')&&!document.querySelector('#busy').classList.contains('show'),null,{timeout:60000});
    const want=await sig(pg);
    await pg.click('#tabs [data-tab=model]');await settle();const m=tool('model');expect(!!m,'Models did not open');
    await m.waitForFunction(()=>window.APP&&APP.A.lower.model&&APP.A.upper.model&&!APP.A.lower.dirty&&!APP.A.upper.dirty,null,{timeout:240000});
    const mi=await m.evaluate(()=>({embed:APP.N.EMBED,hidden:[...document.querySelectorAll('.step')].filter(s=>s.hidden).map(s=>s.dataset.id).join(),wt:APP.A.lower.info.watertight&&APP.A.upper.info.watertight,brand:getComputedStyle(document.querySelector('#top .brand')).display}));
    expect(mi.embed&&mi.hidden==='load,orient,trim'&&mi.wt&&mi.brand==='none','Models inside Scan Card: '+JSON.stringify(mi));
    expect(await sig(m)===want,'Models is not working on the same scans');
    for(const id of ['analysis','splint']){await pg.click(`#tabs [data-tab=${id}]`);await settle();const fr=tool(id);expect(!!fr,id+' did not open');
      await fr.waitForFunction(()=>window.APP&&APP.scans.has('lower')&&!document.querySelector('#busy').classList.contains('show'),null,{timeout:60000});
      expect(await sig(fr)===want,id+' is not working on the same scans');
      expect(await fr.evaluate(()=>[...document.querySelectorAll('.step')].filter(s=>s.hidden).map(s=>s.dataset.id).join())==='load,orient',id+' still shows its own loading steps')}
    await pg.click('#tabs [data-tab=scans]');await settle();
    expect(await pg.evaluate(()=>APP.isLocked()&&!document.getElementById('lock').hidden&&APP.shell.stepEl('trim').querySelector('.body').inert===true),'the scans are not locked while tools are using them');
    const [dl]=await Promise.all([pg.waitForEvent('download'),pg.click('#topBtns button:nth-child(2)')]);expect(/^case-\d{4}-\d\d-\d\d\.zip$/.test(dl.suggestedFilename()),'case file '+dl.suggestedFilename());
    const kept=await pg.evaluate(()=>{const c=APP.buildCase();return c.items.map(i=>i.role).sort().join()+' / '+Object.keys(c.data).sort().join()});
    expect(kept==='lower-model,lower-scan,upper-model,upper-scan / analysis,model,splint','the case holds '+kept);
    // changing the scans (after unlocking) starts a tool again on the new scans, and its earlier work is not saved beside them
    await pg.click('#unlock');await pg.evaluate(()=>{APP.shell.goto('trim');const r=document.getElementById('trDepth');r.value=9;r.dispatchEvent(new Event('input'));r.dispatchEvent(new Event('change'));document.getElementById('trApply').click()});
    await pg.waitForFunction(w=>APP.refreshSig()!==''&&!APP.valid(APP.TOOLS[0])&&!document.querySelector('#busy').classList.contains('show'),null,{timeout:60000});
    expect(await pg.evaluate(()=>APP.buildCase().items.map(i=>i.role).sort().join())==='lower-scan,upper-scan','work made on the earlier scans would be saved with the trimmed ones');
    const want2=await sig(pg);expect(want2!==want,'the trim did not change the scan');
    await pg.click('#tabs [data-tab=model]');await settle();await m.waitForFunction(()=>APP.A.lower.model&&!APP.A.lower.dirty&&!document.querySelector('#busy').classList.contains('show'),null,{timeout:240000});
    expect(await sig(m)===want2,'Models did not take the trimmed scans');await noErrors(pg)});
  await test('Scan Card hands its scans to Tray Card and Wax Card in the scanner’s own coordinates',async()=>{const pg=await page('/scan-card/');
    await pg.waitForFunction(()=>window.APP&&APP.scans,null,{timeout:20000});const settle=()=>pg.evaluate(()=>APP.H.q),fr=p=>pg.frames().find(f=>f!==pg.mainFrame()&&f.url().endsWith(p));
    await pg.evaluate(()=>APP.scans.loadDemo({res:0.6}));await pg.waitForFunction(()=>APP.scans.has('upper')&&APP.scans.has('lower')&&!document.querySelector('#busy').classList.contains('show'),null,{timeout:60000});
    await pg.evaluate(()=>{APP.scans.applyTransform(APP.N.rotationAbout('x',25));APP.H.dirty=true});   // turned on the Scans tab: the two existing apps must still get the scan as the scanner exported it
    const box=(m)=>{const b=APP.N.meshBounds(m);return m.indices.length/3+' tris, '+b.size.map(v=>v.toFixed(1)).join(' × ')+' from '+b.min.map(v=>v.toFixed(1)).join(',')};
    const raw=await pg.evaluate(`(()=>{const box=${box};return Object.fromEntries(['upper','lower'].map(j=>[j,{raw:box(APP.scans[j].raw),turned:box(APP.scans.framed(j))}]))})()`);
    expect(raw.lower.raw!==raw.lower.turned,'test set-up: turning the scan should move its bounding box');
    // what was in the STL file a frame was given (binary STL: 80-byte header, count, 50 bytes a triangle)
    const stl=`async(file)=>{const dv=new DataView(file instanceof ArrayBuffer?file:await file.arrayBuffer()),n=dv.getUint32(80,true),mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9];for(let i=0;i<n;i++)for(let v=0;v<3;v++)for(let k=0;k<3;k++){const x=dv.getFloat32(84+i*50+12+v*12+k*4,true);if(x<mn[k])mn[k]=x;if(x>mx[k])mx[k]=x}return n+' tris, '+mn.map((v,k)=>(mx[k]-v).toFixed(1)).join(' × ')+' from '+mn.map(v=>v.toFixed(1)).join(',')}`;
    await pg.click('#tabs [data-tab=tray]');await settle();const t=fr('/tray-card/');expect(!!t,'Tray Card did not open');
    await t.waitForFunction(()=>!!TC.S.scanGeo&&!!TC.S.antMesh,null,{timeout:60000});
    const ti=await t.evaluate(`(async()=>({name:TC.S.scanSrc.name,file:await (${stl})(TC.S.scanSrc.file),ant:await (${stl})(TC.S.antSrc.file),arch:document.querySelector('#segArch button.on').dataset.v,home:document.querySelector('#top a.brand').target}))()`);
    expect(ti.arch==='mandible'&&ti.name==='lower.stl'&&ti.file===raw.lower.raw&&ti.ant===raw.upper.raw&&ti.home==='_top','Tray Card got '+JSON.stringify(ti)+', expected '+JSON.stringify(raw));
    await t.click('#segArch [data-v=maxilla]');await t.waitForFunction(()=>TC.S.scanSrc.name==='upper.stl'&&!!TC.S.antMesh&&TC.S.antSrc&&TC.S.antSrc.name==='lower.stl',null,{timeout:60000});
    expect(await t.evaluate(`(async()=>await (${stl})(TC.S.scanSrc.file))()`)===raw.upper.raw,'Tray Card’s Maxilla / Mandible switch did not load the upper scan');
    await pg.click('#tabs [data-tab=wax]');await settle();const w=fr('/wax-card/');expect(!!w,'Wax Card did not open');
    await w.waitForFunction(()=>!!(__wax.S.scans.upper&&__wax.S.scans.lower),null,{timeout:90000});
    const wi=await w.evaluate(`(async()=>{const o={};for(const j of ['upper','lower'])o[j]=__wax.S.scans[j].name+': '+await (${stl})(__wax.S.scans[j].buffer);return o})()`);
    expect(wi.upper==='upper.stl: '+raw.upper.raw&&wi.lower==='lower.stl: '+raw.lower.raw,'Wax Card got '+JSON.stringify(wi));
    await pg.click('#tabs [data-tab=scans]');await settle();
    expect(await pg.evaluate(()=>APP.users().join())==='Trays,Wax-up','the Scans tab does not show Trays and Wax-up as using the scans');
    expect(await t.evaluate(()=>new Promise(res=>{let n=0;for(const P of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype]){const o=P.drawElements;P.drawElements=function(...a){n++;return o.apply(this,a)}}setTimeout(()=>res(n),700)}))===0,'Tray Card keeps drawing while its tab is hidden');
    await noErrors(pg)});
  await test('Scan Card’s Prep check, Compare, Survey, Shells and Splint guidance work under the site CSP',async()=>{const pg=await page('/scan-card/');
    await pg.waitForFunction(()=>window.APP&&APP.scans,null,{timeout:20000});const settle=()=>pg.evaluate(()=>APP.H.q),tool=id=>pg.frames().find(f=>f!==pg.mainFrame()&&f.url().endsWith('/scan-card/'+id+'/'));
    const idle=fr=>fr.waitForFunction(()=>!document.querySelector('#busy').classList.contains('show'),null,{timeout:240000});
    // a lower arch whose 46 is a preparation of known shape (walls 6°, lingual −6°), made by the demo generator, and the upper
    const T=await pg.evaluate(async()=>{const N=APP.N,pair=N.makeDemoPair({res:0.3}),t=pair.truth.lower.teeth.find(q=>q.fdi===46),zc=(t.mesial[2]+t.distal[2])/2,prep={fdi:46,zTop:t.tip[2]-2,zMargin:zc-1.2,R0:0.36*t.width,shoulder:0.8,taper:6,taperLingual:-6};
      const lo=N.makeDemoArch({jaw:'lower',res:0.3,prep}).mesh;await APP.scans.loadFiles([new File([N.stlBinary(lo)],'lower.stl'),new File([N.stlBinary(pair.upper)],'upper.stl')]);
      const c=t.centre,loop=[];for(let k=0;k<10;k++){const a=k/10*2*Math.PI;loop.push([c[0]+Math.cos(a)*(prep.R0+0.45),c[1]+Math.sin(a)*(prep.R0+0.45),prep.zMargin])}return{seed:[c[0],c[1],prep.zTop],loop}});
    await idle(pg);expect(await pg.evaluate(()=>APP.scans.has('upper')&&APP.scans.has('lower')),'scans did not load');
    await pg.click('#tabs [data-tab=prep]');await settle();const pr=tool('prep');expect(!!pr,'Prep check did not open');await pr.waitForFunction(()=>window.APP&&APP.scans.has('lower'),null,{timeout:60000});
    const f=await pr.evaluate(T=>{const M=APP.scans.lower.matrix,V=p=>new APP.THREE.Vector3(...p).applyMatrix4(M).toArray();APP.P.jaw='lower';APP.P.seed=V(T.seed);APP.P.loop=T.loop.map(V);APP.P.dir=new APP.THREE.Vector3(0,0,1).transformDirection(M).toArray();APP.analyse();const s=APP.R.sides;return{b:s.buccal.angle,l:s.lingual.angle,md:APP.R.tocMD,c:APP.R.clear&&APP.R.clear.min}},T);
    expect(Math.abs(f.b-6)<1&&Math.abs(f.l+6)<1&&Math.abs(f.md-12)<1.5&&f.c>1,'Prep check figures '+JSON.stringify(f));
    await pg.click('#tabs [data-tab=compare]');await settle();const cm=tool('compare');expect(!!cm,'Compare did not open');await cm.waitForFunction(()=>window.APP&&APP.scans.has('lower'),null,{timeout:60000});
    await cm.click('#cmJaw [data-v=lower]');await cm.click('#cmMade');await idle(cm);
    const c=await cm.evaluate(()=>({rms:APP.C.fit.rms,lo:APP.C.stats.lo}));expect(c.rms<0.01&&Math.abs(c.lo+0.5)<0.04,'Compare '+JSON.stringify(c));
    await pg.click('#tabs [data-tab=survey]');await settle();const sv=tool('survey');expect(!!sv,'Survey did not open');await sv.waitForFunction(()=>window.APP&&APP.scans.has('lower'),null,{timeout:60000});
    await sv.evaluate(()=>APP.shell.goto('block'));await idle(sv);await sv.waitForFunction(()=>APP.B&&APP.B.mesh,null,{timeout:120000});
    const bo=await sv.evaluate(()=>APP.B.info);expect(bo.watertight&&bo.tris>1000,'Survey block-out '+JSON.stringify(bo));
    await pg.click('#tabs [data-tab=shell]');await settle();const sl=tool('shell');expect(!!sl,'Shells did not open');await sl.waitForFunction(()=>window.APP&&APP.scans.has('lower'),null,{timeout:60000});
    await sl.evaluate(T=>{APP.shell.goto('make');},T);await sl.click('#mkMode [data-v=matrix]');await sl.click('#mkJaw [data-v=lower]');await sl.evaluate(()=>APP.shell.goto('shape'));await sl.click('#shSelf');
    await sl.evaluate(T=>{APP.P.taps=[T.seed];APP.shell.goto('design');},T);await sl.click('#dBuild');await idle(sl);const mi=await sl.evaluate(()=>APP.B&&APP.B.info);expect(mi&&mi.closed&&mi.holes===1,'Shells matrix '+JSON.stringify(mi));
    await pg.click('#tabs [data-tab=splint]');await settle();const sp=tool('splint');expect(!!sp,'Splint did not open');await sp.waitForFunction(()=>window.APP&&APP.scans.has('upper'),null,{timeout:60000});
    await sp.evaluate(()=>APP.shell.goto('appliance'));await sp.click('#apJaw [data-v=upper]');await sp.click('#apType [data-v=flat]');await sp.evaluate(()=>APP.shell.goto('shell'));await idle(sp);
    await sp.check('#shUse');await idle(sp);await sp.click('#shAuto');await idle(sp);await sp.check('#gdOn');await idle(sp);await sp.waitForFunction(()=>APP.D.res&&!APP.D.dirty,null,{timeout:300000});
    const g=await sp.evaluate(()=>({r:APP.D.res.report.ramps,w:APP.D.res.report.watertight,e:['right','left','forward'].map(k=>APP.D.exc[k][1])}));
    expect(g.w&&g.r&&g.r.length===3&&g.e.every(q=>q.guide==='front'&&q.back>0.3),'Splint guidance '+JSON.stringify(g));await noErrors(pg)});
  await test('Scan Card’s Articulator, Obturator and CBCT work under the site CSP',async()=>{const pg=await page('/scan-card/');
    await pg.waitForFunction(()=>window.APP&&APP.scans,null,{timeout:20000});const settle=()=>pg.evaluate(()=>APP.H.q),tool=id=>pg.frames().find(f=>f!==pg.mainFrame()&&f.url().endsWith('/scan-card/'+id+'/'));
    const idle=fr=>fr.waitForFunction(()=>!document.querySelector('#busy').classList.contains('show'),null,{timeout:240000});
    await pg.evaluate(async()=>{const N=APP.N,pair=N.makeDemoPair({res:0.3});await APP.scans.loadFiles([new File([N.stlBinary(pair.lower)],'lower.stl'),new File([N.stlBinary(pair.upper)],'upper.stl')]);});
    await idle(pg);expect(await pg.evaluate(()=>APP.scans.has('upper')&&APP.scans.has('lower')),'scans did not load');
    await pg.click('#tabs [data-tab=articulator]');await settle();const ar=tool('articulator');expect(!!ar,'Articulator did not open');await ar.waitForFunction(()=>window.APP&&APP.scans.has('lower'),null,{timeout:60000});
    await ar.waitForFunction(()=>!!APP.E,null,{timeout:120000});await ar.evaluate(()=>APP.shell.goto('report'));await ar.waitForFunction(()=>APP.E&&APP.E.res&&APP.E.res.right&&APP.E.res.right.verdict,null,{timeout:300000});
    const v=await ar.evaluate(()=>APP.E.res.right.verdict.head);expect(/guidance/i.test(v),'Articulator right excursion: '+v);
    await pg.click('#tabs [data-tab=obturator]');await settle();const ob=tool('obturator');expect(!!ob,'Obturator did not open');await ob.waitForFunction(()=>window.APP&&APP.scans.has('upper'),null,{timeout:60000});
    expect(await ob.evaluate(()=>APP.SOL.ready().then(()=>true)),'Obturator: the solid engine did not start');
    await pg.click('#tabs [data-tab=cbct]');await settle();const cb=tool('cbct');expect(!!cb,'CBCT did not open');await cb.waitForFunction(()=>window.APP&&APP.loadDemo,null,{timeout:60000});
    await cb.evaluate(()=>APP.loadDemo());await cb.waitForFunction(()=>APP.S.vol&&APP.S.vol.dims,null,{timeout:120000});
    const d=await cb.evaluate(()=>APP.S.vol.dims);expect(d.every(n=>n>50),'CBCT demo volume '+JSON.stringify(d));
    // the cross-hair turned 20 degrees in the axial slice: the other two slices become oblique; Straighten puts them back
    const tn=await cb.evaluate(()=>{APP.shell.goto('view');APP.turnIn('ax',20*Math.PI/180);const o=APP.obl(APP.views.co);return{ang:APP.lineAngle('ax'),ob:!!o,n:o&&o.f.n,btn:!document.querySelector('#cbStraight').hidden}});
    expect(Math.abs(tn.ang-20)<1e-6&&tn.ob&&Math.abs(tn.n[0]+Math.sin(20*Math.PI/180))<1e-9&&tn.btn,'CBCT cross-hair turn: '+JSON.stringify(tn));
    await cb.click('#cbStraight');expect(await cb.evaluate(()=>APP.lineAngle('ax')===0&&!APP.obl(APP.views.co)),'CBCT Straighten did not put the slices back');
    // a tooth of the demo picked, and its root canals found
    await cb.evaluate(()=>{const t=APP.D.phantomTeeth().find(x=>String(x.name)==='45'),p=[0,1,2].map(q=>t.base[q]+t.w[q]*t.crown*0.3),T=APP.S.tooth;APP.shell.goto('tooth');T.seeds=[p];T.not=[];T.erase=[];T.T=1000;T.fitted=false;T.roi={shape:'cyl',c:[p[0],p[1]],r:7,z0:p[2]-20,z1:p[2]+20};return APP.segment()});
    await cb.waitForFunction(()=>APP.S.tooth.seg&&!APP.S.tooth.seg.error,null,{timeout:120000});
    await cb.evaluate(()=>APP.shell.goto('canal'));await cb.waitForFunction(()=>APP.S.canal.seg&&APP.S.canal.mesh,null,{timeout:120000});
    const cn=await cb.evaluate(()=>{const c=APP.S.canal.seg;return{err:c.error||null,vol:c.volume,canals:c.canals,by:c.by,glass:APP.r3objs.tooth.material.type,shown:APP.r3objs.canal.visible}});
    expect(!cn.err&&cn.vol>15&&cn.vol<26&&cn.canals===1&&cn.by==='tooth'&&cn.glass==='ShaderMaterial'&&cn.shown,'CBCT root canals of the demo premolar: '+JSON.stringify(cn));await noErrors(pg)});
  await test('CBCT: the tooth model runs under the site CSP (the page’s own worker and engine, a stand-in network), and its pack is whole',async()=>{
    // the real pack: every part there, of the size and SHA-256 its manifest gives, none over GitHub's 100 MB
    const fs=require('fs'),path=require('path'),crypto=require('crypto'),root=path.resolve(__dirname,'..'),real=path.join(root,'scan-card/cbct/toothseg'),dir=path.join(root,'tests/.toothseg-test'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
    const man=JSON.parse(fs.readFileSync(path.join(real,'manifest.json'),'utf8')),wasm=fs.readFileSync(path.join(real,man.wasm.file)),parts=Buffer.concat(man.model.parts.map(p=>fs.readFileSync(path.join(real,p.file))));
    expect(parts.length===man.model.bytes&&sha(parts)===man.model.sha256&&wasm.length===man.wasm.bytes&&sha(wasm)===man.wasm.sha256&&man.model.parts.every(p=>p.bytes<100e6)&&fs.existsSync(path.join(real,'worker.js'))&&fs.existsSync(path.join(real,'NOTICE.txt')),'the tooth model pack does not match its manifest');
    // a stand-in pack made here: the same worker and engine, with a 548-byte network that is right on a made-up scan (solid teeth in air)
    const model=fs.readFileSync(path.join(root,'scan-card/dev/tests/cbct-card/toothseg-test/fake.onnx'));fs.mkdirSync(dir,{recursive:true});fs.copyFileSync(path.join(real,'worker.js'),path.join(dir,'worker.js'));fs.writeFileSync(path.join(dir,'fake.onnx'),model);
    fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({version:'test-1',input:'x',output:'y',wasm:{file:'/scan-card/cbct/toothseg/'+man.wasm.file,bytes:wasm.length,sha256:sha(wasm)},model:{bytes:model.length,sha256:sha(model),parts:[{file:'fake.onnx',bytes:model.length}]}}));
    const pg=await page('/scan-card/cbct/');await pg.addInitScript(()=>{window.TOOTHSEG={base:'/tests/.toothseg-test/'}});await pg.reload();await pg.waitForFunction(()=>window.APP&&APP.loadDemo&&APP.MODEL,null,{timeout:60000});
    await pg.evaluate(()=>APP.loadDemo());await pg.waitForFunction(()=>APP.S.vol&&APP.S.demo,null,{timeout:120000});
    const tv=await pg.evaluate(()=>{const V=APP.S.vol,D=APP.D,[nx,ny]=V.dims,h=V.spacing[0],o=V.origin,d=V.data;let v45=0;d.fill(-1000);
      for(const t of APP.S.demo.teeth){const f=D.phantomToothField(t),R=Math.max(t.md,t.bl)/2+2,lo=[t.base[0]-R,t.base[1]-R,t.base[2]-t.root-1.5],hi=[t.base[0]+R,t.base[1]+R,t.base[2]+t.crown+1.5],a0=lo.map((v,q)=>Math.max(0,Math.floor((v-o[q])/h))),a1=hi.map((v,q)=>Math.min(V.dims[q]-1,Math.ceil((v-o[q])/h)));let sum=0;
        for(let k=a0[2];k<=a1[2];k++)for(let j=a0[1];j<=a1[1];j++)for(let i=a0[0];i<=a1[0];i++){const v=Math.round(-1000+2700*Math.max(0,Math.min(1,0.5-f(o[0]+i*h,o[1]+j*h,o[2]+k*h)/h))),q=i+nx*(j+ny*k);sum+=(v+1000)/2700;if(v>d[q])d[q]=v}
        if(String(t.name)==='45')v45=sum*h*h*h}
      V.min=-1000;V.max=1700;const demo=APP.S.demo;APP.setVolume(V);APP.S.demo=demo;APP.shell.goto('tooth');return v45});
    await pg.waitForFunction(()=>APP.MODEL.state==='ask',null,{timeout:60000});
    expect(await pg.evaluate(()=>APP.MODEL.by==='model'&&document.querySelector('#dBy [data-v=model]').classList.contains('on')),'the model is not the outline of choice where its pack is beside the page');
    expect(/one-off download/.test(await pg.textContent('#dModel'))&&!(await pg.evaluate(()=>APP.MODEL.worker)),'“Model” did not ask before fetching: '+await pg.textContent('#dModel'));
    await pg.click('#dGet');await pg.waitForFunction(()=>APP.MODEL.state==='ready'||APP.MODEL.state==='error'||APP.MODEL.state==='none',null,{timeout:120000});
    expect(await pg.evaluate(()=>APP.MODEL.state)==='ready','the model did not start: '+await pg.textContent('#dModel'));
    await pg.evaluate(()=>{const t=APP.S.demo.teeth.find(x=>String(x.name)==='45'),p=[0,1,2].map(q=>t.base[q]+t.w[q]*t.crown*0.3),T=APP.S.tooth;T.seeds=[p];T.not=[];T.erase=[];T.T=1000;T.fitted=false;T.roi={shape:'cyl',c:[p[0],p[1]],r:7,z0:p[2]-20,z1:p[2]+20};return APP.segment()});
    await pg.waitForFunction(()=>APP.S.tooth.seg&&APP.S.tooth.seg.model&&!APP.MODEL.run,null,{timeout:180000});
    const r=await pg.evaluate(()=>({vol:APP.S.tooth.seg.volume,kept:APP.MODEL.info.kept,stored:APP.MODEL.info.stored,out:document.querySelector('#dOut').textContent,rows:document.getElementById('dR').closest('.row').hidden}));
    expect(Math.abs(r.vol/tv-1)<0.05&&r.stored&&r.kept===false&&/model/.test(r.out)&&r.rows,'CBCT model outline: '+JSON.stringify(r)+' against '+tv);await noErrors(pg)});
  await test('Scan Card’s tools still open on their own, and their logo leads back to Scan Card',async()=>{const pg=await page('/scan-card/model/');
    await pg.waitForFunction(()=>window.APP&&APP.scans,null,{timeout:20000});
    expect(await pg.evaluate(()=>!APP.N.EMBED&&!APP.shell.stepEl('load').hidden&&document.querySelectorAll('#topBtns button').length===2),'Model Card on its own should have its own loading steps');
    await Promise.all([pg.waitForURL(BASE+'/scan-card/'),pg.click('#top a.brand')]);await pg.waitForFunction(()=>window.APP&&APP.TOOLS,null,{timeout:20000});await noErrors(pg)});
  await test('ImplantRef opens under its CSP with all 3,961 records, exact REF lookup and torque evidence',async()=>{const pg=await page('/implantref/');
    await pg.waitForFunction(()=>window.IMPLANTREF_DATA&&window.ImplantRefCore&&document.querySelector('.page-head h1'),null,{timeout:15000});
    expect(await pg.evaluate(()=>IMPLANTREF_DATA.records.length)===3961,'catalogue incomplete');
    expect(await pg.evaluate(()=>ImplantRefCore.exactRefMatches(IMPLANTREF_DATA.records,'046.415').length)===4,'exact REF lookup broken');
    expect(await pg.evaluate(()=>IMPLANTREF_EVIDENCE.claims.length)>=800,'evidence registry missing');
    expect(await pg.evaluate(()=>document.documentElement.dataset.sw)==='off','ImplantRef must defer to the site service worker');
    await pg.goto(BASE+'/implantref/#/catalogue');await pg.fill('#q','38878');await pg.waitForTimeout(400);
    await pg.click('tbody tr.data-row');await pg.waitForSelector('#sheet:not(.hidden) .awaiting',{timeout:5000});
    expect((await pg.request.get(BASE+'/implantref/manifest.webmanifest')).ok(),'ImplantRef manifest missing');await noErrors(pg)});
  await test('ImplantRef label scanner: assets present and GTIN → REF resolution works under the CSP',async()=>{const pg=await page('/implantref/');
    await pg.waitForFunction(()=>window.ImplantRefScan&&window.IMPLANTREF_GTIN,null,{timeout:15000});
    expect(await pg.evaluate(()=>Object.keys(IMPLANTREF_GTIN).length)>3000,'GTIN table missing');
    const ref=await pg.evaluate(()=>ImplantRefCore.resolveBarcode('(01)07630031708595(10)X',IMPLANTREF_GTIN,ImplantRefCore.buildRefIndex(IMPLANTREF_DATA.records)).candidates[0].articleNumber);
    expect(ref==='022.4102','GTIN lookup gave '+ref);
    for(const f of ['src/vendor/zxing-0.21.3.min.js','src/vendor/tesseract/tesseract.min.js','src/vendor/tesseract/worker.min.js','src/vendor/tesseract/tesseract-core-simd-lstm.wasm.js','data/ocr/eng.traineddata.gz'])
      expect((await pg.request.get(BASE+'/implantref/'+f)).ok(),'missing '+f);
    expect(await pg.locator('#scanBtn').count()===1,'scan button missing');await noErrors(pg)});
  await test('ImplantRef brands: five brand pages, FDA-listed parts and sourced torque under the CSP',async()=>{const pg=await page('/implantref/');
    await pg.waitForFunction(()=>window.IMPLANTREF_SUPPLEMENT&&document.querySelector('.brand-tile'),null,{timeout:15000});
    expect(await pg.evaluate(()=>IMPLANTREF_SUPPLEMENT.items.length)===16111,'FDA-listed parts incomplete');
    expect(await pg.locator('.brand-tile').count()===5,'brand tiles missing');
    await pg.goto(BASE+'/implantref/#/catalogue/b/southern');await pg.waitForSelector('.fda-note',{timeout:5000});
    expect((await pg.innerText('.page-head h1'))==='Southern Implants components','brand page title');
    await pg.fill('#q','TS-Z-18');await pg.waitForTimeout(500);
    await pg.click('.sup-row[data-record="fda-si-tsz18"]');await pg.waitForSelector('#sheet:not(.hidden) .sup-torque',{timeout:5000});
    const sh=await pg.innerText('#sheet');expect(sh.includes('32–40')&&sh.includes('CAT-8068-08')&&sh.includes('awaiting clinician review'),'Southern torque sheet');
    const man=await pg.evaluate(()=>ImplantRefCore.resolveBarcode('(01)04251574800008(10)X',IMPLANTREF_GTIN,ImplantRefCore.buildRefIndex(IMPLANTREF_DATA.records.concat(IMPLANTREF_SUPPLEMENT.items))).candidates[0].manufacturer);
    expect(man==='Medentika','Medentika barcode gave '+man);await noErrors(pg)});
  await test('ImplantRef pictures: links to the manufacturers\' own pages, no images, under the CSP',async()=>{const pg=await page('/implantref/#/catalogue/r/cat-0749');
    await pg.waitForSelector('#sheet:not(.hidden) .pic-block a',{timeout:15000});
    const links=await pg.$$eval('#sheet .pic-block a',a=>a.map(x=>[x.dataset.pic,x.getAttribute('href'),x.target,x.rel]));
    expect(links.length===2&&links[0][0]==='product'&&links[0][1]==='https://shop.straumann.com/gb/en_gb/p/022.4102','Straumann shop link: '+JSON.stringify(links));
    expect(links[1][0]==='catalogue'&&/^https:\/\/www\.straumann\.com\/.+452\.201-en_low\.pdf#page=140$/.test(links[1][1]),'Straumann catalogue page link: '+links[1][1]);
    expect(links.every(l=>l[2]==='_blank'&&/noopener/.test(l[3])&&/noreferrer/.test(l[3])),'picture links must open outside the app');
    expect(await pg.locator('#sheet .pic-block img, #sheet .pic-block iframe').count()===0,'no image may be shown in the picture block');
    expect((await pg.innerText('#sheet .pic-block')).includes('holds no product images'),'picture block wording');
    await pg.goto(BASE+'/implantref/#/catalogue/r/fda-si-tsdc416');await pg.waitForSelector('#sheet:not(.hidden) .pic-block.none',{timeout:5000});
    expect(await pg.locator('#sheet .pic-block a').count()===0,'Southern Implants must have no picture link');
    expect(await pg.evaluate(()=>Object.keys(IMPLANTREF_PICTURES.pages).join())==='Astra Tech,Straumann','indexed brands');await noErrors(pg)});
  await test('Guide Card opens under the site CSP with its catalogue and search',async()=>{const pg=await page('/guide-card/');
    await pg.waitForFunction(()=>typeof REFS!=='undefined'&&document.querySelector('details.cat'),null,{timeout:15000});
    expect(await pg.evaluate(()=>REFS.length)>=150,'catalogue incomplete');
    await pg.fill('#q','girft tmd');await pg.waitForTimeout(300);expect(/TMD/.test(await pg.locator('#app').innerText()),'search broken');
    expect((await pg.request.get(BASE+'/guide-card/manifest.webmanifest')).ok(),'Guide Card manifest missing');await noErrors(pg)});
  await test('Guide Card: shared record link, quick links and suite links work on the site',async()=>{const pg=await page('/guide-card/#r/bsspd-pdd');await pg.waitForTimeout(300);
    expect((await pg.$$eval('#list .entry',e=>e.map(x=>x.dataset.id))).join()==='bsspd-pdd','shared link did not open the record');
    expect(await pg.$eval('.suite-l',a=>a.getAttribute('href'))==='/chrome-card/','Chrome Card link should stay on the site');
    expect(await pg.evaluate(()=>SHARE_BASE)===BASE+'/guide-card/','share links should use this site');
    await pg.goto(BASE+'/guide-card/#library');await pg.waitForTimeout(300);expect(await pg.locator('.pin-chip').count()>=1,'quick links missing');await noErrors(pg)});
  await test('DentalAudit: a #/create?template= link starts an audit from that template',async()=>{const pg=await page('/dentalaudit/#/create?template=bpe');
    await pg.waitForFunction(()=>document.querySelector('input[data-bind="title"]'),null,{timeout:15000});await pg.waitForTimeout(300);
    expect(await pg.inputValue('input[data-bind="title"]')==='BPE recording at new patient examination','template not applied');await noErrors(pg)});
  await test('Trauma Card opens under the site CSP and builds a note, splint plan and IADT review schedule',async()=>{const pg=await page('/trauma-card/');
    expect((await pg.request.get(BASE+'/trauma-card/manifest.webmanifest')).ok(),'Trauma Card manifest missing');
    await pg.click('[data-act=example]');const n=await pg.inputValue('#out');
    expect(/REVIEW PLAN \(IADT 2020\)/.test(n)&&/Remove splint \(UR2–UL2\) at 4 weeks/.test(n),'note incomplete: '+n.slice(0,200));
    await pg.click('[data-mode=review]');await pg.click('[data-act=example]');const r=await pg.inputValue('#out');
    expect(/REVIEW – 4 weeks post-injury/.test(r)&&/not diagnostic/.test(r),'review note incomplete');
    await pg.click('[data-k=dent][data-v=prim]');await pg.click('[aria-label=ULA]');await pg.click('[data-k="t.ULA.lux"][data-v=avul]');
    expect(/Around age 6/.test(await pg.inputValue('#out')),'primary successor review missing');await noErrors(pg)});
  await test('Trauma Card: moving a review takes the later reviews with it, but not treatment deadlines',async()=>{const pg=await page('/trauma-card/');
    await pg.click('[aria-label=UL1]');await pg.click('[data-k="t.UL1.lux"][data-v=avul]');await pg.click('[data-k="t.UL1.opts.scen"][data-v="Physiological medium, dry under 60 min"]');
    const rows=async()=>(await pg.inputValue('#out')).split('\n').filter(l=>/^  \d\d\//.test(l));
    const before=await rows();await pg.click('.tl li:not(.ms) .mvbtn');
    const d=new Date();d.setDate(d.getDate()+19);const v=d.toISOString().slice(0,10);
    await pg.fill('.tl input[data-mv]',v);await pg.dispatchEvent('.tl input[data-mv]','change');await pg.waitForTimeout(150);
    const after=await rows();
    expect(after.some(l=>/2 weeks \(rescheduled\)/.test(l))&&after.some(l=>/4 weeks \(moved\)/.test(l)),'later reviews did not follow: '+after.slice(0,3).join(' | '));
    expect(after.find(l=>/start RCT/.test(l))===before.find(l=>/start RCT/.test(l)),'RCT deadline moved');
    await pg.click('.tl [data-act=mvreset]');await pg.waitForTimeout(100);expect((await rows()).join()===before.join(),'reset did not restore the IADT dates');await noErrors(pg)});
  await test('Trauma Card: one splint per arch stays on for the worst injury; no sensibility testing once extirpation is due',async()=>{const pg=await page('/trauma-card/');
    const inj=async(c,lux,scen)=>{await pg.click(`[aria-label=${c}]`);await pg.click(`[data-k="t.${c}.lux"][data-v=${lux}]`);if(scen)await pg.click(`[data-k="t.${c}.opts.scen"][data-v="${scen}"]`)};
    await inj('UL1','avul','Physiological medium, dry under 60 min');await inj('UL2','lat');await inj('LL1','ext');
    const n=await pg.inputValue('#out');
    expect(!/UL1 remove splint|UL2 remove splint/.test(n),'per-tooth splint removal suggested');
    expect(/Remove upper splint \(UR1–UL3\) at 4 weeks.*set by UL2 lateral luxation/.test(n),'upper splint not set by the worst injury: '+n.slice(n.indexOf('SPLINT'),n.indexOf('SPLINT')+260));
    expect(/Remove lower splint \(LR1–LL2\) at 2 weeks/.test(n),'lower splint should keep its own time');
    expect(/UL1 clinical \+ radiograph;/.test(n)&&/UL2 clinical \+ radiograph, sensibility/.test(n),'sensibility rule wrong');
    await pg.click('[data-mode=review]');await pg.waitForTimeout(100);
    expect(await pg.locator('[data-k="t.UL1.f.cold"]').count()===0&&await pg.locator('[data-k="t.UL2.f.cold"]').count()>0,'cold test shown for the avulsed mature tooth');await noErrors(pg)});
  await test('Letter Card opens under the site CSP, parses a note and builds every letter type with placeholders only',async()=>{const pg=await page('/letter-card/');
    expect((await pg.request.get(BASE+'/letter-card/manifest.webmanifest')).ok(),'Letter Card manifest missing');
    await pg.click('#exampleBtn');await pg.waitForTimeout(300);expect(await pg.locator('.sec').count()>=8,'note not parsed into sections');
    for(const t of ['referral','clinic','discharge','patient','tplan','postop','mdt']){await pg.click('#tab-'+t);await pg.waitForTimeout(100);
      const txt=await pg.innerText('#page');expect(/\[Patient name\]/.test(txt)&&txt.length>300,t+' letter incomplete')}
    expect(await pg.evaluate(()=>Object.keys(localStorage).every(k=>!/handoff/i.test(k)&&!/UL1/.test(localStorage.getItem(k)||''))),'note text saved to the device');await noErrors(pg)});
  await test('Letter Card picks the letter from the plan, stages a treatment plan and picks post-op advice',async()=>{const pg=await page('/letter-card/');
    await pg.fill('#paste','Dx: UL6 unrestorable, caries UR6\nTx: LA articaine. XLA UL6, 2 x Vicryl sutures\nPlan:\n- Caries control UR6\n- Crown UR6\n- Consider implant UL6\nRefer to oral surgery for LL8');
    await pg.click('#parseBtn');await pg.waitForTimeout(300);
    expect(await pg.getAttribute('#tab-referral','aria-selected')==='true','referral letter not opened from the plan');
    expect(await pg.locator('#details [data-f=dept][data-v="Oral Surgery"][aria-pressed=true]').count()===1,'department not picked');
    await pg.click('#tab-tplan');await pg.waitForTimeout(150);let t=await pg.innerText('#page');
    expect(/Urgent care[\s\S]*Decay control[\s\S]*Essential treatment[\s\S]*Crown[\s\S]*Longer term[\s\S]*implant/i.test(t),'treatment plan not staged');
    await pg.click('#tab-postop');await pg.waitForTimeout(150);t=await pg.innerText('#page');
    expect(/After your tooth extraction/.test(t)&&/While you are numb/.test(t)&&/stitches/.test(t)&&/call 111/.test(t),'post-op advice not picked');await noErrors(pg)});
  await test('Letter Card offers Polish wording on the site, and explains when the browser cannot run it',async()=>{const pg=await page('/letter-card/');
    expect(await pg.isVisible('#polBtn'),'Polish wording button missing');
    expect((await pg.request.get(BASE+'/letter-card/polish-worker.js')).ok(),'polish worker missing');
    await pg.click('#exampleBtn');await pg.waitForTimeout(200);await pg.click('#polBtn');await pg.waitForSelector('#polDlg[open] [data-pol]',{timeout:10000});
    const t=await pg.innerText('#polBody');expect(/WebGPU|never leaves this device/.test(t),'polish dialog text: '+t.slice(0,120));
    await pg.click('#polX');expect(!(await pg.isVisible('#polDlg')),'dialog did not close');
    const hide=await pg.evaluate(()=>{const c=LetterCardPolish.check('UL1 TTP negative, EPT 34.','The tooth was tender, EPT 43.');return c.join('|')});
    expect(/tooth missing: UL1/.test(hide)&&/number missing: 34/.test(hide)&&/new number: 43/.test(hide)&&/"not"/.test(hide),'checks did not flag a bad rewrite: '+hide);await noErrors(pg)});
  await test('Trauma Card hands its note to Letter Card, which offers to import it',async()=>{const pg=await page('/trauma-card/');
    await pg.click('[data-mode=review]');await pg.click('[data-act=example]');
    await Promise.all([pg.waitForURL(BASE+'/letter-card/'),pg.click('[data-act=letter]')]);
    await pg.waitForSelector('#handoff:not([hidden])',{timeout:5000});expect(/Trauma Card/.test(await pg.innerText('#hoSrc')),'wrong source');
    await pg.click('#hoImport');await pg.waitForTimeout(300);
    const txt=await pg.innerText('#page');expect(/Lateral luxation/.test(txt)&&/Assessment: Monitor/.test(txt),'trauma findings missing from the letter');
    expect(await pg.evaluate(()=>localStorage.getItem('notile:letterHandoff'))===null,'handoff left on the device');await noErrors(pg)});
  for(const [path,sel,name] of [['/dentalaudit/','aside a.brand','DentalAudit'],['/smile-card/','header h1 a.homelink','Smile Card'],['/wax-card/','header a.brand','Wax Card'],['/tray-card/','#top a.brand','Tray Card'],['/scan-card/','#top a.brand','Scan Card'],['/implantref/','aside a.brand','ImplantRef'],['/guide-card/','header h1 a.homelink','Guide Card'],['/trauma-card/','header h1 a.homelink','Trauma Card'],['/letter-card/','header h1 a.homelink','Letter Card'],['/snip-card/','header a.brand','Snip Card'],['/task-card/','header a.brand','Task Card'],['/photo-card/','header a.brand','Photo Card']])
    await test(name+' logo returns to the launcher',async()=>{const pg=await page(path);await pg.waitForTimeout(400);
      await Promise.all([pg.waitForURL(BASE+'/'),pg.click(sel)]);expect(await pg.locator('a.app').count()>=6,'not on the launcher')});
}});
