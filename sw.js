/* ASIL KUYUMCU PRO - SAFE SERVICE WORKER V6.95
   This worker intentionally does not rewrite HTML or inject scripts.
   It only clears old caches and unregisters itself. */
const VERSION = 'asil-safe-v6-95';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    } catch (_) {}
    try {
      await self.registration.unregister();
    } catch (_) {}
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach(client => client.postMessage({ type: 'ASIL_SAFE_SW_CLEARED', version: VERSION }));
    } catch (_) {}
  })());
});

self.addEventListener('fetch', event => {
  // Never intercept or modify application requests.
  return;
});
