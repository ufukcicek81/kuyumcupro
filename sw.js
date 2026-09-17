const CACHE_NAME = 'asil-kuyumcu-pro-v4-3-has-kar-r1';
const APP_SHELL = ['./','./index.html','./manifest.webmanifest','./icon.svg','./data/pusula-initial.js'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin){ event.respondWith(fetch(event.request)); return; }
  // HTML ve veri dosyalarında daima önce ağ: eski V4.0 cache'i veri yüklemesini engellemesin.
  const networkFirst = event.request.mode === 'navigate' || /index\.html$|pusula-initial\.js$|manifest\.webmanifest$/.test(url.pathname);
  if(networkFirst){
    event.respondWith(fetch(event.request, {cache:'no-store'}).then(response => {
      const copy=response.clone(); caches.open(CACHE_NAME).then(c=>c.put(event.request,copy)).catch(()=>{}); return response;
    }).catch(()=>caches.match(event.request).then(c=>c || caches.match('./index.html'))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy=response.clone(); caches.open(CACHE_NAME).then(c=>c.put(event.request,copy)).catch(()=>{}); return response;
  })));
});
