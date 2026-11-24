// Asil Kuyumcu Köprü — WhatsApp (gayriresmî, WhatsApp Web bağlantısı)
//
// Dükkân bilgisayarındaki köprü, WhatsApp'a "bağlı cihaz" olarak bağlanır (QR kod ile).
// Program mesajı köprüye gönderir, köprü WhatsApp'tan iletir. Ücretsizdir; ancak WhatsApp'ın
// resmî yolu değildir — numara kısıtlanabilir. Bu yüzden bildirimler için AYRI bir hat önerilir.
// Toplu / reklam mesajı göndermeyin. Gönderimler sıraya alınır ve aralıklı gönderilir.
'use strict';
const path = require('path');
const fs = require('fs');

const AUTH_DIR = path.join(__dirname, 'wa-oturum');
let lib = null;           // { baileys, pino, QR }
let sock = null;
let starting = null;
let status = 'kapalı';    // kapalı | bağlanıyor | qr | bağlı | hata
let qrDataUrl = '';
let me = '';
let lastError = '';
let queue = Promise.resolve();
let lastSendAt = 0;
let daily = { day: '', count: 0 };
let opts = { minIntervalMs: 4000, dailyLimit: 300, log: () => {} };
let reconnectTimer = null;

// Gelen mesajlar (müşterinin "ONAY" cevabı gibi) diske yazılır: program kapalıyken gelenler de sonra okunur.
let inboxFile = path.join(__dirname, 'wa-gelen.json');
let lidFile = path.join(__dirname, 'wa-lid.json');
let inboxList = null;
let lidMap = null;
const digits = (j) => String(j || '').split('@')[0].split(':')[0].replace(/\D/g, '');
function readJson(file, fallback) { if (!file) return fallback; try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; } }
function writeJson(file, value) { if (!file) return; try { fs.writeFileSync(file, JSON.stringify(value)); } catch (_) {} }
function loadInbox() { if (!inboxList) { inboxList = readJson(inboxFile, []); if (!Array.isArray(inboxList)) inboxList = []; } return inboxList; }
function loadLid() { if (!lidMap) { lidMap = readJson(lidFile, {}); if (!lidMap || typeof lidMap !== 'object') lidMap = {}; } return lidMap; }
function textOf(msg) {
  msg = msg || {};
  if (msg.ephemeralMessage) msg = msg.ephemeralMessage.message || {};
  return String(msg.conversation || (msg.extendedTextMessage && msg.extendedTextMessage.text)
    || (msg.buttonsResponseMessage && msg.buttonsResponseMessage.selectedDisplayText)
    || (msg.templateButtonReplyMessage && msg.templateButtonReplyMessage.selectedDisplayText) || '').trim();
}
function onIncoming(m) {
  if (!m || !m.key || m.key.fromMe) return;
  const rj = String(m.key.remoteJid || '');
  if (rj.endsWith('@g.us') || rj === 'status@broadcast' || rj.endsWith('@newsletter')) return;
  const text = textOf(m.message);
  if (!text) return;
  // Yeni WhatsApp sürümleri numara yerine gizli kimlik (@lid) verebilir; gerçek numara ayrı alanda gelir.
  const pnJid = [m.key.senderPn, m.key.remoteJidAlt, m.key.participantPn, rj].find((x) => x && String(x).endsWith('@s.whatsapp.net')) || '';
  const lid = rj.endsWith('@lid') ? digits(rj) : '';
  const from = digits(pnJid) || (lid && loadLid()[lid]) || '';
  const msg = m.message && m.message.ephemeralMessage ? m.message.ephemeralMessage.message || {} : (m.message || {});
  const ctx = (msg.extendedTextMessage && msg.extendedTextMessage.contextInfo) || {};
  const list = loadInbox();
  const id = String(m.key.id || '');
  if (id && list.some((x) => x.id === id)) return;
  list.push({ id, from, lid, text: text.slice(0, 500), ts: Number(m.messageTimestamp || 0) * 1000 || Date.now(), quoted: String(ctx.stanzaId || '') });
  if (list.length > 1000) list.splice(0, list.length - 1000);
  writeJson(inboxFile, list);
  opts.log(`WhatsApp mesaj geldi: ${from || rj} · ${text.slice(0, 40)}`);
}
function inbox(since) { return loadInbox().filter((x) => x.ts > Number(since || 0)).slice(-200); }

async function loadLib() {
  if (lib) return lib;
  try {
    const baileys = await import('@whiskeysockets/baileys');
    const pino = (await import('pino')).default;
    const qr = await import('qrcode');
    lib = { baileys, pino, QR: qr.default || qr };
    return lib;
  } catch (e) {
    throw new Error('WhatsApp modülü kurulu değil. C:\\kopru\\WHATSAPP_KUR.bat dosyasını çalıştırın.');
  }
}

function configure(o = {}) {
  opts = {
    ...opts,
    minIntervalMs: Math.max(1000, Number(o.waMinIntervalMs || opts.minIntervalMs)),
    dailyLimit: Math.max(1, Number(o.waDailyLimit || opts.dailyLimit)),
    log: typeof o.log === 'function' ? o.log : opts.log
  };
}

function hasSession() { try { return fs.existsSync(path.join(AUTH_DIR, 'creds.json')); } catch (_) { return false; } }

async function start() {
  if (sock || starting) return starting;
  starting = (async () => {
    const { baileys, pino, QR } = await loadLib();
    const makeWASocket = baileys.default || baileys.makeWASocket;
    const { useMultiFileAuthState, DisconnectReason, Browsers } = baileys;
    status = 'bağlanıyor'; lastError = '';
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const s = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: Browsers && Browsers.windows ? Browsers.windows('Asil Kuyumcu') : ['Asil Kuyumcu', 'Desktop', '1.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false
    });
    sock = s;
    s.ev.on('creds.update', saveCreds);
    s.ev.on('messages.upsert', (u) => { try { ((u && u.messages) || []).forEach(onIncoming); } catch (_) {} });
    s.ev.on('connection.update', async (u) => {
      if (u.qr) {
        status = 'qr';
        try { qrDataUrl = await QR.toDataURL(u.qr, { margin: 1, width: 280 }); } catch (_) { qrDataUrl = ''; }
        opts.log('WhatsApp: QR kod hazır — programdan okutun.');
      }
      if (u.connection === 'open') {
        status = 'bağlı'; qrDataUrl = ''; lastError = '';
        me = String((s.user && s.user.id) || '').split(':')[0].split('@')[0];
        opts.log(`WhatsApp bağlandı: ${me}`);
      }
      if (u.connection === 'close') {
        const code = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output && u.lastDisconnect.error.output.statusCode;
        lastError = (u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.message) || '';
        sock = null;
        if (code === (DisconnectReason && DisconnectReason.loggedOut)) {
          status = 'kapalı'; me = ''; qrDataUrl = '';
          try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (_) {}
          opts.log('WhatsApp oturumu kapatıldı (telefondan çıkış). Yeniden bağlamak için QR okutun.');
        } else {
          status = 'bağlanıyor';
          opts.log('WhatsApp bağlantısı koptu, yeniden bağlanıyor… ' + lastError);
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => { start().catch(e => { status = 'hata'; lastError = String(e.message || e); }); }, 4000);
        }
      }
    });
  })();
  try { await starting; } catch (e) { status = 'hata'; lastError = String(e.message || e); sock = null; throw e; } finally { starting = null; }
}

function info() {
  return { status, qr: status === 'qr' ? qrDataUrl : '', me, error: lastError || undefined, sentToday: daily.day === today() ? daily.count : 0, dailyLimit: opts.dailyLimit };
}

const today = () => new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d[0] === '0') d = '9' + d;
  else if (d.length === 10 && d[0] === '5') d = '90' + d;
  return d.length >= 11 ? d : '';
}

function send(phone, text) {
  const job = queue.then(async () => {
    if (!sock || status !== 'bağlı') throw new Error('WhatsApp bağlı değil. Programda WhatsApp Ayarları → QR kodu okutun.');
    const num = normPhone(phone);
    if (!num) throw new Error('Geçersiz telefon numarası');
    const msg = String(text || '').trim();
    if (!msg) throw new Error('Mesaj boş');
    if (daily.day !== today()) daily = { day: today(), count: 0 };
    if (daily.count >= opts.dailyLimit) throw new Error(`Günlük mesaj sınırı (${opts.dailyLimit}) doldu`);
    const wait = lastSendAt + opts.minIntervalMs + Math.floor(Math.random() * 1500) - Date.now();
    if (wait > 0) await sleep(wait);
    const jid = num + '@s.whatsapp.net';
    const found = await sock.onWhatsApp(jid);
    const r = Array.isArray(found) ? found[0] : found;
    if (!r || !r.exists) throw new Error(`${num} numarası WhatsApp kullanmıyor`);
    if (r.lid) { const map = loadLid(), l = digits(r.lid); if (l && map[l] !== num) { map[l] = num; writeJson(lidFile, map); } }
    const res = await sock.sendMessage(r.jid || jid, { text: msg });
    lastSendAt = Date.now(); daily.count++;
    opts.log(`WhatsApp gönderildi → ${num}`);
    return { ok: true, id: res && res.key && res.key.id, to: num };
  });
  queue = job.catch(() => {});
  return job;
}

async function logout() {
  try { if (sock) await sock.logout(); } catch (_) {}
  sock = null; status = 'kapalı'; me = ''; qrDataUrl = '';
  try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (_) {}
  return { ok: true };
}

// Testler için: sahte kütüphane / soket.
function _setLib(l) { lib = l; }
function _reset(files) { inboxList = null; lidMap = null; if (files !== undefined) { inboxFile = files && files.inbox; lidFile = files && files.lid; } sock = null; starting = null; status = 'kapalı'; qrDataUrl = ''; me = ''; lastError = ''; queue = Promise.resolve(); lastSendAt = 0; daily = { day: '', count: 0 }; }

module.exports = { configure, start, info, send, logout, hasSession, normPhone, inbox, _onIncoming: onIncoming, _setLib, _reset };
