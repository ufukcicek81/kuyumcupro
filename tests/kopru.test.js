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
