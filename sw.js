const C='asil-v6-83-cari-history-v1-20261002';
const FEATURE='./features/cari-history-v1.js';
self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(C).then(c=>c.addAll(['./','./index.html',FEATURE])));
});
self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    await caches.keys().then(a=>Promise.all(a.filter(x=>x!==C).map(x=>caches.delete(x))));
    await self.clients.claim();
  })());
});
async function injectFeature(response){
  if(!response || !response.ok) return response;
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html')) return response;
  const text=await response.text();
  if(text.includes(FEATURE)) return new Response(text,{status:response.status,statusText:response.statusText,headers:response.headers});
  const tag=`<script src="${FEATURE}"></script>`;
  const body='</body>';
  const html=text.includes(body)?text.replace(body,tag+'\n'+body):text+'\n'+tag;
  const headers=new Headers(response.headers);
  headers.delete('content-length');
  return new Response(html,{status:response.status,statusText:response.statusText,headers});
}
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin!==self.location.origin || u.pathname.startsWith('/api/')) return;
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request,{cache:'no-store'}).then(injectFeature).catch(()=>caches.match('./index.html')));
    return;
  }
  e.respondWith(fetch(e.request,{cache:'no-store'}).catch(()=>caches.match(e.request)));
});
