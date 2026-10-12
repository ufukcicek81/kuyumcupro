// Uçtan uca testler için ortak yardımcılar: sahte Firebase sunucusu ve test girişi.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const { firebaseNormalize } = require('../../js/asil-cloud-merge.js');
const TEST_PIN = '1234';

function startStaticServer() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, u === '/' ? 'index.html' : u);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    let body = fs.readFileSync(file);
    if (file.endsWith('index.html')) {
      // Test kullanıcısı: Admin şifresini 1234 yap (yalnızca testte, dosya değiştirilmez).
      body = body.toString('utf8').replace(/"username":"Admin","name":"([^"]*)","role":"([^"]*)","pinHash":"[^"]*","pinSalt":"[^"]*"/, `"username":"Admin","name":"$1","role":"$2","pin":"${TEST_PIN}"`);
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, url: `http://localhost:${server.address().port}/index.html` })));
}

/* Firebase Realtime Database REST davranışını taklit eder: ETag, if-match (412), auth kontrolü. */
function createFakeFirebase({ requireAuth = false } = {}) {
  const db = { state: null, backups: {} };
  const log = [];
  const etagOf = (v) => crypto.createHash('md5').update(JSON.stringify(v ?? null)).digest('hex');
  async function handle(route) {
    const req = route.request();
    const u = new URL(req.url());
    const auth = u.searchParams.get('auth');
    log.push({ method: req.method(), path: u.pathname, auth });
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'ETag', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (requireAuth && auth !== 'TEST_ID_TOKEN') return route.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: '{"error":"Permission denied"}' });
    if (u.pathname === '/kuyumcuProV5/state.json') {
      if ((req.headers()['accept'] || '').includes('text/event-stream')) {
        return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'text/event-stream' }, body: `retry: 500\nevent: put\ndata: ${JSON.stringify({ path: '/', data: db.state })}\n\n` });
      }
      if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, ETag: etagOf(db.state) }, contentType: 'application/json', body: JSON.stringify(db.state) });
      if (req.method() === 'PUT') {
        const ifMatch = req.headers()['if-match'];
        if (ifMatch && ifMatch !== etagOf(db.state)) return route.fulfill({ status: 412, headers: cors, body: '{"error":"ETag mismatch"}' });
        db.state = firebaseNormalize(JSON.parse(req.postData())) ?? null; // Firebase boş dizi/nesne ve null saklamaz
        return route.fulfill({ status: 200, headers: { ...cors, ETag: etagOf(db.state) }, contentType: 'application/json', body: JSON.stringify(db.state) });
      }
    }
    if (u.pathname.startsWith('/kuyumcuProV5/backups')) {
      if (req.method() === 'PUT') { db.backups[u.pathname] = true; return route.fulfill({ status: 200, headers: cors, body: '{}' }); }
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{}' });
    }
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: 'null' });
  }
  return { db, log, handle };
}

async function newDevice(browser, appUrl, firebase, { authConfig } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.route(/firebaseio\.com/, (r) => firebase.handle(r));
  await ctx.route(/googleapis\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ idToken: 'TEST_ID_TOKEN', id_token: 'TEST_ID_TOKEN', refreshToken: 'R', refresh_token: 'R', expiresIn: '3600', expires_in: '3600', localId: 'UID1', user_id: 'UID1', email: 'magaza@test.com' }) }));
  await ctx.route(/workers\.dev|jsdelivr|supabase|haremaltin/, (r) => r.abort());
  if (authConfig) await ctx.addInitScript((c) => localStorage.setItem('asil_firebase_auth_v7', JSON.stringify(c)), authConfig);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => { page.lastDialog = d.message(); d.accept(); });
  await page.goto(appUrl);
  await page.waitForSelector('#loginPin');
  await page.fill('#loginPin', TEST_PIN);
  await page.click('#loginForm button[type=submit]');
  await page.waitForSelector('[data-home-trade]');
  await page.waitForTimeout(1500);
  return page;
}

async function launch() {
  const { chromium } = require('playwright');
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  return chromium.launch({ executablePath });
}

async function historyText(page, trade) {
  await page.click(`[data-home-trade="${trade}"]`);
  await page.waitForSelector('#stHistoryToggle');
  const t = await page.evaluate(() => document.getElementById('stHistoryPanel').innerText);
  await page.click('#modalX');
  return t;
}

module.exports = { startStaticServer, createFakeFirebase, newDevice, launch, historyText };
