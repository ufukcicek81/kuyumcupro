/* ASIL KUYUMCU PRO — SUPABASE CLOUD BRIDGE
   The application still calls its legacy Firebase URLs internally.
   This worker transparently redirects the state GET/PUT traffic to Supabase,
   so the existing application code can synchronize between devices without Firebase.
*/
const SW_VERSION = 'asil-supabase-bridge-v1';
const SUPABASE_URL = 'https://isrcaoulynycmwnxofgn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_2lHpVrZEgHmPjWD8kOEuLA_Fz6gzZEe';
const STATE_ID = 'kuyumcu_state';
const LEGACY_STATE_HOST = 'asil-kuyumculuk-2feb6-default-rtdb.firebaseio.com';
const LEGACY_STATE_PATH = '/kuyumcuProV5/state.json';

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...extra,
  };
}

async function readState() {
  const url = `${SUPABASE_URL}/rest/v1/app_settings?id=eq.${encodeURIComponent(STATE_ID)}&select=data,updated_at`;
  const response = await fetch(url, {
    method: 'GET',
    headers: supabaseHeaders({ Accept: 'application/json' }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Supabase GET ${response.status}`);
  const rows = await response.json();
  return rows.length ? rows[0].data : null;
}

async function writeState(body) {
  const url = `${SUPABASE_URL}/rest/v1/app_settings?on_conflict=id`;
  const response = await fetch(url, {
    method: 'POST',
    headers: supabaseHeaders({
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    }),
    body: JSON.stringify({ id: STATE_ID, data: body, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Supabase POST ${response.status} ${detail.slice(0, 300)}`);
  }
  const rows = await response.json().catch(() => []);
  return rows[0]?.data ?? body;
}

function isLegacyStateRequest(url) {
  return url.hostname === LEGACY_STATE_HOST && url.pathname === LEGACY_STATE_PATH;
}

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach(client => client.postMessage({ type: 'ASIL_SUPABASE_BRIDGE_ACTIVE', version: SW_VERSION }));
  })());
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  if (!isLegacyStateRequest(requestUrl)) return;

  event.respondWith((async () => {
    try {
      if (event.request.method === 'GET') {
        const state = await readState();
        if (state === null) {
          return new Response('null', {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          });
        }
        return new Response(JSON.stringify(state), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }

      if (event.request.method === 'PUT' || event.request.method === 'PATCH') {
        const body = await event.request.clone().json();
        const saved = await writeState(body);
        return new Response(JSON.stringify(saved), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }

      return fetch(event.request);
    } catch (error) {
      return new Response(JSON.stringify({
        error: 'SUPABASE_CLOUD_BRIDGE_ERROR',
        message: String(error?.message || error),
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
  })());
});
