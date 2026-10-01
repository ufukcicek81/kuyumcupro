const C='asil-v6-93-cari-filter-20261001';

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

  event.respondWith((async () => {
    const response = await fetch(request, { cache: 'no-store' });
    const type = response.headers.get('content-type') || '';
    const isHtml = type.includes('text/html') && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'));
    if (!isHtml) return response;

    try {
      const html = await response.text();
      if (html.includes('UFUK_CARI_STABLE_FILTER_V692')) return new Response(html, {status:response.status,statusText:response.statusText,headers:response.headers});
      const injected = html.replace(/<\/body>/i, '<script src="./cari-fix.js?v=692"></script></body>');
      return new Response(injected, {status:response.status,statusText:response.statusText,headers:response.headers});
    } catch (e) {
      return response;
    }
  })());
});
