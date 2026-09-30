const C='asil-v6-67-customer-label-side-fix-20260930';

function patchIndexHtmlV667(html){
  const start=html.indexOf("if(x.customerOnly){");
  const end=start>=0?html.indexOf("const blocks=[];",start):-1;
  if(start<0 || end<0) return html;
  const before=html.slice(0,start);
  let block=html.slice(start,end);
  const after=html.slice(end);

  // Müşteri isim etiketi: isimler 46–72 mm sağ kanatta değil,
  // 0–23 mm karşı kanatta basılmalı. Orta bölümde mesaj/firma kalır.
  block=block
    .replaceAll('left:46.0mm;top:.55mm;width:25.4mm;', 'left:0.0mm;top:.55mm;width:22.7mm;')
    .replaceAll('left:46.0mm;top:5.00mm;width:25.4mm;', 'left:0.0mm;top:5.00mm;width:22.7mm;');

  return before+block+after;
}

async function patchedIndexResponse(request){
  try{
    const net=await fetch(request,{cache:'no-store'});
    if(!net.ok) return net;
    const html=patchIndexHtmlV667(await net.text());
    const headers=new Headers(net.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    const response=new Response(html,{
      status:net.status,
      statusText:net.statusText,
      headers
    });
    const cache=await caches.open(C);
    await cache.put('./index.html',response.clone());
    return response;
  }catch(err){
    return (await caches.match('./index.html')) || Response.error();
  }
}

self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil((async()=>{
    const cache=await caches.open(C);
    try{
      const r=await fetch('./index.html',{cache:'no-store'});
      if(r.ok){
        const html=patchIndexHtmlV667(await r.text());
        const headers=new Headers(r.headers);
        headers.delete('content-length');
        headers.delete('content-encoding');
        await cache.put('./index.html',new Response(html,{
          status:r.status,
          statusText:r.statusText,
          headers
        }));
      }
    }catch{}
  })());
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
    e.respondWith(patchedIndexResponse(e.request));
    return;
  }

  e.respondWith(fetch(e.request,{cache:'no-store'}).catch(()=>caches.match(e.request)));
});
