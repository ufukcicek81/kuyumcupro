const C='asil-v6-92-nocache-20261001';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  // Uygulamanın HTML/CSS/JS dosyaları kesinlikle eski cache'ten dönmesin.
  event.respondWith(fetch(request, { cache: 'no-store' }));
});
