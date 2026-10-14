const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/asil-pusula-import.js');

const rows = [
  ['ASİL KUYUMCULUK - BARKODLU STOK LİSTESİ'],
  [],
  ['Barkod', 'Grup', 'Cins', 'Ayar', 'Gram', 'Has', 'Alış İşçilik', 'Satış İşçilik', 'Model', 'Tedarikçi'],
  ['ALY0000744', 'ALY', 'ALYANS', '14', '3,15', '1,84', '0,5', '1,9', 'M1', 'TOPTANCI A'],
  ['KOL0000012', 'KOL', 'KOLYE', '22', 10, '', 0.3, 1.2, '', ''],
  ['', '', '', '', '', '', '', '', '', ''],
  ['KOL0000012', 'KOL', 'KOLYE', '22', 5, '', 0, 0, '', ''],
  ['', '', 'GENEL TOPLAM', '', '13,15', '', '', '', '', ''],
];

test('başlık satırı ve sütunlar otomatik bulunur', () => {
  const d = P.detect(rows, 'barcode');
  assert.equal(d.headerIndex, 2);
  assert.equal(d.mapping.barcode, 0);
  assert.equal(d.mapping.gram, 4);
  assert.equal(d.mapping.work, 6);
  assert.equal(d.mapping.saleWork, 7);
});

test('barkodlu stoklar mevcut kayıt biçiminde üretilir', () => {
  const d = P.detect(rows, 'barcode');
  const r = P.buildBarcodeStocks(rows, d.headerIndex, d.mapping, { period: 2026 });
  assert.equal(r.stocks.length, 2);
  const a = r.stocks[0];
  assert.equal(a.id, 'PB-ALY0000744'); assert.equal(a.pusulaCode, '744'); assert.equal(a.group, 'ALY');
  assert.equal(a.purity, 585); assert.equal(a.amount, 3.15); assert.equal(a.hasWeight, 1.84);
  assert.equal(a.costHas, 2.34); assert.equal(a.saleHas, 3.74); assert.equal(a.status, 'Stokta'); assert.equal(a.period, 2026);
  const k = r.stocks[1];
  assert.equal(k.purity, 916); assert.equal(k.hasWeight, 9.16, 'has boşsa gram × milyem');
  assert.equal(k.costHas, 9.46); assert.equal(k.saleHas, 10.36);
  assert.equal(r.errors.length, 1, 'tekrarlanan barkod hata olarak raporlanır');
  assert.match(r.errors[0].message, /ikinci kez/);
});

test('Türkçe sayı biçimleri doğru okunur', () => {
  assert.equal(P.num('1.234,56'), 1234.56); assert.equal(P.num('3,15'), 3.15); assert.equal(P.num('3.15'), 3.15); assert.equal(P.num(''), 0);
  assert.equal(P.purityOf('14K'), 585); assert.equal(P.purityOf('916'), 916); assert.equal(P.purityOf('', '750'), 750);
});

test('açık stok özeti okunur, adetli üründe has birim gramdan hesaplanır', () => {
  const o = [['Stok Kodu', 'Ürün Adı', 'Ayar', 'Miktar', 'Birim', 'Birim Gram'], ['5', 'CEYREK', '22', '37', 'ADET', '1,75'], ['2', '14 K', '14', '5,15', 'GR', '']];
  const d = P.detect(o, 'open');
  const r = P.buildOpenStocks(o, d.headerIndex, d.mapping, { period: 2026 });
  assert.equal(r.stocks.length, 2);
  assert.equal(r.stocks[0].unit, 'ADET'); assert.equal(r.stocks[0].count, 37); assert.equal(r.stocks[0].hasWeight, 59.3110);
  assert.equal(r.stocks[1].unit, 'GR'); assert.equal(r.stocks[1].hasWeight, 3.0128);
  assert.ok(r.stocks[1].inventoryUnitCostHas > 0.58 && r.stocks[1].inventoryUnitCostHas < 0.59);
});

test('cari bakiye listesi: birim sütunları ve borç/alacak yönü tanınır', () => {
  const rows = [
    ['CARİ BAKİYE LİSTESİ'],
    ['Cari Kodu', 'Cari Adı', 'Tür', 'Telefon', 'TL Bakiye', 'HAS', 'USD', '22 Ayar'],
    ['202', 'AKBANK', 'Banka', '', '1.980,00', '', '', ''],
    ['373', 'ALİ OSMAN YAĞIZ', 'Müşteri', '0555', '8900', '-1,25', '100', ''],
    ['1156', 'ADEM KELEŞ', 'Müşteri', '', '', '', '', '-0,35'],
    ['901', 'TOPTANCI A', 'Toptancı', '', '', '12,5', '', ''],
    ['', 'GENEL TOPLAM', '', '', '10880', '', '', ''],
  ];
  const d = P.detect(rows, 'cari');
  assert.equal(d.headerIndex, 1);
  assert.equal(d.mapping.code, 0); assert.equal(d.mapping.name, 1);
  const cols = P.detectBalances(d.headers, d.mapping);
  assert.deepEqual(Object.values(cols).map((x) => x.unit), ['TL', 'HAS', 'USD', '22']);
  const r = P.buildCariBalances(rows, d.headerIndex, d.mapping, cols, {});
  assert.equal(r.customers.length, 4);
  const ali = r.customers.find((c) => c.code === '373');
  assert.deepEqual(ali.balances, { TL: 8900, HAS: -1.25, USD: 100 });
  assert.equal(r.customers.find((c) => c.code === '901').type, 'Toptancı');
  assert.equal(r.customers.find((c) => c.code === '202').type, 'Banka');
  // + = müşteri alacaklı seçilirse işaret döner
  const r2 = P.buildCariBalances(rows, d.headerIndex, d.mapping, cols, { positiveIsDebt: false });
  assert.equal(r2.customers.find((c) => c.code === '373').balances.TL, -8900);
});

test('borç ve alacak ayrı sütunlarda ise netleştirilir', () => {
  const rows = [['Kod', 'Ünvan', 'TL Borç', 'TL Alacak', 'HAS Borç', 'HAS Alacak'], ['1', 'X', '500', '200', '0', '3']];
  const d = P.detect(rows, 'cari');
  const cols = P.detectBalances(d.headers, d.mapping);
  const r = P.buildCariBalances(rows, d.headerIndex, d.mapping, cols, {});
  assert.deepEqual(r.customers[0].balances, { TL: 300, HAS: -3 });
});

test('grup ara toplam satırları ("122 ADET") ürün sayılmaz', () => {
  const rows = [['Barkod', 'Ayar', 'Gram'], ['ALY0001265', '14', '5,25'], ['122 ADET', '', '410,5'], ['1 ADET', '', '2'], ['KOL0000001', '22', '3']];
  const d = P.detect(rows, 'barcode');
  const r = P.buildBarcodeStocks(rows, d.headerIndex, d.mapping, {});
  assert.deepEqual(r.stocks.map((x) => x.barcode), ['ALY0001265', 'KOL0000001']);
  assert.equal(r.errors.length + r.warnings.length, 0);
});
