/* Notile service worker: network first, so updates show straight away; the last good copy is used when offline. */
const CACHE='notile-v9';
const PRECACHE=['/','/notile/','/notile/chart/','/dictate/','/set-app/','/set-app/list.html','/chrome-card/','/ortho-card/','/dentalaudit/','/smile-card/','/implantref/','/guide-card/','/implantref/data/catalogue-data.js','/implantref/data/evidence-data.js','/implantref/data/gtin-data.js','/implantref/data/supplement-data.js','/implantref/src/scan.js','/implantref/src/vendor/zxing-0.21.3.min.js',
  '/fonts/fonts.css','/set-app/vendor/qrcode-generator-1.4.4.js','/manifest.webmanifest','/icons/icon-192.png'];
const ok=r=>r&&r.ok&&r.type==='basic'&&!r.redirected;
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>Promise.allSettled(PRECACHE.map(u=>fetch(u,{cache:'no-cache',credentials:'same-origin'}).then(r=>ok(r)?c.put(u,r):null)))))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const req=e.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/cdn-cgi/'))return;
  // Dictate's speech engine and model (~100 MB) are cached by the engine itself; don't keep a second copy here
  if(url.pathname.startsWith('/notile/models/')||url.pathname.startsWith('/notile/vendor/'))return;
  const key=url.origin+url.pathname;
  // pages: always revalidate; if the login has expired (redirect or 401/403) hand the original request to the browser so it reaches the sign-in page
  const net=req.mode==='navigate'?fetch(key,{cache:'no-cache',credentials:'same-origin',redirect:'manual',headers:{Accept:'text/html'}}).then(r=>r.type==='opaqueredirect'||r.status===401||r.status===403?fetch(req):r):fetch(new Request(req,{cache:'no-cache'}));
  e.respondWith(net.then(r=>{if(ok(r)){const copy=r.clone();caches.open(CACHE).then(c=>c.put(key,copy))}return r})
    .catch(()=>caches.match(key).then(m=>m||(req.mode==='navigate'?caches.match(url.origin+'/'):undefined)).then(m=>m||Response.error())))});
