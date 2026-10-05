/* ASIL KUYUMCU PRO — SUPABASE CLOUD BRIDGE
   The application still contains legacy Firebase cloud URLs.
   This worker keeps the old app code working by injecting a fetch bridge
   into the HTML and by handling legacy state requests when possible.
*/
const SW_VERSION = 'asil-supabase-bridge-v4';
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

// This runs inside the page before the application code. It is the important
// part of the migration: PUT to Firebase would trigger a CORS preflight, so a
// service-worker-only redirect is not reliable. We replace window.fetch before
// the app starts, so the app never sends the cloud write to Firebase.
const PAGE_BRIDGE = `
<script>
(()=>{
  if(window.__asilSupabaseBridgeV4)return;
  window.__asilSupabaseBridgeV4=true;
  const SB_URL=${JSON.stringify(SUPABASE_URL)};
  const SB_KEY=${JSON.stringify(SUPABASE_KEY)};
  const STATE_ID=${JSON.stringify(STATE_ID)};
  const LEGACY_HOST=${JSON.stringify(LEGACY_STATE_HOST)};
  const LEGACY_PATH=${JSON.stringify(LEGACY_STATE_PATH)};
  const originalFetch=window.fetch.bind(window);
  const headers=(extra={})=>Object.assign({apikey:SB_KEY,Authorization:'Bearer '+SB_KEY},extra);
  const isLegacy=(url)=>{try{const u=new URL(url,location.href);return u.hostname===LEGACY_HOST&&u.pathname===LEGACY_PATH;}catch(_){return false;}};
  async function getState(){
    const r=await originalFetch(SB_URL+'/rest/v1/app_settings?id=eq.'+encodeURIComponent(STATE_ID)+'&select=data,updated_at',{method:'GET',headers:headers({Accept:'application/json'}),cache:'no-store'});
    if(!r.ok)throw new Error('Supabase GET '+r.status);
    const rows=await r.json();
    return rows.length?rows[0].data:null;
  }
  async function putState(body){
    const r=await originalFetch(SB_URL+'/rest/v1/app_settings?on_conflict=id',{method:'POST',headers:headers({'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=representation'}),body:JSON.stringify({id:STATE_ID,data:body,updated_at:new Date().toISOString()})});
    if(!r.ok){let d='';try{d=await r.text();}catch(_){}throw new Error('Supabase POST '+r.status+' '+d.slice(0,300));}
    const rows=await r.json().catch(()=>[]);
    return rows[0]?.data??body;
  }
  window.fetch=async function(input,init){
    let url='';try{url=typeof input==='string'?input:input?.url||'';}catch(_){}
    if(!isLegacy(url))return originalFetch(input,init);
    const method=String(init?.method||input?.method||'GET').toUpperCase();
    try{
      if(method==='GET'){
        const data=await getState();
        return new Response(data===null?'null':JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
      }
      if(method==='PUT'||method==='PATCH'){
        const raw=init?.body!==undefined?init.body:await input.clone().text();
        const body=typeof raw==='string'?JSON.parse(raw):raw;
        const data=await putState(body);
        return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
      }
    }catch(e){
      return new Response(JSON.stringify({error:'SUPABASE_CLOUD_BRIDGE_ERROR',message:String(e?.message||e)}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    }
    return originalFetch(input,init);
  };
})();
</script>`;

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

  // Inject the bridge into the actual application document.
  if (event.request.mode === 'navigate' && event.request.method === 'GET') {
    event.respondWith((async () => {
      const response = await fetch(event.request);
      const type = response.headers.get('content-type') || '';
      if (!type.includes('text/html')) return response;
      try {
        const html = await response.text();
        if (!html.includes('__asilSupabaseBridgeV4')) {
          const patched = html.includes('</head>')
            ? html.replace('</head>', PAGE_BRIDGE + '</head>')
            : PAGE_BRIDGE + html;
          return new Response(patched, {
            status: response.status,
            statusText: response.statusText,
            headers: new Headers(response.headers),
          });
        }
      } catch (_) {}
      return response;
    })());
    return;
  }

  if (!isLegacyStateRequest(requestUrl)) return;

  event.respondWith((async () => {
    try {
      if (event.request.method === 'GET') {
        const state = await readState();
        return new Response(state === null ? 'null' : JSON.stringify(state), {
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
