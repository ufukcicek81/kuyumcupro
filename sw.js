const C='asil-v6-68-customer-name-opposite-side-20260930';
self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(C).then(c=>c.addAll(['./','./index.html'])));
});
self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    await caches.keys().then(a=>Promise.all(a.filter(x=>x!==C).map(x=>caches.delete(x))));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin!==self.location.origin || u.pathname.startsWith('/api/')) return;
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request,{cache:'no-store'}).catch(()=>caches.match('./index.html')));
    return;
  }
  e.respondWith(fetch(e.request,{cache:'no-store'}).catch(()=>caches.match(e.request)));
});
