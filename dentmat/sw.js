/* DentMat 3.3.0 service worker for the hosted build.
   Network first, so corrections show straight away; the last good copy is used offline.
   External manufacturer documents are NOT cached (they may change and must be opened live).
   If the site sign-in has expired (redirect or 401/403), the original request goes to the
   browser so it reaches the sign-in page instead of a cached copy. */
const CACHE='dentmat-3.3.0';
const ASSETS=['./','./manifest.webmanifest','./assets/icon-192.png','./assets/panavia-v5-zirconia.png'];
const ok=r=>r&&r.ok&&r.type==='basic'&&!r.redirected;
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>Promise.allSettled(ASSETS.map(u=>fetch(u,{cache:'no-cache',credentials:'same-origin'}).then(r=>ok(r)?c.put(new URL(u,self.registration.scope).href,r):null)))))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('dentmat-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const req=e.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/cdn-cgi/'))return;
  let key=url.origin+url.pathname;if(key.endsWith('/index.html'))key=key.slice(0,-10);
  const net=req.mode==='navigate'?fetch(key,{cache:'no-cache',credentials:'same-origin',redirect:'manual',headers:{Accept:'text/html'}}).then(r=>r.type==='opaqueredirect'||r.status===401||r.status===403?fetch(req):r):fetch(new Request(req,{cache:'no-cache'}));
  e.respondWith(net.then(r=>{if(ok(r)){const copy=r.clone();caches.open(CACHE).then(c=>c.put(key,copy))}return r})
    .catch(()=>caches.match(key).then(m=>m||(req.mode==='navigate'?caches.match(self.registration.scope):undefined)).then(m=>m||Response.error())))});
