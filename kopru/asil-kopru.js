#!/usr/bin/env node
// Asil Kuyumcu Pro — Dükkan Köprüsü (İşNet / NetteFatura e-Fatura & e-Arşiv)
//
// Dükkan bilgisayarında çalışır. Program faturayı bu köprüye gönderir; köprü
// faturayı İşNet SOAP servisine iletir. İşNet kimliği IP + VKN ile doğrular,
// bu yüzden hiçbir kullanıcı adı / şifre burada tutulmaz.
//
// Çalıştırma:  node asil-kopru.js          (ayarlar asil-kopru.json dosyasından)
// Sadece bu bilgisayardan erişilir (127.0.0.1). Ek paket gerektirmez (Node 18+).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENDPOINTS = {
  test: 'https://einvoiceservicetest.isnet.net.tr',
  live: 'https://einvoiceservice.isnet.net.tr'
};
const TEST_VKN = '4810173324';
const VERSION = '1.0';

function loadConfig() {
  const file = process.env.ASIL_KOPRU_CONFIG || path.join(__dirname, 'asil-kopru.json');
  let c = {};
  try { c = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  const mode = String(process.env.ISNET_MODE || c.mode || 'test').toLowerCase() === 'live' ? 'live' : 'test';
  return {
    file,
    mode,
    port: Number(process.env.ASIL_KOPRU_PORT || c.port || 8787),
    vkn: String(process.env.ISNET_VKN || c.vkn || (mode === 'test' ? TEST_VKN : '')).replace(/\D/g, ''),
    baseUrl: String(process.env.ISNET_URL || c.serviceUrl || ENDPOINTS[mode]).replace(/\/+$/, ''),
    sendMail: c.sendMail !== false,
    allowedOrigins: Array.isArray(c.allowedOrigins) ? c.allowedOrigins : []
  };
}

// ---------- SOAP yardımcıları ----------
const NS_MODEL = 'http://schemas.datacontract.org/2004/07/EInvoice.Service.Model';
const NS_ARR = 'http://schemas.microsoft.com/2003/10/Serialization/Arrays';
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ordinal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// WCF DataContract: alanlar ordinal (büyük/küçük harf duyarlı) alfabetik sırayla gelmelidir.
function toXml(obj, prefix = 'a') {
  let out = '';
  for (const key of Object.keys(obj).sort(ordinal)) {
    const v = obj[key];
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      // { __item: 'Tax', list: [...] } biçimi için aşağıdaki listOf kullanılır
      throw new Error('Dizi alanı listOf ile verilmeli: ' + key);
    }
    if (v && v.__list) {
      out += `<${prefix}:${key}>` + v.items.map(it => v.primitive
        ? `<b:${v.__list}>${xmlEsc(it)}</b:${v.__list}>`
        : `<${prefix}:${v.__list}>${toXml(it, prefix)}</${prefix}:${v.__list}>`).join('') + `</${prefix}:${key}>`;
    } else if (typeof v === 'object') {
      out += `<${prefix}:${key}>${toXml(v, prefix)}</${prefix}:${key}>`;
    } else {
      out += `<${prefix}:${key}>${xmlEsc(v)}</${prefix}:${key}>`;
    }
  }
  return out;
}
const listOf = (name, items, primitive = false) => ({ __list: name, items, primitive });

async function soapCall(cfg, service, op, requestObj) {
  const svc = service === 'address' ? 'AddressBookService/ServiceContract/AddressBookService.svc' : 'InvoiceService/ServiceContract/InvoiceService.svc';
  const iface = service === 'address' ? 'IAddressBookService' : 'IInvoiceService';
  const inner = requestObj === undefined ? '' : `<request xmlns:a="${NS_MODEL}" xmlns:b="${NS_ARR}">${toXml(requestObj)}</request>`;
  const body = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><${op} xmlns="http://tempuri.org/">${inner}</${op}></s:Body></s:Envelope>`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 60000);
  let res, text;
  try {
    res = await fetch(`${cfg.baseUrl}/${svc}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"http://tempuri.org/${iface}/${op}"` },
      body,
      signal: ctl.signal
    });
    text = await res.text();
  } finally { clearTimeout(t); }
  const fault = /<faultstring[^>]*>([\s\S]*?)<\/faultstring>/.exec(text);
  if (fault) throw new Error('İşNet: ' + decodeXml(fault[1]));
  if (!res.ok) throw new Error(`İşNet HTTP ${res.status}`);
  return text;
}
const decodeXml = s => String(s || '').replace(/&#xD;|&#xA;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function tag(xml, name) { const m = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml); return m ? decodeXml(m[1]) : ''; }
function tags(xml, name) { const r = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'g'); const out = []; let m; while ((m = r.exec(xml))) out.push(decodeXml(m[1])); return out; }
function checkResult(xml) {
  const result = tag(xml, 'Result');
  if (result && result !== 'Success') throw new Error(tag(xml, 'ErrorMessage') || 'İşNet işlemi başarısız');
}

// ---------- İşNet işlemleri ----------
async function healthCheck(cfg) { return tag(await soapCall(cfg, 'invoice', 'HealthCheck'), 'HealthCheckResult') === 'true'; }
async function balance(cfg) { const x = await soapCall(cfg, 'invoice', 'GetCompanyBalance', { CompanyTaxCode: cfg.vkn }); checkResult(x); return Number(tag(x, 'Balance') || 0); }

// Alıcı e-Fatura mükellefi mi? Mükellefse posta kutusu etiketini döndürür.
async function taxPayerInbox(cfg, taxCode) {
  if (!taxCode || /^1{11}$/.test(taxCode)) return '';
  const x = await soapCall(cfg, 'address', 'GetTaxPayer', { TaxPayerTaxCode: taxCode });
  // Kayıtlı kullanıcı yoksa alıcı e-Fatura mükellefi değildir → e-Arşiv.
  if (tag(x, 'Result') === 'Failed' && /bulunamad/i.test(tag(x, 'ErrorMessage'))) return '';
  checkResult(x);
  const payers = tags(x, 'TaxPayer');
  for (const p of payers) {
    const inbox = tags(p, 'string').find(Boolean);
    if (inbox) return inbox;
  }
  return '';
}

async function viewerLink(cfg, ettn, documentType) {
  const x = await soapCall(cfg, 'invoice', 'GetDocumentViewerLink', {
    CompanyTaxCode: cfg.vkn, Ettn: ettn, InvoiceDirection: 'Outgoing',
    InvoiceDocumentType: documentType === 'EFATURA' ? 'EInvoice' : 'EArchiveInvoice'
  });
  checkResult(x);
  return tag(x, 'DocumentViewerLink');
}

// Gönderilen faturanın resmî XML (UBL-TR) dosyası — İşNet'e canlı geçiş için örnek olarak iletilir.
async function invoiceXml(cfg, ettn, documentType) {
  if (!ettn) throw new Error('ETTN boş');
  if (!documentType) {
    try { return await invoiceXml(cfg, ettn, 'EARSIV'); } catch (_) { return invoiceXml(cfg, ettn, 'EFATURA'); }
  }
  const base = { CompanyTaxCode: cfg.vkn, Ettn: ettn, PagingRequest: { PageNumber: '1', RecordsPerPage: '1' }, ResultSet: { IsXMLIncluded: 'true' } };
  const x = documentType === 'EFATURA'
    ? await soapCall(cfg, 'invoice', 'SearchInvoice', { ...base, InvoiceDirection: 'Outgoing' })
    : await soapCall(cfg, 'invoice', 'SearchArchiveInvoice', base);
  checkResult(x);
  const b64 = tag(x, 'InvoiceXml').replace(/\s+/g, '');
  if (!b64) throw new Error('Fatura XML henüz hazır değil; bir dakika sonra tekrar deneyin');
  return Buffer.from(b64, 'base64').toString('utf8');
}

// ---------- Programın gönderdiği faturayı İşNet modeline çevirme ----------
const r2 = x => Math.round(Number(x || 0) * 100) / 100;
const UNIT = { GR: 'GRM', GRAM: 'GRM', ADET: 'C62', AD: 'C62', KG: 'KGM' };
function istanbulDateTime(d) {
  const dt = d ? new Date(d) : new Date();
  const base = isNaN(dt) ? new Date() : dt;
  // İşNet tarih alanı yerel saat olarak yorumlar; Türkiye saati (UTC+3) gönderilir.
  const tr = new Date(base.getTime() + 3 * 3600 * 1000);
  return tr.toISOString().slice(0, 19);
}
function splitAddress(a) {
  const s = String(a || '').trim();
  const parts = s.split(/\s*[\/,]\s*/).filter(Boolean);
  const city = parts.length > 1 ? parts[parts.length - 1] : '';
  const town = parts.length > 2 ? parts[parts.length - 2] : '';
  return { street: s || '-', city: city || '-', town: town || '-' };
}

// İşNet ürün kartı için kaynak kodu: altın satırı ayara göre, işçilik sabit kod.
function productCode(l) {
  if (l.code) return String(l.code).slice(0, 40);
  if (l.kind === 'labour' || /işçilik|iscilik/i.test(l.name || '')) return 'ISCILIK';
  const k = /(\d{1,2})\s*AYAR/i.exec(l.name || '');
  if (k) return 'ALTIN' + k[1];
  if (/GÜMÜŞ|GUMUS/i.test(l.name || '') && !/\s/.test((l.name || '').trim())) return 'GUMUS';
  const tr = { Ç: 'C', Ğ: 'G', İ: 'I', I: 'I', Ö: 'O', Ş: 'S', Ü: 'U' };
  return String(l.name || 'URUN').toLocaleUpperCase('tr-TR').replace(/[ÇĞİIÖŞÜ]/g, c => tr[c]).replace(/[^A-Z0-9]/g, '').slice(0, 30) || 'URUN';
}

function buildInvoice(p, documentType, inboxTag) {
  const lines = (p.sale && p.sale.lines) || [];
  if (!lines.length) throw new Error('Faturada satır yok');
  const rc = p.receiver || {};
  const taxCode = String(rc.vkn || rc.tckn || '').replace(/\D/g, '') || '11111111111';
  if (!(rc.name || '').trim()) throw new Error('Alıcı adı boş');
  const adr = splitAddress(rc.address);

  let net = 0, vat = 0;
  const vatByRate = new Map();
  let exemptCode = '', exemptReason = '', specialCode = '';
  const details = lines.map(l => {
    const qty = Number(l.quantity) || 1;
    const lineNet = r2(l.total);
    const rate = Number(l.vatRate) || 0;
    const lineVat = r2(l.vatAmount);
    net += lineNet; vat += lineVat;
    const t = vatByRate.get(rate) || { base: 0, vat: 0 };
    t.base += lineNet; t.vat += lineVat; vatByRate.set(rate, t);
    const d = {
      CurrencyCode: 'TRY',
      LineExtensionAmount: lineNet.toFixed(2),
      Product: {
        MeasureUnit: UNIT[String(l.unit || '').toUpperCase()] || 'C62',
        ExternalProductCode: productCode(l),
        ProductCode: productCode(l),
        ProductName: l.name || 'ÜRÜN',
        UnitPrice: (lineNet / qty).toFixed(6)
      },
      Quantity: String(qty),
      VATAmount: lineVat.toFixed(2),
      VATRate: String(rate)
    };
    if (l.specialBase != null && l.exemptionCode) {
      // Özel matrah (KDVK 23/e, 805 altın / 808 gümüş): satır tutarı altın + işçilik, KDV yalnız işçilikten.
      d.SpecialBasisAmount = r2(l.specialBase).toFixed(2);
      d.SpecialBasisReasonCode = String(l.exemptionCode);
      specialCode = specialCode || String(l.exemptionCode);
    } else if (rate === 0 && l.exemptionCode) {
      d.TaxExemptionReasonCode = String(l.exemptionCode);
      d.TaxExemptionReason = l.exemptionReason || '';
      exemptCode = exemptCode || String(l.exemptionCode);
      exemptReason = exemptReason || l.exemptionReason || '';
    }
    return d;
  });
  net = r2(net); vat = r2(vat);
  const totalTax = [...vatByRate.entries()].map(([rate, t]) => ({ TaxAmount: r2(t.vat).toFixed(2), TaxCode: '0015', TaxRate: String(rate) }));
  if (specialCode && exemptCode) throw new Error('Özel matrah ve istisna satırları aynı faturada olamaz; ayrı fatura kesin');
  const invoiceType = specialCode ? 'OZELMATRAH' : exemptCode ? 'ISTISNA' : 'SATIS';
  const notes = [p.sale && p.sale.note, p.sale && p.sale.docNo ? `Belge: ${p.sale.docNo}` : ''].filter(Boolean);
  const ettn = crypto.randomUUID().toUpperCase();
  const sourceCode = String((p.sale && (p.sale.id || p.sale.docNo)) || ettn).slice(0, 60);

  const common = {
    CurrencyCode: 'TRY',
    ETTN: ettn,
    InvoiceDate: istanbulDateTime(p.sale && p.sale.date),
    InvoiceTotalTaxList: listOf('Tax', totalTax),
    InvoiceType: invoiceType,
    Notes: notes.length ? listOf('string', notes, true) : undefined,
    Receiver: {
      Address: {
        BoulevardAveneuStreetName: adr.street,
        CityName: adr.city,
        EMail: rc.email || '',
        TelephoneNumber: rc.phone || '',
        TownName: adr.town
      },
      ReceiverName: rc.name.trim(),
      ReceiverTaxCode: taxCode,
      RecipientType: documentType === 'EFATURA' ? 'EFATURA' : 'EARSIV',
      SendingType: rc.email ? 'ELEKTRONIK' : 'KAGIT'
    },
    TaxExemptionReason: exemptReason || undefined,
    TotalLineExtensionAmount: net.toFixed(2),
    TotalPayableAmount: r2(net + vat).toFixed(2),
    TotalTaxInclusiveAmount: r2(net + vat).toFixed(2),
    TotalVATAmount: vat.toFixed(2)
  };
  if (documentType === 'EFATURA') {
    return { ettn, invoiceType, invoice: { ...common, Exemptions: exemptCode ? listOf('Exemption', [{ TaxExemptionReasonCode: exemptCode, TaxExemptionReasonName: exemptReason, TaxExemptionReasonType: '1' }]) : undefined, ExternalInvoiceCode: sourceCode, InvoiceDetails: listOf('InvoiceDetail', details), ReceiverInboxTag: inboxTag || undefined, ScenarioType: 'TEMELFATURA' } };
  }
  return { ettn, invoiceType, invoice: { ...common, ExternalArchiveInvoiceCode: sourceCode, InvoiceDetails: listOf('ArchiveInvoiceDetail', details), SendMailAutomatically: rc.email ? 'true' : 'false' } };
}

async function createInvoice(cfg, p) {
  if (!cfg.vkn) throw new Error('Köprüde firma VKN ayarlı değil (asil-kopru.json → vkn)');
  const issuerVkn = String((p.issuer && p.issuer.vkn) || '').replace(/\D/g, '');
  if (cfg.mode === 'live' && issuerVkn && issuerVkn !== cfg.vkn) throw new Error(`Programdaki firma VKN (${issuerVkn}) köprüdeki VKN (${cfg.vkn}) ile aynı değil`);
  const rc = p.receiver || {};
  const receiverTax = String(rc.vkn || rc.tckn || '').replace(/\D/g, '');
  let documentType = String(p.documentType || 'AUTO').toUpperCase();
  let inbox = '';
  if (documentType !== 'EARSIV' && receiverTax) inbox = await taxPayerInbox(cfg, receiverTax);
  if (documentType === 'AUTO') documentType = inbox ? 'EFATURA' : 'EARSIV';
  if (documentType === 'EFATURA' && !inbox) throw new Error('Alıcı e-Fatura mükellefi değil; e-Arşiv seçin');

  const built = buildInvoice(p, documentType, inbox);
  let x, number = '', ettn = built.ettn;
  if (documentType === 'EFATURA') {
    x = await soapCall(cfg, 'invoice', 'SendInvoice', { CompanyTaxCode: cfg.vkn, Invoices: listOf('Invoice', [built.invoice]) });
    checkResult(x);
    number = tag(x, 'InvoiceNumber'); ettn = tag(x, 'Ettn') || ettn;
  } else {
    x = await soapCall(cfg, 'invoice', 'SendArchiveInvoice', { ArchiveInvoices: listOf('ArchiveInvoice', [built.invoice]), CompanyTaxCode: cfg.vkn });
    checkResult(x);
    number = tag(x, 'ArchiveInvoiceNumber'); ettn = tag(x, 'Ettn') || ettn;
  }
  let link = '';
  try { link = await viewerLink(cfg, ettn, documentType); } catch (_) {}
  return { ok: true, status: 'Gönderildi', invoiceNo: number, uuid: ettn, ettn, documentType, invoiceType: built.invoiceType, pdfUrl: link, mode: cfg.mode };
}

// ---------- HTTP sunucusu ----------
function corsHeaders(req, cfg) {
  const origin = req.headers.origin || '';
  const allowed = !cfg.allowedOrigins.length || cfg.allowedOrigins.includes(origin);
  return {
    'Access-Control-Allow-Origin': allowed && origin ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin'
  };
}
function send(res, code, obj, extra) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify(obj));
}

async function handle(cfg, req, res) {
  const cors = corsHeaders(req, cfg);
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.method === 'GET') {
    let isnet = false, err = '';
    try { isnet = await healthCheck(cfg); } catch (e) { err = String(e.message || e); }
    return send(res, 200, { ok: true, service: 'Asil Kuyumcu Köprü', version: VERSION, mode: cfg.mode, vkn: cfg.vkn, isnet, error: err || undefined }, cors);
  }
  if (req.method !== 'POST') return send(res, 405, { ok: false, message: 'Yalnız POST' }, cors);
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 2e6) return send(res, 413, { ok: false, message: 'İstek çok büyük' }, cors); }
  let p;
  try { p = JSON.parse(raw || '{}'); } catch (_) { return send(res, 400, { ok: false, message: 'Geçersiz JSON' }, cors); }
  try {
    const action = p.action || 'createInvoice';
    if (action === 'createInvoice') {
      const out = await createInvoice(cfg, p);
      log(`Fatura gönderildi ${out.documentType} ${out.invoiceNo} ${out.ettn}`);
      return send(res, 200, out, cors);
    }
    if (action === 'balance') return send(res, 200, { ok: true, balance: await balance(cfg) }, cors);
    if (action === 'viewerLink') return send(res, 200, { ok: true, url: await viewerLink(cfg, p.ettn, p.documentType) }, cors);
    if (action === 'invoiceXml') return send(res, 200, { ok: true, xml: await invoiceXml(cfg, p.ettn, p.documentType) }, cors);
    if (action === 'health') return send(res, 200, { ok: true, isnet: await healthCheck(cfg), mode: cfg.mode, vkn: cfg.vkn }, cors);
    return send(res, 400, { ok: false, message: 'Bilinmeyen işlem: ' + action }, cors);
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'İşNet zaman aşımı' : String(e.message || e);
    log('HATA: ' + msg);
    return send(res, 200, { ok: false, message: msg }, cors);
  }
}
function log(s) { console.log(new Date().toLocaleString('tr-TR') + '  ' + s); }

if (require.main === module) {
  const cfg = loadConfig();
  const server = http.createServer((req, res) => { handle(cfg, req, res).catch(e => send(res, 500, { ok: false, message: String(e.message || e) })); });
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') { log(`Köprü zaten çalışıyor (port ${cfg.port} kullanımda). Bu kopya kapatılıyor.`); process.exit(3); }
    log('HATA: ' + (e.message || e)); process.exit(1);
  });
  server.listen(cfg.port, '127.0.0.1', () => {
      log(`Asil Kuyumcu Köprü ${VERSION} çalışıyor → http://127.0.0.1:${cfg.port}`);
      log(`İşNet ortamı: ${cfg.mode === 'live' ? 'CANLI' : 'TEST'} (${cfg.baseUrl}), firma VKN: ${cfg.vkn || 'AYARLANMADI'}`);
      log('Bu pencereyi kapatmayın. Durdurmak için Ctrl+C.');
    });
}

module.exports = { _soap: soapCall, invoiceXml, loadConfig, buildInvoice, createInvoice, balance, healthCheck, taxPayerInbox, viewerLink, toXml, listOf, handle };
