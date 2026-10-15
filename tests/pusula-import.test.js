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

// Pusula "Stok Özeti" raporunun yapısını taklit eden örnek (gerçek veri değil).
const OZET = [
  ['TANIM ', 'AYAR ', 'MIKTAR ', 'HAS ', 'ISCILIK ', 'BIRIM ', ' ', ' ', ' ', 'ORTALAMA ', 'Adet ', 'TIP ', ' '],
  ['14 K ', 585, 4, 2.34, -0.03, 'HAS ', 'HAS ', 7, 2, -0.0075, 0, 578.39, 0],
  ['CEYREK ', 1605, 10, 16.05, 0.15, 'HAS ', 'HAS ', 7, 5, 0.015, 0, 1608.6, 0],
  ['22 Ayar 0,5 Gram ', 458, 4, 1.83, 0.02, 'HAS ', 'HAS ', 7, 38, 0.005, 0, 462, 0],
  ['24 Ayar 1 Gram ', 995, 3, 2.99, 0, 'HAS ', 'HAS ', 7, 39, 0, 0, 995.6, 0],
  ['TOPLAM ALTIN ', ' ', 21, 23.21, 0.14, ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
  ['14 K ', 585, 100, 58.5, 10, 'HAS ', 'HAS ', ' ', ' ', '40 ADET ', ' ', ' ', 1],
  ['22 K ', 916, 20, 18.32, 1, 'HAS ', 'HAS ', ' ', ' ', '5 ADET ', ' ', ' ', 1],
  ['TOPLAM BARKODLU ALTIN ', ' ', 120, 76.82, 11, ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
  [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
  ['14 HURDASI ', 556.9, 10, 5.57, ' ', ' ', 'HAS ', 8, 3, ' ', ' ', ' ', 2],
  ['TOPLAM HURDA ', ' ', 10, 5.57, ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
  ['ÖZEL ÜRÜN ', ' ', 5, ' ', 100, 'USD ', 'USD ', 7, 13, 20, ' ', ' ', 3],
  ['KASA ', ' ', 'BORÇ ', 'ALACAK ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
  [' ', 'TL. ', 1500.5, ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', 4],
  [' ', 'USD ', 20, ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', 4],
];

test('Pusula stok özeti bölümlere ayrılır: açık stok, barkodlu toplam, hurda, kasa', () => {
  const o = P.parseStockSummary(OZET, { period: 2026 });
  assert.deepEqual(o.open.map((x) => [x.pusulaCode, x.unit, x.purity, x.zGram]), [['2', 'GR', 585, 0], ['5', 'ADET', 916, 1.7522], ['38', 'ADET', 916, 0.5], ['39', 'ADET', 995, 1]]);
  assert.equal(o.open[1].count, 10); assert.equal(o.open[1].hasWeight, 16.05);
  assert.deepEqual(o.barcodeSummary.count, 45); assert.equal(o.barcodeSummary.gram, 120);
  assert.deepEqual(o.scrap.map((x) => [x.name, x.milyem, x.amount]), [['14 HURDASI', 556.9, 10]]);
  assert.deepEqual(o.cash, [{ currency: 'TL', amount: 1500.5, line: 15 }, { currency: 'USD', amount: 20, line: 16 }]);
  assert.equal(o.skipped[0].name, 'ÖZEL ÜRÜN');
});

test('yarıda kesilmiş barkodlu liste fark edilir', () => {
  const full = [['URUN KODU', 'AYAR', 'MIKTAR', 'HAS', 'Grup', 'Kod', 'BOY']];
  for (let i = 1; i <= 10; i++) full.push([`KUP000${i}`, 585, 1, 0.58, 'KUP', i, 0]);
  assert.equal(P.looksTruncated(full, 0), false);
  const cut = full.concat([['KUP0099', 585, 1, '', '', '', '']]);
  assert.equal(P.looksTruncated(cut, 0), true);
});

test('Pusula barkodlu listesi: URUN KODU barkod, SAT.FİYATI satış HAS, grup kodundan ürün adı', () => {
  const rows = [['URUN KODU ', 'AYAR ', 'MIKTAR ', 'HAS ', 'ISCILIK ', 'BIRIM ', 'MALIYET ', 'SAT.FİYATI ', 'MODEL ', 'Grup ', 'Kod ', 'BANKO ', 'TAŞ ', ' ', 'ORJKOD ', 'BOY ', 'SONUC GR '],
    ['ALY0001265 ', 585, 5.25, 3.07, 0.5, 'HAS ', 3.57, 6.43, ' ', 'ALY ', 1265, ' ', ' ', ' ', ' ', 0, 0],
    ['122 Adet ', ' ', 232.63, 136.16, 42.56, ' ', 178.72, ' ']];
  const d = P.detect(rows, 'barcode');
  const r = P.buildBarcodeStocks(rows, d.headerIndex, d.mapping, {});
  assert.equal(r.stocks.length, 1);
  const x = r.stocks[0];
  assert.equal(x.barcode, 'ALY0001265'); assert.equal(x.pusulaCode, '1265'); assert.equal(x.name, 'ALYANS');
  assert.equal(x.costHas, 3.57); assert.equal(x.saleHas, 6.43); assert.equal(x.workmanshipTotalHas, 0.5);
});

test('Pusula bakiye listesi: FIRMA UNVANI, TL., CEY sütunları; iç hesaplar Özel türünde', () => {
  const rows = [['FIRMA UNVANI ', 'KOD ', 'GRM ', 'GMS ', 22, 'HAS ', 'TL. ', 'USD ', 'EUR ', 'CHF ', 'GBP ', 'CEY ', 'CAD ', 'AUD ', ' ', 'Kons. '],
    ['DONEM K/Z 2012 ', 494, ' ', ' ', ' ', ' ', 1000, ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', 0],
    ['SERMAYE ', 6, ' ', ' ', ' ', -3.5, 900, ' ', ' ', ' ', ' ', 18, ' ', ' ', ' ', 0],
    ['TOPLAM ', ' ', ' ', ' ', ' ', -3.5, 1900, ' ', ' ', ' ', ' ', 18, ' ', ' ', ' ', ' ']];
  const d = P.detect(rows, 'cari');
  const cols = P.detectBalances(d.headers, d.mapping);
  const r = P.buildCariBalances(rows, d.headerIndex, d.mapping, cols, {});
  assert.equal(r.customers.length, 2);
  assert.deepEqual(r.customers[1].balances, { HAS: -3.5, TL: 900, CEY: 18 });
  assert.deepEqual(r.customers.map((c) => c.type), ['Özel', 'Özel']);
});

test('özel ürünler: TL/USD fiyatlar okunur, satış birimi grup ara toplamından düzeltilir', () => {
  const H = ['URUN KODU ', 'AYAR ', 'MIKTAR ', 'HAS ', 'ISCILIK ', 'BIRIM ', 'MALIYET ', 'SAT.FİYATI ', 'MODEL ', 'Grup ', 'Kod '];
  const rows = [H,
    ['SAA0000001 ', ' ', 1, ' ', ' ', 'USD ', 20, 44, ' ', 'SAA ', 1],
    ['SAA0000002 ', ' ', 1, ' ', ' ', 'USD ', 30, 1500, ' ', 'SAA ', 2],   // satışı aslında TL
    ['SAA0000003 ', ' ', 1, ' ', ' ', 'USD ', 25, 55, ' ', 'SAA ', 3],
    ['CASIO 3 Adet ', ' ', 3, ' ', ' ', 'USD ', 75, 1500, 'TL. ', ' '],
    [' ', ' ', ' ', ' ', ' ', ' ', ' ', 99, 'USD ', ' '],
    ['TOPLAM MLYT ', ' ', ' ', ' ', ' ', 'USD ', 75, ' '],
    ['TOPLAM SATIŞ ', ' ', ' ', ' ', ' ', 'USD ', ' ', 99],
    ['TOPLAM SATIŞ ', ' ', ' ', ' ', ' ', 'TL. ', ' ', 1500],
  ];
  const d = P.detect(rows, 'barcode');
  const r = P.buildSpecialStocks(rows, d.headerIndex, d.mapping, { period: 2026 });
  assert.equal(r.stocks.length, 3);
  assert.deepEqual(r.stocks.map((x) => [x.barcode, x.priceCurrency, x.saleCurrency]), [['SAA0000001', 'USD', 'USD'], ['SAA0000002', 'USD', 'TL'], ['SAA0000003', 'USD', 'USD']]);
  assert.deepEqual(r.totals.sale, r.fileTotals.sale);
  assert.deepEqual(r.totals.cost, r.fileTotals.cost);
  assert.equal(r.stocks[0].name, 'SAAT'); assert.equal(r.stocks[0].specialV7, true);
  assert.equal(r.currencyFixes.length, 1); assert.equal(r.currencyFixes[0].unique, true);
});

test('Pusula barkodlu: gerçek işçilik maliyet − has; gram başı işçilik tanınır', () => {
  const rows = [['URUN KODU', 'AYAR', 'MIKTAR', 'HAS', 'ISCILIK', 'BIRIM', 'MALIYET', 'SAT.FİYATI', 'Grup', 'Kod'],
    ['BIL0000132', 585, 4.05, 2.37, 0.13, 'HAS', 2.9, 4.35, 'BIL', 132],
    ['ALY0001265', 585, 5.25, 3.07, 0.5, 'HAS', 3.57, 6.43, 'ALY', 1265],
    ['2 Adet', '', 9.3, 5.44, 0.63, '', 6.47, '']];
  const d = P.detect(rows, 'barcode');
  const r = P.buildBarcodeStocks(rows, d.headerIndex, d.mapping, {});
  assert.equal(r.stocks[0].workmanshipTotalHas, 0.53); assert.equal(r.stocks[0].workmanshipMode, 'Gram İşçilik'); assert.equal(r.stocks[0].workmanshipEntryValue, 0.13);
  assert.equal(r.stocks[1].workmanshipTotalHas, 0.5); assert.equal(r.stocks[1].workmanshipMode, 'Birim İşçilik');
  assert.deepEqual(P.fileGrandTotal(rows, d.mapping), { count: 2, gram: 9.3, line: 4 });
  assert.equal(P.looksTruncated(rows, d.headerIndex), false);
});

test('Pusula bilanço raporu okunur (grup satırları, toplam, kur farkı, kâr/zarar, sermaye)', () => {
  const s = ' ';
  const rows = [
    ['Hesap Tanimi ', 'Cins ', 'Borcumuz ', 'Alacağımız ', s, 'Borcumuz ', 'Alacağımız ', 'Hestip ', s, 'Borc ', 'Alacak '],
    ['MUSTERI ', 22, 10, 1, s, 9.37, 0.94, s, s, s, s],
    ['MUSTERI ', 'TL. ', 6600, 0, s, 1, 0, s, s, s, s],
    [s, s, s, s, s, s, s, s, s, s, s],
    ['KAR / ZARAR ', 'HAS ', 5, 0, s, 5, 0, s, s, s, s],
    ['SERMAYE ', 'HAS ', 20, 2, s, 20, 2, s, s, s, s],
    ['BARKODLU ALTIN STOKU ', 'HAS  12 ', s, 30, s, s, 30, s, s, s, s],
    ['ALTIN STOĞU  CEYREK ', 'GR ', s, 4, s, s, 6.42, s, s, 7, 5],
    ['TOPLAM ', s, s, s, s, 35.37, 39.36, '* ', s, s, s],
    [s, s, s, 'Kur Farkı ', s, s, 3.99, s, s, s, s],
    [s, s, s, 'Eski Kur Farkı ', s, s, 3, s, s, s, s],
    [s, s, s, 'Gunluk Kur Farkı ', s, s, 0.99, s, s, s, s],
    [s, s, s, s, s, '30.09 - 15.10 ', 'TOPLAM ', s, s, s, s],
    [s, s, s, 'Satış Karı ', s, 1, 5, s, s, s, s],
    [s, s, s, 'Iskonto ', s, 0, -0.5, s, s, s, s],
    [s, s, s, 'Kur Farki ', s, 0.99, 3.99, s, s, s, s],
    [s, s, s, 'Net Kar/Zarar ', s, 1.99, 8.49, s, s, s, s],
    [s, s, s, s, s, 'Sermaye ', 18, s, s, s, s],
    [s, s, s, s, s, 'Kalan Sermaye ', 26.49, s, s, s, s],
  ];
  assert.equal(P.isBalanceSheet(rows), true);
  const b = P.parseBalanceSheet(rows);
  assert.equal(b.rows.length, 6);
  assert.deepEqual(b.rows[1], { group: 'MUSTERI', rawGroup: 'MUSTERI', unit: 'TL', note: '', debt: 6600, recv: 0, debtHas: 1, recvHas: 0, line: 3 });
  assert.equal(b.rows[4].unit, 'HAS');
  assert.equal(b.rows[4].note, '12');
  assert.equal(b.rows[5].group, 'ALTIN STOĞU CEYREK');
  assert.deepEqual(b.totals, { debtHas: 35.37, recvHas: 39.36 });
  assert.deepEqual(b.kur, { total: 3.99, old: 3, daily: 0.99 });
  assert.equal(b.periodLabel, '30.09 - 15.10');
  assert.equal(b.total.salesProfit, 5);
  assert.equal(b.total.discount, -0.5);
  assert.equal(b.period.fx, 0.99);
  assert.equal(b.total.net, 8.49);
  assert.equal(b.capital.capital, 18);
  assert.equal(b.capital.remaining, 26.49);
  // Stok satırlarında GR / ADET farkı karşılaştırmayı bozmaz; para birimi satırlarında birim anahtarın parçasıdır.
  assert.equal(P.balanceKey('ALTIN STOĞU  CEYREK', 'GR'), P.balanceKey('ALTIN STOĞU CEYREK', 'ADET'));
  assert.notEqual(P.balanceKey('BARKODLU ÖZEL ÜRÜNLER', 'USD'), P.balanceKey('BARKODLU ÖZEL ÜRÜNLER', 'TL.'));
  assert.equal(P.balanceKey('MUSTERI', 'TL.'), P.balanceKey('MUSTERI ', 'TL'));
  assert.equal(P.isBalanceSheet([['FIRMA UNVANI', 'KOD', 'HAS']]), false);
});

test('cari temizleme listesi okunur: KALSIN / TEMİZLE / yeni grup, anlaşılmayan işlem hata', () => {
  const r = P.parseCariCleanup([
    ['KOD', 'CARİ', 'TÜR', 'TL', 'İŞLEM (KALSIN / TEMİZLE)', 'YENİ GRUP (boşsa değişmez)'],
    ['1', 'A', 'Müşteri', 10, 'TEMİZLE', ''],
    ['2', 'B', 'Müşteri', 5, 'kalsın', 'personel'],
    ['3', 'C', 'Müşteri', 5, '', ''],
    ['4', 'D', 'Müşteri', 5, 'belki', ''],
    ['', '', '', '', '', ''],
  ]);
  assert.deepEqual(r.items.map((x) => [x.code, x.action, x.group]), [['1', 'clear', ''], ['2', 'keep', 'PERSONEL'], ['3', 'keep', '']]);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].line, 5);
  assert.throws(() => P.parseCariCleanup([['FIRMA', 'TL']]), /başlığı/);
});
