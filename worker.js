const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS'
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const clean = (v) => String(v ?? '').trim();

function code8() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 100000000).padStart(8, '0');
}

async function haremPrice() {
  const r = await fetch('https://www.haremaltin.com/dashboard/altin-fiyatlari', {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json',
      'Referer': 'https://www.haremaltin.com/',
      'X-Requested-With': 'XMLHttpRequest'
    }
  });
  return new Response(await r.text(), { status: r.status, headers: JSON_HEADERS });
}

function openSanctionsQuery(customer) {
  const isCompany = clean(customer.personType).toLocaleLowerCase('tr-TR').includes('tüzel');
  const props = {};
  if (clean(customer.fullName)) props.name = [clean(customer.fullName)];
  if (isCompany) {
    if (clean(customer.vkn)) {
      props.registrationNumber = [clean(customer.vkn)];
      props.taxNumber = [clean(customer.vkn)];
    }
    return { schema: 'Company', properties: props };
  }
  if (clean(customer.birthDate)) props.birthDate = [clean(customer.birthDate)];
  if (clean(customer.nationality)) props.nationality = [clean(customer.nationality)];
  if (clean(customer.tckn)) props.idNumber = [clean(customer.tckn)];
  return { schema: 'Person', properties: props };
}

async function screenOpenSanctions(customer, env) {
  if (!env.OPENSANCTIONS_API_KEY) {
    return {
      worked: false,
      status: 'İNCELEME',
      provider: 'OpenSanctions yapılandırılmadı',
      sources: [],
      matches: [],
      message: 'OPENSANCTIONS_API_KEY Worker secret olarak tanımlanmadı.'
    };
  }

  const threshold = Number(env.OPENSANCTIONS_THRESHOLD || 0.78);
  const url = new URL('https://api.opensanctions.org/match/default');
  ['sanction', 'sanction.linked', 'debarment', 'role.pep', 'role.rca'].forEach(t => url.searchParams.append('topics', t));
  url.searchParams.set('algorithm', 'logic-v2');
  url.searchParams.set('threshold', String(threshold));
  url.searchParams.set('limit', '8');

  const r = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Authorization': `ApiKey ${env.OPENSANCTIONS_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({ queries: { q: openSanctionsQuery(customer) } })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.detail || data?.message || `OpenSanctions HTTP ${r.status}`);

  const results = data?.responses?.q?.results || [];
  const matches = results.filter(x => x?.match === true || Number(x?.score || 0) >= threshold).map(x => {
    const topics = Array.isArray(x?.properties?.topics) ? x.properties.topics : [];
    const sanctionHit = topics.some(t => ['sanction', 'sanction.linked', 'debarment'].includes(t));
    const pepHit = topics.some(t => ['role.pep', 'role.rca'].includes(t));
    return {
      source: 'OpenSanctions',
      caption: x.caption || x.id,
      entityId: x.id || '',
      score: Number(x.score || 0),
      status: sanctionHit ? 'EŞLEŞME' : (pepHit ? 'İNCELEME' : 'İNCELEME'),
      topics,
      datasets: Array.isArray(x.datasets) ? x.datasets.slice(0, 12) : [],
      birthDate: Array.isArray(x?.properties?.birthDate) ? x.properties.birthDate[0] || '' : ''
    };
  });
  const hasSanction = matches.some(x => x.status === 'EŞLEŞME');
  const hasReview = matches.length > 0;
  return {
    worked: true,
    status: hasSanction ? 'EŞLEŞME' : (hasReview ? 'İNCELEME' : 'TEMİZ'),
    provider: 'OpenSanctions',
    sources: [...new Set(matches.flatMap(x => x.datasets || []))].slice(0, 20),
    matches,
    message: hasSanction ? 'Yaptırım/debarment eşleşmesi bulundu.' : (hasReview ? 'PEP/RCA veya diğer risk kaydı inceleme gerektiriyor.' : 'Eşleşme bulunmadı.')
  };
}

async function createNfcSession(env) {
  if (!env.NFC_SESSIONS) return json({ ok: false, message: 'NFC_SESSIONS KV binding tanımlı değil.' }, 503);
  let code = code8();
  for (let i = 0; i < 4; i++) {
    if (!(await env.NFC_SESSIONS.get(`nfc:${code}`))) break;
    code = code8();
  }
  await env.NFC_SESSIONS.put(`nfc:${code}`, JSON.stringify({ status: 'WAITING', createdAt: new Date().toISOString() }), { expirationTtl: 600 });
  return json({ ok: true, code, expiresIn: 600 });
}

function sanitizeNfcPayload(p = {}) {
  const face = clean(p.faceImageBase64);
  return {
    fullName: clean(p.fullName).slice(0, 180),
    tckn: clean(p.tckn).replace(/\D/g, '').slice(0, 11),
    documentNumber: clean(p.documentNumber || p.documentNo).slice(0, 40),
    birthDate: clean(p.birthDate).slice(0, 20),
    expiryDate: clean(p.expiryDate).slice(0, 20),
    nationality: clean(p.nationality).slice(0, 60),
    sex: clean(p.sex).slice(0, 20),
    reader: clean(p.reader || 'Asil NFC Helper').slice(0, 80),
    protocol: clean(p.protocol || 'ICAO NFC').slice(0, 80),
    faceImageBase64: face.length <= 3_500_000 ? face : ''
  };
}

async function submitNfcIdentity(body, env) {
  if (!env.NFC_SESSIONS) return json({ ok: false, message: 'NFC_SESSIONS KV binding tanımlı değil.' }, 503);
  const code = clean(body.code).replace(/\D/g, '');
  if (code.length !== 8) return json({ ok: false, message: 'Eşleştirme kodu 8 hane olmalı.' }, 400);
  const key = `nfc:${code}`;
  const current = await env.NFC_SESSIONS.get(key, 'json');
  if (!current) return json({ ok: false, message: 'Kod bulunamadı veya süresi doldu.' }, 404);
  const payload = sanitizeNfcPayload(body.payload || {});
  if (!payload.fullName && !payload.documentNumber) return json({ ok: false, message: 'Kimlik verisi boş.' }, 400);
  await env.NFC_SESSIONS.put(key, JSON.stringify({ status: 'READY', readyAt: new Date().toISOString(), payload }), { expirationTtl: 600 });
  return json({ ok: true, status: 'READY' });
}

async function pollNfcSession(body, env) {
  if (!env.NFC_SESSIONS) return json({ ok: false, message: 'NFC_SESSIONS KV binding tanımlı değil.' }, 503);
  const code = clean(body.code).replace(/\D/g, '');
  const key = `nfc:${code}`;
  const current = await env.NFC_SESSIONS.get(key, 'json');
  if (!current) return json({ ok: false, status: 'EXPIRED', message: 'Kod bulunamadı veya süresi doldu.' }, 404);
  if (current.status === 'READY') {
    await env.NFC_SESSIONS.delete(key);
    return json({ ok: true, status: 'READY', payload: current.payload });
  }
  return json({ ok: true, status: current.status || 'WAITING' });
}

async function forwardInvoice(body, env) {
  if (!env.INVOICE_PROVIDER_URL) return json({ ok: false, message: 'INVOICE_PROVIDER_URL tanımlı değil. Özel entegratör API adresini Worker secret/variable olarak tanımlayın.' }, 503);
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (env.INVOICE_AUTH_HEADER && env.INVOICE_AUTH_VALUE) headers[env.INVOICE_AUTH_HEADER] = env.INVOICE_AUTH_VALUE;
  const r = await fetch(env.INVOICE_PROVIDER_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) return json({ ok: false, message: data?.message || `Entegratör HTTP ${r.status}`, providerResponse: data }, r.status);
  return json({ ok: true, ...data });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSON_HEADERS });
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        return json({ ok: true, service: 'Asil Kuyumcu Pro Worker', version: '6.30', openSanctions: Boolean(env.OPENSANCTIONS_API_KEY), nfcKv: Boolean(env.NFC_SESSIONS), invoice: Boolean(env.INVOICE_PROVIDER_URL) });
      }
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/price')) return await haremPrice();
      if (request.method !== 'POST') return json({ ok: false, message: 'Desteklenmeyen istek.' }, 405);

      const body = await request.json().catch(() => ({}));
      switch (body.action) {
        case 'screenCustomer': {
          const result = await screenOpenSanctions(body.customer || {}, env);
          return json({ ok: true, ...result });
        }
        case 'createNfcSession': return await createNfcSession(env);
        case 'submitNfcIdentity': return await submitNfcIdentity(body, env);
        case 'pollNfcSession': return await pollNfcSession(body, env);
        case 'createInvoice': return await forwardInvoice(body, env);
        default: return json({ ok: false, message: 'Bilinmeyen action.' }, 400);
      }
    } catch (e) {
      return json({ ok: false, message: String(e?.message || e) }, 500);
    }
  }
};
