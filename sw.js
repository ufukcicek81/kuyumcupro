const C='asil-v6-83-production-safety-20261003-cari-v3';
const FEATURES=['./features/cari-payment-gold-v1.js','./features/cari-history-v1.js','./features/cari-payment-ledger-v1.js'];
self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(C).then(c=>c.addAll(['./','./index.html',...FEATURES])));
});
self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    await caches.keys().then(a=>Promise.all(a.filter(x=>x!==C).map(x=>caches.delete(x))));
    await self.clients.claim();
  })());
});
async function inject(response){
  if(!response||!response.ok)return response;
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))return response;
  let text=await response.text();
  for(const f of FEATURES){
    if(!text.includes(f)){
      const tag=`<script src="${f}"></script>`;
      text=text.includes('</body>')?text.replace('</body>',tag+'\n</body>'):text+'\n'+tag;
    }
  }
  const h=new Headers(response.headers);h.delete('content-length');
  return new Response(text,{status:response.status,statusText:response.statusText,headers:h});
}
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin!==self.location.origin || u.pathname.startsWith('/api/'))return;
  if(e.request.mode==='navigate'){
    e.respondWith((async()=>{
      try{return await inject(await fetch(e.request,{cache:'no-store'}));}
      catch{return caches.match('./index.html');}
    })());
    return;
  }
  e.respondWith(fetch(e.request,{cache:'no-store'}).catch(()=>caches.match(e.request)));
});
