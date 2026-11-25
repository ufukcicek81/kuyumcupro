'use strict';
const test = require('node:test');
const assert = require('node:assert');
const k = require('../kopru/asil-kopru.js');

const cfg = { mode: 'test', vkn: '4810173324', baseUrl: 'https://isnet.test', allowedOrigins: [] };
const payload = (receiver = {}) => ({
  action: 'createInvoice', documentType: 'AUTO', issuer: { vkn: '1111111111' },
  receiver: { name: 'TEST ALICI', tckn: '11111111111', address: 'Cad. 1 / Merkez / Ankara', ...receiver },
  sale: { id: 'INV-1', docNo: 'HAVALE', date: '2026-11-19T10:00:00Z', lines: [
    { kind: 'gold', name: '22 AYAR ALTIN', quantity: 1, unit: 'ADET', total: 98000, vatRate: 0, vatAmount: 0, exemptionCode: '230', exemptionReason: 'Altın teslimi' },
    { kind: 'labour', name: 'İŞÇİLİK', quantity: 1, unit: 'ADET', total: 1666.67, vatRate: 20, vatAmount: 333.33 }
  ] }
});

test('toXml alanları WCF sırasıyla (ordinal) yazar ve boşları atlar', () => {
  const x = k.toXml({ b: '2', ETTN: 'e', ExportX: '', a: 'x<y', L: k.listOf('Tax', [{ TaxRate: '0' }]) });
  assert.strictEqual(x, '<a:ETTN>e</a:ETTN><a:L><a:Tax><a:TaxRate>0</a:TaxRate></a:Tax></a:L><a:a>x&lt;y</a:a><a:b>2</a:b>');
});

test('havale faturası: altın 230 istisna + %20 KDV işçilik, tip ISTISNA', () => {
  const b = k.buildInvoice(payload(), 'EARSIV', '');
  assert.strictEqual(b.invoiceType, 'ISTISNA');
  const inv = b.invoice;
  assert.strictEqual(inv.TotalLineExtensionAmount, '99666.67');
  assert.strictEqual(inv.TotalVATAmount, '333.33');
  assert.strictEqual(inv.TotalPayableAmount, '100000.00');
  const [gold, lab] = inv.InvoiceDetails.items;
  assert.strictEqual(gold.TaxExemptionReasonCode, '230');
  assert.strictEqual(gold.VATRate, '0');
  assert.strictEqual(gold.Product.ProductCode, 'ALTIN22');
  assert.strictEqual(lab.VATRate, '20');
  assert.strictEqual(lab.TaxExemptionReasonCode, undefined);
  assert.strictEqual(lab.Product.ProductCode, 'ISCILIK');
  assert.strictEqual(inv.ExternalArchiveInvoiceCode, 'INV-1');
  assert.strictEqual(inv.Receiver.SendingType, 'KAGIT');
  assert.strictEqual(inv.Receiver.Address.CityName, 'Ankara');
});

test('e-Fatura modeli: istisna listesi, senaryo ve posta kutusu', () => {
  const b = k.buildInvoice(payload({ tckn: '', vkn: '1234567805', email: 'a@b.c' }), 'EFATURA', 'urn:mail:defaultpk@x');
  const inv = b.invoice;
  assert.strictEqual(inv.ScenarioType, 'TEMELFATURA');
  assert.strictEqual(inv.ReceiverInboxTag, 'urn:mail:defaultpk@x');
  assert.strictEqual(inv.Exemptions.items[0].TaxExemptionReasonCode, '230');
  assert.strictEqual(inv.Receiver.ReceiverTaxCode, '1234567805');
  assert.strictEqual(inv.Receiver.SendingType, 'ELEKTRONIK');
});

test('alıcı adı yoksa hata verir', () => {
  assert.throws(() => k.buildInvoice(payload({ name: '' }), 'EARSIV', ''), /Alıcı adı/);
});

function fakeFetch(handler) {
  const calls = [];
  global.fetch = async (url, opt) => {
    const op = /IInvoiceService\/(\w+)|IAddressBookService\/(\w+)/.exec(opt.headers.SOAPAction);
    const name = op[1] || op[2];
    calls.push({ name, body: opt.body });
    return { ok: true, status: 200, text: async () => handler(name, opt.body) };
  };
  return calls;
}

test('AUTO: e-Fatura mükellefi değilse e-Arşiv gönderir', async () => {
  const calls = fakeFetch(name => name === 'GetTaxPayer'
    ? '<r><a:Result>Success</a:Result><a:TaxPayers/></r>'
    : name === 'SendArchiveInvoice'
      ? '<r><a:Result>Success</a:Result><a:ArchiveInvoiceNumber>YEK2026000000001</a:ArchiveInvoiceNumber><a:Ettn>abc</a:Ettn></r>'
      : '<r><a:Result>Success</a:Result><a:DocumentViewerLink>http://v</a:DocumentViewerLink></r>');
  const out = await k.createInvoice(cfg, payload({ tckn: '12345678901' }));
  assert.deepStrictEqual([out.ok, out.documentType, out.invoiceNo, out.uuid, out.pdfUrl], [true, 'EARSIV', 'YEK2026000000001', 'abc', 'http://v']);
  assert.deepStrictEqual(calls.map(c => c.name), ['GetTaxPayer', 'SendArchiveInvoice', 'GetDocumentViewerLink']);
  assert.match(calls[1].body, /<a:TaxExemptionReasonCode>230<\/a:TaxExemptionReasonCode>/);
});

test('AUTO: mükellef ise e-Fatura; İşNet hatası mesaj olarak döner', async () => {
  fakeFetch(name => name === 'GetTaxPayer'
    ? '<r><a:Result>Success</a:Result><a:TaxPayers><a:TaxPayer><a:InboxTagList><b:string>urn:mail:pk</b:string></a:InboxTagList></a:TaxPayer></a:TaxPayers></r>'
    : '<r><a:ErrorMessage>Kontör yetersiz</a:ErrorMessage><a:Result>Failed</a:Result></r>');
  await assert.rejects(k.createInvoice(cfg, payload({ vkn: '1234567805', tckn: '' })), /Kontör yetersiz/);
});

test('canlıda programdaki VKN köprüdekinden farklıysa göndermez', async () => {
  fakeFetch(() => '<r/>');
  await assert.rejects(k.createInvoice({ ...cfg, mode: 'live' }, payload()), /aynı değil/);
});

test('İşNet "kullanıcı bulunamadı" derse alıcı e-Arşiv sayılır; 11111111111 sorgulanmaz', async () => {
  const calls = fakeFetch(name => name === 'GetTaxPayer'
    ? '<r><a:ErrorMessage>"12345678901" Vkn/Tckn\'ye ait kullanıcı bulunamadı!</a:ErrorMessage><a:Result>Failed</a:Result></r>'
    : '<r><a:Result>Success</a:Result><a:ArchiveInvoiceNumber>YEK1</a:ArchiveInvoiceNumber><a:Ettn>e1</a:Ettn></r>');
  assert.strictEqual((await k.createInvoice(cfg, payload({ tckn: '12345678901' }))).documentType, 'EARSIV');
  calls.length = 0;
  await k.createInvoice(cfg, payload());
  assert.ok(!calls.some(c => c.name === 'GetTaxPayer'));
});

test('özel matrah satırı: SpecialBasisAmount + 805, fatura tipi OZELMATRAH; istisna ile karışık olamaz', () => {
  const p = payload();
  p.sale.lines = [{ kind: 'special', name: '22 AYAR BİLEZİK', quantity: 10, unit: 'GR', total: 49166.67, vatRate: 20, vatAmount: 833.33, exemptionCode: '805', exemptionReason: 'Altın ziynet', specialBase: 4166.67 }];
  const b = k.buildInvoice(p, 'EARSIV', '');
  assert.strictEqual(b.invoiceType, 'OZELMATRAH');
  const d = b.invoice.InvoiceDetails.items[0];
  assert.deepStrictEqual([d.SpecialBasisAmount, d.SpecialBasisReasonCode, d.VATRate, d.VATAmount, d.LineExtensionAmount, d.TaxExemptionReasonCode], ['4166.67', '805', '20', '833.33', '49166.67', undefined]);
  assert.strictEqual(b.invoice.TotalPayableAmount, '50000.00');
  p.sale.lines.push({ kind: 'gold', name: 'KÜLÇE', quantity: 1, unit: 'ADET', total: 1000, vatRate: 0, vatAmount: 0, exemptionCode: '230' });
  assert.throws(() => k.buildInvoice(p, 'EARSIV', ''), /aynı faturada olamaz/);
});

test('köprü yalnız Asil Kuyumcu adreslerine izin verir', () => {
  const c = { allowedOrigins: ['https://ozel.example'] };
  assert.ok(k.originAllowed('', c));
  assert.ok(k.originAllowed('https://kuyumcupro.vercel.app', c));
  assert.ok(k.originAllowed('https://kuyumcupro-git-x-ufuk.vercel.app', c));
  assert.ok(k.originAllowed('http://127.0.0.1:5500', c));
  assert.ok(k.originAllowed('https://ozel.example', c));
  assert.ok(k.originAllowed('https://ufukcicek81.github.io', c));
  assert.ok(!k.originAllowed('https://baskasi.github.io', c));
  assert.ok(!k.originAllowed('https://kotu-site.com', c));
  assert.ok(!k.originAllowed('https://kuyumcupro.kotu.com', c));
});

test('WhatsApp köprüsü: QR → bağlı → mesaj gönderir; WhatsApp olmayan numarayı reddeder', async () => {
  const wa = k.wa; wa._reset();
  const { EventEmitter } = require('events');
  const sent = [];
  let sock;
  wa._setLib({
    pino: () => ({}), QR: { toDataURL: async (s) => 'data:image/png;base64,' + Buffer.from(s).toString('base64') },
    baileys: {
      DisconnectReason: { loggedOut: 401 }, Browsers: { windows: (n) => [n, 'Windows', '1'] },
      useMultiFileAuthState: async () => ({ state: {}, saveCreds: () => {} }),
      default: () => { const ev = new EventEmitter(); sock = { ev, user: { id: '905551112233:5@s.whatsapp.net' }, onWhatsApp: async (j) => [{ exists: !j.startsWith('905000000000'), jid: j }], sendMessage: async (j, m) => { sent.push([j, m.text]); return { key: { id: 'MSG1' } }; }, logout: async () => {} }; return sock; }
    }
  });
  wa.configure({ waMinIntervalMs: 1000, waDailyLimit: 5 });
  await wa.start();
  sock.ev.emit('connection.update', { qr: 'QRDATA' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(wa.info().status, 'qr');
  assert.match(wa.info().qr, /^data:image\/png/);
  await assert.rejects(wa.send('05321112233', 'x'), /bağlı değil/);
  sock.ev.emit('connection.update', { connection: 'open' });
  assert.equal(wa.info().status, 'bağlı');
  assert.equal(wa.info().me, '905551112233');
  const r = await wa.send('0532 111 22 33', 'Tamiriniz hazır');
  assert.deepEqual([r.ok, r.to], [true, '905321112233']);
  assert.deepEqual(sent[0], ['905321112233@s.whatsapp.net', 'Tamiriniz hazır']);
  await assert.rejects(wa.send('05000000000', 'x'), /WhatsApp kullanmıyor/);
  assert.equal(wa.info().sentToday, 1);
  wa._reset();
});

test('WhatsApp köprüsü: gelen mesajlar kaydedilir (gizli kimlikte gerçek numara), grup ve kendi mesajı alınmaz', () => {
  const wa = k.wa; wa._reset({ inbox: null, lid: null });
  wa._onIncoming({ key: { id: 'M1', remoteJid: '905321112233@s.whatsapp.net', fromMe: false }, message: { conversation: 'Onay' }, messageTimestamp: 1700000000 });
  wa._onIncoming({ key: { id: 'M2', remoteJid: '123456789@lid', senderPn: '905554443322@s.whatsapp.net' }, message: { extendedTextMessage: { text: 'evet', contextInfo: { stanzaId: 'SENT9' } } }, messageTimestamp: 1700000010 });
  wa._onIncoming({ key: { id: 'M3', remoteJid: '1203@g.us', participant: '905000000000@s.whatsapp.net' }, message: { conversation: 'grup' } });
  wa._onIncoming({ key: { id: 'M4', remoteJid: '905321112233@s.whatsapp.net', fromMe: true }, message: { conversation: 'bizim' } });
  wa._onIncoming({ key: { id: 'M1', remoteJid: '905321112233@s.whatsapp.net' }, message: { conversation: 'Onay' }, messageTimestamp: 1700000000 });
  const all = wa.inbox(0);
  assert.deepEqual(all.map((x) => [x.id, x.from, x.text, x.quoted]), [['M1', '905321112233', 'Onay', ''], ['M2', '905554443322', 'evet', 'SENT9']]);
  assert.deepEqual(wa.inbox(1700000005000).map((x) => x.id), ['M2']);
  wa._reset();
});

test('İş Bankası online ekstre: XML hareketleri (etiket ya da özellik biçimi) okunur', () => {
  const a = k.parseXmlRecords('<?xml version="1.0"?><Ozet><Hesap No="1" Doviz="TL" Bakiye="5"/><Hareket><Tarih>01.11.2026 10:00:00</Tarih><Tutar>-1.250,50</Tutar><Aciklama>POS &amp; KOM</Aciklama></Hareket><Hareket><Tarih>02.11.2026</Tarih><Tutar>300,00</Tutar><Aciklama><![CDATA[EFT <x>]]></Aciklama></Hareket></Ozet>');
  assert.equal(a.tag, 'Hareket');
  assert.deepEqual(a.records[0], { Tarih: '01.11.2026 10:00:00', Tutar: '-1.250,50', Aciklama: 'POS & KOM' });
  assert.equal(a.records[1].Aciklama, 'EFT <x>');
  const b = k.parseXmlRecords('<r><h t="01.11.2026" tutar="10" a="x"/><h t="02.11.2026" tutar="20" a="y"/><h t="03.11.2026" tutar="30" a="z"/></r>');
  assert.deepEqual([b.tag, b.records.length, b.records[2].tutar], ['h', 3, '30']);
});

test('İş Bankası online ekstre: POST ile uid/pwd/tarih gönderilir; şifresiz, sayfa dönerse ve sık sorguda açık hata', async () => {
  k._isbankReset();
  await assert.rejects(k.isbankStatement({}, {}), /isbankUid/);
  const calls = [];
  global.fetch = async (url, opt) => { calls.push([url, opt]); return { ok: true, status: 200, text: async () => '<?xml version="1.0"?><x><H><Tarih>24.11.2026</Tarih><Tutar>5</Tutar><Aciklama>a</Aciklama></H></x>' }; };
  const cfg = { isbankUid: 'KOD1', isbankPwd: 'S3cr&t' };
  const out = await k.isbankStatement(cfg, { from: '2026-11-20T00:00:00', to: '2026-11-24T23:59:59' });
  assert.equal(calls[0][0], 'https://posmatik2.isbank.com.tr/AuthenticateSpecific.aspx');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].headers['Content-Type'], 'application/x-www-form-urlencoded');
  const body = new URLSearchParams(calls[0][1].body);
  assert.deepEqual([body.get('uid'), body.get('pwd'), body.get('BeginDate'), body.get('EndDate')], ['KOD1', 'S3cr&t', '20.11.2026 00:00:00', '24.11.2026 23:59:59']);
  assert.equal(out.records.length, 1);
  assert.ok(!JSON.stringify(out).includes('S3cr&t'), 'şifre cevaba girmemeli');
  await assert.rejects(k.isbankStatement(cfg, {}), /dakikada en fazla 2/);
  k._isbankReset();
  global.fetch = async () => ({ ok: true, status: 200, text: async () => '<!DOCTYPE html><html><body>Giriş</body></html>' });
  await assert.rejects(k.isbankStatement(cfg, {}), /kullanıcı kodu \/ şifre/);
  k._isbankReset();
});

test('İş Bankası bilgileri her sorguda dosyadan yeniden okunur (köprüyü yeniden başlatmadan)', async () => {
  const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kopru-')), 'asil-kopru.json');
  fs.writeFileSync(file, JSON.stringify({ mode: 'test' }));
  process.env.ASIL_KOPRU_CONFIG = file;
  const cfg = k.loadConfig();
  const srv = http.createServer((q, r) => k.handle(cfg, q, r));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const realFetch = global.fetch;
  const call = () => new Promise((res, rej) => { const q = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => res(JSON.parse(b))); }); q.on('error', rej); q.end(JSON.stringify({ action: 'isbankStatement' })); });
  try {
    k._isbankReset();
    assert.match((await call()).message, /isbankUid/);
    fs.writeFileSync(file, JSON.stringify({ mode: 'test', isbankUid: 'U', isbankPwd: 'P' }));
    let sent = '';
    global.fetch = async (u, o) => { sent = o.body; return { ok: true, status: 200, text: async () => '<x/>' }; };
    const out = await call();
    assert.equal(out.ok, true);
    assert.match(sent, /uid=U&pwd=P/);
  } finally { global.fetch = realFetch; srv.close(); delete process.env.ASIL_KOPRU_CONFIG; k._isbankReset(); }
});

test('otomatik havale kontrolü: köprü sonucu 45 sn saklar; elle sorgu sırasını bekler', async () => {
  const http = require('http');
  const cfg = { allowedOrigins: [], whatsapp: false, isbankUid: 'U', isbankPwd: 'P' };
  const srv = http.createServer((q, r) => k.handle(cfg, q, r));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const realFetch = global.fetch;
  const call = (body) => new Promise((res, rej) => { const q = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => res(JSON.parse(b))); }); q.on('error', rej); q.end(JSON.stringify(body)); });
  let n = 0;
  try {
    k._isbankReset();
    global.fetch = async () => { n++; return { ok: true, status: 200, text: async () => '<x/>' }; };
    const a = await call({ action: 'isbankStatement', watch: true });
    const b = await call({ action: 'isbankStatement', watch: true });
    assert.equal(a.ok, true); assert.equal(b.cached, true); assert.equal(n, 1, 'ikinci cihaz bankaya tekrar sormamalı');
    assert.ok(Date.parse(a.to) - Date.parse(a.from) >= 864e5 - 1000, 'son 24 saat sorulmalı');
    assert.match((await call({ action: 'isbankStatement' })).message, /dakikada en fazla 2/);
  } finally { global.fetch = realFetch; srv.close(); k._isbankReset(); }
});

test('İş Bankası cevabı Türkçe Windows kodlamasıyla gelirse harfler doğru okunur', async () => {
  k._isbankReset();
  const realFetch = global.fetch;
  const enc = (str) => Buffer.from([...str].map((ch) => ({ 'Ö': 0xD6, 'İ': 0xDD, 'Ş': 0xDE, 'ş': 0xFE, 'ı': 0xFD, 'ğ': 0xF0, 'Ğ': 0xD0, 'ü': 0xFC, 'ç': 0xE7 })[ch] ?? ch.charCodeAt(0)));
  const xml = (decl) => `<?xml version="1.0"${decl}?><x><H><Tarih>24.11.2026</Tarih><Tutar>5</Tutar><Aciklama>ALTIN ÖDEMESİ ELDEN TESLİM ALDIM şığüç</Aciklama></H></x>`;
  try {
    for (const decl of ['', ' encoding="windows-1254"', ' encoding="ISO-8859-9"']) {
      k._isbankReset();
      global.fetch = async () => { const b = enc(xml(decl)); return { ok: true, status: 200, headers: { get: () => 'text/xml' }, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; };
      const out = await k.isbankStatement({ isbankUid: 'U', isbankPwd: 'P' }, {});
      assert.equal(out.records[0].Aciklama, 'ALTIN ÖDEMESİ ELDEN TESLİM ALDIM şığüç', 'kodlama: ' + (decl || 'yok'));
    }
    k._isbankReset();
    global.fetch = async () => { const b = Buffer.from(xml(' encoding="utf-8"'), 'utf8'); return { ok: true, status: 200, headers: { get: () => '' }, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; };
    assert.equal((await k.isbankStatement({ isbankUid: 'U', isbankPwd: 'P' }, {})).records[0].Aciklama, 'ALTIN ÖDEMESİ ELDEN TESLİM ALDIM şığüç', 'UTF-8 de doğru okunmalı');
  } finally { global.fetch = realFetch; k._isbankReset(); }
});

test('e-Fatura etiketi elle verilirse GetTaxPayer sorgulanmadan e-Fatura gönderilir (İşNet test alıcısı)', async () => {
  const realFetch = global.fetch;
  try {
    const calls = fakeFetch(name => name === 'SendInvoice'
      ? '<r><a:Result>Success</a:Result><a:InvoiceNumber>TST2026000000001</a:InvoiceNumber><a:Ettn>e1</a:Ettn></r>'
      : '<r><a:Result>Success</a:Result><a:DocumentViewerLink>http://v</a:DocumentViewerLink></r>');
    const out = await k.createInvoice(cfg, payload({ name: 'Test Firma 05', tckn: '', vkn: '1234567805', inboxTag: 'urn:mail:test05defaultpk@isnet.com' }));
    assert.strictEqual(out.documentType, 'EFATURA');
    assert.ok(!calls.some((c) => c.name === 'GetTaxPayer'), 'etiket verilince sorgu yapılmamalı');
    const send = calls.find((c) => c.name === 'SendInvoice');
    assert.match(send.body, /urn:mail:test05defaultpk@isnet\.com/);
    assert.match(send.body, /1234567805/);
  } finally { global.fetch = realFetch; }
});
