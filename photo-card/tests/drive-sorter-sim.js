// Runs PhotoCardSorter.gs (the Google Apps Script) in Node against a pretend Google Drive.
// makeJpeg(kind, slateUrl) must return the bytes of a 1200 px JPEG preview: a slate with that QR, or a plain photo.
// Returns a report the caller checks: which files ended up in which folders, and the message from each run.
const vm=require('vm'),fs=require('fs'),path=require('path');
async function simulate(makeJpeg){
  const code=fs.readFileSync(path.join(__dirname,'..','PhotoCardSorter.gs'),'utf8');
  const FOLDER='application/vnd.google-apps.folder',files=new Map();let n=0,clock=Date.parse('2026-11-20T16:00:00Z');
  const add=f=>{const id='f'+(++n);files.set(id,{id,properties:{},parents:['root'],createdTime:new Date(clock).toISOString(),...f});return id};
  const inbox=add({name:'image.canon',mimeType:FOLDER});
  const thumbs=new Map();
  async function photo(name,time,opts={}){const id=add({name:name+'.JPG',mimeType:'image/jpeg',parents:[inbox],createdTime:new Date(clock-(opts.ageMin||0)*60000).toISOString(),
      imageMediaMetadata:opts.noMeta?undefined:{time,cameraMake:'Canon',cameraModel:'Canon EOS R10'},thumbnailLink:opts.noThumb?undefined:'https://lh3.test/drive-storage/'+'x'+n+'=s220'});
    if(!opts.noThumb)thumbs.set(files.get(id).thumbnailLink.replace(/=s220$/,'=s1200'),await makeJpeg(opts.slate?'slate':'photo',opts.slate));
    if(opts.raw)add({name:name+'.CR3',mimeType:'application/octet-stream',parents:[inbox],createdTime:files.get(id).createdTime});return id}
  const unq=s=>s.replace(/\\(.)/g,'$1');
  function matches(f,q){if(f.trashed)return false;let m;
    if((m=/'([^']+)' in parents/.exec(q))&&!f.parents.includes(m[1]))return false;
    if((m=/name = '((?:[^'\\]|\\.)*)'/.exec(q))&&f.name!==unq(m[1]))return false;
    if((m=/mimeType = '([^']+)'/.exec(q))&&f.mimeType!==m[1])return false;
    if((m=/properties has \{ key='(\w+)' and value='((?:[^'\\]|\\.)*)' \}/.exec(q))&&f.properties[m[1]]!==unq(m[2]))return false;return true}
  const res=(code,obj,bytes)=>({getResponseCode:()=>code,getContentText:()=>obj?JSON.stringify(obj):'',getBlob:()=>({getBytes:()=>Array.from(new Int8Array(bytes.buffer,bytes.byteOffset,bytes.length))})});
  const calls={fetch:0,thumb:0};
  const UrlFetchApp={fetch(url,o={}){calls.fetch++;
    if(url.startsWith('https://lh3.test/')){calls.thumb++;const b=thumbs.get(url);return b?res(200,null,b):res(404)}
    const u=new URL(url),m=/\/drive\/v3\/files(?:\/([^/?]+))?$/.exec(u.pathname),method=(o.method||'get').toLowerCase();if(!m)throw new Error('unexpected url '+url);
    if(method==='get'&&!m[1]){const q=u.searchParams.get('q');let out=[...files.values()].filter(f=>matches(f,q));const max=+u.searchParams.get('pageSize');if(max)out=out.slice(0,max);return res(200,{files:out.map(f=>JSON.parse(JSON.stringify(f)))})}
    if(method==='get'){const f=files.get(m[1]);return f?res(200,{id:f.id,trashed:!!f.trashed}):res(404)}
    if(method==='post'){const b=JSON.parse(o.payload);const id=add({name:b.name,mimeType:b.mimeType,parents:b.parents,properties:b.properties||{}});return res(200,{id})}
    if(method==='patch'){const f=files.get(m[1]);if(!f)return res(404);const b=JSON.parse(o.payload||'{}');Object.assign(f.properties,b.properties||{});
      const add_=u.searchParams.get('addParents'),rem=u.searchParams.get('removeParents');if(rem)f.parents=f.parents.filter(p=>!rem.split(',').includes(p));if(add_)f.parents.push(...add_.split(','));return res(200,{id:f.id})}
    throw new Error('unexpected '+method+' '+url)}};
  const props=new Map(),logs=[];
  const ctx=vm.createContext({UrlFetchApp,console:{log:m=>logs.push(m),warn:m=>logs.push('WARN '+m)},__clock:()=>clock,
    ScriptApp:{getOAuthToken:()=>'token',getProjectTriggers:()=>[],newTrigger:()=>({timeBased:()=>({everyMinutes:()=>({create:()=>{}})})}),deleteTrigger(){}},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.has(k)?props.get(k):null,setProperty:(k,v)=>props.set(k,String(v))})},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},DriveApp:{getRootFolder(){}}});
  vm.runInContext('Date.now=function(){return __clock()}',ctx);
  vm.runInContext(code,ctx,{filename:'PhotoCardSorter.gs'});
  const where=()=>{const pathOf=id=>{const f=files.get(id);if(!f||id==='root')return '';const p=pathOf(f.parents[0]);return (p?p+'/':'')+f.name};
    const o={};for(const f of files.values())if(f.mimeType!==FOLDER){const p=pathOf(f.parents[0]);(o[p]=o[p]||[]).push(f.name)}for(const k in o)o[k].sort();return o};
  const runs=[];const run=()=>{const msg=ctx.sortPhotos();runs.push(msg);return msg};
  const A='http://localhost/photo-card/#case=caseaaaa&n=Case+A&l=UL1+implant&s=pre',B='http://localhost/photo-card/#case=casebbbb&n=Case+B&s=post';
  // first check: a stray, slate A with three photos (two with RAW), slate B with one, a late photo after a long gap, and one Drive hasn't read yet
  await photo('IMG_0001','2026:11:20 09:00:00',{ageMin:200});
  await photo('IMG_0002','2026:11:20 10:00:00',{slate:A,raw:true,ageMin:180});
  await photo('IMG_0003','2026:11:20 10:01:00',{raw:true,ageMin:180});await photo('IMG_0004','2026:11:20 10:02:00',{ageMin:180});
  await photo('IMG_0005','2026:11:20 11:00:00',{slate:B,ageMin:150});await photo('IMG_0006','2026:11:20 11:01:00',{ageMin:150});
  await photo('IMG_0007','2026:11:20 15:30:00',{ageMin:130});
  await photo('IMG_0008','',{noMeta:true,ageMin:5});
  run();const first=where(),thumbsFirst=calls.thumb;
  // second check, 10 minutes later: one more photo for case B arrives; a photo with no preview yet holds back the one after it
  clock+=10*60000;
  await photo('IMG_0009','2026:11:20 11:30:00',{ageMin:1});
  await photo('IMG_0010','2026:11:20 11:40:00',{ageMin:1,noThumb:true});await photo('IMG_0011','2026:11:20 11:41:00',{ageMin:1});
  run();const second=where();
  const caseFolders=[...files.values()].filter(f=>f.mimeType===FOLDER&&f.properties.pcCase).map(f=>f.name);
  return {first,second,runs,logs,caseFolders,thumbsFirst,thumbsSecond:calls.thumb-thumbsFirst};
}
module.exports={simulate};
