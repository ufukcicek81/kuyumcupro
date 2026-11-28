// Uçtan uca testler: gerçek tarayıcıda uygulamanın kritik akışları.
// Çalıştırma: npm run test:e2e
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStaticServer, createFakeFirebase, newDevice, launch, historyText } = require('./helpers');

let browser, server, appUrl;
test.before(async () => { ({ server, url: appUrl } = await startStaticServer()); browser = await launch(); });
test.after(async () => { await browser?.close(); server?.close(); });

const val = (page, id) => page.inputValue('#' + id);

test('iki cihazda aynı anda yapılan işlemlerin ikisi de bulutta kalır', async () => {
  const fb = createFakeFirebase();
  const a = await newDevice(browser, appUrl, fb);
  const b = await newDevice(browser, appUrl, fb);
  assert.ok(fb.db.state, 'ilk kurulumda veri buluta yazılmalı');
  const tlCash = (st) => (st.cashAccounts || []).filter((x) => x.currency === 'TL').reduce((n, x) => n + Number(x.balance || 0), 0);
  const cashBefore = tlCash(fb.db.state);

  // A: döviz alışı
  await a.click('[data-home-trade="Döviz Alış"]');
  await a.fill('#stQty', '100'); await a.fill('#stPrice', '40');
  await a.click('#modalConfirm'); await a.click('text=ONAYLA VE İŞLEMİ TAMAMLA');
  // B: A'nın verisini almadan ziynet alışı
  await b.click('[data-home-trade="Ziynet Alış"]');
  await b.fill('#stQty', '2'); await b.fill('#stPrice', '5000');
  await b.click('#modalConfirm');
  await a.waitForTimeout(9000);

  const moves = (fb.db.state.tradeMoves || []).map((x) => x.docNo).sort();
  assert.ok(moves.some((d) => d.startsWith('DA-')), 'A cihazının döviz alışı bulutta olmalı: ' + moves);
  assert.ok(moves.some((d) => d.startsWith('ZA-')), 'B cihazının ziynet alışı bulutta olmalı: ' + moves);
  // A 100 USD × 40 = 4.000 TL, B 2 × 5.000 = 10.000 TL ödedi; iki çıkış da kasaya yansımalı.
  assert.equal(Math.round(tlCash(fb.db.state)), Math.round(cashBefore - 14000));
  assert.match(await historyText(b, 'Döviz Alış'), /DA-\d{4}-0+1/, 'B cihazı A cihazının işlemini görmeli');
  assert.match(await historyText(a, 'Ziynet Alış'), /ZA-\d{4}-0+1/, 'A cihazı B cihazının işlemini görmeli');
  assert.deepEqual([...a.errors, ...b.errors], []);
  await a.context().close(); await b.context().close();
});

test('bulut girişi yapılmışsa Firebase isteklerine kimlik anahtarı eklenir', async () => {
  const fb = createFakeFirebase({ requireAuth: true });
  const p = await newDevice(browser, appUrl, fb, { authConfig: { apiKey: 'K', email: 'magaza@test.com', uid: 'UID1', refreshToken: 'R', idToken: 'TEST_ID_TOKEN', exp: Date.now() + 3600e3 } });
  await p.waitForTimeout(2000);
  assert.ok(fb.db.state, 'girişli cihaz buluta yazabilmeli');
  const dbCalls = fb.log.filter((x) => x.path.startsWith('/kuyumcuProV5'));
  assert.ok(dbCalls.length > 0);
  assert.ok(dbCalls.every((x) => x.auth === 'TEST_ID_TOKEN'), 'tüm istekler auth içermeli');
  await p.context().close();
});

test('girişsiz cihaz kilitli buluta yazamaz ve kullanıcı uyarılır', async () => {
  const fb = createFakeFirebase({ requireAuth: true });
  const p = await newDevice(browser, appUrl, fb);
  await p.waitForTimeout(1500);
  assert.equal(fb.db.state, null);
  await p.click('[data-go="backup"]').catch(() => {});
  await p.waitForTimeout(500);
  assert.match(await p.innerText('body'), /KORUMASIZ|Bulut girişi yapılmadı/);
  await p.context().close();
});

test('toplam tutarlar elle girilebilir ve virgüllü fiyat kabul edilir', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  // Ziynet: fiyat elle girilip miktar değişince fiyat korunur; toplam girilince fiyat hesaplanır
  await p.click('[data-home-trade="Ziynet Alış"]');
  await p.fill('#stPrice', '5000'); await p.fill('#stQty', '3');
  assert.equal(await val(p, 'stPrice'), '5000');
  await p.fill('#stTotal', '14000');
  assert.equal(await val(p, 'stPrice'), '4666.6667');
  await p.click('#modalX');
  // Döviz: toplamdan kur
  await p.click('[data-home-trade="Döviz Alış"]');
  await p.fill('#stQty', '100'); await p.fill('#stTotal', '4855');
  assert.equal(await val(p, 'stPrice'), '48.5500');
  await p.click('#modalX');
  // Satış: virgüllü fiyat ve elle ödenecek tutar
  await p.click('[data-go="sales"]');
  for (let i = 0; i < 3; i++) {
    await p.fill('#saleProductSearch', '22'); await p.waitForTimeout(300); await p.press('#saleProductSearch', 'Enter');
    if (await p.waitForSelector('#saleEntryPrice:not([disabled])', { timeout: 5000 }).catch(() => null)) break;
  }
  await p.waitForTimeout(300); // program seçimden sonra imleci Miktar alanına taşır; o bitmeden yazma
  await p.fill('#saleEntryPrice', '2500,50');
  assert.equal(await val(p, 'saleEntryPayable'), '2500.50');
  await p.fill('#saleEntryPayable', '7.000,00');
  await p.click('#saleAddUnified');
  await p.waitForTimeout(500);
  assert.match(await p.innerText('body'), /7\.000,00/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('çoklu döviz alışı her satırı ayrı belge olarak kaydeder', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.click('[data-home-trade="Döviz Alış"]');
  await p.fill('#stQty', '100'); await p.fill('#stPrice', '40');
  await p.click('text=+ Döviz Ekle');
  const row = p.locator('[data-ufuk-extra-rows] [data-row]').first();
  await row.locator('select').selectOption('EUR');
  await row.locator('input').nth(0).fill('50'); await row.locator('input').nth(1).fill('50');
  await p.click('#modalConfirm');
  await p.click('text=ONAYLA VE İŞLEMİ TAMAMLA');
  await p.waitForTimeout(4000);
  const h = await historyText(p, 'Döviz Alış');
  assert.match(h, /USD/); assert.match(h, /EUR/);
  assert.match(h, /2\.500,00/); assert.match(h, /4\.000,00/);
  await p.context().close();
});

test('şifreli yedek kaydedilir, dosyada veri okunamaz ve parola ile geri yüklenir', async () => {
  const fs = require('node:fs');
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.evaluate(() => { delete window.showSaveFilePicker; });
  await p.click('[data-go="backup"]');
  await p.waitForSelector('#backupDownloadEncrypted');
  p.removeAllListeners('dialog');
  p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Guclu-Parola-2026' : undefined));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#backupDownloadEncrypted')]);
  const file = await dl.path();
  const text = fs.readFileSync(file, 'utf8');
  const env = JSON.parse(text);
  assert.equal(env.format, 'ASIL_KUYUMCU_BACKUP_ENC_V1');
  assert.ok(!/ASİL KUYUMCULUK|pinHash|stocks/.test(env.data), 'veri şifreli olmalı');
  await p.setInputFiles('#backupFile', file);
  // Bildirim 2,8 sn görünür; sabit beklemek yerine görünmesini bekle.
  await p.waitForFunction(() => document.getElementById('toast-root').innerText.includes('Yedek geri yüklendi'), null, { timeout: 15000 });
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('bulut girişi ekranından giriş yapılır ve sonraki istekler kimlikli gider', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  await p.click('[data-go="backup"]');
  await p.click('#cloudAuthOpen');
  await p.fill('#caApiKey', 'AIzaTEST'); await p.fill('#caEmail', 'magaza@test.com'); await p.fill('#caPassword', 'sifre-123456');
  await p.click('#modalConfirm');
  await p.waitForFunction(() => document.body.innerText.includes('GİRİŞLİ'), null, { timeout: 10000 });
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('asil_firebase_auth_v7')));
  assert.equal(stored.email, 'magaza@test.com');
  assert.ok(!JSON.stringify(stored).includes('sifre-123456'), 'şifre cihazda saklanmamalı');
  await p.waitForTimeout(1500); // girişten önce açılmış eski bağlantıların kapanması için
  const n = fb.log.length;
  await p.click('#backupCloudPush', { timeout: 10000 }); await p.waitForTimeout(1500);
  assert.ok(fb.log.slice(n).filter((x) => x.path.startsWith('/kuyumcuProV5')).every((x) => x.auth === 'TEST_ID_TOKEN'));
  await p.context().close();
});

test('çoklu döviz işleminde tüm satırlar tek fişte basılır', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  const popups = [];
  p.context().on('page', (pg) => popups.push(pg));
  await p.click('[data-home-trade="Döviz Alış"]');
  await p.fill('#stQty', '100'); await p.fill('#stPrice', '40');
  await p.click('text=+ Döviz Ekle');
  const row = p.locator('[data-ufuk-extra-rows] [data-row]').first();
  await row.locator('select').selectOption('EUR');
  await row.locator('input').nth(0).fill('50'); await row.locator('input').nth(1).fill('50');
  await p.click('#modalConfirm');
  await p.selectOption('#ufukCurrencySummary select', 'yes');
  await p.click('text=ONAYLA VE İŞLEMİ TAMAMLA');
  await p.waitForTimeout(8000);
  assert.equal(popups.length, 1, 'tek fiş penceresi açılmalı');
  const text = await popups[0].innerText('body');
  assert.match(text, /DÖVİZ İŞLEM FİŞİ/);
  assert.match(text, /USD/); assert.match(text, /EUR/);
  assert.match(text, /6\.500,00/, 'toplam iki satırın toplamı olmalı');
  // Fiş yazıcısında okunur: tüm yazılar tam siyah ve kalın.
  const ink = await popups[0].$$eval('.receipt *', (els) => els.filter((e) => e.textContent.trim()).map((e) => [getComputedStyle(e).color, Number(getComputedStyle(e).fontWeight)]));
  assert.ok(ink.length > 5);
  assert.ok(ink.every(([c, w]) => c === 'rgb(0, 0, 0)' && w >= 700), 'fiş yazıları siyah ve kalın olmalı');
  await p.context().close();
});

test('döviz satırında Enter satır eklemez/silmez, işlemi tamamlamaya ilerler; satır fareyle eklenip silinir', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.click('[data-home-trade="Döviz Alış"]');
  await p.fill('#stQty', '100');
  await p.click('text=+ Döviz Ekle');
  const rows = p.locator('[data-ufuk-extra-rows] [data-row]');
  assert.equal(await rows.count(), 1, 'fare tıklaması satır eklemeli');
  await rows.first().locator('input').first().fill('50');
  const focused = () => p.evaluate(() => document.activeElement.id || document.activeElement.placeholder || document.activeElement.textContent);
  await p.keyboard.press('Enter'); assert.equal(await focused(), 'Kur');
  await p.keyboard.press('Enter'); assert.equal(await focused(), 'TL Toplam');
  await p.keyboard.press('Enter'); assert.equal(await focused(), 'stTlAccount', 'satır sonunda Enter işleme devam etmeli');
  assert.equal(await rows.count(), 1, 'Enter satır eklememeli/silmemeli');
  for (let i = 0; i < 6 && !(await p.$('#ufukCurrencySummary')); i++) { await p.keyboard.press('Enter'); await p.waitForTimeout(150); }
  assert.ok(await p.$('#ufukCurrencySummary'), 'Enter sonunda işlem özeti (kaydet) açılmalı');
  assert.match(await p.innerText('#ufukCurrencySummary'), /1\. USD[\s\S]*2\. USD/, 'iki satır özette olmalı');
  await p.click('#ufukCurrencySummary button:has-text("VAZGEÇ")');
  await p.focus('[data-ufuk-add-row]'); await p.keyboard.press('Enter');
  assert.equal(await rows.count(), 1, 'klavye ile yeni satır eklenmemeli');
  await rows.first().locator('button').click();
  assert.equal(await rows.count(), 0, '× fareyle satırı silmeli');
  await p.context().close();
});

test('Pusula Excel stok yükleme eski stokları siler, yenilerini yükler', async () => {
  const XLSX = require('xlsx');
  const os = require('node:os'); const path = require('node:path'); const fs = require('node:fs');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pusula-')), 'barkodlu.xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['BARKODLU STOK LİSTESİ'], [],
    ['Barkod', 'Grup', 'Cins', 'Ayar', 'Gram', 'Has', 'Alış İşçilik', 'Satış İşçilik'],
    ['YUZ0009001', 'YUZ', 'YÜZÜK', '14', 2.5, '', 0.4, 1.1],
    ['KOL0009002', 'KOL', 'KOLYE', '22', 7.25, '', 0.3, 0.9],
    ['BIL0009003', 'BIL', 'BİLEZİK', '22', 15.1, '', 0.2, 0.6],
  ]), 'Stok');
  XLSX.writeFile(wb, file);

  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  const other = await newDevice(browser, appUrl, fb); // aynı anda açık ikinci cihaz
  await p.click('[data-go="stocks"]');
  await p.click('#pusulaImportV7');
  await p.setInputFiles('#piFile', file);
  await p.waitForFunction(() => /Yüklenecek:<\/b> 3 stok/.test(document.getElementById('piResult').innerHTML), null, { timeout: 10000 });
  assert.match(await p.innerText('#piResult'), /Silinecek: 1691 eski stok/);
  assert.match(await p.innerText('#piResult'), /YUZ0009001/);
  p.removeAllListeners('dialog'); p.on('dialog', (d) => d.accept());
  await p.click('#modalConfirm');
  await p.waitForFunction(() => !document.getElementById('modalRoot'), null, { timeout: 15000 });
  await p.waitForTimeout(4000);
  const stocks = fb.db.state.stocks.filter((x) => x.period === 2026);
  assert.deepEqual(stocks.map((x) => x.barcode).sort(), ['BIL0009003', 'KOL0009002', 'YUZ0009001']);
  const k = stocks.find((x) => x.barcode === 'KOL0009002');
  assert.equal(Number(k.purity), 916); assert.equal(Number(k.hasWeight), 6.641); assert.equal(Number(k.saleHas), 7.541);
  // Satışta yeni barkod bulunur
  await p.click('nav [data-route="sales"]');
  await p.fill('#saleProductSearch', 'KOL0009002'); await p.press('#saleProductSearch', 'Enter');
  await p.waitForSelector('#saleEntryPrice:not([disabled])', { timeout: 10000 });
  assert.match(await p.inputValue('#saleEntryName'), /KOLYE/);
  // İkinci cihaz yeni listeyi "veri kaybı" sanıp reddetmemeli
  await other.waitForTimeout(3000);
  await other.click('[data-go="stocks"]');
  await other.click('[data-stock-view="list"]');
  await other.waitForTimeout(500);
  const otherText = await other.innerText('body');
  assert.match(otherText, /YUZ0009001/, 'ikinci cihaz yeni stokları görmeli');
  assert.doesNotMatch(otherText, /ALY0000744/, 'ikinci cihazda eski stok kalmamalı');
  assert.deepEqual(p.errors, []);
  await p.context().close(); await other.context().close();
});

test('Pusula cari bakiye aktarımı bakiyeleri eşitler, farkı devir hareketi olarak yazar', async () => {
  const XLSX = require('xlsx');
  const os = require('node:os'); const path = require('node:path'); const fs = require('node:fs');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pusula-cari-')), 'cari.xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['CARİ BAKİYE LİSTESİ'],
    ['Cari Kodu', 'Cari Adı', 'Tür', 'TL Bakiye', 'HAS', 'USD'],
    ['373', 'ALI OSMAN YAGıZ', 'Müşteri', 10000, '-1,5', ''],
    ['9999', 'YENİ MÜŞTERİ', 'Müşteri', 250, '', '40'],
    ['361', 'İŞ BANKASI', '', 5000, '', ''],
  ]), 'Cari');
  XLSX.writeFile(wb, file);

  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  await p.click('[data-go="backup"]');
  await p.click('#pusulaImportBackupV7');
  await p.selectOption('#piMode', 'cari');
  await p.setInputFiles('#piFile', file);
  await p.waitForFunction(() => /Excel'de:<\/b> 3 cari/.test(document.getElementById('piResult').innerHTML), null, { timeout: 10000 });
  const txt = await p.innerText('#piResult');
  assert.match(txt, /Yeni: 1 /); assert.match(txt, /YENİ MÜŞTERİ/);
  p.removeAllListeners('dialog'); p.on('dialog', (d) => d.accept());
  await p.click('#modalConfirm');
  await p.waitForFunction(() => !document.getElementById('modalRoot'), null, { timeout: 15000 });
  await p.waitForTimeout(4000);
  const st = fb.db.state;
  const ali = st.customers.find((c) => String(c.code) === '373');
  assert.equal(Number(ali.tlBalance), 10000); assert.equal(Number(ali.hasBalance), -1.5);
  const yeni = st.customers.find((c) => String(c.code) === '9999');
  assert.equal(Number(yeni.tlBalance), 250); assert.equal(Number(yeni.otherBalances.USD), 40);
  const akbank = st.customers.find((c) => String(c.code) === '202');
  assert.equal(Number(akbank.tlBalance || 0), 0, "Excel'de olmayan cari sıfırlanmalı");
  assert.equal(Number(st.bankAccounts.find((b) => b.id === 'BNK-IS').balance), 5000, 'bankaya bağlı carinin TL bakiyesi banka hesabına işlenmeli');
  // Hareket defteri bakiye ile tutarlı: Ali'nin TL hareketleri toplamı = 10000
  const sum = st.customerMoves.filter((m) => m.customerId === ali.id && m.unit === 'TL').reduce((n, m) => n + Number(m.debit || 0) - Number(m.credit || 0), 0);
  assert.equal(Math.round(sum * 100) / 100, 10000);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('Pusula stok özeti açık stok, hurda ve kasayı aktarır; sonra eksik barkodlu dosya engellenir', async () => {
  const XLSX = require('xlsx');
  const os = require('node:os'); const path = require('node:path'); const fs = require('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pusula-ozet-'));
  const ozet = path.join(dir, 'ozet.xlsx'), barkod = path.join(dir, 'barkod.xlsx');
  let wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['TANIM ', 'AYAR ', 'MIKTAR ', 'HAS ', 'ISCILIK ', 'BIRIM ', ' ', ' ', ' ', 'ORTALAMA ', 'Adet ', 'TIP ', ' '],
    ['CEYREK ', 1605, 50, 80.25, 0.1, 'HAS ', 'HAS ', 7, 5, 0.002, 0, 1608, 0],
    ['22 BILEZIK ', 916, 1000, 916, 10, 'HAS ', 'HAS ', 7, 34, 0.01, 0, 926, 0],
    ['TOPLAM ALTIN ', ' ', 1050, 996.25, 10.1, ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
    ['14 K ', 585, 500, 292.5, 50, 'HAS ', 'HAS ', ' ', ' ', '200 ADET ', ' ', ' ', 1],
    ['TOPLAM BARKODLU ALTIN ', ' ', 500, 292.5, 50, ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
    ['14 HURDASI ', 556.9, 30, 16.7, ' ', ' ', 'HAS ', 8, 3, ' ', ' ', ' ', 2],
    ['TOPLAM HURDA ', ' ', 30, 16.7, ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
    ['KASA ', ' ', 'BORÇ ', 'ALACAK ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
    [' ', 'TL. ', 12345.67, ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', 4],
    [' ', 'USD ', 300, ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', 4],
  ]), 'Sayfa1');
  XLSX.writeFile(wb, ozet);
  wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['URUN KODU', 'AYAR', 'MIKTAR', 'HAS', 'ISCILIK', 'Grup', 'Kod'], ['KUP0000001', 585, 2, 1.17, 0.1, 'KUP', 1], ['KUP0000002', 585, 3, 1.75, 0.1, 'KUP', 2]]), 'Sayfa1');
  XLSX.writeFile(wb, barkod);

  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  p.removeAllListeners('dialog'); p.on('dialog', (d) => d.accept());
  await p.click('[data-go="backup"]');
  await p.click('#pusulaImportBackupV7');
  await p.selectOption('#piMode', 'open');
  await p.setInputFiles('#piFile', ozet);
  await p.waitForFunction(() => /stok özeti tanındı/i.test(document.getElementById('piResult').innerText), null, { timeout: 10000 });
  assert.match(await p.innerText('#piResult'), /200 adet · 500 gr/);
  await p.click('#modalConfirm');
  await p.waitForFunction(() => !document.getElementById('modalRoot'), null, { timeout: 15000 });
  await p.waitForTimeout(5000);
  const st = fb.db.state;
  const ce = st.openStocks.find((x) => x.name === 'CEYREK' && x.period === 2026);
  assert.equal(Number(ce.amount), 50); assert.equal(ce.id, 'OPEN-5', 'mevcut kart kimliği korunur'); assert.equal(Number(ce.zGram), 1.75, 'mevcut birim gram korunur');
  assert.equal(st.scrapStocks.find((x) => x.name === '14 HURDASI').amount, 30);
  assert.equal(Number(st.cashAccounts.find((a) => a.id === 'KASA-TL').balance), 12345.67);
  assert.equal(Number(st.cashAccounts.find((a) => a.id === 'KASA-USD').balance), 300);

  // Barkodlu dosya (2 ürün) stok özetiyle (200 adet) tutmuyor → engellenir
  await p.click('#pusulaImportBackupV7');
  await p.selectOption('#piMode', 'barcode');
  await p.setInputFiles('#piFile', barkod);
  await p.waitForFunction(() => /DOSYA EKSİK/.test(document.getElementById('piResult').innerText), null, { timeout: 10000 });
  await p.click('#modalConfirm');
  await p.waitForTimeout(800);
  assert.ok(await p.$('#modalRoot'), 'eksik dosyada aktarım yapılmamalı');
  assert.ok(fb.db.state.stocks.filter((x) => x.period === 2026).length > 100, 'eski stoklar silinmemeli');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('sistem carileri: ziynet kârı KAR HESABI carisine bir kez yazılır, dönem kapanışı DONEM K/Z carisine aktarır', async () => {
  const fb = createFakeFirebase();
  const a = await newDevice(browser, appUrl, fb);
  const b = await newDevice(browser, appUrl, fb);
  a.removeAllListeners('dialog'); a.on('dialog', (d) => d.accept(d.type() === 'prompt' ? '2026' : undefined));
  await a.click('[data-go="customers"]');
  await a.click('#systemCariV7Btn');
  await a.click('#sysEnableV7');
  await a.waitForTimeout(500);
  await a.click('#modalX');
  // Ziynet satışı (kârlı)
  await a.evaluate(() => document.querySelector('[data-route="dashboard"]')?.click());
  await a.waitForSelector('[data-home-trade="Ziynet Satış"]');
  await a.click('[data-home-trade="Ziynet Satış"]');
  await a.fill('#stQty', '1'); await a.fill('#stPrice', '20000');
  await a.click('#modalConfirm'); await a.waitForTimeout(300);
  if (await a.$('#modalRoot #modalConfirm')) { await a.click('#modalConfirm').catch(() => {}); }
  await a.waitForTimeout(8000);
  const st = fb.db.state;
  const kar = st.customers.find((c) => c.sysKeyV7 === 'kar');
  assert.ok(kar, 'KAR HESABI carisi olmalı');
  const karMoves = st.customerMoves.filter((m) => m.customerId === kar.id && m.sourceType === 'systemV7');
  assert.equal(karMoves.length, 1, 'kâr bir kez yazılmalı (iki cihaz açıkken de)');
  assert.ok(karMoves[0].credit > 0, 'kâr alacak olarak yazılır');
  const ledger = st.customerMoves.filter((m) => m.customerId === kar.id).reduce((n, m) => n + Number(m.debit || 0) - Number(m.credit || 0), 0);
  assert.ok(Math.abs(Number(kar.hasBalance || 0) - ledger) < 1e-6, 'bakiye = hareket toplamı');
  // Dönem kapanışı
  await a.evaluate(() => document.querySelector('[data-route="customers"]')?.click());
  await a.waitForSelector('#systemCariV7Btn');
  await a.click('#systemCariV7Btn');
  await a.click('#sysCloseV7');
  await a.waitForTimeout(6000);
  const st2 = fb.db.state;
  const kar2 = st2.customers.find((c) => c.sysKeyV7 === 'kar');
  assert.equal(Math.round(Number(kar2.hasBalance || 0) * 1e6), 0, 'kapanıştan sonra KAR HESABI sıfır');
  const donem = st2.customers.find((c) => /DONEM K\/Z 2026/.test(c.name));
  assert.ok(donem && Number(donem.hasBalance) < 0, 'kâr DONEM K/Z 2026 carisine alacak olarak aktarılmalı');
  assert.deepEqual([...a.errors, ...b.errors], []);
  await a.context().close(); await b.context().close();
});

test('ALTIN STOKLARI penceresi F9 ile açılır; açık stok, barkodlu toplam ve kasa bölümleri vardır', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.keyboard.press('F9');
  await p.waitForSelector('table.gold-stock-v7');
  const t = await p.innerText('table.gold-stock-v7');
  for (const s of ['TANIM', 'CEYREK', 'TOPLAM ALTIN', 'TOPLAM BARKOD', 'TOPLAM HURDA', 'KASA', 'BORÇ', 'ALACAK', 'TL.']) assert.ok(t.includes(s), s + ' görünmeli');
  assert.match(t, /1691 ADET/);
  await p.click('#modalCancel');
  await p.click('[data-gold-stocks]');
  await p.waitForSelector('table.gold-stock-v7');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('ALTIN STOKLARI: satıra çift tıklayınca hareketleri açılır; sıralama değiştirilir ve korunur', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  // Bir ziynet satışı yap: ilgili açık stoğun hareketlerinde çıkan olarak görünmeli.
  await p.waitForSelector('[data-home-trade="Ziynet Satış"]');
  await p.click('[data-home-trade="Ziynet Satış"]');
  const soldName = (await p.$eval('#stItem', (s) => s.options[s.selectedIndex].text)).split('·')[0].trim();
  await p.fill('#stQty', '1'); await p.fill('#stPrice', '20000');
  await p.click('#modalConfirm'); await p.waitForTimeout(300);
  if (await p.$('#modalRoot #modalConfirm')) { await p.click('#modalConfirm').catch(() => {}); }
  await p.waitForTimeout(300);
  await p.keyboard.press('F9');
  await p.waitForSelector('table.gold-stock-v7');
  const rowsCount = await p.locator('table.gold-stock-v7 tr.open').count();
  let found = false;
  for (let i = 0; i < rowsCount && !found; i++) {
    await p.locator('table.gold-stock-v7 tr.open').nth(i).dblclick();
    await p.waitForSelector('.gold-mv-v7');
    const txt = await p.innerText('.gold-mv-v7');
    if (/Ziynet Satış/.test(txt)) { found = true; assert.match(txt, /Ziynet Satış[^\n]*\t1\t/, 'çıkan 1 adet görünmeli'); }
    await p.click('#modalCancel');
    await p.waitForSelector('table.gold-stock-v7');
  }
  assert.ok(found, `ziynet satışı (${soldName}) bir açık stok satırının hareketlerinde görünmeli`);
  await p.waitForSelector('table.gold-stock-v7');
  const openNames = async () => p.$$eval('table.gold-stock-v7 tr.open td:first-child', (tds) => tds.map((td) => td.innerText.replace(/[▲▼]/g, '').trim()));
  const before = await openNames();
  assert.ok(before.length >= 2, 'en az iki açık stok satırı olmalı');
  // Çift tık: hareket penceresi, devir satırı ve son kalan stoktaki miktara eşit.
  const firstRow = p.locator('table.gold-stock-v7 tr.open').first();
  const qtyText = (await firstRow.locator('td').nth(2).innerText()).trim();
  await firstRow.dblclick();
  await p.waitForSelector('.gold-mv-v7');
  const mv = await p.innerText('.gold-mv-v7');
  assert.ok(mv.includes('DEVİR / AÇILIŞ') && mv.includes('TOPLAM'), 'devir ve toplam satırı olmalı');
  const lastBal = (await p.locator('.gold-mv-v7 tr.sum td').last().innerText()).trim();
  assert.equal(Number(lastBal.replace(/\./g, '').replace(',', '.')), Number(qtyText.replace(/\./g, '').replace(',', '.')), 'kalan, stok miktarına eşit olmalı');
  await p.click('#modalCancel');
  await p.waitForSelector('table.gold-stock-v7');
  // Tek tık + Hareketler düğmesi (dokunmatik ekran için).
  await p.locator('table.gold-stock-v7 tr.cash').first().click();
  await p.click('#goldMovesV7');
  await p.waitForSelector('.gold-mv-v7');
  await p.click('#modalCancel');
  // Sıralama: ilk açık stoğu bir aşağı al.
  await p.click('#goldOrderV7');
  await p.locator('table.gold-stock-v7 tr.open [data-gold-down]').first().click();
  await p.click('#goldOrderDoneV7');
  const after = await openNames();
  assert.equal(after[0], before[1]);
  assert.equal(after[1], before[0]);
  // Pencere kapanıp yeniden açılınca sıra korunur.
  await p.click('#modalCancel');
  await p.keyboard.press('F9');
  await p.waitForSelector('table.gold-stock-v7');
  assert.deepEqual(await openNames(), after);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('KASA SAYIMI: sayılan miktar sistemle karşılaştırılır; fazla AL, eksik SAT olarak raporlanır ve kaydedilir', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  await p.keyboard.press('F9');
  await p.click('#goldCountV7');
  await p.waitForSelector('.kc-wrap');
  const num = (t) => Number(String(t).replace(/\./g, '').replace(',', '.'));
  const rowSys = async (sel) => num(await p.locator(sel).locator('td').nth(2).innerText());
  assert.equal(await p.locator('tr[data-kc-row^="b:"], tr[data-kc-row="sp"]').count(), 0, 'barkodlu ürünler kasa sayımına girmemeli');
  const kcNames = await p.$$eval('tr[data-kc-row^="o:"] td:first-child', (tds) => tds.map((t) => t.textContent.trim()));
  assert.ok(kcNames.length && !kcNames.some((t) => /B[İI]LEZ[İI]K$|^14 K|^8 K|^22 K/.test(t)), 'gramlı barkodsuz stoklar sayıma girmemeli: ' + kcNames.join(', '));
  const kcSys = await p.$$eval('tr[data-kc-row^="o:"], tr[data-kc-row^="s:"]', (trs) => trs.map((tr) => tr.querySelectorAll('td')[2].textContent.trim()));
  assert.ok(!kcSys.some((t) => /^0(,0+)?$/.test(t)), 'sıfır stoklu satır sayıma girmemeli: ' + kcSys.join(' | '));
  const openRow = p.locator('tr[data-kc-row^="o:"]').first();
  const openName = (await openRow.locator('td').first().innerText()).trim();
  const openSys = await rowSys('tr[data-kc-row^="o:"] >> nth=0');
  const cashSys = await rowSys('tr[data-kc-row="c:TL"]');
  await openRow.locator('input').fill(String(openSys + 2));
  await openRow.locator('input').press('Enter'); // sonraki satıra geçer, rapor açılmaz
  assert.ok(await p.$('.kc-wrap'), 'Enter sayım ekranında kalmalı');
  assert.match(await openRow.locator('.kc-diff').innerText(), /^\+2/);
  await p.fill('tr[data-kc-row="c:TL"] input', String(cashSys - 100).replace('.', ','));
  assert.match(await p.innerText('#kcInfo'), /^2\//);
  await p.click('#modalConfirm');
  await p.waitForSelector('table.kc-rep');
  const rep = await p.innerText('#modalRoot .modal-body');
  assert.match(rep, /AL — sisteme GİRİŞ/);
  assert.match(rep, /SAT — sisteme ÇIKIŞ/);
  const alPart = rep.split('SAT —')[0], satPart = rep.split('SAT —')[1];
  assert.ok(alPart.includes(openName), 'fazla sayılan açık stok AL bölümünde olmalı');
  assert.ok(satPart.includes('Kasa TL'), 'eksik kasa SAT bölümünde olmalı');
  await p.click('#modalConfirm'); // SAYIMI KAYDET
  await p.waitForSelector('table.gold-stock-v7');
  await p.waitForTimeout(6000);
  const saved = fb.db.state.kasaCountsV7;
  assert.ok(Array.isArray(saved) && saved.length === 1, 'sayım buluta kaydedilmeli');
  assert.equal(saved[0].rows.filter((r) => r.off).length, 2);
  // Stok değişmez.
  await p.click('#goldCountV7');
  await p.waitForSelector('.kc-wrap');
  assert.equal(await rowSys('tr[data-kc-row^="o:"] >> nth=0'), openSys);
  assert.equal(await p.inputValue('tr[data-kc-row^="o:"] >> nth=0 >> input'), '', 'kaydedilen sayımdan sonra taslak temizlenir');
  await p.click('#kcHistoryV7');
  await p.click('[data-kc-open]');
  await p.waitForSelector('table.kc-rep');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('Son Fiş: satış ekranındaki ziynet alışı dahil son işlemin fişi basılır; F10 fiş listesi', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  const popups = [];
  p.context().on('page', (pg) => popups.push(pg));
  await p.click('[data-go="sales"]');
  await p.waitForSelector('[data-special-trade="Ziynet Alış"]');
  await p.click('[data-special-trade="Ziynet Alış"]');
  await p.fill('#stQty', '2'); await p.fill('#stPrice', '15000');
  await p.click('#modalConfirm'); await p.waitForTimeout(400);
  if (await p.$('#modalRoot #modalConfirm')) { await p.click('#modalConfirm').catch(() => {}); }
  await p.waitForTimeout(400);
  await p.click('[data-receipt-kind="last"]');
  for (let i = 0; i < 40 && popups.length < 1; i++) await p.waitForTimeout(250);
  assert.equal(popups.length, 1, 'fiş penceresi açılmalı');
  const text = await popups[0].innerText('body');
  assert.match(text, /ALTIN \/ ZİYNET|Ziynet Alış/i, 'son fiş ziynet alışı olmalı');
  assert.doesNotMatch(text, /SATIŞ FİŞİ/);
  // Testte QZ yok: "doğrudan baskı olmadı" uyarısı kapatılır.
  // Playwright'ta timeout:0 süresiz bekler; bekleme yalnız süre verilirse yapılır.
  const closeAlert = async (waitMs = 0) => { if (waitMs) await p.waitForSelector('.critical-alert button', { timeout: waitMs }).catch(() => {}); const b = await p.$('.critical-alert button'); if (b) await b.click(); };
  await closeAlert(3000);
  // F10: son işlemler listesi, en üstte ziynet alışı.
  await p.keyboard.press('F10');
  await p.waitForSelector('[data-recent-receipt="0"]');
  const first = await p.locator('#modalRoot tbody tr').first().innerText();
  assert.match(first, /Ziynet Alış/);
  await closeAlert(1000);
  await p.locator('#modalRoot tbody tr').first().locator('[data-recent-receipt]').click();
  // Yoğun makinede fiş penceresi geç açılabilir: süre tanınır.
  for (let i = 0; i < 80 && popups.length < 2; i++) await p.waitForTimeout(250);
  assert.equal(popups.length, 2, 'listeden de fiş basılmalı');
  // Diğer çıktılar (kimlik formu, raporlar…): gri yazı da siyah ve kalın basılır.
  await p.evaluate(() => { const w = window.open('', '_blank'); w.document.write('<!doctype html><html><head><style>.l{color:#888;font-weight:400}</style></head><body><span class="l">Ad Soyad</span></body></html>'); w.document.close(); });
  for (let i = 0; i < 20 && popups.length < 3; i++) await p.waitForTimeout(100);
  const [c, fw] = await popups[2].$eval('.l', (e) => [getComputedStyle(e).color, Number(getComputedStyle(e).fontWeight)]);
  assert.equal(c, 'rgb(0, 0, 0)'); assert.ok(fw >= 700);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('KAMERA İLE KİMLİK OKU: MRZ metni ayrıştırılır, alanlar doldurulur ve MASAK müşterisi oluşturulur', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  // Testte gerçek OCR yok: Tesseract yerine bilinen MRZ metnini döndüren sahte kütüphane.
  const ocr = ['T.C. KIMLIK KARTI', 'I<TURA12B34567510000000146<<<<', '9001158M3105205TUR<<<<<<<<<<<0', 'YILMAZ<<AHMET<CAN<KLKLLL<<<<<<'].join('\n');
  await p.context().route(/tesseract\.min\.js/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: `window.Tesseract={createWorker:async(l)=>{window.__ocrLangs=(window.__ocrLangs||[]).concat(l);if(l==='ocrb_int')throw new Error('indirilemedi');return ({setParameters:async()=>{},recognize:async()=>({data:{text:${JSON.stringify(ocr)}}}),terminate:async()=>{}});}};` }));
  await p.evaluate(() => document.querySelector('[data-go="compliance"]')?.click());
  await p.click('#startCameraKyc');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await p.setInputFiles('#camKycFile', { name: 'kimlik.png', mimeType: 'image/png', buffer: png });
  await p.waitForSelector('#camKycSave');
  assert.equal(await p.inputValue('#ckName'), 'AHMET CAN YILMAZ');
  assert.equal(await p.inputValue('#ckTckn'), '10000000146');
  assert.deepEqual(await p.evaluate(() => window.__ocrLangs), ['ocrb_int', 'eng'], 'önce kimlik yazı tipi modeli, indirilemezse genel model');
  assert.equal(await p.inputValue('#ckDoc'), 'A12B34567');
  assert.equal(await p.inputValue('#ckBirth'), '1990-01-15');
  assert.equal(await p.inputValue('#ckExpiry'), '2031-05-20');
  await p.click('#camKycSave');
  await p.waitForSelector('#kycName');
  assert.equal(await p.inputValue('#kycName'), 'AHMET CAN YILMAZ');
  const rec = await p.evaluate(() => JSON.parse(localStorage.getItem('asil_kuyumcu_pro_kyc_v2') || '[]')[0]);
  assert.equal(rec.tckn, '10000000146'); assert.equal(rec.mrzCameraRead, true); assert.notEqual(rec.verified, true);
  // MASAK evrakı yazdırılırken yazıcı sorulur; A4 seçilince tarayıcı yazdırma penceresi açılır, düzenleme penceresi kapanmaz.
  const pops = []; p.context().on('page', (pg) => pops.push(pg));
  await p.evaluate(() => document.getElementById('printKycFromEdit').click());
  await p.waitForSelector('#kycPrintPick [data-kyc-paper="a4"]');
  assert.match(await p.innerText('#kycPrintPick'), /Fiş yazıcısı \(Aclas\)/);
  await p.click('#kycPrintPick [data-kyc-paper="a4"]');
  for (let i = 0; i < 40 && !pops.length; i++) await p.waitForTimeout(100);
  assert.equal(pops.length, 1, 'A4 seçilince yazdırma penceresi açılmalı');
  assert.equal(await p.$('#kycPrintPick'), null);
  assert.ok(await p.$('#kycName'), 'kimlik düzenleme penceresi açık kalmalı');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('PC\'de başlatılan kimlik okuması telefonda QR ile açılan sayfadan fotoğrafla gelir', async () => {
  const auth = { apiKey: 'K', email: 'magaza@test.com', uid: 'UID1', refreshToken: 'R', idToken: 'TEST_ID_TOKEN', exp: Date.now() + 3600e3 };
  const pc = await newDevice(browser, appUrl, createFakeFirebase(), { authConfig: auth });
  // Sahte NFC köprüsü (api/nfc): oturum aç / gönder / sorgula.
  const sessions = {};
  const bridge = async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    const b = JSON.parse(req.postData() || '{}'); let out = { ok: false };
    if (b.action === 'createNfcSession') { const code = '12345678'; sessions[code] = { status: 'WAITING' }; out = { ok: true, code }; }
    if (b.action === 'submitNfcIdentity') { sessions[b.code] = { status: 'READY', payload: b.payload }; out = { ok: true, status: 'READY' }; }
    if (b.action === 'pollNfcSession') { const s = sessions[b.code]; out = s && s.status === 'READY' ? { ok: true, status: 'READY', payload: s.payload } : { ok: true, status: 'WAITING' }; if (s && s.status === 'READY') delete sessions[b.code]; }
    return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify(out) });
  };
  await pc.context().route(/\/api\/nfc/, bridge);
  await pc.evaluate(() => document.querySelector('[data-go="compliance"]')?.click());
  await pc.click('#startNfcNew');
  await pc.waitForSelector('#nfcCamLink[href*="kimlik.html"]');
  const link = await pc.getAttribute('#nfcCamLink', 'href');
  assert.match(link, /c=12345678/);
  // Telefon: ayrı cihaz, giriş yok; sahte OCR.
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await phoneCtx.route(/\/api\/nfc/, bridge);
  const ocr = ['I<TURA12B34567510000000146<<<<', '9001158M3105205TUR<<<<<<<<<<<0', 'YILMAZ<<AHMET<CAN<<<<<<<<<<<<<'].join('\n');
  await phoneCtx.route(/tesseract\.min\.js/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: `window.Tesseract={createWorker:async()=>({setParameters:async()=>{},recognize:async()=>({data:{text:${JSON.stringify(ocr)}}}),terminate:async()=>{}})};` }));
  const phone = await phoneCtx.newPage();
  const phoneErrors = []; phone.on('pageerror', (e) => phoneErrors.push(e.message));
  await phone.goto(link);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await phone.setInputFiles('#file', { name: 'kimlik.png', mimeType: 'image/png', buffer: png });
  await phone.waitForSelector('#result:not([hidden])');
  assert.equal(await phone.inputValue('#tckn'), '10000000146');
  await phone.click('#send');
  await phone.waitForSelector('#status.ok');
  // PC: sorgulama veriyi alır, kayıt açılır.
  await pc.waitForFunction(() => (JSON.parse(localStorage.getItem('asil_kuyumcu_pro_kyc_v2') || '[]')[0] || {}).tckn === '10000000146', null, { timeout: 15000 });
  const rec = await pc.evaluate(() => JSON.parse(localStorage.getItem('asil_kuyumcu_pro_kyc_v2'))[0]);
  assert.equal(rec.fullName, 'AHMET CAN YILMAZ'); assert.equal(rec.documentNo, 'A12B34567'); assert.equal(rec.birthDate, '1990-01-15');
  assert.equal(rec.mrzCameraRead, true); assert.notEqual(rec.nfcRead, true, 'kamera okuması NFC sayılmaz');
  assert.deepEqual([...pc.errors, ...phoneErrors], []);
  await phoneCtx.close(); await pc.context().close();
});

test('telefonda satış ekranı: açılışta klavye açılmaz, kaydırma odaktaki alana geri çekilmez', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.setViewportSize({ width: 390, height: 700 });
  await p.evaluate(() => document.querySelector('[data-go="sales"]')?.click());
  await p.waitForSelector('#saleProductSearch');
  await p.waitForTimeout(300);
  assert.notEqual(await p.evaluate(() => document.activeElement?.id), 'saleProductSearch', 'telefonda arama kutusu kendiliğinden odaklanmamalı');
  // Kullanıcı arama kutusuna dokunur, sonra parmağıyla aşağı kaydırır.
  await p.focus('#saleProductSearch');
  await p.waitForTimeout(500);
  await p.evaluate(() => { window.dispatchEvent(new Event('touchstart')); window.scrollTo(0, 900); window.dispatchEvent(new Event('touchmove')); });
  const y0 = await p.evaluate(() => window.scrollY);
  await p.waitForTimeout(700);
  const y1 = await p.evaluate(() => window.scrollY);
  assert.ok(y0 > 300 && Math.abs(y1 - y0) < 5, `kaydırma korunmalı (${y0} → ${y1})`);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('özel ürün aktarımı altın stoklarına dokunmaz; USD fiyatlı ürün satışta güncel kurla TL olur', async () => {
  const XLSX = require('xlsx');
  const os = require('node:os'); const path = require('node:path'); const fs = require('node:fs');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pusula-ozel-')), 'ozel.xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['URUN KODU ', 'AYAR ', 'MIKTAR ', 'HAS ', 'ISCILIK ', 'BIRIM ', 'MALIYET ', 'SAT.FİYATI ', 'MODEL ', 'Grup ', 'Kod '],
    ['SAA0000701 ', ' ', 1, ' ', ' ', 'USD ', 20, 100, ' ', 'SAA ', 701],
    ['GUM0000702 ', ' ', 3, ' ', ' ', 'TL. ', 40, 750, ' ', 'GUM ', 702],
  ]), 'Sayfa1');
  XLSX.writeFile(wb, file);
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  p.removeAllListeners('dialog'); p.on('dialog', (d) => d.accept());
  await p.click('[data-go="backup"]');
  await p.click('#pusulaImportBackupV7');
  await p.selectOption('#piMode', 'special');
  await p.setInputFiles('#piFile', file);
  await p.waitForFunction(() => /Yüklenecek:<\/b> 2 özel ürün/.test(document.getElementById('piResult').innerHTML), null, { timeout: 10000 });
  await p.click('#modalConfirm');
  await p.waitForFunction(() => !document.getElementById('modalRoot'), null, { timeout: 15000 });
  await p.waitForTimeout(5000);
  const st = fb.db.state.stocks.filter((x) => x.period === 2026);
  assert.equal(st.filter((x) => x.specialV7).length, 2);
  assert.ok(st.filter((x) => !x.specialV7).length >= 1691, 'altın barkodlu stoklar silinmemeli');
  await p.evaluate(() => document.querySelector('[data-route="sales"]')?.click());
  await p.waitForSelector('#saleProductSearch');
  await p.fill('#saleProductSearch', 'SAA0000701'); await p.press('#saleProductSearch', 'Enter');
  await p.waitForSelector('#saleEntryPrice:not([disabled])', { timeout: 10000 });
  const price = Number(await p.inputValue('#saleEntryPrice'));
  const usd = await p.evaluate(() => parseFloat(String(document.getElementById('tickerUsd')?.textContent || '0').replace(',', '.')) || 0);
  assert.ok(price > 1000, '100 USD satış fiyatı TL olarak gelmeli: ' + price);
  if (usd) assert.ok(Math.abs(price - 100 * usd) < 100 * usd * 0.05);
  await p.keyboard.press('F9');
  await p.waitForSelector('table.gold-stock-v7');
  const goldText = await p.innerText('table.gold-stock-v7');
  assert.match(goldText, /TOPLAM HURDA/);
  assert.doesNotMatch(goldText, /ÖZEL ÜRÜN/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('bilanço Pusula düzeninde: kasa bir kez sayılır, hesap grubu değiştirilir, Pusula bilançosu ile karşılaştırılır', async () => {
  const XLSX = require('xlsx');
  const os = require('node:os'); const path = require('node:path'); const fs = require('node:fs');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pusula-bilanco-')), 'bilanco.xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Hesap Tanimi ', 'Cins ', 'Borcumuz ', 'Alacağımız ', ' ', 'Borcumuz ', 'Alacağımız '],
    ['MUSTERI ', 'TL. ', 100, 50, ' ', 0.02, 0.01],
    ['KASA ', 'TL. ', 0, 123, ' ', 0, 0.02],
    ['TOPLAM ', ' ', ' ', ' ', ' ', 0.02, 0.03],
  ]), 'Sayfa1');
  XLSX.writeFile(wb, file);

  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  // Pusula'daki gibi bir "KASA" carisi: kasa hesabının aynası, bilançoda ikinci kez sayılmamalı.
  const cariFile = path.join(path.dirname(file), 'cari.xlsx');
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([['FIRMA UNVANI ', 'KOD ', 'TL. '], ['KASA ', 1, 999999], ['TEST MÜŞTERİ ', 5000, 1500]]), 'Cari');
  XLSX.writeFile(wb2, cariFile);
  await p.click('[data-go="backup"]');
  await p.click('#pusulaImportBackupV7');
  await p.selectOption('#piMode', 'cari');
  await p.setInputFiles('#piFile', cariFile);
  await p.waitForFunction(() => /Excel'de:<\/b> 2 cari/.test(document.getElementById('piResult').innerHTML), null, { timeout: 10000 });
  p.removeAllListeners('dialog'); p.on('dialog', (d) => d.accept());
  await p.click('#modalConfirm');
  await p.waitForFunction(() => !document.getElementById('modalRoot'), null, { timeout: 15000 });
  await p.waitForTimeout(1500);
  assert.equal(await p.locator('.critical-alert').count(), 0, 'aktarım sonrası yanlış veri güvenliği uyarısı çıkmamalı');
  const openBal = async () => {
    await p.evaluate(() => (document.querySelector('[data-route="reports"]') || document.querySelector('[data-go="reports"]')).click());
    await p.click('[data-pusula-report="balance_sheet"]');
    await p.waitForSelector('#balResult table');
  };
  await openBal();
  const rows = await p.$$eval('#balResult .bal-table-v7 tbody tr', (trs) => trs.map((tr) => [...tr.children].map((td) => td.innerText.trim())));
  const kasaTl = rows.filter((r) => r[0] === 'KASA' && r[1] === 'TL.');
  assert.equal(kasaTl.length, 1, 'KASA TL tek satır olmalı');
  const st = fb.db.state;
  const cashTl = st.cashAccounts.filter((a) => a.currency === 'TL').reduce((n, a) => n + Number(a.balance || 0), 0);
  const shown = Number(kasaTl[0][3].replace(/\./g, '').replace(',', '.'));
  assert.equal(Math.round(shown * 100), Math.round(cashTl * 100), 'KASA satırı kasa hesaplarının toplamı olmalı');
  assert.ok(rows.some((r) => r[0] === 'TOPLAM'));

  // Hesap grubu: bakiyeli bir cariyi PERSONEL grubuna al.
  await p.click('#balGroupsV7');
  const cariId = await p.$$eval('[data-bg-row]', (trs) => trs.find((tr) => tr.children[2].innerText.trim() === 'Müşteri')?.dataset.bgRow);
  assert.ok(cariId, 'listede bakiyeli müşteri olmalı');
  const cari = { id: cariId };
  await p.fill(`[data-bg="${cari.id}"]`, 'personel');
  await p.click('#modalConfirm');
  await p.waitForSelector('#balResult table');
  const groups = await p.$$eval('#balResult .bal-table-v7 tbody tr td:first-child', (tds) => tds.map((td) => td.innerText.trim()));
  assert.ok(groups.includes('PERSONEL'), 'PERSONEL grubu bilançoda görünmeli: ' + [...new Set(groups)]);
  await p.waitForTimeout(3000);
  assert.equal(fb.db.state.customers.find((c) => c.id === cari.id).balanceGroupV7, 'PERSONEL');

  // Pusula bilanço Excel'i ile karşılaştırma
  await p.setInputFiles('#balPusulaFileV7', file);
  await p.waitForSelector('text=Pusula Bilançosu ile Karşılaştırma');
  const cmp = await p.innerText('#balResult');
  assert.match(cmp, /satır farklı/);
  assert.match(cmp, /Toplam HAS Alacağımız/);

  // Excel'e aktar: Pusula düzeninde bilanço + cari detay + karşılaştırma; dosya bu programa geri okunabilir.
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#balExcelV7')]);
  const out = path.join(path.dirname(file), 'bizim-bilanco.xlsx');
  await dl.saveAs(out);
  const book = XLSX.readFile(out);
  assert.deepEqual(book.SheetNames, ['Bilanço', 'Cari Detay', 'Karşılaştırma']);
  const P = require('../../js/asil-pusula-import.js');
  const aoa = XLSX.utils.sheet_to_json(book.Sheets['Bilanço'], { header: 1, defval: '' });
  assert.equal(P.isBalanceSheet(aoa), true);
  const back = P.parseBalanceSheet(aoa);
  assert.ok(back.rows.some((r) => r.group === 'KASA' && r.unit === 'TL'));
  assert.ok(back.rows.some((r) => r.group === 'PERSONEL'));
  assert.ok(back.totals && back.capital.remaining !== undefined);
  const detail = XLSX.utils.sheet_to_json(book.Sheets['Cari Detay'], { header: 1, defval: '' });
  assert.ok(detail.some((r) => r[0] === 'KASA' && /kasa\/banka hesabından/.test(r[7])), 'KASA carisi detayda işaretli olmalı');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('cari temizleme listesi: işaretli cariler net HAS olarak düzeltme hesabına aktarılır; kasa ve bilanço sonucu değişmez', async () => {
  const XLSX = require('xlsx');
  const os = require('node:os'); const path = require('node:path'); const fs = require('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cari-temizle-'));
  const cariFile = path.join(dir, 'cari.xlsx'), listFile = path.join(dir, 'liste.xlsx');
  let wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['FIRMA UNVANI ', 'KOD ', 'HAS ', 'TL. '], ['TEST TEMIZ ', 7001, '', 1500], ['TEST KALSIN ', 7002, -2, '']]), 'Cari');
  XLSX.writeFile(wb, cariFile);
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  p.removeAllListeners('dialog'); p.on('dialog', (d) => d.accept());
  await p.click('[data-go="backup"]'); await p.click('#pusulaImportBackupV7');
  await p.selectOption('#piMode', 'cari'); await p.setInputFiles('#piFile', cariFile);
  await p.waitForFunction(() => /Excel'de:<\/b> 2 cari/.test(document.getElementById('piResult').innerHTML), null, { timeout: 10000 });
  await p.click('#modalConfirm');
  await p.waitForFunction(() => !document.getElementById('modalRoot'), null, { timeout: 15000 });

  wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['KOD', 'CARİ', 'TÜR', 'ŞU ANKİ GRUP', 'TL', 'HAS', 'İŞLEM (KALSIN / TEMİZLE)', 'YENİ GRUP (boşsa değişmez)'],
    ['7001', 'TEST TEMIZ', 'Müşteri', 'MUSTERI', 1500, '', 'TEMİZLE', ''],
    ['7002', 'TEST KALSIN', 'Müşteri', 'MUSTERI', '', -2, 'kalsın', 'personel'],
  ]), 'Cariler');
  XLSX.writeFile(wb, listFile);
  const kalan = async () => {
    await p.evaluate(() => (document.querySelector('[data-route="reports"]') || document.querySelector('[data-go="reports"]')).click());
    await p.click('[data-pusula-report="balance_sheet"]'); await p.waitForSelector('#balResult table');
    const t = await p.innerText('#balResult'); await p.click('#modalCancel');
    return (/Kalan Sermaye\s+([-\d.,]+)/.exec(t) || [])[1];
  };
  await p.waitForTimeout(1500);
  const kalanBefore = await kalan();
  assert.ok(kalanBefore, 'bilançoda Kalan Sermaye okunmalı');
  const cashBefore = JSON.stringify(fb.db.state.cashAccounts.map((a) => [a.id, a.balance]));
  await p.evaluate(() => (document.querySelector('[data-route="customers"]') || document.querySelector('[data-go="customers"]')).click());
  await p.click('#cariCleanupV7');
  await p.setInputFiles('#ccFileV7', listFile);
  await p.waitForFunction(() => /1<\/b> cari temizlenecek/.test(document.getElementById('ccResultV7').innerHTML), null, { timeout: 10000 });
  await p.click('#modalConfirm');
  await p.waitForFunction(() => !document.getElementById('modalRoot'), null, { timeout: 15000 });
  await p.waitForTimeout(4000);
  const st = fb.db.state;
  const a = st.customers.find((c) => String(c.code) === '7001'), b = st.customers.find((c) => String(c.code) === '7002');
  const adj = st.customers.find((c) => c.name === 'CARİ BAKİYE DÜZELTME');
  assert.equal(Number(a.tlBalance || 0), 0);
  assert.equal(Number(adj.tlBalance || 0), 0, 'düzeltme hesabı yalnız HAS tutar');
  assert.ok(Number(adj.hasBalance) > 0, 'net alacak HAS olarak düzeltme hesabına aktarılmalı');
  assert.equal(adj.balanceGroupV7, 'CARİ DÜZELTME');
  assert.equal(JSON.stringify(st.cashAccounts.map((x) => [x.id, x.balance])), cashBefore, 'kasa değişmemeli');
  assert.equal(await kalan(), kalanBefore, 'bilançodaki Kalan Sermaye değişmemeli');
  assert.equal(Number(b.hasBalance), -2, 'KALSIN işaretli cari değişmemeli');
  assert.equal(b.balanceGroupV7, 'PERSONEL');
  const led = st.customerMoves.filter((m) => m.customerId === a.id && m.unit === 'TL').reduce((n, m) => n + Number(m.debit || 0) - Number(m.credit || 0), 0);
  assert.equal(Math.round(led * 100), 0, 'hareket defteri bakiye ile tutarlı olmalı');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('Pusula öncesi deneme kayıtları silinir; bakiyeler değişmez, cari defteri denkleşir, buluta yazılır', async () => {
  const XLSX = require('xlsx');
  const os = require('node:os'); const path = require('node:path'); const fs = require('node:fs');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'deneme-sil-')), 'cari.xlsx');
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  // Deneme işlemi: ziynet alışı (Pusula aktarımından önce)
  await p.click('[data-home-trade="Ziynet Alış"]');
  await p.fill('#stQty', '2'); await p.fill('#stPrice', '5000');
  await p.click('#modalConfirm');
  await p.waitForTimeout(1500);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['FIRMA UNVANI ', 'KOD ', 'TL. '], ['DENEME CARI ', 7101, 2500]]), 'Cari');
  XLSX.writeFile(wb, file);
  p.removeAllListeners('dialog'); p.on('dialog', (d) => d.accept());
  await p.evaluate(() => (document.querySelector('[data-route="backup"]') || document.querySelector('[data-go="backup"]')).click()); await p.click('#pusulaImportBackupV7');
  await p.selectOption('#piMode', 'cari'); await p.setInputFiles('#piFile', file);
  await p.waitForFunction(() => /Excel'de:<\/b> 1 cari/.test(document.getElementById('piResult').innerHTML), null, { timeout: 10000 });
  await p.click('#modalConfirm');
  await p.waitForFunction(() => !document.getElementById('modalRoot'), null, { timeout: 15000 });
  await p.waitForTimeout(4000);
  const before = JSON.parse(JSON.stringify(fb.db.state));
  assert.ok((before.tradeMoves || []).length >= 1, 'deneme işlemi bulutta olmalı');
  const cash = (st) => st.cashAccounts.map((a) => a.currency + ':' + Number(a.balance)).sort().join(',');
  const bal = (st) => st.customers.map((c) => c.id + ':' + Number(c.tlBalance || 0) + ':' + Number(c.hasBalance || 0)).sort().join(',');

  await p.evaluate(() => (document.querySelector('[data-route="backup"]') || document.querySelector('[data-go="backup"]')).click());
  await p.click('#trialPurgeV7');
  // Dakika hassasiyeti: sınırı bir dakika sonrasına al ki az önceki deneme işlemi kapsansın.
  await p.evaluate(() => { const d = new Date(Date.now() + 60000); const el = document.getElementById('tpCutV7'); el.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); el.dispatchEvent(new Event('change')); });
  assert.ok(await p.isChecked('[data-tp="tradeMoves"]'));
  await p.click('#modalConfirm');
  await p.waitForFunction(() => !document.getElementById('modalRoot'), null, { timeout: 15000 });
  await p.waitForTimeout(5000);
  assert.equal(await p.locator('.critical-alert').count(), 0, 'güvenlik uyarısı çıkmamalı');
  const after = fb.db.state;
  assert.equal((after.tradeMoves || []).length, 0, 'deneme işlemleri buluttan da silinmeli');
  assert.equal(cash(after), cash(before), 'kasa bakiyeleri değişmemeli');
  assert.equal(bal(after), bal(before), 'cari bakiyeleri değişmemeli');
  // Her carinin hareket defteri bakiyesine eşit
  for (const c of after.customers) {
    const sum = (after.customerMoves || []).filter((m) => m.customerId === c.id && String(m.unit || 'TL').toUpperCase() === 'TL').reduce((n, m) => n + Number(m.debit || 0) - Number(m.credit || 0), 0);
    assert.equal(Math.round(sum * 100), Math.round(Number(c.tlBalance || 0) * 100), c.name + ' defteri bakiye ile tutmalı');
  }
  assert.ok(after.meta.trialPurgeV7, 'temizlik işareti olmalı');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('cari kartları: tür filtresi arama alanını gizlemez; tür, bakiye ve arama birlikte çalışır', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  await p.evaluate(() => (document.querySelector('[data-route="customers"]') || document.querySelector('[data-go="customers"]')).click());
  await p.waitForSelector('#cariCardSearch');
  const visibleTypes = () => p.$$eval('[data-cari-card]', (cs) => [...new Set(cs.filter((c) => c.style.display !== 'none').map((c) => c.dataset.cariType + '/' + c.dataset.cariBalance))]);
  await p.click('[data-cari-type-filter="Toptancı"]');
  await p.waitForTimeout(300);
  assert.ok(await p.isVisible('#cariCardSearch'), 'arama alanı görünür kalmalı');
  assert.ok(await p.isVisible('#cariBalanceFilter'), 'bakiye filtresi görünür kalmalı');
  assert.ok((await visibleTypes()).every((t) => t.startsWith('Toptancı/')));
  await p.selectOption('#cariBalanceFilter', 'credit');
  await p.waitForTimeout(200);
  const types = await visibleTypes();
  assert.ok(types.length && types.every((t) => t === 'Toptancı/credit'), 'tür + bakiye filtresi: ' + types);
  await p.click('#cariCardClear');
  assert.ok((await visibleTypes()).some((t) => t.startsWith('Müşteri/')), 'temizle tüm carileri göstermeli');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('ana menüde Genel Satış Raporu; rapor HAS ya da TL gösterilir ve seçim hatırlanır', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  await p.click('.home-tile[data-go="salesreport"]');
  await p.waitForSelector('#prResult table');
  assert.match(await p.innerText('#prResult'), /Satış Raporu Genel/);
  assert.match(await p.innerText('#prResult thead'), /Satış HAS/);
  await p.selectOption('#prUnit', 'TL');
  await p.waitForFunction(() => /Satış TL/.test(document.querySelector('#prResult thead')?.innerText || ''));
  await p.click('#modalCancel');
  await p.click('.home-tile[data-go="salesreport"]');
  await p.waitForSelector('#prResult table');
  assert.equal(await p.inputValue('#prUnit'), 'TL', 'seçim hatırlanmalı');
  assert.match(await p.innerText('#prResult thead'), /Kâr TL/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('cari kartı: banka carisi banka hesabına bağlanır (bakiye taşınır), gereksiz cari silinir', async () => {
  const XLSX = require('xlsx');
  const os = require('node:os'); const path = require('node:path'); const fs = require('node:fs');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cari-kart-')), 'cari.xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['FIRMA UNVANI ', 'KOD ', 'TL. '], ['VAKIFBANK ', 1132, 8226.34], ['VAKIBANK ', 9132, '']]), 'Cari');
  XLSX.writeFile(wb, file);
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  p.removeAllListeners('dialog'); p.on('dialog', (d) => d.accept());
  await p.click('[data-go="backup"]'); await p.click('#pusulaImportBackupV7');
  await p.selectOption('#piMode', 'cari'); await p.setInputFiles('#piFile', file);
  await p.waitForFunction(() => /Excel'de:<\/b> 2 cari/.test(document.getElementById('piResult').innerHTML), null, { timeout: 10000 });
  await p.click('#modalConfirm');
  await p.waitForFunction(() => !document.getElementById('modalRoot'), null, { timeout: 15000 });
  await p.waitForTimeout(1500);
  const idOf = (code) => p.evaluate((c) => document.querySelector(`[data-cari-card] [data-cari-edit]`) && [...document.querySelectorAll('[data-cari-card]')].find((x) => x.textContent.includes(c))?.dataset.cariCard, code);
  await p.evaluate(() => (document.querySelector('[data-route="customers"]') || document.querySelector('[data-go="customers"]')).click());
  await p.waitForSelector('[data-cari-edit]');
  const vakif = await idOf('1132');
  await p.click(`[data-cari-edit="${vakif}"]`);
  assert.ok(await p.isChecked('#ceLink'));
  await p.fill('#ceCommission', '1.5');
  await p.click('#modalConfirm');
  await p.waitForFunction(() => !document.getElementById('modalRoot'), null, { timeout: 10000 });
  const vakibank = await idOf('9132');
  await p.click(`[data-cari-edit="${vakibank}"]`);
  await p.click('#ceDelete');
  await p.waitForFunction(() => !document.getElementById('modalRoot'), null, { timeout: 10000 });
  await p.waitForTimeout(4000);
  const st = fb.db.state;
  const c = st.customers.find((x) => x.id === vakif);
  const acc = st.bankAccounts.find((b) => b.id === c.financeAccountId);
  assert.ok(acc, 'banka hesabı açılmalı');
  assert.equal(Number(acc.balance), 8226.34, 'cari TL bakiyesi banka hesabına taşınmalı');
  assert.equal(Number(acc.posCommission), 1.5);
  assert.notEqual(acc.posEnabled, false);
  assert.equal(st.customers.some((x) => x.id === vakibank), false, 'gereksiz cari silinmeli');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('cari kartı: bakiyesiz banka hesabı kullanım dışı bırakılır ve tekrar açılır', async () => {
  const XLSX = require('xlsx');
  const os = require('node:os'); const path = require('node:path'); const fs = require('node:fs');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'banka-pasif-')), 'cari.xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['FIRMA UNVANI ', 'KOD ', 'TL. '], ['VAKIBANK ', 9132, '']]), 'Cari');
  XLSX.writeFile(wb, file);
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  p.removeAllListeners('dialog'); p.on('dialog', (d) => d.accept());
  await p.click('[data-go="backup"]'); await p.click('#pusulaImportBackupV7');
  await p.selectOption('#piMode', 'cari'); await p.setInputFiles('#piFile', file);
  await p.waitForFunction(() => /Excel'de:<\/b> 1 cari/.test(document.getElementById('piResult').innerHTML), null, { timeout: 10000 });
  await p.click('#modalConfirm');
  await p.waitForFunction(() => !document.getElementById('modalRoot'), null, { timeout: 15000 });
  await p.evaluate(() => (document.querySelector('[data-route="customers"]') || document.querySelector('[data-go="customers"]')).click());
  await p.waitForSelector('[data-cari-edit]');
  const id = await p.evaluate(() => [...document.querySelectorAll('[data-cari-card]')].find((x) => x.textContent.includes('9132'))?.dataset.cariCard);
  await p.click(`[data-cari-edit="${id}"]`); await p.click('#modalConfirm');
  await p.waitForFunction(() => !document.getElementById('modalRoot'), null, { timeout: 10000 });
  await p.click(`[data-cari-edit="${id}"]`); await p.click('#ceBankInactive');
  await p.waitForFunction(() => !document.getElementById('modalRoot'), null, { timeout: 10000 });
  await p.waitForTimeout(3000);
  const acc = () => { const st = fb.db.state, c = st.customers.find((x) => x.id === id); return st.bankAccounts.find((b) => b.id === c.financeAccountId); };
  assert.equal(acc().inactive, true, 'banka kullanım dışı olmalı');
  await p.click(`[data-cari-edit="${id}"]`); await p.click('#ceBankActive');
  await p.waitForFunction(() => !document.getElementById('modalRoot'), null, { timeout: 10000 });
  await p.waitForTimeout(3000);
  assert.equal(acc().inactive, false, 'tekrar kullanıma açılmalı');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('bulut verisi sıkıştırılmış yazılır; diğer cihaz yalnız sürüm kaydını dinler, kendi yazdığını indirmez', async () => {
  const fb = createFakeFirebase();
  const a = await newDevice(browser, appUrl, fb);
  const b = await newDevice(browser, appUrl, fb);
  await a.waitForTimeout(3000);
  assert.equal(fb.db.raw?.format, 'ASIL_GZ_V1', 'bulut kaydı sıkıştırılmış olmalı');
  assert.ok(Array.isArray(fb.db.state.stocks), 'sıkıştırılmış kayıt açılabilmeli');
  // A işlem yapar → rev güncellenir → B değişikliği alır
  await a.click('[data-home-trade="Ziynet Alış"]');
  await a.fill('#stQty', '1'); await a.fill('#stPrice', '5000');
  await a.click('#modalConfirm');
  await a.waitForTimeout(6000);
  assert.equal(fb.db.rev?.stamp, fb.db.state.meta.updatedAt, 'sürüm kaydı son yazımı göstermeli');
  assert.match(await historyText(b, 'Ziynet Alış'), /ZA-\d{4}-0+1/, 'B cihazı A cihazının işlemini almalı');
  // Akış artık tüm veriyi değil, yalnız sürüm kaydını dinler
  const streamed = fb.log.filter((x) => x.method === 'GET' && x.path === '/kuyumcuProV5/state.json');
  assert.ok(fb.log.some((x) => x.path === '/kuyumcuProV5/rev.json'), 'sürüm kaydı dinlenmeli');
  assert.ok(streamed.length < 20, 'tam veri sürekli indirilmemeli: ' + streamed.length);
  assert.deepEqual([...a.errors, ...b.errors], []);
  await a.context().close(); await b.context().close();
});

test('başka cihazdan veri gelince yazılan kutudan imleç kaçmaz; ekran kutudan çıkınca güncellenir', async () => {
  const fb = createFakeFirebase();
  const a = await newDevice(browser, appUrl, fb);
  const b = await newDevice(browser, appUrl, fb);
  await a.waitForTimeout(2000);
  await b.click('[data-go="sales"]'); await b.waitForSelector('#saleProductSearch');
  await b.click('#saleProductSearch'); await b.keyboard.type('22');
  const pulls = () => fb.log.filter((x) => x.method === 'GET' && x.path === '/kuyumcuProV5/state.json').length;
  const before = pulls();
  await a.click('[data-home-trade="Ziynet Alış"]');
  await a.fill('#stQty', '1'); await a.fill('#stPrice', '5000');
  await a.click('#modalConfirm');
  await a.waitForTimeout(7000);
  assert.ok(pulls() > before, 'B cihazı yeni veriyi indirmeli');
  assert.equal(await b.evaluate(() => document.activeElement?.id), 'saleProductSearch', 'imleç kutuda kalmalı');
  assert.equal(await b.inputValue('#saleProductSearch'), '22', 'yazılan silinmemeli');
  // Kutudan çıkınca ekran yeni veriyle çizilir
  await b.evaluate(() => document.activeElement.blur()); await b.waitForTimeout(12000); // son dokunuştan 10 sn sonra yenilenir
  await b.click('text=Ana Menü');
  assert.match(await historyText(b, 'Ziynet Alış'), /ZA-\d{4}-0+1/, 'B cihazı A cihazının işlemini görmeli');
  assert.deepEqual([...a.errors, ...b.errors], []);
  await a.context().close(); await b.context().close();
});

test('başka cihazdan veri gelince yedek sayfası ve yeni dokunulan sayfa baştan çizilmez', async () => {
  const fb = createFakeFirebase();
  const a = await newDevice(browser, appUrl, fb);
  const b = await newDevice(browser, appUrl, fb);
  await a.waitForTimeout(2000);
  await b.evaluate(() => document.querySelector('[data-route="backup"],[data-go="backup"]').click()); await b.waitForTimeout(500);
  await b.evaluate(() => { const m = document.createElement('div'); m.id = 'listedBackupsMarker'; document.querySelector('#app main, #app').appendChild(m); });
  await a.click('[data-home-trade="Ziynet Alış"]');
  await a.fill('#stQty', '1'); await a.fill('#stPrice', '5000');
  await a.click('#modalConfirm'); await a.waitForTimeout(14000);
  assert.ok(await b.$('#listedBackupsMarker'), 'yedek sayfası kendiliğinden yenilenmemeli (listelenen yedekler kaybolmasın)');
  assert.deepEqual([...a.errors, ...b.errors], []);
  await a.context().close(); await b.context().close();
});

test('cari işlem penceresi açıkken başka cihazdan veri gelse de kaydedilen tutar bakiyeye işlenir (bakiye ile hareket ayrışmaz)', async () => {
  const fb = createFakeFirebase();
  const a = await newDevice(browser, appUrl, fb);
  const b = await newDevice(browser, appUrl, fb);
  await a.waitForTimeout(2000);
  await a.evaluate(() => document.querySelector('[data-route="customers"],[data-go="customers"]').click()); await a.waitForTimeout(400);
  const id = await a.evaluate(() => document.querySelector('[data-cari-move]').dataset.cariMove);
  const sumOf = (s) => (s.customerMoves || []).filter((m) => m.customerId === id && String(m.unit || 'HAS').toUpperCase() === 'HAS').reduce((n, m) => n + Number(m.debit || 0) - Number(m.credit || 0), 0);
  const balOf = (s) => Number((s.customers || []).find((c) => c.id === id)?.hasBalance || 0);
  const gap0 = balOf(fb.db.state) - sumOf(fb.db.state);
  // A pencereyi açar, tutarı yazar
  await a.evaluate(() => document.querySelector('[data-cari-move]').click()); await a.waitForSelector('#cmType');
  await a.selectOption('#cmType', 'NT'); await a.selectOption('#cmUnit', 'TL');
  await a.click('#cmAmount'); await a.keyboard.press('Control+A'); await a.keyboard.type('102032');
  await a.check('#cmCounterEnabled'); await a.selectOption('#cmCounterUnit', 'HAS'); await a.waitForTimeout(200);
  await a.click('#cmCounterAmount'); await a.keyboard.press('Control+A'); await a.keyboard.type('16,837');
  // Bu sırada B (ör. fiyat panosu) buluta yazar; A'ya yeni veri gelir
  await b.click('#darkThemeBtn'); await b.waitForTimeout(500); await b.click('#lightThemeBtn');
  await a.waitForTimeout(8000);
  // A kaydeder
  await a.evaluate(() => document.getElementById('modalConfirm').click()); await a.waitForSelector('#cariSummarySave');
  await a.evaluate(() => document.getElementById('cariSummarySave').click()); await a.waitForTimeout(800);
  if (await a.$('#modalX')) await a.click('#modalX').catch(() => {});
  await a.waitForTimeout(10000);
  const s = fb.db.state, nt = s.customerMoves.filter((m) => m.customerId === id && m.code === 'NT').length;
  assert.equal(nt, 1, 'hareket buluta gitmeli');
  assert.ok(Math.abs(balOf(s) - sumOf(s) - gap0) < 1e-6, `bakiye hareketle birlikte değişmeli: bakiye ${balOf(s)}, hareket toplamı ${sumOf(s)}`);
  assert.deepEqual([...a.errors, ...b.errors], []);
  await a.context().close(); await b.context().close();
});

test('telefon düzeni: logo görünür, ekranlar yana taşmaz, satış kartları üst üste binmez', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.setViewportSize({ width: 390, height: 800 });
  assert.equal(await p.evaluate(() => document.querySelector('.sidebar-brand img.logo')?.naturalWidth > 0), true, 'logo yüklenmeli');
  const overflow = () => p.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 2 && !e.parentElement.closest('.table-wrap')).map((e) => e.tagName + '.' + e.className).slice(0, 3));
  for (const r of ['dashboard', 'sales', 'customers', 'stocks', 'purchases', 'finance', 'reports']) {
    await p.evaluate((r) => document.querySelector(`[data-go="${r}"],[data-route="${r}"]`).click(), r);
    await p.waitForTimeout(400);
    assert.deepEqual(await overflow(), [], `${r} ekranı yana taşmamalı`);
  }
  await p.evaluate(() => document.querySelector('[data-route="sales"]').click());
  await p.waitForSelector('#saleAddUnified');
  const gap = await p.evaluate(() => document.querySelector('.sale-payment-card').getBoundingClientRect().top - document.querySelector('#saleAddUnified').getBoundingClientRect().bottom);
  assert.ok(gap > 0, `Ekle düğmesi ödeme kartının üstüne binmemeli (${gap})`);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('MASAK: eşik üstü satışta kimlik ve sorgu uyarısı; seçilen kimlik ve sorgu sonucu satışa bağlanır', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  await p.evaluate(() => document.querySelector('[data-go="compliance"]').click());
  await p.fill('#masakThreshold', '50000'); await p.click('#saveMasakSettings'); await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.setItem('asil_kuyumcu_pro_kyc_v2', JSON.stringify([{ id: 'KYC-T1', createdAt: new Date().toISOString(), verified: true, personType: 'Gerçek Kişi', fullName: 'AHMET YILMAZ', tckn: '10000000146', documentNo: 'A12B34567', address: 'DÜZCE', wetSignatureObtained: true, kvkkAcknowledged: true, identityDeclarationConfirmed: true, riskStatus: 'TARANMADI' }])));
  await p.reload(); await p.waitForTimeout(1500);
  await p.click('[data-go="sales"]');
  for (let i = 0; i < 3; i++) {
    await p.fill('#saleProductSearch', '22'); await p.waitForTimeout(300); await p.press('#saleProductSearch', 'Enter');
    if (await p.waitForSelector('#saleEntryPrice:not([disabled])', { timeout: 5000 }).catch(() => null)) break;
  }
  await p.waitForTimeout(300);
  await p.fill('#saleEntryPayable', '70000'); await p.click('#saleAddUnified'); await p.waitForTimeout(400);
  await p.click('[data-pay="Nakit"]'); await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.selectOption('#salePerson', { index: 1 });
  await p.click('#finalizeSale');
  await p.waitForSelector('#saleMasakIdentity');
  await p.selectOption('#saleMasakIdentity', 'KYC-T1'); await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.click('#finalizeSale');
  await p.waitForSelector('#masakRiskSkip');
  assert.match(await p.innerText('#modalRoot'), /MASAK SORGUSU YAPILMADI[\s\S]*AHMET YILMAZ/);
  await p.click('#masakRiskSkip'); await p.waitForTimeout(300);
  await p.click('#modalConfirm'); await p.waitForTimeout(1500);
  for (let i = 0; i < 40 && !(fb.db.state.sales || []).some((x) => x.masakIdentityId === 'KYC-T1'); i++) await p.waitForTimeout(250);
  const sale = (fb.db.state.sales || []).find((x) => x.masakIdentityId === 'KYC-T1');
  assert.ok(sale, 'satış MASAK kimliğine bağlanmalı');
  assert.equal(sale.masakCheck.fullName, 'AHMET YILMAZ'); assert.equal(sale.masakCheck.riskStatus, 'TARANMADI'); assert.equal(sale.masakCheck.riskSkipped, true);
  await p.evaluate(() => document.querySelector('[data-go="compliance"],[data-route="compliance"]').click());
  await p.waitForTimeout(400);
  const t = await p.innerText('body');
  assert.match(t, /Eşik Üstü Satışlar ve MASAK Sorguları[\s\S]*MASAK: AHMET YILMAZ · TARANMADI/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('fatura taslağı: altın bedeli, işçilik ve yalnız işçilikten KDV ayrılır; entegratöre ayrıntılı gider', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  let sent = null;
  let calls = 0;
  await p.context().route('https://fatura.test/api', async (r) => {
    if (++calls === 1) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, message: 'ESKİ KÖPRÜ HATASI' }) });
    sent = JSON.parse(r.request().postData()); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'Gönderildi', invoiceNo: 'TST2026000000001' }) });
  });
  // Satış: 22 ayar 0,25 gram, 70.000 TL nakit
  await p.click('[data-go="sales"]');
  for (let i = 0; i < 3; i++) {
    await p.fill('#saleProductSearch', '22'); await p.waitForTimeout(300); await p.press('#saleProductSearch', 'Enter');
    if (await p.waitForSelector('#saleEntryPrice:not([disabled])', { timeout: 5000 }).catch(() => null)) break;
  }
  await p.waitForTimeout(300);
  await p.fill('#saleEntryPayable', '70000'); await p.click('#saleAddUnified'); await p.waitForTimeout(400);
  await p.click('[data-pay="Nakit"]'); await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.selectOption('#salePerson', { index: 1 });
  await p.click('#finalizeSale'); await p.click('#modalConfirm'); await p.waitForTimeout(1500);
  // e-Fatura: entegrasyon adresi, taslak
  await p.evaluate(() => document.querySelector('[data-go="invoices"],[data-route="invoices"]').click());
  await p.click('[data-invoice-view="settings"]');
  await p.fill('#invVkn', '2530152458'); await p.fill('#invProxy', 'https://fatura.test/api'); await p.click('#saveInvoiceSettings');
  await p.click('[data-invoice-view="sales"]');
  await p.click('[data-invoice-draft]');
  await p.waitForSelector('[data-inv-gold="0"]');
  const num = (s) => Number(String(s).replace(/[^\d,-]/g, '').replace(',', '.'));
  const rowText = await p.innerText('.invoice-draft tbody tr');
  const cells = rowText.split('\t');
  const gold = Number(await p.inputValue('[data-inv-gold="0"]'));
  const labour = num(cells[6]), vat = num(cells[7]);
  assert.ok(gold > 0 && gold < 70000, 'altın bedeli hesaplanmalı: ' + gold);
  assert.ok(Math.abs(gold + labour + vat - 70000) < 0.02, `altın + işçilik + KDV = satış (${gold} + ${labour} + ${vat})`);
  assert.ok(Math.abs(vat - (70000 - gold) * 20 / 120) < 0.02, 'KDV yalnız işçilikten iç yüzdeyle ayrılmalı');
  // Altın bedeli elle düzeltilir, kaydedilir; kayıtlar sekmesinde görünür
  await p.fill('[data-inv-gold="0"]', '10000');
  // Kaydetmeden önce işçilik / KDV / satırlar hemen güncellenir; odak kutuda kalır.
  await p.waitForFunction(() => /50\.000,00/.test(document.querySelector('#invDraftBox tbody tr')?.innerText || ''), null, { timeout: 3000 });
  assert.match(await p.innerText('#invDraftBox .invoice-lines tbody'), /%20[\s\S]*10\.000,00[\s\S]*60\.000,00[\s\S]*805/, 'özel matrah: tek satır 60.000 (altın + işçilik), KDV 10.000');
  assert.equal(await p.evaluate(() => document.activeElement?.dataset?.invGold), '0');
  await p.click('#modalConfirm'); await p.waitForTimeout(300);
  assert.match(await p.innerText('.content'), /SAT-\d{4}-0+1/);
  assert.match(await p.innerText('.content'), /50\.000,00/, 'işçilik (60.000 − KDV 10.000) listede görünmeli');
  await p.click('[data-invoice-send]');
  // Elle yazılan altın bedeli HAS fiyatından çok farklı → gönderim öncesi uyarı, onaylanınca gider.
  await p.waitForSelector('#invPreWarnings');
  assert.match(await p.innerText('#invPreWarnings'), /Altın bedeli[\s\S]*%10/);
  assert.equal(sent, null);
  await p.click('#modalConfirm'); await p.waitForTimeout(800);
  // İlk deneme hata verir; hata yazısı görünür, tekrar gönderilince kaybolur.
  assert.match(await p.innerText('table.table tbody'), /ESKİ KÖPRÜ HATASI/);
  await p.click('#modalRoot .modal button, .critical-alert button').catch(() => {});
  await p.evaluate(() => document.querySelectorAll('.critical-overlay,.critical-alert').forEach((e) => e.remove()));
  await p.click('[data-invoice-send]'); await p.waitForSelector('#invPreWarnings'); await p.click('#modalConfirm'); await p.waitForTimeout(800);
  assert.ok(sent, 'entegratöre istek gitmeli');
  assert.doesNotMatch(await p.innerText('table.table tbody'), /ESKİ KÖPRÜ HATASI/, 'başarılı gönderimde eski hata yazısı kalmamalı');
  assert.equal(sent.sale.products[0].goldValue, 10000);
  assert.equal(sent.sale.products[0].labourAmount, 50000);
  assert.equal(sent.sale.products[0].vatAmount, 10000);
  // Varsayılan düzen: özel matrah — tek satır (altın + işçilik), KDV yalnız işçilikten, kod 805
  assert.equal(sent.layout, 'OZELMATRAH');
  assert.equal(sent.sale.lines.length, 1);
  assert.deepEqual([sent.sale.lines[0].total, sent.sale.lines[0].vatRate, sent.sale.lines[0].vatAmount, sent.sale.lines[0].exemptionCode, sent.sale.lines[0].specialBase], [60000, 20, 10000, '805', 50000]);
  assert.deepEqual({ g: sent.totals.goldValue, l: sent.totals.labourAmount, v: sent.totals.vatAmount, t: sent.totals.total }, { g: 10000, l: 50000, v: 10000, t: 70000 });
  assert.match(await p.innerText('.content'), /TST2026000000001/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('banka ekstresi: banka hareketleri görünür, düzeltilir ve silinir; bakiye güncellenir', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  const path = require('node:path');
  // Bankaya ekstreden bir ödeme hareketi kaydet (2.500 TL çıkış)
  await p.evaluate(() => document.querySelector('[data-go="banking"]').click());
  const bankName = (await p.$eval('#bankFeedBank option:checked', (o) => o.textContent)).split(' · ')[0];
  await p.setInputFiles('#bankCsvInput', path.join(__dirname, '..', '..', 'BANKA_CSV_ORNEK.csv'));
  await p.waitForSelector('[data-bankfeed-post]');
  await p.click('[data-bankfeed-post]'); await p.click('#modalConfirm'); await p.waitForTimeout(300);
  const openEkstre = async () => {
    await p.evaluate(() => document.querySelector('[data-route="customers"],[data-go="customers"]').click());
    await p.waitForTimeout(500);
    await p.evaluate((n) => [...document.querySelectorAll('[data-cari-card][data-cari-type="Banka"]')].find((e) => e.querySelector('h3').innerText.trim() === n).querySelector('[data-cari-detail]').click(), bankName);
    await p.waitForSelector('[data-cari-range="all"]');
    await p.click('[data-cari-range="all"]'); // ekstre örneği eski tarihli: tüm hareketler
    await p.waitForSelector('#cariEkstreTable');
  };
  const tlBalance = () => p.evaluate(() => [...document.querySelectorAll('.cari-ekstre-balance')].find((e) => /TL Son Bakiye/.test(e.innerText)).innerText);
  await openEkstre();
  const before = await tlBalance();
  assert.match(await p.innerText('#cariEkstreTable'), /Havale \/ EFT Ödeme/, 'banka hareketi ekstrede görünmeli');
  assert.match(await p.innerText('#modalRoot'), /tutuyor/, 'bakiye hareketlerle tutmalı');
  const num = (s) => Number(String(s).replace(/[^\d,]/g, '').replace(',', '.'));
  // Düzelt: 2.500 → 3.000
  await p.click('.cari-ekstre-row:has-text("Havale / EFT Ödeme")');
  await p.click('#selectedFinEdit');
  await p.fill('#bfeAmt', '3000'); await p.click('#modalConfirm');
  await p.waitForSelector('#cariEkstreTable');
  assert.equal(num(await tlBalance()), num(before) - 500, 'bakiye 500 TL azalmalı');
  assert.match(await p.innerText('#cariEkstreTable'), /3\.000/);
  // Sil: bakiye 3.000 TL geri gelir, ekstre satırı tekrar "Bekliyor" olur
  await p.click('.cari-ekstre-row:has-text("Havale / EFT Ödeme")');
  await p.click('#selectedFinDelete'); await p.click('#modalConfirm');
  await p.waitForSelector('#cariEkstreTable');
  assert.equal(num(await tlBalance()), num(before) + 2500, 'silinince bakiye geri alınmalı');
  assert.doesNotMatch(await p.innerText('#cariEkstreTable'), /Havale \/ EFT Ödeme/);
  await p.click('#modalX');
  await p.evaluate(() => document.querySelector('[data-go="banking"],[data-route="banking"]').click());
  await p.waitForTimeout(400);
  // Çıkan hareketler "Yeni Hareket Kaydet", gelen havaleler "Faturaya Gönder" (bakiyeye dokunmaz) ile işlenir.
  assert.equal(await p.locator('[data-bankfeed-post]').count(), 1, 'silinen hareketin ekstre satırı yeniden kaydedilebilmeli');
  assert.equal(await p.locator('[data-bankfeed-invoice]').count(), 1, 'gelen havale faturaya gönderilebilmeli');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('cari geçmişi: peşin kapanan satış müşterinin ekstresinde görünür, bakiyeyi değiştirmez', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.click('[data-go="sales"]');
  const cust = await p.$$eval('#saleCustomerSelect option', (os) => os.map((o) => ({ v: o.value, t: o.textContent })).find((o) => o.v && o.v !== 'CASH' && !/PEŞİN/i.test(o.t)));
  await p.selectOption('#saleCustomerSelect', cust.v); await p.waitForTimeout(400);
  for (let i = 0; i < 3; i++) {
    await p.fill('#saleProductSearch', '22'); await p.waitForTimeout(300); await p.press('#saleProductSearch', 'Enter');
    if (await p.waitForSelector('#saleEntryPrice:not([disabled])', { timeout: 5000 }).catch(() => null)) break;
  }
  await p.waitForTimeout(300);
  await p.fill('#saleEntryPayable', '4321'); await p.click('#saleAddUnified'); await p.waitForTimeout(400);
  await p.click('[data-pay="Nakit"]'); await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.selectOption('#salePerson', { index: 1 });
  await p.click('#finalizeSale'); await p.click('#modalConfirm'); await p.waitForTimeout(1500);
  const closeAlert = async () => { const b = await p.$('.critical-alert button'); if (b) await b.click(); };
  await closeAlert();
  await p.evaluate(() => document.querySelector('[data-route="customers"],[data-go="customers"]').click());
  await p.waitForTimeout(500);
  const before = await p.evaluate((id) => document.querySelector(`[data-cari-card="${id}"]`).innerText, cust.v);
  await p.evaluate((id) => document.querySelector(`[data-cari-card="${id}"] [data-cari-detail]`).click(), cust.v);
  await p.waitForSelector('#cariEkstreTable');
  const table = await p.innerText('#cariEkstreTable');
  assert.match(table, /SATIŞ/, 'peşin satış cari geçmişinde görünmeli');
  assert.match(table, /4\.321,00/);
  assert.match(table, /Peşin \/ kapalı/);
  await p.click('.cari-ekstre-row:has-text("4.321,00")');
  assert.ok(await p.$('#selectedInfoPrint'), 'fiş düğmesi olmalı');
  await p.keyboard.press('Escape'); // detay penceresini kapat
  await p.uncheck('#cariShowInfo'); await p.waitForTimeout(300);
  assert.doesNotMatch(await p.innerText('#modalRoot'), /4\.321,00/, 'kutucuk kapatılınca peşin işlemler gizlenmeli');
  await p.click('#modalX');
  assert.equal(await p.evaluate((id) => document.querySelector(`[data-cari-card="${id}"]`).innerText, cust.v), before, 'cari bakiyesi değişmemeli');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('satış geçmişi: tam pencere, tarih ve ödeme/banka filtresi, ödeme şekli görünür', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.click('[data-go="sales"]');
  for (let i = 0; i < 3; i++) {
    await p.fill('#saleProductSearch', '22'); await p.waitForTimeout(300); await p.press('#saleProductSearch', 'Enter');
    if (await p.waitForSelector('#saleEntryPrice:not([disabled])', { timeout: 5000 }).catch(() => null)) break;
  }
  await p.waitForTimeout(300);
  await p.fill('#saleEntryPayable', '5000'); await p.click('#saleAddUnified'); await p.waitForTimeout(400);
  await p.click('[data-pay="Havale / EFT"]'); await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.selectOption('#salePerson', { index: 1 });
  await p.click('#finalizeSale'); await p.click('#modalConfirm'); await p.waitForTimeout(1500);
  await p.click('text=Satış Geçmişi');
  await p.waitForSelector('#saleHistBody tr');
  const [mw, vw] = await p.evaluate(() => [document.querySelector('#modalRoot .modal').getBoundingClientRect().width, innerWidth]);
  assert.ok(mw > vw - 40, `pencere ekranı doldurmalı (${mw}/${vw})`);
  assert.match(await p.innerText('#saleHistBody'), /Havale · İŞ BANKASI/, 'ödeme şekli ve banka görünmeli');
  assert.match(await p.innerText('#saleHistSummary'), /1 satış · 5\.000,00/);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#saleHistExcel')]);
  assert.match(dl.suggestedFilename(), /^SATIS_GECMISI_.*\.xlsx$/);
  const XLSX = require('xlsx'); const wb = XLSX.readFile(await dl.path());
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  assert.ok(aoa.some((r) => /SAT-/.test(r[1]) && /Havale/.test(r[7] || '') && Number(r[6]) === 5000), 'satış ödeme şekliyle Excel\'de olmalı');
  await p.selectOption('#saleHistPay', 'Nakit');
  assert.match(await p.innerText('#saleHistBody'), /Satış bulunamadı/, 'nakit filtresinde havale satışı çıkmamalı');
  await p.selectOption('#saleHistPay', '');
  await p.click('[data-hist-range="today"]');
  assert.match(await p.innerText('#saleHistBody'), /SAT-\d{4}-0+1/, 'bugün filtresinde görünmeli');
  await p.fill('#saleHistFrom', '2099-01-01');
  assert.match(await p.innerText('#saleHistBody'), /Satış bulunamadı/, 'ileri tarihte satış olmamalı');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('satış fişi: takasta alınan ziynet kalem kalem, müşteriye ödenen hesabıyla yazılır', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  const popups = [];
  p.context().on('page', (pg) => popups.push(pg));
  await p.click('[data-go="sales"]');
  for (let i = 0; i < 3; i++) {
    await p.fill('#saleProductSearch', '22'); await p.waitForTimeout(300); await p.press('#saleProductSearch', 'Enter');
    if (await p.waitForSelector('#saleEntryPrice:not([disabled])', { timeout: 5000 }).catch(() => null)) break;
  }
  await p.waitForTimeout(300);
  await p.fill('#saleEntryPayable', '6700'); await p.click('#saleAddUnified'); await p.waitForTimeout(400);
  await p.click('[data-pay="Altın / Ziynet"]');
  await p.waitForSelector('#tiSearch'); await p.fill('#tiSearch', 'CEYREK'); await p.press('#tiSearch', 'Enter');
  await p.fill('#tiQty', '1'); await p.press('#tiQty', 'Enter'); await p.fill('#tiPrice', '10400'); await p.press('#tiPrice', 'Enter'); await p.press('#tiTotal', 'Enter'); await p.waitForTimeout(200);
  await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.click('[data-pay="Ödeme"]'); await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.selectOption('#salePerson', { index: 1 });
  await p.click('#finalizeSale'); await p.click('#modalConfirm'); await p.waitForTimeout(1500);
  if (!popups.length) await p.click('text=Son Fişi Yazdır');
  for (let i = 0; i < 40 && !popups.length; i++) await p.waitForTimeout(250);
  assert.ok(popups.length, 'satış fişi basılmalı');
  const text = await popups[0].innerText('body');
  assert.match(text, /ALINAN: CEYREK/);
  assert.match(text, /1 ADET × 10\.400,00/);
  assert.match(text, /MÜŞTERİYE ÖDENEN · Nakit/);
  assert.match(text, /TL Kasa/);
  assert.match(text, /Müşteriye Ödenen\s+3\.700,00/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('fatura: (seçilirse) altın ve işçilik ayrı satır, altın kodu 230, fatura tipi İSTİSNA; özel matrah düzenine dönülebilir', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  let sent = null;
  await p.context().route('https://fatura.test/api', async (r) => { sent = JSON.parse(r.request().postData()); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'Gönderildi', invoiceNo: 'TST2' }) }); });
  await p.click('[data-go="sales"]');
  for (let i = 0; i < 3; i++) {
    await p.fill('#saleProductSearch', '39'); await p.waitForTimeout(300); await p.press('#saleProductSearch', 'Enter');
    if (await p.waitForSelector('#saleEntryPrice:not([disabled])', { timeout: 5000 }).catch(() => null)) break;
  }
  await p.waitForTimeout(300);
  assert.match(await p.inputValue('#saleEntryName'), /24 Ayar/);
  await p.fill('#saleEntryPayable', '7000'); await p.click('#saleAddUnified'); await p.waitForTimeout(400);
  await p.click('[data-pay="Nakit"]'); await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.selectOption('#salePerson', { index: 1 });
  await p.click('#finalizeSale'); await p.click('#modalConfirm'); await p.waitForTimeout(1500);
  await p.evaluate(() => document.querySelector('[data-go="invoices"],[data-route="invoices"]').click());
  await p.click('[data-invoice-view="settings"]');
  assert.match(await p.innerText('.content'), /KDV İstisna ve Özel Matrah Kodları/);
  assert.equal(await p.inputValue('#invLayout'), 'OZELMATRAH', 'varsayılan düzen özel matrah (perakende)');
  assert.equal(await p.inputValue('#invGoldCode'), '230');
  // Bu test eski "Altın + İşçilik ayrı satır" düzenini sınar.
  await p.selectOption('#invLayout', 'SPLIT'); await p.click('#invCodeSave'); await p.waitForTimeout(300);
  await p.click('[data-invoice-view="settings"]');
  await p.fill('#invVkn', '2530152458'); await p.fill('#invProxy', 'https://fatura.test/api'); await p.click('#saveInvoiceSettings');
  await p.click('[data-invoice-view="sales"]');
  await p.click('[data-invoice-draft]');
  await p.waitForSelector('.invoice-lines');
  let draft = await p.innerText('.invoice-draft');
  assert.match(draft, /Fatura Tipi\s+İSTİSNA/);
  const lines = await p.innerText('.invoice-lines tbody');
  assert.match(lines, /24 Ayar[^\n]*%0[^\n]*230/, 'altın satırı KDV %0 ve 230 koduyla');
  assert.match(lines, /İŞÇİLİK[^\n]*%20/, 'işçilik ayrı satır, KDV %20');
  // Alıcı bilgileri taslakta düzenlenir
  await p.fill('#irName', 'ALİ VELİ'); await p.fill('#irTckn', '10000000146'); await p.fill('#irAddress', 'Cumhuriyet Cad. 5 / Merkez / Bursa'); await p.fill('#irEmail', 'ali@ornek.com');
  assert.match(draft, /230 · İstisna\s+Külçe altın, külçe gümüş ve kıymetli taşların teslimi/);
  // Ürün satırında kod 230 (Altın + İşçilik); 230 elle seçilse de işçilik ayrı satırda kalır.
  assert.equal(await p.$eval('[data-inv-code="0"]', (e) => e.value), '230');
  assert.match(await p.$eval('[data-inv-code="0"]', (e) => e.selectedOptions[0].textContent), /230 · Altın \+ İşçilik/);
  await p.selectOption('[data-inv-code="0"]', 'SATIS'); await p.waitForTimeout(200);
  await p.selectOption('[data-inv-code="0"]', '230'); await p.waitForTimeout(200);
  assert.match(await p.innerText('.invoice-lines tbody'), /İŞÇİLİK[^\n]*%20/, '230 seçilince işçilik kaybolmamalı');
  await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.click('[data-invoice-send]'); await p.waitForTimeout(800);
  assert.equal(sent.invoiceType, 'ISTISNA');
  assert.equal(sent.layout, 'SPLIT');
  assert.deepEqual([sent.receiver.name, sent.receiver.tckn, sent.receiver.address, sent.receiver.email], ['ALİ VELİ', '10000000146', 'Cumhuriyet Cad. 5 / Merkez / Bursa', 'ali@ornek.com']);
  assert.match(await p.innerText('table.table tbody'), /ALİ VELİ/);
  assert.equal(sent.sale.lines[0].exemptionCode, '230');
  assert.equal(sent.sale.lines[0].vatRate, 0);
  assert.match(sent.sale.lines[1].name, /^İŞÇİLİK/);
  assert.equal(sent.sale.lines[1].vatRate, 20);
  const sum = sent.sale.lines.reduce((n, x) => n + x.total + x.vatAmount, 0);
  assert.ok(Math.abs(sum - 7000) < 0.02, 'satırlar + KDV satış tutarına eşit olmalı: ' + sum);
  // Özel matrah düzenine geçilince tek satır 805
  await p.click('[data-invoice-view="settings"]');
  await p.selectOption('#invLayout', 'OZELMATRAH'); await p.click('#invCodeSave'); await p.waitForTimeout(300);
  await p.click('[data-invoice-view="records"]');
  await p.click('[data-invoice-open]');
  await p.waitForSelector('.invoice-lines');
  draft = await p.innerText('.invoice-draft');
  assert.doesNotMatch(await p.innerText('.invoice-lines tbody'), /İŞÇİLİK/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('İşlem Raporu: her satırda hesap, giriş/çıkış tutarı ve birim var; tablo ekrana sığar', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.setViewportSize({ width: 1280, height: 720 });
  await p.click('[data-home-trade="Döviz Alış"]');
  await p.fill('#stQty', '100'); await p.fill('#stPrice', '40');
  await p.click('#modalConfirm'); await p.click('text=ONAYLA VE İŞLEMİ TAMAMLA'); await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-route="reports"],[data-go="reports"]').click());
  await p.click('[data-pusula-report="transaction"]'); await p.waitForSelector('#prShow');
  await p.click('#prShow'); await p.waitForSelector('#prResult table');
  assert.match(await p.innerText('#prResult thead'), /Hesap[\s\S]*Giriş[\s\S]*Çıkış[\s\S]*Birim[\s\S]*TL Karşılığı/);
  const t = await p.innerText('#prResult tbody');
  assert.match(t, /Döviz Alış[\s\S]*100/, 'döviz miktarı görünmeli');
  assert.match(t, /4\.000,00/, 'TL karşılığı / kasa çıkışı görünmeli');
  const over = await p.evaluate(() => { const w = document.querySelector('#prResult .table-wrap'); return w.scrollWidth - w.clientWidth; });
  assert.ok(over <= 2, 'tablo yana kaymamalı: ' + over);
  // Raporda arama: yazılan kelimeyi içeren satırlar kalır
  const total = await p.$$eval('#prResult tbody tr', (r) => r.length);
  await p.fill('#prResult [data-report-search]', 'tl kasa');
  const vis = await p.$$eval('#prResult tbody tr', (r) => r.filter((x) => x.style.display !== 'none').map((x) => x.innerText));
  assert.ok(vis.length >= 1 && vis.length < total, `arama satırları süzmeli (${vis.length}/${total})`);
  assert.ok(vis.every((x) => /TL Kasa/i.test(x)));
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('raporlar bugünün tarihiyle açılır; hızlı aralık düğmeleri tarihi değiştirir', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  const today = await p.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  const monthStart = today.slice(0, 8) + '01';
  await p.evaluate(() => document.querySelector('[data-route="reports"],[data-go="reports"]').click());
  await p.click('[data-pusula-report="sales_general"]');
  await p.waitForSelector('#prFrom');
  assert.equal(await p.inputValue('#prFrom'), today, 'rapor bugünden başlamalı');
  assert.equal(await p.inputValue('#prTo'), today);
  await p.click('[data-range-pr="month"]');
  assert.equal(await p.inputValue('#prFrom'), monthStart);
  assert.match(await p.innerText('#prResult'), new RegExp(monthStart));
  await p.click('#modalX');
  await p.click('[data-pusula-report="patron"]');
  await p.waitForSelector('#patronFrom');
  assert.equal(await p.inputValue('#patronFrom'), today);
  assert.ok((await p.innerText('#patronResult')).trim().length > 0, 'patron raporu açılışta hesaplanmalı');
  await p.click('#modalX');
  await p.click('[data-pusula-report="balance_sheet"]');
  await p.waitForSelector('#balFrom');
  assert.equal(await p.inputValue('#balFrom'), today);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('yeni stok kartı: kod otomatik sıradaki numara; stoksuz kart satış aramasında çıkar ve seçilebilir', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.evaluate(() => document.querySelector('[data-route="stocks"],[data-go="stocks"]').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => (document.getElementById('newStockCard') || document.querySelector('[data-new-stockcard]')).click());
  await p.waitForSelector('#scProductCode');
  const code = await p.inputValue('#scProductCode');
  assert.match(code, /^\d+$/, 'kod otomatik dolmalı: ' + code);
  assert.ok(Number(code) > 39, 'mevcut kodlardan büyük olmalı: ' + code);
  await p.fill('#scProductDefinition', '24 TEST KULCE 7 GRAM');
  await p.fill('#scPurity', '995'); await p.fill('#scFixedMilyem', '995');
  await p.click('#modalConfirm'); await p.waitForTimeout(400);
  // Aynı kodla ikinci kart açılamaz
  await p.evaluate(() => (document.getElementById('newStockCard') || document.querySelector('[data-new-stockcard]')).click());
  await p.waitForSelector('#scProductCode');
  assert.equal(await p.inputValue('#scProductCode'), String(Number(code) + 1), 'sonraki kart bir sonraki kodu almalı');
  await p.click('#modalX');
  // Satış: stoksuz kart listede STOK YOK olarak çıkar
  await p.evaluate(() => document.querySelector('[data-route="sales"],[data-go="sales"]').click());
  await p.waitForSelector('#saleProductSearch');
  await p.fill('#saleProductSearch', '24'); await p.waitForTimeout(400); // çok sayıda barkodlu '24' eşleşmesine rağmen kart görünmeli
  const list = await p.innerText('#saleSearchResults');
  assert.match(list, /STOK YOK/); assert.match(list, /24 TEST KULCE 7 GRAM/);
  await p.dispatchEvent('[data-sale-suggestion-type="card"]', 'pointerdown');
  await p.waitForTimeout(500);
  assert.equal(await p.inputValue('#saleEntryName'), '24 TEST KULCE 7 GRAM', 'kart seçilebilmeli');
  // Ürün kutusuna tıklayınca aynı aramanın listesi açılır, başka ürün seçilebilir
  await p.dispatchEvent('#saleEntryName', 'mousedown'); await p.waitForSelector('#saleSearchResults.show');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'saleProductSearch');
  await p.dispatchEvent('#saleSearchResults [data-sale-suggestion-type]:not([data-sale-suggestion-type="card"])', 'pointerdown');
  await p.waitForTimeout(500);
  assert.notEqual(await p.inputValue('#saleEntryName'), '24 TEST KULCE 7 GRAM', 'başka ürün seçilebilmeli');
  // Vazgeç: seçim ve arama temizlenir; başka sayfaya gidip dönünce de boş kalır
  await p.dispatchEvent('#saleEntryCancel', 'click'); await p.waitForTimeout(300);
  assert.deepEqual([await p.inputValue('#saleEntryName'), await p.inputValue('#saleProductSearch')], ['', '']);
  assert.ok(!(await p.$('#saleEntryCancel')), 'boşken Vazgeç düğmesi görünmez');
  await p.evaluate(() => document.querySelector('[data-route="stocks"],[data-go="stocks"]').click()); await p.waitForTimeout(200);
  await p.evaluate(() => document.querySelector('[data-route="sales"],[data-go="sales"]').click()); await p.waitForSelector('#saleEntryName');
  assert.equal(await p.inputValue('#saleEntryName'), '');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('yeni ziynet stok kartı Ziynet Alış ve takas listelerinde çıkar; alış kendi stoğuna işlenir', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.evaluate(() => document.querySelector('[data-route="stocks"],[data-go="stocks"]').click());
  await p.waitForTimeout(300);
  await p.evaluate(() => (document.getElementById('newStockCard') || document.querySelector('[data-new-stockcard]')).click());
  await p.waitForSelector('#scProductCode');
  await p.fill('#scProductDefinition', 'TEST 24 AYAR 5 GRAM');
  await p.fill('#scPurity', '4975'); await p.fill('#scFixedMilyem', '4975'); await p.fill('#scZGram', '5');
  await p.selectOption('#scUnit12', 'AD'); await p.check('#scCounted'); await p.check('#scZiynet');
  await p.click('#modalConfirm'); await p.waitForTimeout(300);
  // Ziynet Alış listesinde
  await p.evaluate(() => document.querySelector('[data-route="dashboard"],[data-go="dashboard"]').click());
  await p.click('[data-home-trade="Ziynet Alış"]');
  await p.waitForSelector('#stItem');
  const opts = await p.$$eval('#stItem option', (os) => os.map((o) => o.textContent));
  assert.ok(opts.includes('TEST 24 AYAR 5 GRAM'), 'Ziynet Alış listesinde olmalı: ' + opts.join(', '));
  await p.selectOption('#stItem', { label: 'TEST 24 AYAR 5 GRAM' });
  await p.waitForTimeout(200);
  assert.ok(Number(await p.inputValue('#stPrice')) > 0, 'HAS fiyatından alış fiyatı önerilmeli');
  await p.fill('#stQty', '2'); await p.fill('#stPrice', '30000');
  await p.click('#modalConfirm'); await p.waitForTimeout(1500);
  const b = await p.$('.critical-alert button'); if (b) await b.click();
  // Satışta kendi kartının stoğu olarak (2 ADET) görünür
  await p.evaluate(() => document.querySelector('[data-route="sales"],[data-go="sales"]').click());
  await p.waitForSelector('#saleProductSearch');
  await p.fill('#saleProductSearch', 'TEST 24 AYAR'); await p.waitForTimeout(400);
  const list = await p.innerText('#saleSearchResults');
  assert.match(list, /TEST 24 AYAR 5 GRAM[\s\S]*2 ADET stok/, 'alış kartın kendi stoğuna işlenmeli: ' + list);
  // Altın Stokları (F9): kart satırı, adet başına kart HAS'ıyla (2 × 4,975 = 9,95 HAS)
  await p.keyboard.press('F9');
  await p.waitForSelector('table.gold-stock-v7');
  assert.match(await p.innerText('table.gold-stock-v7'), /TEST 24 AYAR 5 GRAM\t4975\t2,00\t9,95/);
  await p.click('#modalX');
  // Takas (müşteriden alınan) listesinde
  await p.fill('#saleProductSearch', ''); await p.click('[data-pay="Altın / Ziynet"]');
  await p.waitForSelector('#tiSearch');
  await p.fill('#tiSearch', 'TEST 24'); await p.waitForSelector('#tiSuggest [data-ti-sug]');
  const ti = await p.$$eval('#tiSuggest [data-ti-sug] b', (os) => os.map((o) => o.textContent));
  assert.ok(ti.some((x) => x.includes('TEST 24 AYAR 5 GRAM')), 'takas listesinde olmalı');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('satış ekranından alış: eski stokla benzer isimli yeni kart listede çıkar, kendi stoğuna girer, Satış Geçmişinde görünür', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.evaluate(() => document.querySelector('[data-route="stocks"],[data-go="stocks"]').click());
  await p.waitForTimeout(300);
  await p.evaluate(() => (document.getElementById('newStockCard') || document.querySelector('[data-new-stockcard]')).click());
  await p.waitForSelector('#scProductCode');
  await p.fill('#scProductDefinition', 'REŞAT ÇEYREK BİLEKLİK');
  await p.fill('#scPurity', '1590'); await p.fill('#scFixedMilyem', '1590'); await p.fill('#scZGram', '1.75');
  await p.selectOption('#scUnit12', 'AD'); await p.check('#scCounted'); await p.check('#scZiynet');
  await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('[data-route="sales"],[data-go="sales"]').click());
  await p.waitForSelector('#saleProductSearch');
  await p.click('[data-pay="Altın / Ziynet"]'); await p.waitForSelector('#tiSearch');
  await p.fill('#tiSearch', 'BİLEKLİK'); await p.waitForSelector('#tiSuggest [data-ti-sug]');
  const opts = await p.$$eval('#tiSuggest [data-ti-sug] b', (os) => os.map((o) => o.textContent));
  assert.ok(opts.includes('REŞAT ÇEYREK BİLEKLİK') && opts.includes('RESAT CEYREK BİLEKLİK'), 'yeni kart eski stok satırıyla birlikte listede olmalı: ' + opts.join(', '));
  await p.fill('#tiSearch', 'REŞAT ÇEYREK BİLEKLİK'); await p.press('#tiSearch', 'Enter');
  await p.fill('#tiQty', '2'); await p.press('#tiQty', 'Enter'); await p.fill('#tiPrice', '10000'); await p.press('#tiPrice', 'Enter'); await p.press('#tiTotal', 'Enter'); await p.waitForTimeout(200);
  await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.click('[data-pay="Ödeme"]'); await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.click('#finalizeSale'); await p.waitForTimeout(500);
  if (await p.$('#modalConfirm')) await p.click('#modalConfirm');
  await p.waitForTimeout(1500);
  const b = await p.$('.critical-alert button'); if (b) await b.click();
  await p.click('text=Satış Geçmişi');
  await p.waitForSelector('#saleHistBody tr');
  assert.match(await p.innerText('#saleHistBody'), /AZA-\d{4}-0+1[\s\S]*ALIŞ[\s\S]*REŞAT ÇEYREK BİLEKLİK · 2/, 'alış Satış Geçmişinde görünmeli');
  assert.match(await p.innerText('#saleHistSummary'), /1 altın\/ziynet alış · 20\.000,00/);
  await p.click('#modalX');
  await p.keyboard.press('F9');
  await p.waitForSelector('table.gold-stock-v7');
  const gold = await p.innerText('table.gold-stock-v7');
  assert.match(gold, /REŞAT ÇEYREK BİLEKLİK\t1590\t2,00\t3,18/, 'yeni kartın kendi satırına girmeli');
  assert.match(gold, /RESAT CEYREK BİLEKLİK\t1590\t1,00/, 'eski stok değişmemeli');
  // Alış Satış Geçmişinden iptal edilir: stok düşer, ödeme kasaya geri döner
  await p.click('#modalX');
  await p.click('text=Satış Geçmişi');
  await p.waitForSelector('[data-buy-cancel]');
  await p.click('[data-buy-edit]'); await p.click('#modalConfirm'); await p.waitForTimeout(500);
  assert.match(await p.innerText('body'), /REŞAT ÇEYREK BİLEKLİK · 2/, 'düzeltmede ürün satış ekranına geri gelmeli');
  await p.keyboard.press('F9');
  await p.waitForSelector('table.gold-stock-v7');
  assert.ok(!(await p.innerText('table.gold-stock-v7')).includes('REŞAT ÇEYREK BİLEKLİK'), 'iptalde stok geri alınmalı; sıfır stoklu kart listede gizlenir');
  await p.click('#modalX');
  await p.click('text=Satış Geçmişi');
  await p.waitForSelector('#saleHistBody tr');
  assert.doesNotMatch(await p.innerText('#saleHistBody'), /AZA-/, 'iptal edilen alış listede kalmamalı');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('ziynet alış geçmişinden iptal ve düzelt: stok ve kasa geri alınır, düzeltme eski bilgilerle açılır', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  const st = () => p.evaluate(() => 0).then(() => fb.db.state);
  const tlCash = (s) => (s.cashAccounts || []).filter((x) => x.currency === 'TL').reduce((n, x) => n + Number(x.balance || 0), 0);
  const ceyrek = (s) => Number((s.openStocks || []).find((o) => o.name === 'CEYREK')?.amount || 0);
  await p.waitForTimeout(3000);
  const cash0 = tlCash(await st()), c0 = ceyrek(await st());
  await p.click('[data-home-trade="Ziynet Alış"]');
  await p.selectOption('#stItem', 'CEYREK'); await p.fill('#stQty', '2'); await p.fill('#stPrice', '5000'); await p.waitForTimeout(200);
  await p.click('#modalConfirm'); await p.waitForTimeout(9000);
  assert.equal(ceyrek(await st()), c0 + 2); assert.equal(Math.round(tlCash(await st())), Math.round(cash0 - 10000));
  // İptal
  await p.click('[data-home-trade="Ziynet Alış"]'); await p.click('#stHistoryToggle');
  await p.click('[data-trade-cancel]'); await p.click('#modalConfirm'); await p.waitForTimeout(500);
  await p.click('#modalX'); await p.waitForTimeout(9000);
  assert.equal(ceyrek(await st()), c0, 'iptalde stok geri alınmalı');
  assert.equal(Math.round(tlCash(await st())), Math.round(cash0), 'iptalde kasa geri dönmeli');
  assert.ok(!(fb.db.state.tradeMoves || []).some((x) => String(x.docNo).startsWith('ZA-')), 'iptal edilen kayıt silinmeli');
  // Düzelt: yeniden kaydedip geri al, ekran eski değerlerle açılır, 3 adede düzeltilir
  await p.click('[data-home-trade="Ziynet Alış"]');
  await p.selectOption('#stItem', 'CEYREK'); await p.fill('#stQty', '2'); await p.fill('#stPrice', '5000'); await p.waitForTimeout(200);
  await p.click('#modalConfirm'); await p.waitForTimeout(500);
  await p.click('[data-home-trade="Ziynet Alış"]'); await p.click('#stHistoryToggle');
  await p.click('[data-trade-edit]'); await p.click('#modalConfirm'); await p.waitForTimeout(500);
  assert.equal(await p.inputValue('#stQty'), '2', 'düzeltme eski adetle açılmalı');
  assert.equal(await p.inputValue('#stItem'), 'CEYREK');
  await p.fill('#stQty', '3'); await p.fill('#stPrice', '5000'); await p.waitForTimeout(200);
  await p.click('#modalConfirm'); await p.waitForTimeout(9000);
  const za = (fb.db.state.tradeMoves || []).filter((x) => x.tradeType === 'Ziynet Alış' && !x.sourceType);
  assert.equal(za.length, 1, 'tek kayıt kalmalı'); assert.equal(Number(za[0].quantity), 3);
  assert.equal(ceyrek(await st()), c0 + 3); assert.equal(Math.round(tlCash(await st())), Math.round(cash0 - 15000));
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('döviz alış geçmişinden iptal ve düzelt: TL ve USD kasası geri alınır, düzeltme eski bilgilerle açılır', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  const st = () => p.evaluate(() => 0).then(() => fb.db.state);
  const cash = (s, cur) => (s.cashAccounts || []).filter((x) => x.currency === cur).reduce((n, x) => n + Number(x.balance || 0), 0);
  await p.waitForTimeout(3000);
  const tl0 = cash(await st(), 'TL'), usd0 = cash(await st(), 'USD');
  await p.click('[data-home-trade="Döviz Alış"]');
  await p.selectOption('#stFx', 'USD'); await p.fill('#stQty', '100'); await p.fill('#stPrice', '40'); await p.waitForTimeout(200);
  await p.click('#modalConfirm'); await p.click('text=ONAYLA VE İŞLEMİ TAMAMLA'); await p.waitForTimeout(9000);
  assert.equal(Math.round(cash(await st(), 'TL')), Math.round(tl0 - 4000)); assert.equal(Math.round(cash(await st(), 'USD')), Math.round(usd0 + 100));
  // İptal
  await p.click('[data-home-trade="Döviz Alış"]'); await p.click('#stHistoryToggle');
  await p.click('[data-trade-cancel]'); await p.click('#modalConfirm'); await p.waitForTimeout(500);
  await p.click('#modalX'); await p.waitForTimeout(9000);
  assert.equal(Math.round(cash(await st(), 'TL')), Math.round(tl0), 'iptalde TL kasa geri dönmeli');
  assert.equal(Math.round(cash(await st(), 'USD')), Math.round(usd0), 'iptalde USD kasa geri dönmeli');
  assert.ok(!(fb.db.state.tradeMoves || []).some((x) => String(x.docNo).startsWith('DA-')), 'iptal edilen kayıt silinmeli');
  assert.ok(!(fb.db.state.financeMoves || []).some((x) => String(x.sourceDocNo || '').startsWith('DA-')), 'kasa hareketleri silinmeli');
  // Düzelt: 100 USD kaydedip geri al, ekran eski değerlerle açılır, 150 USD'ye düzeltilir
  await p.click('[data-home-trade="Döviz Alış"]');
  await p.selectOption('#stFx', 'USD'); await p.fill('#stQty', '100'); await p.fill('#stPrice', '40'); await p.waitForTimeout(200);
  await p.click('#modalConfirm'); await p.click('text=ONAYLA VE İŞLEMİ TAMAMLA'); await p.waitForTimeout(500);
  await p.click('[data-home-trade="Döviz Alış"]'); await p.click('#stHistoryToggle');
  await p.click('[data-trade-edit]'); await p.click('#modalConfirm'); await p.waitForTimeout(500);
  assert.equal(await p.inputValue('#stQty'), '100', 'düzeltme eski miktarla açılmalı');
  assert.equal(await p.inputValue('#stFx'), 'USD');
  assert.equal(Number(await p.inputValue('#stPrice')), 40, 'düzeltme eski kurla açılmalı');
  await p.fill('#stQty', '150'); await p.waitForTimeout(200);
  await p.click('#modalConfirm'); await p.click('text=ONAYLA VE İŞLEMİ TAMAMLA'); await p.waitForTimeout(9000);
  const da = (fb.db.state.tradeMoves || []).filter((x) => x.tradeType === 'Döviz Alış');
  assert.equal(da.length, 1, 'tek kayıt kalmalı'); assert.equal(Number(da[0].quantity), 150);
  assert.equal(Math.round(cash(await st(), 'TL')), Math.round(tl0 - 6000)); assert.equal(Math.round(cash(await st(), 'USD')), Math.round(usd0 + 150));
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('fiyatlar Asil fiyat ekranının ayarlarından gelir: işçilik, döviz düzeltmesi, hurda ve K. Kartı', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  const settings = { labor: { ceyrek: { a: 1.6, s: 1.65 } }, customItems: [{ id: 'c1', label: '22 Ayar 1 Gram Altın' }], kkOran: 5, hasDuzA: 2, hasDuzS: 0,
    dovizDuz: { usdA: 0.5, usdS: -0.25 }, hurdaItems: [{ id: 'hurda22', label: '22 Ayar Hurda', oran: 22 / 24 }, { id: 'hurda14', label: '14 Ayar Hurda', oran: 14 / 24 }], hurdaCarp: { hurda22A: 0.9, hurda22S: 0.92, hurda14A: 0.55, hurda14S: 0.58 } };
  settings.labor.c1 = { a: 0.91, s: 0.96 };
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
  // Supabase (PostgREST) gibi davranır: bilinmeyen sorgu parametresi (örn. v=...) 400 döner; PATCH kaydı günceller.
  const patches = [];
  await p.context().route(/supabase\.co/, (r) => {
    const req = r.request(), u = new URL(req.url());
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if ([...u.searchParams.keys()].some((k) => !['id', 'select', 'limit'].includes(k))) return r.fulfill({ status: 400, headers: cors, contentType: 'application/json', body: '{"message":"column app_settings.v does not exist"}' });
    if (req.method() === 'PATCH') { const b = JSON.parse(req.postData()); patches.push(b); Object.keys(settings).forEach((k) => delete settings[k]); Object.assign(settings, b.data); return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify([{ id: 'asil_settings', data: settings }]) }); }
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify([{ data: settings, updated_at: '2026-10-21' }]) });
  });
  await p.context().route(/workers\.dev/, (r) => r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ hasAlis: 6000, hasSatis: 6100, usdAlis: 48, usdSatis: 50, sarAlis: 12, sarSatis: 13 }) }));
  await p.evaluate(() => document.querySelector('[data-go="prices"],[data-route="prices"]').click()); await p.waitForSelector('#refreshLivePrices');
  await p.evaluate(() => document.getElementById('refreshLivePrices').click()); await p.waitForSelector('#asilScreenPrices'); await p.waitForTimeout(500);
  const rows = await p.$$eval('#asilScreenPrices tbody tr', (trs) => trs.map((tr) => [...tr.cells].map((c) => c.innerText.trim())));
  const ceyrek = rows.find((r) => r[0] === 'Çeyrek');
  assert.deepEqual(ceyrek, ['Çeyrek', (Math.round(6002 * 1.6)).toLocaleString('tr-TR'), (Math.round(6100 * 1.65)).toLocaleString('tr-TR'), (Math.round(Math.round(6100 * 1.65) * 1.05)).toLocaleString('tr-TR')]);
  assert.ok(rows.some((r) => r[0] === '22 Ayar 1 Gram Altın'), 'özel ürün de listelenmeli');
  const usdBuy = await p.$eval('[data-price="usd.buy"]', (e) => Number(e.value));
  assert.equal(usdBuy, 48.5, 'döviz düzeltmesi uygulanmalı');
  const fxRow = await p.$$eval('#boardFx tbody tr', (trs) => trs.map((tr) => [...tr.cells].map((c) => c.innerText.trim())));
  assert.deepEqual(fxRow.find((r) => r[0] === 'USD'), ['USD', '48,50', '49,75'], 'panoda döviz farklı kur görünmeli');
  // Programın kendi fiyat listesi (satış / ziynet ekranları bunu kullanır) ekranla aynı rakamı almalı
  const itemVal = async (code, f) => p.evaluate(([c, f]) => { const el = [...document.querySelectorAll('[data-item]')].find((e) => e.dataset.item.endsWith('.' + f) && e.closest('tr')?.textContent.includes(c)); return el ? Number(el.value) : null; }, [code, f]);
  assert.equal(await itemVal('Çeyrek', 'buy'), Math.round(6002 * 1.6), 'çeyrek alış ekrandaki gibi');
  assert.equal(await itemVal('22 Ayar 1 Gram', 'sell'), Math.round(6100 * 0.96), '22 ayar 1 gram ada göre eşleşmeli');
  assert.equal(await itemVal('22 Hurda', 'buy'), Math.round(6002 * 0.9), 'hurda çarpanı ekrandan gelmeli');
  // Programdaki Fiyat Ekranı Ayarları: değişiklik fiyat ekranının kaydına yazılır, diğer ayarlar korunur
  await p.evaluate(() => document.getElementById('openScreenSettings').click()); await p.waitForSelector('#ssA_ceyrek');
  await p.fill('#ssA_ceyrek', '1.7');
  await p.click('[data-ss-tab="ssFx"]'); await p.fill('#ssFxA_sar', '0.1');
  await p.click('[data-ss-tab="ssGen"]'); await p.fill('#ssKK', '6');
  await p.evaluate(() => document.getElementById('modalConfirm').click()); await p.waitForTimeout(1200);
  assert.equal(patches.length, 1, 'fiyat ekranına bir kez yazılmalı');
  const saved = patches[0].data;
  assert.equal(saved.labor.ceyrek.a, 1.7); assert.equal(saved.labor.ceyrek.s, 1.65, 'değişmeyen satış çarpanı korunmalı');
  assert.equal(saved.labor.c1.a, 0.91, 'diğer ürünlerin işçiliği korunmalı');
  assert.equal(saved.dovizDuz.sarA, 0.1); assert.equal(saved.dovizDuz.usdA, 0.5, 'diğer döviz farkı korunmalı'); assert.equal(saved.kkOran, 6);
  assert.equal(saved.customItems.length, 1, 'özel ürünler silinmemeli');
  assert.equal(await itemVal('Çeyrek', 'buy'), Math.round(6002 * 1.7), 'programdaki fiyat yeni işçilikle güncellenmeli');
  const sarRow = (await p.$$eval('#boardFx tbody tr', (trs) => trs.map((tr) => [...tr.cells].map((c) => c.innerText.trim())))).find((r) => r[0] === 'SAR');
  assert.deepEqual(sarRow, ['SAR', '12,10', '13,00'], 'SAR panoda farkıyla görünmeli');
  // Fiyat ekranında (başka cihazda) yapılan değişiklik birkaç saniyede kendiliğinden gelir
  settings.labor.ceyrek = { a: 1.8, s: 1.85 };
  await p.waitForTimeout(6500);
  assert.equal(await itemVal('Çeyrek', 'buy'), Math.round(6002 * 1.8), 'fiyat ekranındaki değişiklik dakika beklemeden gelmeli');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('cari ekstre: tarih aralığıyla yazdırılır, son durum çıkar; harekette fiş, düzelt ve sil düğmeleri var', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  const popups = [];
  p.context().on('page', (pg) => popups.push(pg));
  await p.evaluate(() => document.querySelector('[data-route="customers"],[data-go="customers"]').click());
  await p.waitForTimeout(500);
  const ids = await p.$$eval('[data-cari-card]', (els) => els.map((e) => e.dataset.cariCard));
  let found = false, foundId = '';
  for (const id of ids) {
    await p.evaluate((x) => document.querySelector(`[data-cari-card="${x}"] [data-cari-detail]`).click(), id);
    await p.waitForTimeout(200);
    if (await p.$('#cariShowInfo')) { await p.uncheck('#cariShowInfo'); await p.waitForTimeout(200); }
    if (await p.$('#cariEkstreTable .cari-ekstre-row')) { found = true; foundId = id; break; }
    await p.click('#modalX');
  }
  assert.ok(found, 'hareketli bir cari bulunmalı');
  await p.click('.cari-ekstre-row[data-ekstre-index="0"]');
  assert.ok(await p.$('#selectedCariPrint'), 'fiş yazdır düğmesi olmalı');
  assert.ok(await p.$('#selectedCariEdit'), 'düzelt düğmesi olmalı');
  assert.ok(await p.$('#selectedCariDelete'), 'sil düğmesi olmalı');
  await p.click('#selectedCariDelete');
  await p.waitForSelector('text=Cari Hareketi Sil');
  await p.click('#modalX');
  await p.evaluate((x) => document.querySelector(`[data-cari-card="${x}"] [data-cari-detail]`).click(), foundId);
  await p.waitForSelector('#cariPrintStatement');
  await p.click('#cariPrintStatement');
  for (let i = 0; i < 40 && !popups.length; i++) await p.waitForTimeout(250);
  assert.ok(popups.length, 'ekstre basılmalı');
  const text = await popups[0].innerText('body');
  assert.match(text, /CARİ HESAP EKSTRESİ/);
  assert.match(text, /SON DURUM/);
  assert.match(text, /Bakiye/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('cari nakit tahsilat karşılığı HAS: satış kuruyla, ödemede alış kuruyla hesaplanır', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.evaluate(() => document.querySelector('[data-route="customers"],[data-go="customers"]').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('[data-cari-move]').click());
  await p.waitForSelector('#cmType');
  await p.selectOption('#cmType', 'NT'); await p.selectOption('#cmUnit', 'TL'); await p.fill('#cmAmount', '93000');
  await p.check('#cmCounterEnabled'); await p.selectOption('#cmCounterUnit', 'HAS'); await p.waitForTimeout(200);
  const rate = Number(await p.$eval('#cmCounterRate', (e) => e.value));
  assert.ok(rate > 0);
  // Ödeme (BORÇ) seçilince karşılık kuru alış kuruna döner ve satıştan küçük olur
  await p.selectOption('#cmType', 'NO'); await p.waitForTimeout(200);
  const rateOut = Number(await p.$eval('#cmCounterRate', (e) => e.value));
  assert.ok(rate > rateOut, `tahsilatta satış kuru (${rate}) ödemedeki alış kurundan (${rateOut}) büyük olmalı`);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('bulut: yazıldığı hâlde yanıtı kaybolan gönderimden sonra kasa farkı ikinci kez eklenmez', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  const tlCash = (s) => (s.cashAccounts || []).filter((x) => x.currency === 'TL').reduce((n, x) => n + Number(x.balance || 0), 0);
  const cash0 = tlCash(fb.db.state);
  fb.db.dropNextPutResponse = true;
  await p.click('[data-home-trade="Ziynet Alış"]');
  await p.fill('#stQty', '2'); await p.fill('#stPrice', '5000');
  await p.click('#modalConfirm'); await p.waitForTimeout(9000);
  assert.equal(Math.round(tlCash(fb.db.state)), Math.round(cash0 - 10000), 'ilk yazma buluta ulaşmış olmalı');
  await p.click('[data-home-trade="Ziynet Alış"]');
  await p.fill('#stQty', '1'); await p.fill('#stPrice', '5000');
  await p.click('#modalConfirm'); await p.waitForTimeout(9000);
  const st = fb.db.state, moves = (st.financeMoves || []).filter((f) => String(f.sourceDocNo || '').startsWith('ZA-'));
  assert.equal(moves.length, 2);
  assert.equal(Math.round(tlCash(st)), Math.round(cash0 - 15000), 'kasa iki alışın toplamı kadar düşmeli (ilk fark ikinci kez eklenmemeli)');
  await p.context().close();
});

test('cariye kısmi ödemeli satış: kalan tutar cariye bir kez yazılır, iptalde tamamen geri alınır', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  await p.click('[data-go="sales"]');
  const cust = await p.$$eval('#saleCustomerSelect option', (os) => os.map((o) => ({ v: o.value, t: o.textContent })).find((o) => o.v && o.v !== 'CASH' && !/PEŞİN/i.test(o.t)));
  await p.selectOption('#saleCustomerSelect', cust.v); await p.waitForTimeout(400);
  const tlOf = () => Number((fb.db.state.customers || []).find((c) => c.id === cust.v)?.tlBalance || 0);
  const tl0 = tlOf();
  for (let i = 0; i < 3; i++) {
    await p.fill('#saleProductSearch', '22'); await p.waitForTimeout(300); await p.press('#saleProductSearch', 'Enter');
    if (await p.waitForSelector('#saleEntryPrice:not([disabled])', { timeout: 5000 }).catch(() => null)) break;
  }
  await p.waitForTimeout(300);
  await p.fill('#saleEntryPayable', '9000'); await p.click('#saleAddUnified'); await p.waitForTimeout(400);
  await p.click('[data-pay="Nakit"]'); await p.fill('#payNative', '400'); await p.dispatchEvent('#payNative', 'input'); await p.waitForTimeout(200);
  await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.selectOption('#salePerson', { index: 1 });
  await p.click('#finalizeSale'); await p.click('#modalConfirm'); await p.waitForTimeout(9000);
  const b = await p.$('.critical-alert button'); if (b) await b.click();
  const moves = (fb.db.state.customerMoves || []).filter((m) => m.customerId === cust.v && /SAT-/.test(m.sourceDocNo || '') && m.type === 'SATIŞ / AÇIK HESAP');
  assert.equal(moves.length, 1, 'kalan tutar tek satır olmalı');
  assert.equal(Math.round(tlOf() - tl0), 8600, 'cari borcu yalnız kalan 8.600 TL artmalı');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('kasa sayımı: kasa farkı sisteme işlenir, bakiye sayılan tutara gelir ve hareket olarak görünür', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  const tlCash = (s) => (s.cashAccounts || []).filter((x) => x.currency === 'TL').reduce((n, x) => n + Number(x.balance || 0), 0);
  const cash0 = tlCash(fb.db.state);
  await p.keyboard.press('F9');
  await p.click('#goldCountV7');
  await p.waitForSelector('.kc-wrap');
  const num = (t) => Number(String(t).replace(/\./g, '').replace(',', '.'));
  const cashSys = num(await p.locator('tr[data-kc-row="c:TL"] td').nth(2).innerText());
  await p.fill('tr[data-kc-row="c:TL"] input', String(cashSys + 500).replace('.', ','));
  await p.click('#modalConfirm');
  await p.waitForSelector('#kcCashFixV7');
  await p.click('#kcCashFixV7'); await p.click('#modalConfirm'); await p.waitForTimeout(9000);
  assert.equal(Math.round(tlCash(fb.db.state)), Math.round(cash0 + 500), 'kasa sayılan tutara gelmeli');
  const mv = (fb.db.state.financeMoves || []).find((f) => f.type === 'Kasa Sayım Farkı');
  assert.ok(mv && mv.direction === 'Giriş' && Math.round(mv.accountAmount) === 500, 'fark kasa hareketi olarak görünmeli');
  // Sayım farkı Kasa / Banka hareketlerinden silinir; kasa eski haline döner
  const cb = await p.$('.critical-alert button'); if (cb) await cb.click();
  await p.evaluate(() => { document.querySelector('#modalX')?.click(); document.querySelector('[data-go="finance"],[data-route="finance"]').click(); });
  await p.waitForSelector(`[data-kasa-diff-del="${mv.id}"]`);
  await p.evaluate((id) => document.querySelector(`[data-kasa-diff-del="${id}"]`).click(), mv.id);
  await p.click('#modalConfirm');
  for (let i = 0; i < 40 && (fb.db.state.financeMoves || []).some((f) => f.id === mv.id); i++) await p.waitForTimeout(250);
  assert.ok(!(fb.db.state.financeMoves || []).some((f) => f.id === mv.id), 'sayım farkı kaydı silinmeli');
  assert.equal(Math.round(tlCash(fb.db.state)), Math.round(cash0), 'kasa sayımdan önceki tutara dönmeli');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('İş Bankası online ekstre: köprüden gelen hareketler programdaki banka hareketleriyle eşleştirilir', async () => {
  const http = require('http');
  const kopru = require('../../kopru/asil-kopru.js');
  kopru._isbankReset();
  const realFetch = global.fetch;
  const fb = createFakeFirebase();
  let p = await newDevice(browser, appUrl, fb);
  await p.waitForTimeout(1500);
  const st = fb.db.state, acc = (st.bankAccounts || []).find((b) => /İŞ BANKASI/.test(String(b.bank || b.name)));
  const day = (n) => { const d = new Date(Date.now() - n * 864e5); return d; };
  const dmy = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const fm = (id, d, dir, amt, type) => ({ id, period: st.activePeriod, date: d.toISOString(), direction: dir, type, accountKind: 'Banka', accountId: acc.id, accountName: acc.bank || acc.name, amount: amt, accountAmount: amt, accountCurrency: 'TL', tlAmount: amt, sourceDocNo: id });
  st.financeMoves = [...(st.financeMoves || []), fm('FIN-T1', day(1), 'Giriş', 1500, 'Havale / EFT Tahsilat'), fm('FIN-T2', day(2), 'Çıkış', 250, 'Bankaya Ödeme'), fm('FIN-T3', day(3), 'Giriş', 999, 'Kredi Kartı Tahsilat')];
  st.invoiceSettings = { ...(st.invoiceSettings || {}), proxyUrl: 'http://127.0.0.1:0' };
  const cfg = { allowedOrigins: [], whatsapp: false, isbankUid: 'KOD1', isbankPwd: 'gizli' };
  let sentBody = '';
  global.fetch = async (url, opt) => {
    if (!String(url).includes('posmatik2.isbank.com.tr')) return realFetch(url, opt);
    sentBody = opt.body;
    return { ok: true, status: 200, text: async () => `<?xml version="1.0" encoding="utf-8"?><HesapOzeti><Hareket><Tarih>${dmy(day(1))} 10:11:12</Tarih><Tutar>1.500,00</Tutar><Aciklama>EFT GELEN</Aciklama></Hareket><Hareket><Tarih>${dmy(day(2))} 09:00:00</Tarih><Tutar>-250,00</Tutar><Aciklama>HAVALE GİDEN</Aciklama></Hareket><Hareket><Tarih>${dmy(day(2))} 15:00:00</Tutar><Tutar>-42,10</Tutar><Aciklama>MASRAF</Aciklama></Hareket></HesapOzeti>`.replace('</Tutar><Tutar>-42,10', '</Tarih><Tutar>-42,10') };
  };
  const bridge = http.createServer((q, r) => kopru.handle(cfg, q, r));
  await new Promise((r) => bridge.listen(0, '127.0.0.1', r));
  try {
    st.invoiceSettings.proxyUrl = `http://127.0.0.1:${bridge.address().port}`;
    fb.db.state = st; await p.context().close();
    p = await newDevice(browser, appUrl, fb);
    await p.evaluate(() => document.querySelector('[data-route="customers"],[data-go="customers"]').click());
    await p.waitForTimeout(500);
    await p.evaluate(() => [...document.querySelectorAll('[data-cari-card][data-cari-type="Banka"]')].find((x) => /İŞ BANKASI/.test(x.innerText)).querySelector('[data-cari-detail]').click());
    await p.waitForSelector('#bankOnlineV7'); await p.click('#bankOnlineV7');
    await p.waitForSelector('#boGet'); await p.click('#boGet');
    await p.waitForSelector('#boResult table', { timeout: 10000 });
    const t = await p.innerText('#boResult');
    assert.match(t, /Bankada var, programda yok\s*1/);
    assert.match(t, /MASRAF[\s\S]*Programda yok/);
    assert.match(t, /Programda var, bankada yok[\s\S]*FIN-T3/);
    assert.match(t, /EFT GELEN[\s\S]*✓/);
    const body = new URLSearchParams(sentBody);
    assert.deepEqual([body.get('uid'), body.get('pwd')], ['KOD1', 'gizli']);
    assert.match(body.get('BeginDate'), /^\d{2}\.\d{2}\.\d{4} 00:00:00$/);
    assert.ok(!t.includes('gizli'), 'şifre ekranda görünmemeli');
    for (let i = 0; i < 40 && !(fb.db.state.bankIncomingV7 || []).length; i++) await p.waitForTimeout(250);
    const inc = fb.db.state.bankIncomingV7 || [];
    assert.deepEqual(inc.map((x) => x.amount), [1500], 'Bankadan Getir ile gelen para fatura listesine kaydedilmeli');
    assert.deepEqual(p.errors, []);
    await p.context().close();
  } finally { global.fetch = realFetch; bridge.close(); kopru._isbankReset(); }
});

test('otomatik havale bildirimi: yeni gelen para uyarı verir, riskli açıklama kırmızı işaretlenir', async () => {
  const http = require('http');
  const kopru = require('../../kopru/asil-kopru.js');
  kopru._isbankReset();
  const realFetch = global.fetch;
  const fb = createFakeFirebase();
  let p = await newDevice(browser, appUrl, fb);
  await p.waitForTimeout(1000);
  const st = fb.db.state, acc = (st.bankAccounts || []).find((b) => /İŞ BANKASI/.test(String(b.bank || b.name)));
  const d = new Date(), dmy = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const cfg = { allowedOrigins: [], whatsapp: false, isbankUid: 'KOD1', isbankPwd: 'gizli' };
  global.fetch = async (url, opt) => {
    if (!String(url).includes('posmatik2.isbank.com.tr')) return realFetch(url, opt);
    return { ok: true, status: 200, text: async () => `<?xml version="1.0"?><R><H><Tarih>${dmy} 10:00:00</Tarih><Tutar>5.000,00</Tutar><Aciklama>AHMET YILMAZ BORÇ ÖDEMESİ</Aciklama></H><H><Tarih>${dmy} 10:05:00</Tarih><Tutar>7.250,00</Tutar><Aciklama>FAST GELEN AHMET YILMAZ ALTIN ÖDEMESİ ELDEN TESLİM ALDIM 10000000146</Aciklama></H><H><Tarih>${dmy} 10:06:00</Tarih><Tutar>300,00</Tutar><Aciklama>FAST GELEN</Aciklama></H><H><Tarih>${dmy} 10:07:00</Tarih><Tutar>-80,00</Tutar><Aciklama>MASRAF</Aciklama></H><H><Tarih>${dmy} 10:08:00</Tarih><Tutar>31.023,45</Tutar><Aciklama>0000000000000/NET SATIŞ TUTARI DENEME KUYUM /000</Aciklama><IslemTuru>CCP</IslemTuru></H></R>` };
  };
  const bridge = http.createServer((q, r) => kopru.handle(cfg, q, r));
  await new Promise((r) => bridge.listen(0, '127.0.0.1', r));
  try {
    st.invoiceSettings = { ...(st.invoiceSettings || {}), proxyUrl: `http://127.0.0.1:${bridge.address().port}` };
    st.bankWatchV7 = { on: true, accountId: acc.id, needTc: true };
    fb.db.state = st; await p.context().close();
    p = await newDevice(browser, appUrl, fb);
    await p.evaluate(() => localStorage.setItem('asil_bank_seen_v7', '[]'));
    await p.waitForSelector('#bankAlertV7', { timeout: 15000 });
    const t = await p.innerText('#bankAlertV7');
    assert.match(t, /Hesabınıza havale geldi/);
    assert.match(t, /BORÇ ÖDEMESİ[\s\S]*Riskli açıklama/);
    assert.match(t, /ALTIN ÖDEMESİ[\s\S]*Açıklama uygun \(TC 10000000146\)/);
    assert.match(t, /FAST GELEN[\s\S]*TC kimlik numarası yok/);
    assert.ok(!/MASRAF/.test(t), 'çıkan para bildirilmemeli');
    assert.ok(!/NET SATIŞ/.test(t), 'POS net satış aktarımı havale sayılmamalı');
    assert.match(t, /FAST GELEN[\s\S]*isim soyisim yok/);
    assert.equal((t.match(/Hesabınıza havale geldi/g) || []).length, 3);
    await p.click('[data-bank-alert-all]');
    assert.equal(await p.$('#bankAlertV7'), null);
    for (let i = 0; i < 40 && !(fb.db.state.bankIncomingV7 || []).length; i++) await p.waitForTimeout(250);
    const bi = fb.db.state.bankIncomingV7 || [];
    assert.equal(bi.length, 3, 'gelen 3 havale buluta yazılmalı');
    await p.evaluate(() => document.querySelector('[data-route="invoices"],[data-go="invoices"]').click());
    await p.waitForTimeout(400);
    await p.evaluate(() => document.querySelector('[data-invoice-view="havale"]').click());
    await p.waitForSelector('[data-bank-incoming-invoice]');
    const ht = await p.innerText('body');
    assert.match(ht, /Bankadan Otomatik Gelen Havaleler[\s\S]*ALTIN ÖDEMESİ/);
    const id = bi.find((x) => /ALTIN/.test(x.description)).id;
    await p.evaluate((i) => document.querySelector(`[data-bank-incoming-invoice="${i}"]`).click(), id);
    for (let i = 0; i < 40 && !(fb.db.state.invoiceRecords || []).some((r) => r.bankIncomingId === id); i++) await p.waitForTimeout(250);
    const rec = (fb.db.state.invoiceRecords || []).find((r) => r.bankIncomingId === id);
    assert.ok(rec && rec.amount === 7250 && rec.manual.receiver.tckn === '10000000146', 'fatura taslağı TC ile oluşmalı');
    assert.equal(rec.manual.receiver.name, 'AHMET YILMAZ', 'gönderen adı açıklamadan alınmalı');
    assert.deepEqual(p.errors, []);
    await p.context().close();
  } finally { global.fetch = realFetch; bridge.close(); kopru._isbankReset(); }
});

test('satıştan açılan fatura taslağına bankadan gelen havalenin TC si ve o TC li carinin adı yazılır', async () => {
  const fb = createFakeFirebase();
  let p = await newDevice(browser, appUrl, fb);
  await p.waitForTimeout(1500);
  const st = fb.db.state, bank = st.bankAccounts[0], now = new Date().toISOString();
  st.sales = [{ id: 'S-T9', docNo: 'SAT-T9', status: 'Tamamlandı', period: st.activePeriod, date: now, total: 7250, saleCurrency: 'TL', customerId: '', lines: [], items: [], payments: [] }, ...(st.sales || [])];
  st.financeMoves = [{ id: 'FIN-T9', period: st.activePeriod, date: now, direction: 'Giriş', type: 'Havale / EFT Tahsilat', accountKind: 'Banka', accountId: bank.id, accountName: bank.bank || bank.name, amount: 7250, accountAmount: 7250, tlAmount: 7250, accountCurrency: 'TL', sourceDocNo: 'SAT-T9' }, ...(st.financeMoves || [])];
  st.customers = [...(st.customers || []), { id: 'C-TC', name: 'MEHMET DEMİR', tckn: '10000000214', type: 'Müşteri' }];
  st.bankIncomingV7 = [{ id: 'BI-x', date: now, amount: 7250, description: 'ALTIN ÖDEMESİ ELDEN TESLİM ALDIM 10000000214', tckn: '10000000214', level: 'uygun', msg: '', accountId: bank.id, status: 'bekliyor' }];
  fb.db.state = st; await p.context().close();
  p = await newDevice(browser, appUrl, fb);
  await p.evaluate(() => document.querySelector('[data-go="invoices"],[data-route="invoices"]').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('[data-invoice-view="pending"],[data-invoice-view="sales"]')?.click());
  await p.waitForSelector('[data-invoice-draft="S-T9"]');
  await p.evaluate(() => document.querySelector('[data-invoice-draft="S-T9"]').click());
  await p.waitForSelector('#irName');
  assert.equal(await p.inputValue('#irName'), 'MEHMET DEMİR');
  assert.equal(await p.inputValue('#irTckn'), '10000000214');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('veri kontrol raporu: temiz veride hata yok; 1000 üstü milyemli cari iade ve hatalı stok kartı listelenir, veri değişmez', async () => {
  const fb = createFakeFirebase();
  let p = await newDevice(browser, appUrl, fb);
  await p.waitForTimeout(1500);
  const open = async () => {
    await p.evaluate(() => document.querySelector('[data-route="reports"],[data-go="reports"]').click());
    await p.click('[data-pusula-report="data_check"]'); await p.waitForTimeout(500);
    return p.evaluate(() => document.getElementById('prResult').innerText);
  };
  let txt = await open();
  assert.match(txt, /Hatalı milyem \/ HAS girişi bulunamadı/, txt.slice(0, 400));
  await p.context().close();
  const st = fb.db.state, now = new Date().toISOString();
  st.customers = [...(st.customers || []), { id: 'C-DC', name: 'DENEME CARİ', type: 'Müşteri' }];
  st.customerMoves = [{ id: 'CM-DC', customerId: 'C-DC', period: st.activePeriod, date: now, code: 'CI', type: 'CI - ÇIKAN İADE', unit: 'HAS', debit: 99.5, credit: 0, sourceType: 'cariReturnOut', sourceDocNo: 'CI-9001', sourceUnit: 'ADET', sourceAmount: 1, sourceRate: 9950, returnOutImpact: { unit: 'ADET', amount: 1, count: 1, gram: 10, zGram: 10, milyem: 9950, commercialHas: 99.5 } }, ...(st.customerMoves || [])];
  st.stockCardsMaster = [...(st.stockCardsMaster || []), { id: 'SC-DC', productCode: 'DC1', productDefinition: 'HATALI KART', purity: '9160', fixedMilyem: 9160, ziynet: false }];
  fb.db.state = st;
  p = await newDevice(browser, appUrl, fb);
  txt = await open();
  assert.match(txt, /CI-9001/); assert.match(txt, /milyem 9\.950/i); assert.match(txt, /DENEME CARİ/);
  assert.match(txt, /HATALI KART/);
  await p.waitForTimeout(800);
  const after = fb.db.state;
  assert.equal(after.customerMoves.find((m) => m.id === 'CM-DC').debit, 99.5, 'rapor veriyi değiştirmemeli');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('gider pusulası: hurda alışından düzenlenir, numara sırayla gider, iptal numarayı boşaltmaz', async () => {
  const fb = createFakeFirebase();
  let p = await newDevice(browser, appUrl, fb);
  await p.waitForTimeout(1500);
  const st = fb.db.state, now = new Date().toISOString();
  st.customers = [...(st.customers || []), { id: 'C-GP', name: 'AYŞE KARA', type: 'Müşteri', phone: '05550000000' }];
  const tr = (id, doc, item, q, has, tl) => ({ id, docNo: doc, period: st.activePeriod, date: now, tradeType: 'Hurda Alış', side: 'Alış', item, quantity: q, unit: 'GR', unitPrice: tl / q, totalTL: tl, totalHas: has, customerId: 'C-GP', customer: 'AYŞE KARA', sourceType: 'saleScreenPurchase' });
  st.tradeMoves = [tr('T-GP1', 'AZA-9001', '22 AYAR HURDA', 10, 9.16, 55000), tr('T-GP2', 'AZA-9001', '14 AYAR HURDA', 5, 2.92, 17500), tr('T-GP3', 'AZA-9002', '22 AYAR HURDA', 2, 1.83, 11000), ...(st.tradeMoves || [])];
  fb.db.state = st; await p.context().close();
  p = await newDevice(browser, appUrl, fb);
  await p.evaluate(() => document.querySelector('[data-go="invoices"],[data-route="invoices"]').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('[data-invoice-view="gider"]').click());
  await p.waitForSelector('[data-gp-new="AZA-9001"]');
  await p.evaluate(() => document.querySelector('[data-gp-new="AZA-9001"]').click());
  await p.waitForSelector('#gpName');
  assert.equal(await p.inputValue('#gpName'), 'AYŞE KARA');
  assert.match(await p.innerText('#gpTotals'), /72\.500,00/);
  await p.click('#modalConfirm');
  assert.ok(await p.$('#gpName'), 'TC ve adres olmadan kaydedilmemeli');
  await p.evaluate(() => document.querySelector('.critical-alert-backdrop')?.remove());
  await p.fill('#gpTc', '10000000146'); await p.fill('#gpAddress', 'CUMHURİYET MAH. DÜZCE');
  await p.click('#modalConfirm');
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-gp-new="AZA-9002"]').click());
  await p.waitForSelector('#gpName');
  assert.equal(await p.inputValue('#gpTc'), '10000000146', 'TC cari kartına yazılmış olmalı');
  await p.click('#modalConfirm');
  for (let i = 0; i < 40 && (fb.db.state.expenseVouchersV7 || []).length < 2; i++) await p.waitForTimeout(250);
  const v = (fb.db.state.expenseVouchersV7 || []).slice().sort((a, b) => a.no.localeCompare(b.no));
  const y = new Date().getFullYear();
  assert.deepEqual(v.map((x) => x.no), [`GP${y}0000000001`, `GP${y}0000000002`]);
  assert.equal(v[0].total, 72500); assert.equal(v[0].lines.length, 2); assert.equal(v[0].seller.address, 'CUMHURİYET MAH. DÜZCE');
  await p.waitForSelector(`[data-gp-cancel="${v[0].id}"]`);
  await p.evaluate((id) => document.querySelector(`[data-gp-cancel="${id}"]`).click(), v[0].id);
  for (let i = 0; i < 40 && !(fb.db.state.expenseVouchersV7 || []).some((x) => x.status === 'İptal'); i++) await p.waitForTimeout(250);
  const after = fb.db.state.expenseVouchersV7;
  assert.equal(after.find((x) => x.id === v[0].id).status, 'İptal');
  await p.waitForSelector('[data-gp-new="AZA-9001"]');
  await p.evaluate(() => document.querySelector('[data-gp-new="AZA-9001"]').click());
  await p.waitForSelector('#gpName');
  await p.click('#modalConfirm');
  for (let i = 0; i < 40 && (fb.db.state.expenseVouchersV7 || []).length < 3; i++) await p.waitForTimeout(250);
  assert.ok(fb.db.state.expenseVouchersV7.some((x) => x.no === `GP${y}0000000003`), 'iptalden sonra yeni numara verilmeli, eski numara tekrar kullanılmamalı');
  const t = await p.innerText('body');
  assert.ok(!/e-Gönder/.test(t), 'e-Gider Pusulası kapalıyken gönder düğmesi görünmemeli');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('Banka Hareketleri: İş Bankası online ekstresi listeye düşer, tekrar çekince mükerrer eklenmez', async () => {
  const http = require('http');
  const kopru = require('../../kopru/asil-kopru.js');
  kopru._isbankReset();
  const realFetch = global.fetch;
  const fb = createFakeFirebase();
  let p = await newDevice(browser, appUrl, fb);
  await p.waitForTimeout(1000);
  const st = fb.db.state;
  const d = new Date(), dd = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const sn = (hh, mi) => `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}${hh}${mi}29577863`;
  const H = (no, amt, desc, tur) => `<Hareket><Tarih>${dd}</Tarih><HareketSirano>${no}</HareketSirano><Miktar>${amt}</Miktar><Bakiye>1000.00</Bakiye><Aciklama>${desc}</Aciklama><IslemTuru>${tur}</IslemTuru><KarsiHesapVKN>0000000000</KarsiHesapVKN></Hareket>`;
  const xml = `<?xml version="1.0" encoding="utf-8"?><XMLEXBAT><Tarih>${dd}</Tarih><Hesaplar><Hesap><Tanimlamalar><HesapNo>1</HesapNo><Bakiye>1000.00</Bakiye></Tanimlamalar><Hareketler>${H(sn('09', '15'), '21350.00', 'ALİ VELİ ALTIN ÖDEMESİ ELDEN TESLİM ALDIM 10000000146', 'FST')}${H(sn('18', '45'), '-500.00', 'HAVALE GİDEN', 'EFT')}${H(sn('03', '44'), '31023.45', '0000000000000/NET SATIŞ TUTARI DENEME KUYUM /000', 'CCP')}</Hareketler></Hesap></Hesaplar></XMLEXBAT>`;
  global.fetch = async (url, opt) => String(url).includes('posmatik2.isbank.com.tr') ? { ok: true, status: 200, text: async () => xml } : realFetch(url, opt);
  const bridge = http.createServer((q, r) => kopru.handle({ allowedOrigins: [], whatsapp: false, isbankUid: 'U', isbankPwd: 'P' }, q, r));
  await new Promise((r) => bridge.listen(0, '127.0.0.1', r));
  try {
    st.invoiceSettings = { ...(st.invoiceSettings || {}), proxyUrl: `http://127.0.0.1:${bridge.address().port}` };
    fb.db.state = st; await p.context().close();
    p = await newDevice(browser, appUrl, fb);
    await p.evaluate(() => document.querySelector('[data-go="banking"],[data-route="banking"]').click());
    await p.waitForSelector('#bankFeedOnline');
    const acc = st.bankAccounts.find((b) => /İŞ BANKASI/.test(String(b.bank || b.name)));
    await p.selectOption('#bankFeedBank', acc.id);
    await p.click('#bankFeedOnline');
    await p.waitForSelector('[data-bankfeed-row]', { timeout: 10000 });
    const t = await p.innerText('#bankFeedTable');
    assert.equal((await p.$$('[data-bankfeed-row]')).length, 3);
    assert.match(t, /ALİ VELİ ALTIN ÖDEMESİ[\s\S]*UYGUN/);
    assert.match(t, /HAVALE GİDEN/); assert.match(t, /Çıkış/);
    const rows = await p.$$eval('[data-bankfeed-row]', (rs) => rs.map((r) => r.innerText));
    assert.match(rows[0], /18:45[\s\S]*HAVALE GİDEN/, 'en yeni hareket üstte, işlem saatiyle');
    assert.match(rows[1], /09:15[\s\S]*ALTIN ÖDEMESİ/); assert.match(rows[2], /03:44[\s\S]*NET SATIŞ/);
    assert.ok(!/NET SATIŞ[^\n]*(UYGUN|EKSİK|RİSKLİ)/.test(t), 'POS aktarımına açıklama kontrolü konmamalı');
    kopru._isbankReset();
    await p.click('#bankFeedOnline'); await p.waitForTimeout(1500);
    assert.equal((await p.$$('[data-bankfeed-row]')).length, 3, 'aynı hareketler tekrar eklenmemeli');
    // Gelen havalede yalnız "Faturaya Gönder" var; bankaya / kasaya işlem yapmaz.
    assert.equal(await p.$$eval('[data-bankfeed-post]', (b) => b.length), 1, 'Yeni Hareket Kaydet yalnız çıkan harekette olmalı');
    const balBefore = (fb.db.state.bankAccounts.find((b) => b.id === acc.id) || {}).balance, finBefore = (fb.db.state.financeMoves || []).length;
    await p.evaluate(() => document.querySelectorAll('[data-bankfeed-invoice]')[0].click());
    for (let i = 0; i < 40 && !(fb.db.state.bankIncomingV7 || []).some((x) => /ALTIN ÖDEMESİ/.test(x.description)); i++) await p.waitForTimeout(250);
    assert.ok((fb.db.state.bankIncomingV7 || []).some((x) => /ALTIN ÖDEMESİ/.test(x.description)), 'fatura ekranına gitmeli');
    assert.equal(fb.db.state.bankAccounts.find((b) => b.id === acc.id).balance, balBefore, 'banka bakiyesi değişmemeli');
    assert.equal((fb.db.state.financeMoves || []).length, finBefore, 'finans kaydı oluşmamalı');
    assert.match(await p.innerText('#bankFeedTable'), /Faturada/);
    assert.deepEqual(p.errors, []);
    await p.context().close();
  } finally { global.fetch = realFetch; bridge.close(); kopru._isbankReset(); }
});

test('fatura taslağı: gümüşte (808) KDV yalnız işçilikten; mal adı değiştirilebilir', async () => {
  const fb = createFakeFirebase();
  let p = await newDevice(browser, appUrl, fb);
  await p.waitForTimeout(1500);
  const st = fb.db.state, now = new Date().toISOString();
  st.sales = [{ id: 'S-AG', docNo: 'SAT-AG1', status: 'Tamamlandı', period: st.activePeriod, date: now, total: 2400, saleCurrency: 'TL', customerId: '', lines: [{ code: 'GMS', name: '925 AYAR GÜMÜŞ YÜZÜK', karat: '925', unit: 'GR', weight: 10, qty: 10, displayAmount: 10, total: 2400 }], payments: [] }, ...(st.sales || [])];
  st.invoiceSettings = { ...(st.invoiceSettings || {}), silverGramTl: '60' };
  fb.db.state = st; await p.context().close();
  p = await newDevice(browser, appUrl, fb);
  await p.evaluate(() => document.querySelector('[data-go="invoices"],[data-route="invoices"]').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('[data-invoice-view="sales"]')?.click());
  await p.waitForSelector('[data-invoice-draft="S-AG"]');
  await p.evaluate(() => document.querySelector('[data-invoice-draft="S-AG"]').click());
  await p.waitForSelector('[data-inv-name="0"]');
  const lines = await p.innerText('#invDraftBox .invoice-lines tbody');
  // 10 gr × 60 TL = 600 gümüş bedeli; işçilik 1.800 (KDV dahil) → KDV 300, matrah 1.500
  assert.match(lines, /%20[\s\S]*300,00[\s\S]*2\.100,00[\s\S]*808/, 'KDV yalnız işçilikten hesaplanmalı');
  await p.fill('[data-inv-name="0"]', 'GÜMÜŞ KOLYE');
  await p.click('#modalConfirm');
  for (let i = 0; i < 40 && !((fb.db.state.invoiceRecords || []).find((r) => r.saleId === 'S-AG') || {}).lineNames; i++) await p.waitForTimeout(250);
  const rec = fb.db.state.invoiceRecords.find((r) => r.saleId === 'S-AG');
  assert.deepEqual(rec.lineNames, { 0: 'GÜMÜŞ KOLYE' });
  await p.evaluate((id) => document.querySelector(`[data-invoice-open="${id}"]`).click(), rec.id);
  await p.waitForSelector('#invDraftBox .invoice-lines');
  assert.match(await p.innerText('#invDraftBox .invoice-lines tbody'), /GÜMÜŞ KOLYE/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('Banka Hareketleri: daha önce "Yeni Hareket Kaydet" ile bankaya eklenen gelen havale (yedekten dönülse de) geri alınır', async () => {
  const fb = createFakeFirebase();
  let p = await newDevice(browser, appUrl, fb);
  await p.waitForTimeout(1000);
  const st = fb.db.state, acc = st.bankAccounts[0], now = new Date().toISOString();
  acc.balance = 100000;
  st.financeMoves = [{ id: 'FIN-BNK1', period: st.activePeriod, date: now, direction: 'Giriş', type: 'Havale / EFT Tahsilat', accountKind: 'Banka', accountId: acc.id, accountName: acc.bank || acc.name, amount: 60700, accountAmount: 60700, accountCurrency: 'TL', tlAmount: 60700, sourceCategory: 'Banka Ekstresi', sourceDocNo: 'BNK-2026-619592', bankFeedId: 'BF-X1' }, ...(st.financeMoves || [])];
  fb.db.state = st; await p.context().close();
  p = await newDevice(browser, appUrl, fb);
  await p.evaluate((a) => localStorage.setItem('asil_kuyumcu_pro_bankfeed_v1', JSON.stringify([{ id: 'BF-X1', bankId: a, date: new Date().toISOString(), direction: 'Giriş', amount: 60700, description: 'levent doran altin odemesi', reference: '', status: 'Bekliyor', linkedFinanceMoveId: '', fingerprint: 'X1', createdAt: new Date().toISOString(), source: 'CSV' }])), acc.id);
  await p.reload(); await p.waitForTimeout(1500);
  await p.evaluate(() => document.querySelector('[data-go="banking"],[data-route="banking"]').click());
  await p.waitForSelector('[data-bankfeed-undo="BF-X1"]');
  await p.click('[data-bankfeed-undo="BF-X1"]');
  for (let i = 0; i < 40 && (fb.db.state.financeMoves || []).some((f) => f.id === 'FIN-BNK1'); i++) await p.waitForTimeout(250);
  assert.ok(!(fb.db.state.financeMoves || []).some((f) => f.id === 'FIN-BNK1'), 'BNK kaydı silinmeli');
  assert.equal(fb.db.state.bankAccounts.find((b) => b.id === acc.id).balance, 100000 - 60700, 'banka bakiyesi geri alınmalı');
  await p.waitForSelector('[data-bankfeed-invoice="BF-X1"]');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('fatura ayarları: şahıs firmasında Firma VKN alanına 11 haneli TCKN yazılabilir', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  await p.evaluate(() => document.querySelector('[data-go="invoices"],[data-route="invoices"]').click());
  await p.click('[data-invoice-view="settings"]');
  await p.fill('#invVkn', '10000000146'); await p.click('#saveInvoiceSettings');
  for (let i = 0; i < 40 && (fb.db.state.invoiceSettings || {}).companyVkn !== '10000000146'; i++) await p.waitForTimeout(250);
  assert.equal(fb.db.state.invoiceSettings.companyVkn, '10000000146', '11 hane kesilmeden kaydedilmeli');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('personel satış ve prim raporu: personel bazında satış / kâr, prim ayarı kaydedilir ve hesaplanır', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  await p.click('[data-go="sales"]');
  for (let i = 0; i < 3; i++) {
    await p.fill('#saleProductSearch', '22'); await p.waitForTimeout(300); await p.press('#saleProductSearch', 'Enter');
    if (await p.waitForSelector('#saleEntryPrice:not([disabled])', { timeout: 5000 }).catch(() => null)) break;
  }
  await p.waitForTimeout(300);
  await p.fill('#saleEntryPayable', '70000'); await p.click('#saleAddUnified'); await p.waitForTimeout(400);
  await p.click('[data-pay="Nakit"]'); await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.selectOption('#salePerson', { index: 1 });
  const person = await p.$eval('#salePerson', (s) => s.value);
  await p.click('#finalizeSale'); await p.click('#modalConfirm'); await p.waitForTimeout(1500);
  const cb = await p.$('.critical-alert button'); if (cb) await cb.click();
  await p.evaluate(() => document.querySelector('[data-route="reports"],[data-go="reports"]').click());
  await p.click('[data-pusula-report="personnel_sales"]'); await p.waitForSelector('#prResult table');
  const row = async () => p.evaluate((n) => [...document.querySelectorAll('#prResult tbody tr')].map((r) => [...r.cells].map((c) => c.innerText.trim())).find((c) => c[0] === n), person);
  const num = (v) => Number(String(v).replace(/[^\d,-]/g, '').replace(',', '.'));
  let r = await row();
  assert.ok(r, 'satış yapan personel raporda olmalı'); assert.equal(r[1], '1'); assert.equal(num(r[3]), 70000);
  assert.equal(num(r[8]), 0, 'prim ayarı yokken prim 0');
  await p.fill(`[data-prim-rate="${person}"]`, '10');
  await p.click('#primSaveV7'); await p.waitForTimeout(600);
  r = await row();
  assert.ok(Math.abs(num(r[8]) - Math.max(0, num(r[5])) * 0.1) < 0.02, `prim = kârın %10'u (${r[5]} → ${r[8]})`);
  for (let i = 0; i < 40 && !(fb.db.state.primSettingsV7 || {})[person]; i++) await p.waitForTimeout(250);
  assert.deepEqual(fb.db.state.primSettingsV7[person], { type: 'kar', rate: 10 });
  // Ürün grubuna özel oran: satılan ürünün grubunda %20 → o grubun primi genel orana göre değil %20'ye göre
  const grp = await p.evaluate(() => [...document.querySelectorAll('#primGroupTableV7 tbody tr')].map((r) => [...r.cells].map((c) => c.innerText.trim()))[0]);
  assert.ok(grp && grp[0] === person, 'ürün grubu dökümünde satış görünmeli');
  await p.fill(`[data-prim-group="${person}"][data-group="${grp[1]}"]`, '20');
  await p.click('#primSaveV7'); await p.waitForTimeout(600);
  r = await row();
  assert.ok(Math.abs(num(r[8]) - Math.max(0, num(r[5])) * 0.2) < 0.02, `grup oranı %20 uygulanmalı (${r[5]} → ${r[8]})`);
  for (let i = 0; i < 40 && !((fb.db.state.primSettingsV7 || {})[person] || {}).groups; i++) await p.waitForTimeout(250);
  assert.equal(fb.db.state.primSettingsV7[person].groups[grp[1]], 20);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('karanlık tema: Raporlar düğmeleri ve seçili menü okunur (siyah üstüne siyah / beyaz üstüne altın yok)', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.evaluate(() => document.getElementById('darkThemeBtn')?.click());
  await p.evaluate(() => document.querySelector('[data-route="reports"],[data-go="reports"]').click());
  await p.waitForSelector('[data-pusula-report]');
  const lum = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const txt = await p.$eval('[data-pusula-report] strong', (e) => getComputedStyle(e).color);
  assert.ok(lum(txt) > 0.5, 'rapor düğmesi yazısı açık renk olmalı: ' + txt);
  const act = await p.$eval('.nav button.active', (e) => getComputedStyle(e).color);
  assert.ok(lum(act) < 0.2, 'altın zemindeki seçili menü yazısı koyu olmalı: ' + act);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('banka bakiyesi gerçek tutara eşitlenir; kasa değişmez', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  const tlCash = (s) => (s.cashAccounts || []).filter((x) => x.currency === 'TL').reduce((n, x) => n + Number(x.balance || 0), 0);
  const cash0 = tlCash(fb.db.state);
  await p.evaluate(() => document.querySelector('[data-route="customers"],[data-go="customers"]').click());
  await p.waitForTimeout(500);
  const bankName = await p.evaluate(() => { const e = [...document.querySelectorAll('[data-cari-card][data-cari-type="Banka"]')].find((x) => /İŞ BANKASI/.test(x.innerText)); const n = e.querySelector('h3').innerText.trim(); e.querySelector('[data-cari-detail]').click(); return n; });
  await p.waitForSelector('#bankSetBalanceV7');
  await p.click('#bankSetBalanceV7');
  await p.fill('#bankRealBalV7', '26900'); await p.click('#modalConfirm'); await p.waitForTimeout(9000);
  const st = fb.db.state, acc = (st.bankAccounts || []).find((b) => String(b.bank || b.name).includes(bankName) || bankName.includes(String(b.bank || b.name)));
  assert.ok(acc, 'banka hesabı bulunmalı: ' + bankName);
  assert.equal(Math.round(Number(acc.balance)), 26900, 'banka bakiyesi gerçek tutara eşitlenmeli');
  assert.equal(Math.round(tlCash(st)), Math.round(cash0), 'kasa değişmemeli');
  assert.ok((st.financeMoves || []).some((f) => f.type === 'Banka Bakiye Düzeltme' && f.accountId === acc.id), 'düzeltme hareketi görünmeli');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('mahsup iki taraflı: karşı cari zorunlu, tutar karşı cariye ters yazılır, silince ikisi de geri alınır', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  await p.evaluate(() => document.querySelector('[data-route="customers"],[data-go="customers"]').click());
  await p.waitForTimeout(400);
  const aId = await p.evaluate(() => document.querySelector('[data-cari-move]').dataset.cariMove);
  const hasOf = (id) => Number((fb.db.state.customers || []).find((c) => c.id === id)?.hasBalance || 0);
  await p.evaluate(() => document.querySelector('[data-cari-move]').click());
  await p.waitForSelector('#cmType');
  await p.selectOption('#cmType', 'MH'); await p.waitForTimeout(150);
  assert.ok(await p.isVisible('#cmMahsupCari'), 'mahsupta karşı cari alanı görünmeli');
  await p.selectOption('#cmUnit', 'HAS'); await p.fill('#cmAmount', '9.95'); await p.selectOption('#cmSide', 'credit');
  await p.click('#modalConfirm'); await p.waitForTimeout(300);
  assert.ok(!(await p.$('#cariSummaryRoot')), 'karşı cari seçilmeden özet açılmamalı');
  const bId = await p.$$eval('#cmMahsupCari option', (os) => os.map((o) => o.value).filter(Boolean)[0]);
  await p.waitForTimeout(3000);
  const a0 = hasOf(aId), b0 = hasOf(bId);
  await p.selectOption('#cmMahsupCari', bId);
  await p.evaluate(() => document.getElementById('modalConfirm').click()); await p.waitForSelector('#cariSummarySave');
  assert.match(await p.innerText('#cariSummaryRoot'), /Karşı cari/);
  await p.evaluate(() => document.getElementById('cariSummarySave').click()); await p.waitForTimeout(9000);
  assert.equal(Math.round((hasOf(aId) - a0) * 100), -995, 'cari alacaklanmalı');
  assert.equal(Math.round((hasOf(bId) - b0) * 100), 995, 'karşı cari aynı tutarda borçlanmalı');
  const mv = (fb.db.state.customerMoves || []).find((m) => m.customerId === aId && m.code === 'MH');
  assert.ok(mv && mv.pairId, 'mahsup eşli kaydedilmeli');
  if (await p.$('#modalX')) await p.click('#modalX').catch(() => {});
  await p.evaluate((x) => document.querySelector(`[data-cari-card="${x}"] [data-cari-detail]`).click(), aId);
  await p.waitForSelector('#cariEkstreTable');
  await p.evaluate(() => [...document.querySelectorAll('.cari-ekstre-row')].find((r) => /MAHSUP/.test(r.innerText)).click());
  await p.evaluate(() => document.getElementById('selectedCariDelete').click()); await p.waitForSelector('text=Cari Hareketi Sil');
  await p.evaluate(() => document.getElementById('modalConfirm').click());
  await p.waitForTimeout(9000);
  assert.equal(Math.round((hasOf(aId) - a0) * 100), 0, 'silince cari geri dönmeli');
  assert.equal(Math.round((hasOf(bId) - b0) * 100), 0, 'silince karşı cari de geri dönmeli');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('satış ekranı: cari ad yazarak aranır; hızlı yeni cari eklenip seçilir', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.click('[data-go="sales"]'); await p.waitForSelector('#saleCustomerSearch');
  const cust = await p.$$eval('#saleCustomerSelect option', (os) => os.map((o) => ({ v: o.value, t: o.textContent })).find((o) => o.v && o.v !== 'CASH' && !/PEŞİN/i.test(o.t)));
  const namePart = cust.t.split(' · ').find((x) => /[A-Za-zÇĞİÖŞÜçğıöşü]{3}/.test(x)).slice(0, 5);
  await p.fill('#saleCustomerSearch', namePart); await p.press('#saleCustomerSearch', 'Enter'); await p.waitForTimeout(400);
  assert.notEqual(await p.inputValue('#saleCustomerSelect'), 'CASH', 'yazılan isimle cari seçilmeli');
  await p.fill('#saleCustomerSearch', 'xyzqw olmayan'); await p.press('#saleCustomerSearch', 'Enter'); await p.waitForTimeout(400);
  assert.match(await p.innerText('#saleCustomerHint'), /bulunamadı/, 'bulunamayan cari kutunun altında yazmalı');
  assert.ok(!(await p.$('.critical-alert')), 'engelleyici uyarı açılmamalı');
  assert.ok(await p.$('#saleProductSearch'), 'satış ekranı yerinde kalmalı');
  // Cari sayfasının eski kart filtresi bu kutuyu kendi aramasi sanıp satış kartlarını gizliyordu (ekran boşalıyordu).
  for (const sel of ['.sale-head-card', '.sale-product-card', '.sale-payment-card', '.sale-summary']) assert.ok(await p.isVisible(sel), sel + ' görünür kalmalı');
  assert.equal(await p.evaluate(() => document.activeElement?.id), 'saleCustomerSearch', 'odak arama kutusunda kalmalı');
  await p.click('#saleQuickCustomer'); await p.waitForSelector('#qcName');
  await p.fill('#qcName', 'TEST HIZLI CARİ'); await p.fill('#qcPhone', '5551112233');
  await p.click('#modalConfirm'); await p.waitForTimeout(500);
  const sel = await p.$eval('#saleCustomerSelect', (s) => s.options[s.selectedIndex].textContent);
  assert.match(sel, /TEST HIZLI CARİ/, 'yeni cari eklenip seçilmeli');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('satış düzeltmesi yarım kalırsa uyarı + eski hâliyle geri yükleme; iptal edilen satış Silinenler bölümünden geri gelir', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  await p.click('[data-go="sales"]');
  for (let i = 0; i < 3; i++) {
    await p.fill('#saleProductSearch', '22'); await p.waitForTimeout(300); await p.press('#saleProductSearch', 'Enter');
    if (await p.waitForSelector('#saleEntryPrice:not([disabled])', { timeout: 5000 }).catch(() => null)) break;
  }
  await p.waitForTimeout(300);
  await p.fill('#saleEntryPayable', '4321'); await p.click('#saleAddUnified'); await p.waitForTimeout(400);
  await p.click('[data-pay="Nakit"]'); await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.selectOption('#salePerson', { index: 1 });
  await p.click('#finalizeSale'); await p.click('#modalConfirm'); await p.waitForTimeout(1500);
  const b = await p.$('.critical-alert button'); if (b) await b.click();
  // Düzeltmeye aç, sonra Yeni Fiş → uyarı → eski hâliyle geri yükle
  await p.click('text=Satış Geçmişi'); await p.waitForSelector('[data-sale-edit]');
  await p.click('[data-sale-edit]'); await p.click('#modalConfirm'); await p.waitForTimeout(500);
  assert.match(await p.innerText('#saleEditBanner'), /DÜZELTİLİYOR/);
  await p.click('#resetSale'); await p.waitForSelector('text=Düzeltme Yarım Kaldı');
  await p.click('#modalCancel'); await p.waitForTimeout(9000);
  let sales = (fb.db.state.sales || []).filter((x) => /4\.?321|4321/.test(String(x.total)));
  assert.equal(sales.length, 1, 'satış eski hâliyle geri yüklenmeli');
  assert.ok(!(await p.$('#saleEditBanner')), 'geri yüklenince uyarı kalkmalı');
  // İptal et, Silinenler'den geri yükle
  await p.click('text=Satış Geçmişi'); await p.waitForSelector('[data-sale-cancel]');
  await p.evaluate(() => document.querySelector('#saleHistBody [data-sale-cancel]').click()); await p.click('#modalConfirm'); await p.waitForTimeout(500);
  await p.click('text=Satış Geçmişi'); await p.waitForSelector('#saleHistCancelled');
  await p.click('#saleHistCancelled'); await p.waitForSelector('[data-cs-restore]');
  await p.click('[data-cs-restore]'); await p.click('#modalConfirm'); await p.waitForTimeout(9000);
  sales = (fb.db.state.sales || []).filter((x) => Number(x.total) === 4321);
  assert.equal(sales.length, 1, 'iptal edilen satış geri yüklenmeli');
  // Satır tıklanınca ayrıntı penceresi açılır (Düzelt / İptal orada), Esc kapatır
  await p.click('text=Satış Geçmişi'); await p.waitForSelector('#saleHistBody [data-sale-row]');
  await p.click('#saleHistBody [data-sale-row] td:nth-child(2)'); await p.waitForSelector('#saleHistPop #shpEdit');
  assert.ok(await p.isVisible('#shpCancel') && await p.isVisible('#shpPrint'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  assert.ok(!(await p.$('#saleHistPop')), 'Esc pencereyi kapatmalı');
  assert.ok(await p.$('#saleHistBody'), 'satış geçmişi açık kalmalı');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('fiyat panosu ↔ satış ekranı: düğmeyle ve F7 ile geçilir (satışta imleç kutudayken de)', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.click('[data-go="sales"]'); await p.waitForSelector('#saleProductSearch');
  await p.click('#goPriceBoard'); await p.waitForSelector('#priceBoard'); await p.waitForTimeout(300);
  await p.evaluate(() => document.exitFullscreen()); await p.waitForTimeout(300); // tam ekrandan çıkınca (Esc) sayfadaki düğme de çalışır
  await p.click('#goSalesFromBoard'); await p.waitForSelector('#saleProductSearch');
  await p.focus('#saleProductSearch'); await p.keyboard.press('F7'); await p.waitForSelector('#priceBoard'); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => document.fullscreenElement?.id), 'priceBoard', 'F7 fiyat panosunu tam ekran açmalı');
  assert.ok(await p.isVisible('.pb-go-sales'), 'tam ekranda Satışa Geç düğmesi görünmeli');
  await p.keyboard.press('F7'); await p.waitForSelector('#saleProductSearch'); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => document.fullscreenElement), null, 'satışa dönünce tam ekrandan çıkmalı');
  await p.click('#goPriceBoard'); await p.waitForSelector('#priceBoard'); await p.waitForTimeout(300);
  await p.click('.pb-go-sales'); await p.waitForSelector('#saleProductSearch');
  assert.ok(await p.isVisible('.sale-product-card'), 'satış ekranı tam açılmalı');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('satış fişindeki satırın fiyatı sonradan değiştirilir (Fiyat düğmesi)', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.click('[data-go="sales"]'); await p.waitForSelector('#saleProductSearch');
  for (let i = 0; i < 3; i++) {
    await p.fill('#saleProductSearch', '22'); await p.waitForTimeout(300); await p.press('#saleProductSearch', 'Enter');
    if (await p.waitForSelector('#saleEntryPrice:not([disabled])', { timeout: 5000 }).catch(() => null)) break;
  }
  await p.waitForTimeout(300);
  await p.fill('#saleEntryPrice', '2500'); await p.fill('#saleEntryPayable', '7000');
  await p.click('#saleAddUnified'); await p.waitForTimeout(500);
  await p.click('[data-line-price="0"]'); await p.waitForSelector('#slpTotal');
  await p.fill('#slpTotal', '6500'); await p.click('#modalConfirm'); await p.waitForTimeout(400);
  assert.equal(await p.inputValue('[data-lp-total="0"]'), '6500.00', 'yeni tutar fişte görünmeli');
  assert.match(await p.innerText('.sale-summary'), /6\.500,00/, 'toplam da değişmeli');
  // Satırdaki kutuya doğrudan yazıp Enter: ödenecek tutar ve birim fiyat
  await p.fill('[data-lp-total="0"]', '6000'); await p.press('[data-lp-total="0"]', 'Enter'); await p.waitForTimeout(300);
  assert.match(await p.innerText('.sale-summary'), /6\.000,00/, 'kutudan yazılan tutar toplamı değiştirmeli');
  const amt = Number(await p.$eval('[data-lp-total="0"]', (e) => e.value)) / Number(await p.$eval('[data-lp-unit="0"]', (e) => e.value));
  await p.fill('[data-lp-unit="0"]', '2000'); await p.press('[data-lp-unit="0"]', 'Enter'); await p.waitForTimeout(300);
  assert.ok(Math.abs(Number(await p.inputValue('[data-lp-total="0"]')) - 2000 * amt) < 0.02, 'birim fiyat × miktar = tutar');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('yeni hurda stok kartı Hurda Alış/Satış ve takas listesinde çıkar; alış kendi hurda stoğuna işlenir (8 → 18 karışmaz)', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  const newCard = async (name, milyem) => {
    await p.evaluate(() => document.querySelector('[data-route="stocks"],[data-go="stocks"]').click()); await p.waitForTimeout(300);
    await p.evaluate(() => (document.getElementById('newStockCard') || document.querySelector('[data-new-stockcard]')).click());
    await p.waitForSelector('#scProductCode');
    await p.fill('#scProductDefinition', name); await p.fill('#scPurity', milyem); await p.fill('#scFixedMilyem', milyem);
    await p.selectOption('#scUnit12', 'GR');
    await p.click('#modalConfirm'); await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelector('[data-route="dashboard"],[data-go="dashboard"]').click()); await p.waitForTimeout(200);
  };
  await newCard('18 AYAR HURDA', '750'); await newCard('8 AYAR HURDA', '333');
  // Stok kartları listesinde hurdalar kendi grubunda art arda; ürün grubu seçeneklerinde HURDA var
  await p.evaluate(() => document.querySelector('[data-route="stocks"],[data-go="stocks"]').click()); await p.waitForTimeout(300);
  await p.evaluate(() => (document.getElementById('newStockCard') || document.querySelector('[data-new-stockcard]')).click()); await p.waitForSelector('#scProductGroup');
  assert.ok((await p.$$eval('#scProductGroup option', (os) => os.map((o) => o.value))).includes('HURDA'), 'ürün grubunda HURDA olmalı');
  await p.click('#modalX');
  const hurdaGroup = await p.evaluate(() => { const h = [...document.querySelectorAll('.stock-card-group-head')].find((e) => /^HURDA/.test(e.innerText)); const out = []; let n = h && h.nextElementSibling; while (n && !n.classList.contains('stock-card-group-head')) { out.push(n.querySelector('h4')?.innerText.trim()); n = n.nextElementSibling; } return out; });
  assert.deepEqual(hurdaGroup.sort(), ['18 AYAR HURDA', '8 AYAR HURDA'], 'hurda kartları HURDA başlığı altında art arda olmalı');
  await p.evaluate(() => document.querySelector('[data-route="dashboard"],[data-go="dashboard"]').click()); await p.waitForTimeout(200);
  for (const t of ['Hurda Alış', 'Hurda Satış']) {
    await p.click(`[data-home-trade="${t}"]`); await p.waitForSelector('#stItem');
    const opts = await p.$$eval('#stItem option', (os) => os.map((o) => o.textContent));
    assert.ok(opts.includes('18 AYAR HURDA') && opts.includes('8 AYAR HURDA'), t + ' listesinde yeni kartlar olmalı: ' + opts.join(', '));
    await p.click('#modalX');
  }
  // 18 ayar 10 gr alış, sonra 8 ayar 5 gr alış: her biri kendi stoğuna
  for (const [name, gr] of [['18 AYAR HURDA', '10'], ['8 AYAR HURDA', '5']]) {
    await p.click('[data-home-trade="Hurda Alış"]'); await p.waitForSelector('#stItem');
    await p.selectOption('#stItem', { label: name }); await p.waitForTimeout(200);
    assert.ok(Number(await p.inputValue('#stPrice')) > 0, name + ' için fiyat önerilmeli');
    await p.fill('#stQty', gr); await p.fill('#stPrice', '3000'); await p.waitForTimeout(200);
    await p.click('#modalConfirm'); await p.waitForTimeout(800);
    const b = await p.$('.critical-alert button'); if (b) await b.click();
  }
  await p.waitForTimeout(9000);
  const scrap = (fb.db.state.scrapStocks || []).map((x) => [x.name, Number(x.amount)]);
  assert.deepEqual(scrap.find((x) => x[0] === '18 AYAR HURDA'), ['18 AYAR HURDA', 10], 'scrap: ' + JSON.stringify(scrap));
  assert.deepEqual(scrap.find((x) => x[0] === '8 AYAR HURDA'), ['8 AYAR HURDA', 5], '8 ayar 18 ayara karışmamalı: ' + JSON.stringify(scrap));
  assert.deepEqual(p.errors, []);
  await p.context().close();
});


test('satış ekranı Altın / Ziynet: klavyeyle art arda kalem girilir (ürün Enter, miktar Enter, fiyat Enter, toplam Enter), pencere kapanmaz', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.click('[data-go="sales"]'); await p.waitForSelector('#saleProductSearch');
  await p.click('[data-pay="Altın / Ziynet"]'); await p.waitForSelector('#tiSearch');
  await p.waitForFunction(() => document.activeElement?.id === 'tiSearch', null, { timeout: 2000 }); // imleç ürün kutusunda başlamalı
  for (const [name, n, price] of [['ceyrek', '2', '10000'], ['YARIM', '1', '20000']]) {
    await p.keyboard.type(name); await p.keyboard.press('Enter');
    assert.equal(await p.evaluate(() => document.activeElement?.id), 'tiQty');
    await p.keyboard.press('Control+A'); await p.keyboard.type(n); await p.keyboard.press('Enter');
    assert.equal(await p.evaluate(() => document.activeElement?.id), 'tiPrice');
    await p.keyboard.press('Control+A'); await p.keyboard.type(price); await p.keyboard.press('Enter');
    assert.equal(await p.evaluate(() => document.activeElement?.id), 'tiTotal', 'fiyattan sonra Enter toplam tutara geçmeli');
    assert.match(await p.innerText('#tiList'), name === 'ceyrek' ? /Henüz kalem yok/ : /CEYREK/, 'fiyatta Enter kalemi eklememeli');
    await p.keyboard.press('Enter'); await p.waitForTimeout(200);
    assert.ok(await p.$('#tiSearch'), 'pencere açık kalmalı');
    await p.waitForFunction(() => document.activeElement?.id === 'tiSearch', null, { timeout: 2000 }); // sonraki ürün için imleç ürün kutusuna dönmeli
  }
  const list = await p.innerText('#tiList');
  assert.match(list, /CEYREK[\s\S]*20\.000,00/); assert.match(list, /YARIM[\s\S]*20\.000,00/); assert.match(list, /40\.000,00/, 'toplam');
  await p.keyboard.press('Enter'); await p.waitForTimeout(300); // boş ürün kutusunda Enter = bitti
  assert.ok(!(await p.$('#tiSearch')), 'boş Enter ile pencere kapanmalı');
  assert.match(await p.innerText('.sale-payment-card'), /CEYREK[\s\S]*YARIM|YARIM[\s\S]*CEYREK/, 'iki kalem ödemelerde olmalı');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('satış raporu: kart komisyonu düşülür, hurda kârı eklenir ve NET KÂR gösterilir', async () => {
  const fb = createFakeFirebase();
  let p = await newDevice(browser, appUrl, fb);
  await p.waitForTimeout(2500);
  const st = fb.db.state; st.bankAccounts.forEach((x) => { x.posCommission = 2; }); fb.db.state = st;
  await p.context().close();
  p = await newDevice(browser, appUrl, fb);
  await p.click('[data-go="sales"]');
  for (let i = 0; i < 3; i++) {
    await p.fill('#saleProductSearch', '22'); await p.waitForTimeout(300); await p.press('#saleProductSearch', 'Enter');
    if (await p.waitForSelector('#saleEntryPrice:not([disabled])', { timeout: 5000 }).catch(() => null)) break;
  }
  await p.waitForTimeout(300);
  await p.fill('#saleEntryPayable', '70000'); await p.click('#saleAddUnified'); await p.waitForTimeout(400);
  await p.click('[data-pay="Kredi Kartı"]'); await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.selectOption('#salePerson', { index: 1 });
  await p.click('#finalizeSale'); await p.click('#modalConfirm'); await p.waitForTimeout(1500);
  await p.evaluate(() => document.querySelector('[data-route="reports"],[data-go="reports"]').click());
  await p.click('[data-pusula-report="sales_general"]');
  await p.waitForSelector('#prResult table');
  await p.selectOption('#prUnit', 'TL');
  await p.waitForFunction(() => /NET KÂR/.test(document.querySelector('#prResult')?.innerText || ''));
  const t = await p.innerText('#prResult');
  assert.match(t, /Kart Komisyonu\s*− 1\.400,00 TL/);
  const num = (label) => Number(t.match(new RegExp(label + '\\s*([\\d.,]+) TL'))[1].replace(/\./g, '').replace(',', '.'));
  assert.ok(Math.abs(num('Brüt Kâr') - 1400 - num('NET KÂR')) < 0.01, 'net = brüt − komisyon');
  // Banka carisi ekstresi: kart tahsilatı brüt 70.000 + ayrı POS komisyonu 1.400 satırı (bakiye net)
  await p.evaluate(() => document.querySelector('[data-route="customers"],[data-go="customers"]').click());
  await p.waitForTimeout(500);
  const banks = await p.$$eval('[data-cari-card][data-cari-type="Banka"]', (a) => a.map((e) => e.dataset.cariCard));
  let ext = '';
  for (const id of banks) {
    await p.evaluate((x) => document.querySelector(`[data-cari-card="${x}"] [data-cari-detail]`).click(), id);
    await p.waitForTimeout(500);
    ext = await p.innerText('#modalRoot').catch(() => '');
    if (/POS Komisyonu/.test(ext)) break;
    await p.evaluate(() => document.getElementById('modalRoot')?.remove());
  }
  assert.match(ext, /Kredi Kartı Tahsilat\tTL\t70\.000\t/);
  assert.match(ext, /POS Komisyonu %2\tTL\t—\t1\.400\t/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('ALTIN STOKLARI: stoğu olmayan açık stok ve hurda kartları listede görünmez', async () => {
  const fb = createFakeFirebase();
  let p = await newDevice(browser, appUrl, fb);
  await p.waitForTimeout(2500);
  const st = fb.db.state;
  const o = st.openStocks.find((x) => x.period === st.activePeriod);
  st.openStocks.push({ ...o, id: 'OPEN-SIFIR-TEST', name: 'SIFIR STOK KARTI', amount: 0, hasWeight: 0, workmanshipTotalHas: 0 });
  st.openStocks.push({ ...o, id: 'OPEN-KUSURAT-TEST', name: 'KUSURAT STOK KARTI', amount: 0.001, hasWeight: 0.0009, workmanshipTotalHas: 0 });
  st.scrapStocks = st.scrapStocks || [];
  st.scrapStocks.push({ id: 'SCR-SIFIR-TEST', period: st.activePeriod, name: 'SIFIR HURDA KARTI', milyem: 585, amount: 0, hasWeight: 0 });
  fb.db.state = st;
  await p.context().close();
  p = await newDevice(browser, appUrl, fb);
  await p.keyboard.press('F9');
  await p.waitForSelector('table.gold-stock-v7');
  const t = await p.innerText('table.gold-stock-v7');
  assert.ok(t.includes(o.name), 'stoğu olan kart görünmeli');
  assert.ok(!t.includes('SIFIR STOK KARTI'), 'sıfır açık stok gizlenmeli');
  assert.ok(!t.includes('KUSURAT STOK KARTI'), '0,00 görünen kuruş artığı da gizlenmeli');
  assert.ok(!t.includes('SIFIR HURDA KARTI'), 'sıfır hurda gizlenmeli');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('ALTIN STOKLARI: çeyrek ve yarımın HAS değeri milyemden (1605 / 3210) hesaplanır; bozuk birikmiş HAS düzelir', async () => {
  const fb = createFakeFirebase();
  let p = await newDevice(browser, appUrl, fb);
  await p.waitForTimeout(2500);
  const st = fb.db.state;
  const o = st.openStocks.find((x) => x.period === st.activePeriod);
  st.openStocks = st.openStocks.filter((x) => !(x.period === st.activePeriod && /^(CEYREK|YARIM)$/i.test(String(x.pusulaCode || x.productCode || ''))));
  st.openStocks.push({ ...o, id: 'OPEN-CEY-T', name: 'CEYREK', pusulaCode: 'CEYREK', productCode: 'CEYREK', unit: 'ADET', amount: 10, count: 10, hasWeight: 11.2446, displayAyar: 916, purity: 916, zGram: 1.2276, workmanshipTotalHas: 0 });
  st.openStocks.push({ ...o, id: 'OPEN-YAR-T', name: 'YARIM', pusulaCode: 'YARIM', productCode: 'YARIM', unit: 'ADET', amount: 6, count: 6, hasWeight: 12.3699, displayAyar: 916, purity: 916, zGram: 2.25, workmanshipTotalHas: 0 });
  st.openStocks.push({ ...o, id: 'OPEN-CBL-T', name: 'CEYREK BİLEKLİK', pusulaCode: 'CBL', productCode: 'CBL', unit: 'ADET', amount: 2, count: 2, hasWeight: 3.21, displayAyar: 1605, workmanshipTotalHas: 0 });
  fb.db.state = st;
  await p.context().close();
  p = await newDevice(browser, appUrl, fb);
  await p.keyboard.press('F9');
  await p.waitForSelector('table.gold-stock-v7');
  const row = async (name) => p.evaluate((n) => [...document.querySelectorAll('table.gold-stock-v7 tr')].map((r) => [...r.cells].map((c) => c.innerText.trim())).find((c) => c[0] === n), name);
  const num = (v) => Number(String(v).replace(/\./g, '').replace(',', '.'));
  const c = await row('CEYREK'), y = await row('YARIM'), b = await row('CEYREK BİLEKLİK');
  // Aynı adlı açık stoklar tek satırda toplanır: HAS = toplam adet × milyem / 1000
  assert.equal(num(c[1]), 1605); assert.ok(Math.abs(num(c[3]) - num(c[2]) * 1.605) < 0.011, 'çeyrek: adet × 1,605 HAS');
  assert.equal(num(y[1]), 3210); assert.ok(Math.abs(num(y[3]) - num(y[2]) * 3.21) < 0.011, 'yarım: adet × 3,21 HAS');
  assert.equal(num(b[3]).toFixed(2), '3.21', 'çeyrek bileklik değişmemeli');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('Altın / Ziynet: yazarken ürün listesi açılır; ok tuşu ve Enter ile seçilir', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.click('[data-go="sales"]');
  await p.click('[data-pay="Altın / Ziynet"]'); await p.waitForSelector('#tiSearch');
  await p.click('#tiSearch');
  await p.keyboard.type('CEY');
  await p.waitForSelector('#tiSuggest [data-ti-sug]', { state: 'visible' });
  const names = await p.$$eval('#tiSuggest [data-ti-sug] b', (os) => os.map((o) => o.textContent));
  assert.ok(names.length > 1, 'liste açılmalı: ' + names.join(', '));
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.activeElement?.id === 'tiQty', null, { timeout: 2000 });
  assert.equal(await p.inputValue('#tiSearch'), names[1], 'ok tuşuyla seçilen ürün alınmalı');
  assert.ok(!(await p.isVisible('#tiSuggest')), 'seçimden sonra liste kapanmalı');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('HURDA → BARKODLU: hurda düşer, yeni barkodlu ürün hurdanın maliyetiyle stoğa girer', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  const scrap0 = fb.db.state.scrapStocks.find((x) => x.name === '14 HURDASI' && x.period === fb.db.state.activePeriod);
  await p.evaluate(() => document.querySelector('[data-go="operations"],[data-route="operations"]').click());
  await p.click('#v5H2B'); await p.waitForSelector('#h2bScrap');
  await p.selectOption('#h2bScrap', scrap0.id);
  assert.equal(await p.inputValue('#h2bPurity'), '585', 'hurdanın milyemine en yakın ayar seçilmeli');
  const kyuMax = Math.max(0, ...fb.db.state.stocks.map((x) => String(x.code || '').match(/^KYU0*(\d+)$/i)).filter(Boolean).map((m) => Number(m[1])));
  await p.selectOption('#h2bKind', 'KYU');
  const expected = 'KYU' + String(kyuMax + 1).padStart(7, '0');
  assert.equal(await p.inputValue('#h2bCode'), expected, 'grup seçince sistemdeki son KYU numarasının bir fazlası gelmeli');
  await p.fill('#h2bGram', '9.5'); await p.fill('#h2bName', 'hurda bilezik');
  assert.match(await p.innerText('#h2bInfo'), /Fire yok/);
  await p.click('#h2bLabel'); // etiket basma
  await p.click('#modalConfirm'); await p.waitForTimeout(300);
  assert.ok(await p.$('#h2bSale'), 'satış HAS girilmeden ürün oluşmamalı');
  await p.fill('#h2bLabour', '0.1'); // satış HAS = 9,5 × (0,585 + 0,100)
  assert.equal(await p.inputValue('#h2bSale'), (9.5 * (0.585 + 0.1)).toFixed(3));
  assert.match(await p.innerText('#h2bInfo'), /Kâr/);
  await p.dispatchEvent('#modalConfirm', 'click');
  await p.waitForTimeout(4000);
  const st = fb.db.state;
  const rec = st.stocks.find((x) => /HURDA B[İI]LEZ[İI]K/.test(x.name));
  assert.ok(rec, 'barkodlu ürün oluşmalı');
  assert.equal(rec.status, 'Stokta'); assert.equal(rec.purity, '585'); assert.equal(Number(rec.grossWeight), 9.5);
  assert.equal(rec.barcode, expected); assert.equal(rec.code, expected); assert.equal(rec.group, 'KYU'); assert.equal(Number(rec.saleHas), Number((9.5 * (0.585 + 0.1)).toFixed(3)));
  const scrap1 = st.scrapStocks.find((x) => x.id === scrap0.id);
  assert.ok(Math.abs(Number(scrap1.amount) - (Number(scrap0.amount) - 9.5)) < 1e-6, 'hurdadan ürün gramı kadar düşmeli (fire yok)');
  const usedHas = Number(scrap0.hasWeight) - Number(scrap1.hasWeight);
  assert.ok(Math.abs(Number(rec.costHas) - usedHas) < 1e-6, 'ürün maliyeti kullanılan hurdanın HAS maliyeti olmalı');
  assert.ok(Math.abs(Number(rec.hasWeight) - usedHas) < 1e-6, 'ürünün HAS\'ı hurdadaki gerçek HAS (ayar farkı kazancı yok)');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('Döviz Alış: SAR listede çıkar, kur gelir ve SAR kasasına işlenir', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  const sar0 = (fb.db.state.cashAccounts || []).filter((x) => x.currency === 'SAR').reduce((n, x) => n + Number(x.balance || 0), 0);
  await p.click('[data-home-trade="Döviz Alış"]');
  const opts = await p.$$eval('#stFx option', (os) => os.map((o) => o.value));
  assert.ok(opts.includes('SAR'), 'SAR listede olmalı: ' + opts.join(','));
  await p.selectOption('#stFx', 'SAR');
  assert.ok(Number(await p.inputValue('#stPrice')) > 1, 'SAR kuru gelmeli');
  assert.ok((await p.$$eval('#stFxAccount option', (os) => os.map((o) => o.textContent))).some((t) => /SAR/.test(t)), 'SAR kasası seçilebilmeli');
  await p.fill('#stQty', '100'); await p.fill('#stTotal', '1300');
  await p.click('#modalConfirm');
  await p.click('text=ONAYLA VE İŞLEMİ TAMAMLA');
  await p.waitForTimeout(4000);
  const sar1 = (fb.db.state.cashAccounts || []).filter((x) => x.currency === 'SAR').reduce((n, x) => n + Number(x.balance || 0), 0);
  assert.ok(Math.abs(sar1 - sar0 - 100) < 1e-6, 'SAR kasası 100 artmalı');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('cari işlem: tutar yazarken binlik noktalar kendiliğinden konur, kayıt doğru tutarla yapılır', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  await p.evaluate(() => document.querySelector('[data-route="customers"],[data-go="customers"]').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('[data-cari-move]').click());
  await p.waitForSelector('#cmType');
  await p.selectOption('#cmType', 'NT'); await p.selectOption('#cmUnit', 'TL');
  await p.click('#cmAmount'); await p.keyboard.press('Control+A'); await p.keyboard.type('1250000');
  const shown = () => p.$eval('#cmAmount', (e) => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').get.call(e));
  assert.equal(await shown(), '1.250.000', 'yazarken binlik nokta konmalı');
  await p.keyboard.type(',5');
  assert.equal(await shown(), '1.250.000,5');
  assert.equal(await p.$eval('#cmAmount', (e) => e.value), '1250000.5', 'program düz sayıyı okumalı');
  await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace');
  await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace');
  assert.equal(await shown(), '12.500');
  await p.keyboard.type('.75'); // nokta tuşu ondalık virgül olur
  assert.equal(await shown(), '12.500,75');
  assert.equal(await p.$eval('#cmAmount', (e) => e.value), '12500.75');
  // TL'de "102.032" yazılırsa (nokta tuşu virgül olur → 102,032) kutudan çıkınca 102.032 TL okunur; HAS karşılığı buna göre
  await p.check('#cmCounterEnabled'); await p.selectOption('#cmCounterUnit', 'HAS');
  await p.click('#cmAmount'); await p.keyboard.press('Control+A'); await p.keyboard.type('102.032');
  assert.equal(await shown(), '102,032');
  await p.click('#cmSourceRate'); await p.waitForTimeout(200);
  assert.equal(await p.$eval('#cmAmount', (e) => e.value), '102032', '3 haneli kuruş TL\'de binlik sayılmalı');
  assert.match(await p.innerText('#cmAmountRead'), /102\.032 TL/);
  const rate = Number(await p.$eval('#cmCounterRate', (e) => e.value)), ctr = Number(await p.$eval('#cmCounterAmount', (e) => e.value));
  assert.ok(Math.abs(ctr - 102032 / rate) < 0.002, `HAS karşılığı tutara göre: ${ctr} vs ${102032 / rate}`);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('satış: ATA ÇEYREK fiyatı Ata Lira fiyatıyla gelmez, adet başı HAS oranıyla hesaplanır', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  await p.click('[data-go="sales"]'); await p.waitForSelector('#saleProductSearch');
  for (let i = 0; i < 3; i++) {
    await p.fill('#saleProductSearch', 'ATA CEYREK'); await p.waitForTimeout(300); await p.press('#saleProductSearch', 'Enter');
    if (await p.waitForSelector('#saleEntryPrice:not([disabled])', { timeout: 5000 }).catch(() => null)) break;
  }
  await p.waitForTimeout(300);
  const price = Number(await p.inputValue('#saleEntryPrice'));
  const st = fb.db.state, ata = st.prices.items.find((x) => x.code === 'ATA');
  assert.ok(price > 0 && price < Number(ata.sell) * 0.4, `ATA ÇEYREK fiyatı (${price}) Ata Lira (${ata.sell}) fiyatı olmamalı`);
  assert.ok(price > Number(ata.sell) * 0.2, `ATA ÇEYREK fiyatı çeyrek liraya yakın olmalı (${price})`);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('HURDA → BARKODLU: 24 hurdadan aynı gramda 24 ayar ürün yapılabilir (küçük ayar farkı engel olmaz)', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  const scrap = fb.db.state.scrapStocks.find((x) => x.name === '24 HURDASI' && x.period === fb.db.state.activePeriod);
  await p.evaluate(() => document.querySelector('[data-go="operations"],[data-route="operations"]').click());
  await p.click('#v5H2B'); await p.waitForSelector('#h2bScrap');
  await p.selectOption('#h2bScrap', scrap.id); await p.selectOption('#h2bKind', 'KYU');
  await p.selectOption('#h2bPurity', '995');
  await p.fill('#h2bGram', '1'); await p.fill('#h2bSale', '1.1');
  await p.click('#h2bLabel');
  await p.click('#modalConfirm'); await p.waitForTimeout(4000);
  const rec = fb.db.state.stocks.find((x) => x.group === 'KYU' && /HURDA/.test(String(x.sourceDocNo || '') + String(x.notes || '')) && Number(x.grossWeight) === 1);
  assert.ok(rec, 'ürün oluşmalı');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('Altın / Ziynet listesi: silinmiş kartlardan kalan sıfır stoklu satırlar görünmez', async () => {
  const fb = createFakeFirebase();
  let p = await newDevice(browser, appUrl, fb);
  await p.waitForTimeout(2500);
  const st = fb.db.state;
  const o = st.openStocks.find((x) => x.period === st.activePeriod && x.unit === 'ADET');
  st.openStocks.push({ ...o, id: 'OPEN-ESKI', name: 'ESKI SILINMIS ZIYNET', amount: 0, hasWeight: 0, stockCardId: 'SILINMIS-KART' });
  st.scrapStocks.push({ id: 'SCR-ESKI', period: st.activePeriod, name: 'ESKI SILINMIS HURDA', milyem: 585, amount: 0, hasWeight: 0 });
  st.openStocks.push({ id: 'OPEN-KARTLI', period: st.activePeriod, name: 'KARTLI SIFIR ZIYNET', unit: 'ADET', purity: 916, amount: 0, hasWeight: 0, pusulaCode: '9991' });
  st.stockCardsMaster.push({ id: 'CARD-KARTLI', name: 'KARTLI SIFIR ZIYNET', productDefinition: 'KARTLI SIFIR ZIYNET', productGroup: 'ZİYNET' });
  fb.db.state = st;
  await p.context().close();
  p = await newDevice(browser, appUrl, fb);
  await p.click('[data-go="sales"]'); await p.waitForSelector('#saleProductSearch');
  await p.click('[data-pay="Altın / Ziynet"]'); await p.waitForSelector('#tiSearch');
  await p.fill('#tiSearch', 'ESKI'); await p.waitForTimeout(300);
  const names = await p.$$eval('#tiSuggest [data-ti-sug] b', (os) => os.map((x) => x.textContent));
  assert.ok(!names.some((n) => /SILINMIS/.test(n)), 'silinmiş kart satırları listede olmamalı: ' + names.join(', '));
  await p.fill('#tiSearch', 'CEY'); await p.waitForSelector('#tiSuggest [data-ti-sug]');
  assert.ok((await p.$$eval('#tiSuggest [data-ti-sug] b', (os) => os.map((x) => x.textContent))).length > 0, 'stoğu olan ürünler görünmeli');
  // Kartı duran ürün stoğu sıfır olsa da listede kalır (stoğa ürün alınabilsin).
  await p.fill('#tiSearch', 'KARTLI SIFIR'); await p.waitForSelector('#tiSuggest [data-ti-sug]');
  assert.ok((await p.$$eval('#tiSuggest [data-ti-sug] b', (os) => os.map((x) => x.textContent))).some((n) => /KARTLI SIFIR ZIYNET/.test(n)), 'kartı olan sıfır stoklu ürün görünmeli');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('Altın / Ziynet listesi: aynı ürün (24 Ayar 1 Gram, Çeyrek) iki kez görünmez', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.click('[data-go="sales"]'); await p.waitForSelector('#saleProductSearch');
  await p.click('[data-pay="Altın / Ziynet"]'); await p.waitForSelector('#tiSearch');
  for (const [q, name] of [['24 Ayar 1', /^24 AYAR 1 GRAM$/i], ['CEYREK', /^(Ç|C)EYREK$/i]]) {
    await p.fill('#tiSearch', q); await p.waitForSelector('#tiSuggest [data-ti-sug]');
    const names = await p.$$eval('#tiSuggest [data-ti-sug] b', (os) => os.map((x) => x.textContent.trim()));
    assert.equal(names.filter((n) => name.test(n)).length, 1, `${q} tek satır olmalı: ${names.join(', ')}`);
  }
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('bulut girişi: Şifremi unuttum, e-postaya şifre yenileme isteği gönderir', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  const sent = [];
  p.on('request', (r) => { if (r.url().includes('accounts:sendOobCode')) sent.push(JSON.parse(r.postData() || '{}')); });
  await p.click('[data-go="backup"]');
  await p.click('#cloudAuthOpen');
  await p.fill('#caApiKey', 'AIzaTEST'); await p.fill('#caEmail', 'magaza@test.com');
  await p.click('#caReset');
  await p.waitForFunction(() => document.getElementById('toast-root').innerText.includes('yenileme bağlantısı'), null, { timeout: 10000 });
  assert.deepEqual(sent, [{ requestType: 'PASSWORD_RESET', email: 'magaza@test.com' }]);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('Altın / Ziynet listesi: hurdaların iç kayıt numarası (SCR-…) görünmez ve aramayı karıştırmaz', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  await p.click('[data-go="sales"]'); await p.waitForSelector('#saleProductSearch');
  await p.click('[data-pay="Altın / Ziynet"]'); await p.waitForSelector('#tiSearch');
  await p.fill('#tiSearch', 'HURDA'); await p.waitForSelector('#tiSuggest [data-ti-sug]');
  const rows = await p.$$eval('#tiSuggest [data-ti-sug]', (os) => os.map((x) => x.textContent));
  assert.ok(rows.length && rows.every((t) => !/SCR[-:]/.test(t)), 'iç numara görünmemeli: ' + rows.join(' | '));
  const scrapIds = fb.db.state.scrapStocks.map((x) => String(x.id));
  const digits = (scrapIds.join('').match(/\d{2}/) || ['17'])[0];
  await p.fill('#tiSearch', digits); await p.waitForTimeout(300);
  const hits = await p.$$eval('#tiSuggest [data-ti-sug] b', (os) => os.map((x) => x.textContent));
  assert.ok(!hits.some((n) => /HURDA/i.test(n) && !n.includes(digits)), `"${digits}" araması iç numaradan hurda getirmemeli: ` + hits.join(', '));
  // Hurda yine adıyla seçilir.
  await p.fill('#tiSearch', '14 HURDASI'); await p.press('#tiSearch', 'Enter');
  await p.waitForFunction(() => document.activeElement?.id === 'tiQty', null, { timeout: 2000 });
  assert.match(await p.inputValue('#tiSearch'), /14 HURDASI/i);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('fatura: gelen havale fatura ekranına düşer; 100.000 TL → özel matrah (98.000 altın + 2.000 KDV dahil işçilik), toptan → istisna', async () => {
  const fb = createFakeFirebase();
  let p = await newDevice(browser, appUrl, fb);
  await p.waitForTimeout(2500);
  const st = fb.db.state;
  const bank = st.bankAccounts[0];
  st.financeMoves = st.financeMoves || [];
  st.financeMoves.unshift({ id: 'FIN-HAVALE-TEST', period: st.activePeriod, date: new Date().toISOString(), direction: 'Giriş', type: 'Havale / EFT Tahsilat', accountKind: 'Banka', accountId: bank.id, accountName: bank.bank || bank.name, amount: 100000, accountAmount: 100000, accountCurrency: 'TL', tlAmount: 100000, customer: 'AHMET YILMAZ', description: 'altın bedeli' });
  fb.db.state = st;
  await p.context().close();
  p = await newDevice(browser, appUrl, fb);
  let sent = null;
  await p.context().route('https://fatura.test/api', async (r) => { sent = JSON.parse(r.request().postData()); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'Gönderildi', invoiceNo: 'TST2026000000009' }) }); });
  await p.evaluate(() => document.querySelector('[data-go="invoices"],[data-route="invoices"]').click());
  await p.click('[data-invoice-view="settings"]');
  await p.fill('#invVkn', '2530152458'); await p.fill('#invProxy', 'https://fatura.test/api'); await p.click('#saveInvoiceSettings');
  await p.click('[data-invoice-view="havale"]');
  await p.waitForSelector('[data-havale-invoice="FIN-HAVALE-TEST"]');
  await p.click('[data-havale-invoice="FIN-HAVALE-TEST"]');
  await p.waitForSelector('#hiGold');
  assert.equal(await p.inputValue('#hiName'), 'AHMET YILMAZ');
  await p.fill('#hiTckn', '12345678950');
  await p.fill('#hiGold', '98000');
  const info = await p.innerText('#hiInfo');
  assert.match(info, /2\.000,00/); assert.match(info, /1\.666,67/); assert.match(info, /333,33/);
  let lines = await p.innerText('#hiPreview .invoice-lines tbody');
  assert.match(lines, /22 AYAR ALTIN[\s\S]*%20[\s\S]*333,33[\s\S]*99\.666,67[\s\S]*805/, 'tek satır: altın + işçilik, KDV yalnız işçilikten, 805');
  assert.doesNotMatch(lines, /İŞÇİLİK/);
  assert.match(await p.innerText('#hiPreview'), /ÖZEL MATRAH/);
  // Toptan → istisna, işçiliksiz
  await p.selectOption('#hiType', 'ISTISNA'); await p.waitForTimeout(200);
  lines = await p.innerText('#hiPreview .invoice-lines tbody');
  assert.match(lines, /22 AYAR ALTIN[\s\S]*%0[\s\S]*100\.000,00[\s\S]*230/);
  assert.equal(await p.$eval('#hiGold', (e) => e.disabled), true);
  await p.selectOption('#hiType', 'OZELMATRAH'); await p.waitForTimeout(200);
  await p.click('#modalConfirm'); await p.waitForTimeout(300);
  // Havale listeden düşer, kayıtlarda görünür; gönderim istisna satırlarıyla gider.
  await p.click('[data-invoice-view="havale"]');
  assert.equal(await p.$('[data-havale-invoice="FIN-HAVALE-TEST"]'), null, 'faturalanan havale listeden düşmeli');
  await p.click('[data-invoice-view="records"]');
  await p.click('[data-invoice-send]'); await p.waitForTimeout(1500);
  assert.ok(sent, 'entegratöre gönderilmeli');
  assert.equal(sent.invoiceType, 'OZELMATRAH');
  assert.equal(sent.receiver.tckn, '12345678950');
  assert.deepEqual(sent.sale.lines.map((x) => [x.name, x.total, x.vatRate, x.vatAmount, x.exemptionCode, x.specialBase]), [['22 AYAR ALTIN', 99666.67, 20, 333.33, '805', 1666.67]]);
  assert.match(await p.innerText('body'), /TST2026000000009/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('fatura: İşNet köprüsü — bağlantı testi, havale faturası gönderimi ve XML indirme', async () => {
  const http = require('http');
  const kopru = require('../../kopru/asil-kopru.js');
  const realFetch = global.fetch, soap = [];
  global.fetch = async (url, opt) => {
    const name = /\/(\w+)"$/.exec(opt.headers.SOAPAction)[1]; soap.push({ name, body: opt.body });
    const ok = '<a:Result>Success</a:Result>';
    const body = { HealthCheck: '<HealthCheckResult>true</HealthCheckResult>', GetCompanyBalance: ok + '<a:Balance>500</a:Balance>',
      SendArchiveInvoice: ok + '<a:ArchiveInvoiceNumber>YEK2026000000077</a:ArchiveInvoiceNumber><a:Ettn>ettn-77</a:Ettn>',
      GetDocumentViewerLink: ok + '<a:DocumentViewerLink>http://viewer.test/77</a:DocumentViewerLink>',
      SearchArchiveInvoice: ok + '<a:InvoiceXml>' + Buffer.from('<Invoice>230</Invoice>').toString('base64') + '</a:InvoiceXml>' }[name] || ok;
    return { ok: true, status: 200, text: async () => `<r>${body}</r>` };
  };
  const cfg = { mode: 'test', vkn: '4810173324', baseUrl: 'https://isnet.test', allowedOrigins: [] };
  const bridge = http.createServer((q, s) => kopru.handle(cfg, q, s));
  await new Promise((r) => bridge.listen(0, '127.0.0.1', r));
  const bridgeUrl = `http://127.0.0.1:${bridge.address().port}`;
  try {
    const fb = createFakeFirebase();
    let p = await newDevice(browser, appUrl, fb);
    await p.waitForTimeout(2500);
    const st = fb.db.state, bank = st.bankAccounts[0];
    st.financeMoves.unshift({ id: 'FIN-KOPRU', period: st.activePeriod, date: new Date().toISOString(), direction: 'Giriş', type: 'Havale / EFT Tahsilat', accountKind: 'Banka', accountId: bank.id, accountName: bank.bank || bank.name, amount: 100000, accountAmount: 100000, accountCurrency: 'TL', tlAmount: 100000, customer: 'AYŞE KAYA', description: '' });
    fb.db.state = st;
    await p.context().close();
    p = await newDevice(browser, appUrl, fb);
    await p.evaluate(() => document.querySelector('[data-go="invoices"],[data-route="invoices"]').click());
    await p.click('[data-invoice-view="settings"]');
    await p.fill('#invVkn', '2530152458'); await p.fill('#invProxy', bridgeUrl); await p.click('#saveInvoiceSettings');
    await p.click('#invTestBridge');
    await p.waitForFunction(() => /Kontör/.test(document.getElementById('invBridgeInfo')?.innerText || ''), null, { timeout: 5000 });
    const info = await p.innerText('#invBridgeInfo');
    assert.match(info, /Köprü çalışıyor/); assert.match(info, /TEST/); assert.match(info, /bağlı/); assert.match(info, /500/);
    await p.click('[data-invoice-view="havale"]');
    await p.click('[data-havale-invoice="FIN-KOPRU"]'); await p.waitForSelector('#hiGold');
    await p.fill('#hiTckn', '11111111111'); await p.fill('#hiGold', '98000');
    await p.click('#modalConfirm'); await p.waitForTimeout(300);
    await p.click('[data-invoice-view="records"]');
    await p.click('[data-invoice-send]');
    await p.waitForSelector('[data-invoice-xml]', { timeout: 5000 });
    const row = await p.innerText('table.table tbody tr');
    assert.match(row, /Gönderildi/); assert.match(row, /YEK2026000000077/);
    const send = soap.find((x) => x.name === 'SendArchiveInvoice');
    assert.ok(send, 'e-Arşiv gönderilmeli');
    assert.match(send.body, /<a:InvoiceType>OZELMATRAH<\/a:InvoiceType>/);
    assert.match(send.body, /<a:SpecialBasisAmount>1666.67<\/a:SpecialBasisAmount><a:SpecialBasisReasonCode>805<\/a:SpecialBasisReasonCode>/);
    assert.match(send.body, /<a:TotalPayableAmount>100000.00<\/a:TotalPayableAmount>/);
    for (let i = 0; i < 60 && !(fb.db.state.invoiceRecords || []).some((r) => r.sentDocumentType); i++) await p.waitForTimeout(250);
    assert.equal((fb.db.state.invoiceRecords || []).find((r) => r.kind === 'havale')?.sentDocumentType, 'EARSIV');
    const dl = p.waitForEvent('download');
    await p.click('[data-invoice-xml]');
    const d = await dl;
    assert.equal(d.suggestedFilename(), 'YEK2026000000077.xml');
    assert.deepEqual(p.errors, []);
    await p.context().close();
  } finally {
    global.fetch = realFetch; bridge.close();
  }
});

test('fatura: gönderim öncesi kontrol — geçersiz TCKN durdurur, 7 günden eski satış uyarı ister', async () => {
  const fb = createFakeFirebase();
  let p = await newDevice(browser, appUrl, fb);
  await p.waitForTimeout(2500);
  const st = fb.db.state, bank = st.bankAccounts[0];
  st.financeMoves.unshift({ id: 'FIN-ESKI', period: st.activePeriod, date: new Date(Date.now() - 10 * 864e5).toISOString(), direction: 'Giriş', type: 'Havale / EFT Tahsilat', accountKind: 'Banka', accountId: bank.id, accountName: bank.bank || bank.name, amount: 50000, accountAmount: 50000, accountCurrency: 'TL', tlAmount: 50000, customer: 'MEHMET DEMİR', description: '' });
  fb.db.state = st;
  await p.context().close();
  p = await newDevice(browser, appUrl, fb);
  let sent = 0;
  await p.context().route('https://fatura.test/api', async (r) => { sent++; await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'Gönderildi', invoiceNo: 'TST9', documentType: 'EARSIV' }) }); });
  await p.evaluate(() => document.querySelector('[data-go="invoices"],[data-route="invoices"]').click());
  await p.click('[data-invoice-view="settings"]');
  await p.fill('#invVkn', '2530152458'); await p.fill('#invProxy', 'https://fatura.test/api'); await p.click('#saveInvoiceSettings');
  await p.click('[data-invoice-view="havale"]');
  await p.click('[data-havale-invoice="FIN-ESKI"]'); await p.waitForSelector('#hiGold');
  await p.fill('#hiTckn', '12345678901'); await p.fill('#hiGold', '49000');
  await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.click('[data-invoice-view="records"]');
  await p.click('[data-invoice-send]');
  await p.waitForSelector('#invPreErrors');
  assert.match(await p.innerText('#invPreErrors'), /TCKN geçersiz/);
  assert.equal(sent, 0, 'hatalı fatura gönderilmemeli');
  // Taslağı aç → TCKN düzelt → uyarı (10 gün önce) → yine de gönder
  await p.click('#modalConfirm'); await p.waitForSelector('#hiTckn');
  await p.fill('#hiTckn', '12345678950');
  await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.click('[data-invoice-send]');
  await p.waitForSelector('#invPreWarnings');
  assert.match(await p.innerText('#invPreWarnings'), /10 gün önce[\s\S]*7 gün/);
  assert.equal(sent, 0);
  await p.click('#modalConfirm'); await p.waitForTimeout(1200);
  assert.equal(sent, 1);
  const row = await p.innerText('table.table tbody tr');
  assert.match(row, /Gönderildi/); assert.match(row, /e-Arşiv/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('fatura: perakende satış özel matrah (805) tek satır; "Toptan satış" düğmesi istisna (230, işçiliksiz) yapar', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.click('[data-go="sales"]');
  for (let i = 0; i < 3; i++) {
    await p.fill('#saleProductSearch', '22'); await p.waitForTimeout(300); await p.press('#saleProductSearch', 'Enter');
    if (await p.waitForSelector('#saleEntryPrice:not([disabled])', { timeout: 5000 }).catch(() => null)) break;
  }
  await p.waitForTimeout(300);
  await p.fill('#saleEntryPayable', '70000'); await p.click('#saleAddUnified'); await p.waitForTimeout(400);
  await p.click('[data-pay="Nakit"]'); await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.selectOption('#salePerson', { index: 1 });
  await p.click('#finalizeSale'); await p.click('#modalConfirm'); await p.waitForTimeout(1500);
  await p.evaluate(() => document.querySelector('[data-go="invoices"],[data-route="invoices"]').click());
  await p.click('[data-invoice-view="sales"]');
  await p.click('[data-invoice-draft]');
  await p.waitForSelector('.invoice-lines');
  assert.match(await p.innerText('.invoice-draft'), /Fatura Tipi\s+ÖZEL MATRAH/);
  assert.equal(await p.$eval('[data-inv-code="0"]', (e) => e.value), '805');
  assert.match(await p.$eval('[data-inv-code="0"]', (e) => e.selectedOptions[0].textContent), /805 · Özel matrah \(perakende\)/);
  let lines = await p.innerText('.invoice-lines tbody');
  assert.doesNotMatch(lines, /İŞÇİLİK/);
  assert.match(lines, /%20[\s\S]*805/);
  await p.click('#invAllExempt'); await p.waitForSelector('.invoice-lines');
  assert.equal(await p.$eval('[data-inv-code="0"]', (e) => e.value), '230');
  lines = await p.innerText('.invoice-lines tbody');
  assert.match(lines, /%0[\s\S]*70\.000,00[\s\S]*230/, 'toptan: tutarın tamamı istisna');
  assert.doesNotMatch(lines, /İŞÇİLİK/);
  assert.match(await p.innerText('.invoice-draft'), /Fatura Tipi\s+İSTİSNA/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('satış geçmişi: "Maliyeti yeniden hesapla" geçmiş fişin barkodsuz satır maliyetini güncel birim maliyete göre düzeltir', async () => {
  const fb = createFakeFirebase();
  let p = await newDevice(browser, appUrl, fb);
  await p.click('[data-go="sales"]');
  for (let i = 0; i < 3; i++) {
    await p.fill('#saleProductSearch', '22'); await p.waitForTimeout(300); await p.press('#saleProductSearch', 'Enter');
    if (await p.waitForSelector('#saleEntryPrice:not([disabled])', { timeout: 5000 }).catch(() => null)) break;
  }
  await p.waitForTimeout(300);
  await p.fill('#saleEntryPayable', '5000'); await p.click('#saleAddUnified'); await p.waitForTimeout(400);
  await p.click('[data-pay="Nakit"]'); await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.selectOption('#salePerson', { index: 1 });
  await p.click('#finalizeSale'); await p.click('#modalConfirm'); await p.waitForTimeout(2500);
  const st = fb.db.state, sale = st.sales.find((s) => s.lines?.some((l) => l.openStockId));
  assert.ok(sale, 'barkodsuz satış oluşmalı');
  const line = sale.lines.find((l) => l.openStockId), o = st.openStocks.find((x) => x.id === line.openStockId);
  const oldLine = Number(line.costHas), oldSale = Number(sale.costHas), amount = Number(line.qty ?? line.displayAmount);
  // Birim maliyet sonradan düzeltildi (ör. YARIM 1,835 → 3,22)
  o.inventoryUnitCostHas = Number(o.inventoryUnitCostHas || oldLine / amount) * 2;
  fb.db.state = st;
  await p.context().close();
  p = await newDevice(browser, appUrl, fb);
  await p.click('[data-go="sales"]');
  await p.click('text=Satış Geçmişi');
  await p.waitForSelector('#saleHistBody [data-sale-view]');
  await p.click(`[data-sale-view="${sale.id}"]`);
  await p.waitForSelector('#saleRecalcCost');
  assert.match(await p.innerText('#saleRecalcCost'), /1 satır farklı/);
  await p.click('#saleRecalcCost');
  await p.waitForSelector('#recalcTable');
  assert.match(await p.innerText('.modal'), /Kâr değişimi/);
  await p.click('#modalConfirm');
  const want = amount * o.inventoryUnitCostHas;
  const cur = () => fb.db.state.sales.find((s) => s.id === sale.id).lines.find((l) => l.openStockId).costHas;
  for (let i = 0; i < 60 && Math.abs(cur() - want) >= 0.001; i++) await p.waitForTimeout(250); // buluta yazma gecikmesi
  const s2 = fb.db.state.sales.find((s) => s.id === sale.id), l2 = s2.lines.find((l) => l.openStockId);
  assert.ok(Math.abs(l2.costHas - want) < 0.001, `satır maliyeti ${l2.costHas} ≈ ${want}`);
  assert.ok(Math.abs(s2.costHas - (oldSale + (want - oldLine))) < 0.001, 'fiş maliyeti güncellenmeli');
  assert.ok(Math.abs(s2.profitHas - (Number(sale.profitHas) - (want - oldLine))) < 0.001, 'kâr düşmeli');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('cari AG ziynet: milyem 916 yazılırsa ayar sayılır (3 çeyrek × 1,75 × 916 = 4,809 HAS); sabit 1605 aynen çalışır', async () => {
  const fb = createFakeFirebase();
  const run = async (milyem) => {
    const p = await newDevice(browser, appUrl, fb);
    await p.waitForTimeout(1500);
    const card = (fb.db.state.stockCardsMaster || []).find((c) => /EYREK/.test(c.name || '') && !/ATA|RESAT|BİLEK/.test(c.name || '') && c.ziynet && Number(c.zGram) > 1);
    assert.ok(card, 'çeyrek kartı olmalı');
    await p.evaluate(() => document.querySelector('[data-route="customers"],[data-go="customers"]').click());
    await p.waitForTimeout(400);
    await p.evaluate(() => document.querySelector('[data-cari-move]').click());
    await p.waitForSelector('#cmType');
    await p.selectOption('#cmType', 'AG'); await p.waitForTimeout(200);
    await p.selectOption('#cmGoldCard', card.id); await p.waitForTimeout(150);
    await p.fill('#cmGoldCount', '3');
    await p.$eval('#cmGoldMilyem', (e, v) => { e.readOnly = false; e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, String(milyem));
    await p.waitForTimeout(200);
    const shown = await p.inputValue('#cmGoldMaterialHas');
    await p.click('#modalConfirm');
    await p.waitForSelector('#cariSummarySave');
    assert.match(await p.innerText('#cariSummaryRoot'), milyem === 916 ? /4,809/ : /4,815/);
    await p.click('#cariSummarySave');
    const find = () => (fb.db.state.customerMoves || []).find((m) => m.code === 'AG' && Math.abs(Number(m.sourceRate) - milyem) < 0.01);
    for (let i = 0; i < 60 && !find(); i++) await p.waitForTimeout(250);
    assert.deepEqual(p.errors, []);
    await p.context().close();
    return { shown, mv: find() };
  };
  let r = await run(916);
  assert.match(r.shown, /4,809/);
  assert.ok(r.mv, 'AG hareketi kaydedilmeli');
  assert.ok(Math.abs(Number(r.mv.credit) - 4.809) < 0.001, 'credit ' + r.mv.credit);
  r = await run(1605);
  assert.match(r.shown, /4,815/);
  assert.ok(r.mv, 'AG hareketi kaydedilmeli');
  assert.ok(Math.abs(Number(r.mv.credit) - 4.815) < 0.001, 'credit ' + r.mv.credit);
});

test('stok dönüştür: 3 adet kaynak ziynet → 3 adet hedef; miktarlar ve maliyet taşınır, hareketlerde görünür', async () => {
  const fb = createFakeFirebase();
  let p = await newDevice(browser, appUrl, fb);
  await p.waitForTimeout(1500);
  const st = fb.db.state, base = st.openStocks.find((x) => x.period === st.activePeriod && String(x.unit).toUpperCase() === 'ADET');
  st.openStocks.push({ ...base, id: 'OPEN-CB-TEST', stockCardId: '', name: 'ÇEYREK BİLEKLİK TEST', amount: 3, count: 3, hasWeight: 4.8, workmanshipTotalHas: 0, inventoryUnitCostHas: 1.7, openingUnitCostHas: 1.7 });
  st.openStocks.push({ ...base, id: 'OPEN-CY-TEST', stockCardId: '', name: 'ÇEYREK TEST', amount: 2, count: 2, hasWeight: 3.2, workmanshipTotalHas: 0, inventoryUnitCostHas: 1.6, openingUnitCostHas: 1.6 });
  fb.db.state = st;
  await p.context().close();
  p = await newDevice(browser, appUrl, fb);
  await p.evaluate(() => document.querySelector('[data-go="stocks"]').click());
  await p.waitForSelector('#convertOpenStock');
  await p.click('#convertOpenStock');
  await p.waitForSelector('#scvFrom');
  await p.selectOption('#scvFrom', 'OPEN-CB-TEST'); await p.selectOption('#scvTo', 'OPEN-CY-TEST');
  await p.fill('#scvOut', '3'); await p.waitForTimeout(150);
  assert.equal(await p.inputValue('#scvIn'), '3', 'giren miktar çıkanla aynı gelir');
  const info = await p.innerText('#scvInfo');
  assert.match(info, /5,1 HAS|5,10/);
  await p.click('#modalConfirm');
  for (let i = 0; i < 60 && !(fb.db.state.stockMoves || []).some((m) => m.type === 'STOK DÖNÜŞÜM'); i++) await p.waitForTimeout(250);
  const s2 = fb.db.state, a = s2.openStocks.find((x) => x.id === 'OPEN-CB-TEST'), b = s2.openStocks.find((x) => x.id === 'OPEN-CY-TEST');
  assert.equal(a.amount, 0);
  assert.equal(b.amount, 5);
  assert.ok(Math.abs(b.inventoryUnitCostHas - (2 * 1.6 + 3 * 1.7) / 5) < 1e-6, 'ağırlıklı maliyet');
  assert.ok(Math.abs(b.hasWeight - 8.0) < 1e-6);
  assert.equal(s2.stockMoves.filter((m) => m.type === 'STOK DÖNÜŞÜM').length, 2);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('cari AG ziynet: kartta Z.Gram yanlışsa (ÇEYREK 7,009) uyarı çıkar ve 916 ile kaydetmez', async () => {
  const fb = createFakeFirebase();
  let p = await newDevice(browser, appUrl, fb);
  await p.waitForTimeout(1500);
  const st = fb.db.state, card = st.stockCardsMaster.find((c) => /EYREK/.test(c.name || '') && !/ATA|RESAT|BİLEK/.test(c.name || '') && c.ziynet && Number(c.zGram) > 1);
  card.zGram = 7.009; card.fixedMilyem = 1605;
  fb.db.state = st;
  await p.context().close();
  p = await newDevice(browser, appUrl, fb);
  await p.evaluate(() => document.querySelector('[data-route="customers"],[data-go="customers"]').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('[data-cari-move]').click());
  await p.waitForSelector('#cmType');
  await p.selectOption('#cmType', 'AG'); await p.waitForTimeout(200);
  await p.selectOption('#cmGoldCard', card.id); await p.waitForTimeout(150);
  await p.fill('#cmGoldCount', '3');
  await p.$eval('#cmGoldMilyem', (e) => { e.readOnly = false; e.value = '916'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(200);
  assert.equal(await p.isVisible('#cmGoldWarn'), true);
  assert.match(await p.innerText('#cmGoldWarn'), /7,009[\s\S]*1605[\s\S]*4,815/);
  await p.$eval('#cmGoldMilyem', (e) => { e.value = '1605'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(200);
  assert.match(await p.inputValue('#cmGoldMaterialHas'), /4,815/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('tamir WhatsApp: yeni tamirde tamirciye + müşteriye, Hazır olunca müşteriye hazır mesajı açılır', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  await p.evaluate(() => { window.__waLinks = []; const o = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (/wa\.me|whatsapp:/.test(this.href)) { window.__waLinks.push(this.href); return; } return o.call(this); }; });
  await p.evaluate(() => document.querySelector('[data-route="repairs"],[data-go="repairs"]').click());
  await p.click('#repairWaSettings'); await p.waitForSelector('#waTechPhone');
  await p.fill('#waTechName', 'Usta Ali'); await p.fill('#waTechPhone', '0532 111 22 33'); await p.selectOption('#waMode', 'web');
  await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.click('#newRepair'); await p.waitForSelector('#repCustomer');
  await p.fill('#repCustomer', 'AYŞE KAYA'); await p.fill('#repPhone', '0555 444 33 22'); await p.fill('#repItem', 'YÜZÜK'); await p.fill('#repRequest', 'Taş takılacak');
  await p.$eval('#repAutoPrint', (e) => { e.checked = false; }).catch(() => {});
  await p.click('#modalConfirm');
  await p.waitForSelector('[data-wa-send="1"]');
  const texts = await p.$$eval('[data-wa-text]', (a) => a.map((e) => e.value));
  assert.match(texts[0], /Yeni tamir: TMR-[\s\S]*AYŞE KAYA[\s\S]*Taş takılacak/);
  assert.match(texts[1], /Sayın AYŞE KAYA, YÜZÜK ürününüz tamir için teslim alınmıştır/);
  await p.click('[data-wa-send="0"]'); await p.click('[data-wa-send="1"]');
  let links = await p.evaluate(() => window.__waLinks);
  assert.match(links[0], /^https:\/\/wa\.me\/905321112233\?text=Yeni%20tamir/);
  assert.match(links[1], /^https:\/\/wa\.me\/905554443322\?text=/);
  await p.click('#modalCancel'); await p.waitForTimeout(300);
  // Durum Hazır → müşteriye hazır mesajı
  await p.selectOption('[data-repair-status]', 'Hazır');
  await p.waitForSelector('[data-wa-send="0"]');
  assert.match(await p.$eval('[data-wa-text="0"]', (e) => e.value), /tamiriniz \(YÜZÜK\) hazırdır/);
  await p.click('[data-wa-send="0"]');
  links = await p.evaluate(() => window.__waLinks);
  assert.match(decodeURIComponent(links[2]), /hazırdır/);
  for (let i = 0; i < 40 && !((fb.db.state.repairs || [])[0]?.waLog || []).length; i++) await p.waitForTimeout(250);
  assert.ok(fb.db.state.repairs[0].waLog.length >= 3, 'gönderim kaydı tutulmalı');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('WhatsApp: cari kartından bakiye mesajı ve satış fişinden alışveriş özeti WhatsApp ile açılır', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  await p.evaluate(() => { window.__waLinks = []; const o = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (/wa\.me|whatsapp:/.test(this.href)) { window.__waLinks.push(this.href); return; } return o.call(this); }; });
  await p.evaluate(() => document.querySelector('[data-route="customers"],[data-go="customers"]').click());
  await p.waitForSelector('[data-cari-wa]');
  await p.evaluate(() => document.querySelector('[data-cari-wa]').click());
  await p.waitForSelector('#waCPhone');
  await p.fill('#waCPhone', '0533 222 11 00');
  await p.selectOption('#waCPreset', '1');
  assert.match(await p.inputValue('#waCText'), /güncel bakiyesi/);
  await p.click('#modalConfirm');
  let links = await p.evaluate(() => window.__waLinks);
  assert.match(links[0], /^whatsapp:\/\/send\?phone=905332221100&text=Say%C4%B1n/);
  // Satış fişi
  await p.evaluate(() => document.querySelector('[data-route="sales"],[data-go="sales"]').click());
  for (let i = 0; i < 3; i++) {
    await p.fill('#saleProductSearch', '22'); await p.waitForTimeout(300); await p.press('#saleProductSearch', 'Enter');
    if (await p.waitForSelector('#saleEntryPrice:not([disabled])', { timeout: 5000 }).catch(() => null)) break;
  }
  await p.waitForTimeout(300);
  await p.fill('#saleEntryPayable', '5000'); await p.click('#saleAddUnified'); await p.waitForTimeout(400);
  await p.click('[data-pay="Nakit"]'); await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.selectOption('#salePerson', { index: 1 });
  await p.click('#finalizeSale'); await p.click('#modalConfirm'); await p.waitForTimeout(1500);
  await p.click('text=Satış Geçmişi');
  await p.waitForSelector('#saleHistBody [data-sale-view]');
  await p.click('#saleHistBody [data-sale-view]');
  await p.waitForSelector('#saleWa'); await p.click('#saleWa');
  await p.waitForSelector('#waCText');
  assert.match(await p.inputValue('#waCText'), /numaralı alışverişiniz:[\s\S]*Toplam: 5\.000,00/);
  await p.fill('#waCPhone', '05332221100'); await p.click('#modalConfirm');
  links = await p.evaluate(() => window.__waLinks);
  assert.equal(links.length, 2);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('WhatsApp otomatik (köprü): QR gösterilir, bağlanınca tamir mesajları köprüden gönderilir', async () => {
  const http = require('http');
  const kopru = require('../../kopru/asil-kopru.js');
  const { EventEmitter } = require('events');
  const sent = [];
  let sock;
  kopru.wa._reset();
  kopru.wa._setLib({
    pino: () => ({}), QR: { toDataURL: async () => 'data:image/png;base64,iVBORw0KGgo=' },
    baileys: {
      DisconnectReason: { loggedOut: 401 }, Browsers: { windows: (n) => [n, 'Windows', '1'] },
      useMultiFileAuthState: async () => ({ state: {}, saveCreds: () => {} }),
      default: () => { const ev = new EventEmitter(); sock = { ev, user: { id: '905550000001:1@s.whatsapp.net' }, onWhatsApp: async (j) => [{ exists: true, jid: j }], sendMessage: async (j, m) => { sent.push([j, m.text]); return { key: { id: 'X' } }; }, logout: async () => {} }; setTimeout(() => ev.emit('connection.update', { qr: 'QR' }), 20); return sock; }
    }
  });
  kopru.wa.configure({ waMinIntervalMs: 1000 });
  const cfg = { mode: 'test', vkn: '4810173324', baseUrl: 'https://isnet.test', allowedOrigins: [], whatsapp: true };
  const bridge = http.createServer((q, s) => kopru.handle(cfg, q, s));
  await new Promise((r) => bridge.listen(0, '127.0.0.1', r));
  try {
    const fb = createFakeFirebase();
    let p = await newDevice(browser, appUrl, fb);
    await p.waitForTimeout(1500);
    const st = fb.db.state; st.invoiceSettings = { ...(st.invoiceSettings || {}), proxyUrl: `http://127.0.0.1:${bridge.address().port}` };
    fb.db.state = st; await p.context().close();
    p = await newDevice(browser, appUrl, fb);
    await p.evaluate(() => document.querySelector('[data-route="repairs"],[data-go="repairs"]').click());
    await p.click('#repairWaSettings'); await p.waitForSelector('#waMode');
    await p.fill('#waTechPhone', '05321112233');
    await p.selectOption('#waMode', 'bridge');
    await p.waitForSelector('#waQrImg', { timeout: 8000 });
    sock.ev.emit('connection.update', { connection: 'open' });
    await p.waitForFunction(() => /WhatsApp bağlı/.test(document.getElementById('waBridgeStatus')?.innerText || ''), null, { timeout: 8000 });
    await p.click('#modalConfirm'); await p.waitForTimeout(300);
    await p.click('#newRepair'); await p.waitForSelector('#repCustomer');
    await p.fill('#repCustomer', 'ALİ VELİ'); await p.fill('#repPhone', '0555 444 33 22'); await p.fill('#repItem', 'KOLYE'); await p.fill('#repRequest', 'Kilit değişecek');
    await p.$eval('#repAutoPrint', (e) => { e.checked = false; }).catch(() => {});
    await p.click('#modalConfirm');
    await p.waitForSelector('[data-wa-send="1"]');
    assert.match(await p.innerText('#modalRoot'), /Mesaj gitsin mi\?/);
    assert.equal((await p.innerText('[data-wa-send="0"]')).trim(), 'Gönder');
    await p.click('#modalConfirm'); // HEPSİNİ GÖNDER
    for (let i = 0; i < 40 && sent.length < 2; i++) await p.waitForTimeout(250);
    assert.equal(sent.length, 2);
    assert.equal(sent[0][0], '905321112233@s.whatsapp.net');
    assert.match(sent[0][1], /Yeni tamir: TMR-/);
    assert.equal(sent[1][0], '905554443322@s.whatsapp.net');
    assert.match(sent[1][1], /ALİ VELİ, KOLYE ürününüz tamir için teslim alınmıştır/);
    assert.deepEqual(p.errors, []);
    await p.context().close();
  } finally { bridge.close(); kopru.wa._reset(); }
});

test('tamir teslim onayı: teslim mesajı ONAY ister; müşteri WhatsApp ile ONAY yazınca tamir kaydına işlenir', async () => {
  const http = require('http');
  const kopru = require('../../kopru/asil-kopru.js');
  const { EventEmitter } = require('events');
  const sent = [];
  let sock;
  kopru.wa._reset({ inbox: null, lid: null });
  kopru.wa._setLib({
    pino: () => ({}), QR: { toDataURL: async () => 'data:image/png;base64,iVBORw0KGgo=' },
    baileys: {
      DisconnectReason: { loggedOut: 401 }, Browsers: { windows: (n) => [n, 'Windows', '1'] },
      useMultiFileAuthState: async () => ({ state: {}, saveCreds: () => {} }),
      default: () => { const ev = new EventEmitter(); sock = { ev, user: { id: '905550000001:1@s.whatsapp.net' }, onWhatsApp: async (j) => [{ exists: true, jid: j }], sendMessage: async (j, m) => { sent.push([j, m.text]); return { key: { id: 'SENT' + sent.length } }; }, logout: async () => {} }; setTimeout(() => ev.emit('connection.update', { connection: 'open' }), 20); return sock; }
    }
  });
  kopru.wa.configure({ waMinIntervalMs: 1000 });
  const cfg = { mode: 'test', vkn: '4810173324', baseUrl: 'https://isnet.test', allowedOrigins: [], whatsapp: true };
  const bridge = http.createServer((q, s) => kopru.handle(cfg, q, s));
  await new Promise((r) => bridge.listen(0, '127.0.0.1', r));
  try {
    const fb = createFakeFirebase();
    let p = await newDevice(browser, appUrl, fb);
    await p.waitForTimeout(1500);
    const st = fb.db.state;
    st.invoiceSettings = { ...(st.invoiceSettings || {}), proxyUrl: `http://127.0.0.1:${bridge.address().port}` };
    st.settings = st.settings || {}; st.settings.whatsapp = { mode: 'bridge', autoPrompt: true, autoSend: false, confirmDelivery: true };
    st.repairs = [{ id: 'REPON', docNo: 'TMR-2026-000901', period: st.activePeriod, createdAt: new Date().toISOString(), customerName: 'AYŞE KAYA', phone: '0555 444 33 22', itemType: 'KOLYE', repairRequest: 'Kilit', status: 'Hazır' }];
    fb.db.state = st; await p.context().close();
    await kopru.wa.start(); await new Promise((r) => setTimeout(r, 100));
    p = await newDevice(browser, appUrl, fb);
    await p.evaluate(() => document.querySelector('[data-route="repairs"],[data-go="repairs"]').click());
    await p.waitForSelector('[data-repair-deliver="REPON"]');
    await p.click('[data-repair-deliver="REPON"]');
    await p.waitForSelector('[data-wa-send="0"]');
    assert.match(await p.inputValue('[data-wa-text="0"]'), /ONAY yazarak cevap verin/);
    await p.click('[data-wa-send="0"]');
    for (let i = 0; i < 40 && !sent.length; i++) await p.waitForTimeout(250);
    assert.equal(sent[0][0], '905554443322@s.whatsapp.net');
    await p.waitForTimeout(500); await p.click('#modalX').catch(() => {});
    await p.waitForSelector('text=Onay bekleniyor');
    // Başka numaradan gelen ONAY ve aynı numaradan ilgisiz mesaj işlenmez; müşterinin "Onay" cevabı işlenir
    const now = Math.floor(Date.now() / 1000);
    sock.ev.emit('messages.upsert', { type: 'notify', messages: [
      { key: { id: 'IN1', remoteJid: '905320000000@s.whatsapp.net' }, message: { conversation: 'ONAY' }, messageTimestamp: now },
      { key: { id: 'IN2', remoteJid: '905554443322@s.whatsapp.net' }, message: { conversation: 'Merhaba ne zaman hazır olur' }, messageTimestamp: now },
      { key: { id: 'IN3', remoteJid: '905554443322@s.whatsapp.net' }, message: { conversation: 'Onay' }, messageTimestamp: now + 1 }
    ] });
    await p.evaluate(() => document.querySelector('[data-route="dashboard"]').click());
    await p.evaluate(() => document.querySelector('[data-route="repairs"],[data-go="repairs"]').click());
    await p.waitForSelector('text=Müşteri onayladı', { timeout: 8000 });
    await p.waitForTimeout(3000);
    const r = fb.db.state.repairs.find((x) => x.id === 'REPON');
    assert.equal(r.deliveryConfirm.status, 'onaylandı');
    assert.equal(r.deliveryConfirm.text, 'Onay');
    assert.equal(r.deliveryConfirm.from, '905554443322');
    assert.deepEqual(p.errors, []);
    await p.context().close();
  } finally { bridge.close(); kopru.wa._reset(); }
});

test('satış: geçmiş tarih seçilince satış, kasa ve stok hareketi o güne yazılır; ileri tarih seçilemez', async () => {
  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  const d = new Date(Date.now() - 3 * 864e5), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await p.click('[data-go="sales"]');
  await p.waitForSelector('#saleDateV7');
  await p.fill('#saleDateV7', day); await p.dispatchEvent('#saleDateV7', 'change'); await p.waitForTimeout(300);
  assert.match(await p.innerText('.sale-head-grid'), /GEÇMİŞ TARİHLİ SATIŞ/);
  for (let i = 0; i < 3; i++) {
    await p.fill('#saleProductSearch', '22'); await p.waitForTimeout(300); await p.press('#saleProductSearch', 'Enter');
    if (await p.waitForSelector('#saleEntryPrice:not([disabled])', { timeout: 5000 }).catch(() => null)) break;
  }
  await p.waitForTimeout(300);
  await p.fill('#saleEntryPayable', '5000'); await p.click('#saleAddUnified'); await p.waitForTimeout(400);
  await p.click('[data-pay="Nakit"]'); await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.selectOption('#salePerson', { index: 1 });
  await p.click('#finalizeSale'); await p.click('#modalConfirm');
  const sale = () => (fb.db.state.sales || []).find((s) => s.backdated);
  for (let i = 0; i < 60 && !sale(); i++) await p.waitForTimeout(250);
  const s = sale();
  assert.ok(s, 'satış kaydedilmeli');
  const loc = (iso) => { const x = new Date(iso); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  assert.equal(loc(s.date), day);
  const fin = (fb.db.state.financeMoves || []).filter((f) => f.sourceDocNo === s.docNo);
  assert.ok(fin.length && fin.every((f) => loc(f.date) === day), 'kasa hareketi de o güne yazılmalı');
  assert.ok(Math.abs(new Date(fb.db.state.meta.updatedAt).getTime() - Date.now()) < 120000, 'senkron saati gerçek zaman kalmalı');
  // Bir sonraki satış yeniden bugün
  await p.waitForSelector('#saleDateV7');
  assert.doesNotMatch(await p.innerText('.sale-head-grid'), /GEÇMİŞ TARİHLİ SATIŞ/);
  // İleri tarih reddedilir
  const fut = new Date(Date.now() + 2 * 864e5), fday = `${fut.getFullYear()}-${String(fut.getMonth() + 1).padStart(2, '0')}-${String(fut.getDate()).padStart(2, '0')}`;
  await p.$eval('#saleDateV7', (e, v) => { e.removeAttribute('max'); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, fday);
  await p.waitForTimeout(200);
  assert.notEqual(await p.inputValue('#saleDateV7'), fday);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('tamir: liste 1180 genişlikte yatay kaydırmasız sığar; İptal düğmesi nedenle iptal eder', async () => {
  const fb = createFakeFirebase();
  let p = await newDevice(browser, appUrl, fb);
  await p.waitForTimeout(1500);
  const st = fb.db.state;
  st.repairs = [1, 2, 3].map((i) => ({ id: 'REPX' + i, docNo: 'TMR-2026-00009' + i, period: st.activePeriod, createdAt: new Date().toISOString(), customerName: 'ABDURRAHMAN KANCA', phone: '05334072362', itemType: 'YÜZÜK 925 K GÜMÜŞ', karat: '14K', repairRequest: 'KAYNAK VE TEMİZLEME taş takılacak', dueDate: '2026-11-21', estimatedFee: 200, deposit: 200, status: 'Bekliyor' }));
  fb.db.state = st; await p.context().close();
  p = await newDevice(browser, appUrl, fb);
  await p.setViewportSize({ width: 1180, height: 720 });
  await p.evaluate(() => document.querySelector('[data-route="repairs"],[data-go="repairs"]').click());
  await p.waitForSelector('[data-repair-cancel="REPX1"]');
  const m = await p.evaluate(() => { const w = [...document.querySelectorAll('.table-wrap')].find((x) => x.querySelector('[data-repair-row]')); return { over: w.scrollWidth - w.clientWidth, rowH: document.querySelector('[data-repair-row]').offsetHeight }; });
  assert.ok(m.over <= 2, 'yatay kaydırma olmamalı: ' + m.over);
  assert.ok(m.rowH < 120, 'satır kısa olmalı: ' + m.rowH);
  if (process.env.SHOT) await (await p.$('.repair-table')).screenshot({ path: process.env.SHOT });
  await p.click('[data-repair-cancel="REPX1"]');
  await p.waitForSelector('#repCancelReason');
  assert.match(await p.innerText('#modalRoot'), /Kapora 200,00 TL/);
  await p.fill('#repCancelReason', 'Müşteri vazgeçti');
  await p.click('#modalConfirm');
  const rep = () => (fb.db.state.repairs || []).find((r) => r.id === 'REPX1');
  for (let i = 0; i < 40 && rep()?.status !== 'İptal'; i++) await p.waitForTimeout(250);
  assert.equal(rep().status, 'İptal');
  assert.equal(rep().cancelReason, 'Müşteri vazgeçti');
  assert.equal(await p.$('[data-repair-cancel="REPX1"]'), null, 'iptal edilen tamirde düğme kalkar');
  assert.match(await p.innerText('[data-repair-row]:has([data-repair-status="REPX1"])'), /İptal: Müşteri vazgeçti/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('satış ekranı 1280×720 pencereye sığar: üst satır tek sıra, özet ve İşlem Özeti düğmesi görünür', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  await p.setViewportSize({ width: 1280, height: 720 });
  await p.click('[data-go="sales"]'); await p.waitForTimeout(600);
  const m = await p.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const head = r('.sale-head-grid'), fin = r('#finalizeSale'), side = r('.compact-sale-side');
    const tops = ['#saleCustomerSearch', '#saleDateV7', '#saleCurrency', '#saleProductSearch'].map((s) => Math.round(r(s).top));
    return { headH: head.height, finBottom: fin.bottom, vh: innerHeight, sideScroll: document.querySelector('.compact-sale-side').scrollHeight - document.querySelector('.compact-sale-side').clientHeight, tops };
  });
  assert.ok(Math.max(...m.tops) - Math.min(...m.tops) < 4, 'cari, tarih, cins, stok kodu aynı satırda: ' + m.tops);
  assert.ok(m.finBottom <= m.vh, `İşlem Özeti görünmeli (${m.finBottom} ≤ ${m.vh})`);
  assert.ok(m.sideScroll <= 2, 'sağ panel kaydırma gerektirmemeli: ' + m.sideScroll);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('cari ekstre: açılışta yalnız bugün; tarih aralığı / Tümü; harekete tıklayınca detay penceresi (düzelt/sil) açılır', async () => {
  const fb = createFakeFirebase();
  let p = await newDevice(browser, appUrl, fb);
  await p.waitForTimeout(1500);
  const st = fb.db.state, c = st.customers.find((x) => x.type === 'Müşteri' && x.id !== 'CASH');
  const old = new Date(Date.now() - 20 * 864e5).toISOString(), today = new Date().toISOString();
  st.customerMoves.push({ id: 'CM-ESKI-T', customerId: c.id, period: st.activePeriod, date: old, code: 'NT', type: 'ESKİ HAREKET TEST', unit: 'TL', debit: 0, credit: 1111, description: 'eski' });
  st.customerMoves.push({ id: 'CM-BUGUN-T', customerId: c.id, period: st.activePeriod, date: today, code: 'NT', type: 'BUGÜN HAREKET TEST', unit: 'TL', debit: 0, credit: 2222, description: 'bugün' });
  fb.db.state = st; await p.context().close();
  p = await newDevice(browser, appUrl, fb);
  await p.evaluate(() => document.querySelector('[data-route="customers"],[data-go="customers"]').click());
  await p.waitForTimeout(500);
  await p.evaluate((x) => document.querySelector(`[data-cari-card="${x}"] [data-cari-detail]`).click(), c.id);
  await p.waitForSelector('#cariEkstreTable');
  let t = await p.innerText('#cariEkstreTable');
  assert.match(t, /BUGÜN HAREKET TEST/); assert.doesNotMatch(t, /ESKİ HAREKET TEST/, 'açılışta yalnız bugün');
  assert.match(await p.innerText('#modalRoot'), /Devreden bakiye/);
  await p.click('[data-cari-range="all"]'); await p.waitForSelector('#cariEkstreTable');
  t = await p.innerText('#cariEkstreTable');
  assert.match(t, /ESKİ HAREKET TEST/);
  // Tarih aralığı: yalnız eski gün
  const d = old.slice(0, 10), loc = new Date(old); const day = `${loc.getFullYear()}-${String(loc.getMonth() + 1).padStart(2, '0')}-${String(loc.getDate()).padStart(2, '0')}`;
  await p.fill('#cariPrintFrom', day); await p.dispatchEvent('#cariPrintFrom', 'change'); await p.waitForSelector('#cariPrintTo');
  await p.fill('#cariPrintTo', day); await p.dispatchEvent('#cariPrintTo', 'change'); await p.waitForSelector('#cariEkstreTable');
  t = await p.innerText('#cariEkstreTable');
  assert.match(t, /ESKİ HAREKET TEST/); assert.doesNotMatch(t, /BUGÜN HAREKET TEST/);
  // Tıklayınca detay penceresi
  assert.equal(await p.isVisible('#cariRowPop'), false);
  await p.click('.cari-ekstre-row:has-text("ESKİ HAREKET TEST")');
  assert.equal(await p.isVisible('#cariRowPop'), true);
  assert.ok(await p.isVisible('#selectedCariEdit')); assert.ok(await p.isVisible('#selectedCariDelete'));
  await p.keyboard.press('Escape');
  assert.equal(await p.isVisible('#cariRowPop'), false, 'Esc pencereyi kapatır, ekstre açık kalır');
  assert.ok(await p.isVisible('#cariEkstreTable'));
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('fiş yazıcı (QZ): fiş resim olarak gider (ayarla ESC/POS ESC * komutu); QZ bağlantısı açılışta önceden kurulur', async () => {
  const fb = createFakeFirebase();
  let p = await newDevice(browser, appUrl, fb);
  await p.waitForTimeout(1500);
  const st = fb.db.state;
  st.repairs = [{ id: 'REPQZ', docNo: 'TMR-2026-000777', period: st.activePeriod, createdAt: new Date().toISOString(), customerName: 'AYŞE KAYA', phone: '05551112233', itemType: 'KOLYE', karat: '925K', repairRequest: 'KAYNAK VE TEMİZLEME', dueDate: '2026-11-23', estimatedFee: 150, status: 'Teslim Alındı' }];
  st.settings = st.settings || {}; st.settings.receiptPrinter = { ...(st.settings.receiptPrinter || {}), mode: 'qz', printerName: 'ACLAS PP7X', widthMm: 80, copies: 1, logoData: process.env.SHOT ? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAA8CAIAAAC1nk4lAAAAIUlEQVR4nO3BgQAAAADDoPlTX+AIVQEAAAAAAAAAAADANypsAAHc33jIAAAAAElFTkSuQmCC' : '' };
  fb.db.state = st; await p.context().close();
  const init = () => {
    localStorage.setItem('asilQzPrivateKeyV1', '-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----');
    window.KJUR = {}; window.KEYUTIL = {}; window.stob64 = () => ''; window.hextorstr = () => '';
    window.__qz = { connects: 0, jobs: [] };
    let active = false;
    window.qz = {
      websocket: { isActive: () => active, connect: async () => { window.__qz.connects++; active = true; } },
      security: { setCertificatePromise() {}, setSignatureAlgorithm() {}, setSignaturePromise() {} },
      printers: { find: async () => ['ACLAS PP7X'], getDefault: async () => 'ACLAS PP7X' },
      configs: { create: (name, o) => ({ name, o }) },
      print: async (cfg, jobs) => { window.__qz.jobs.push({ cfg, jobs }); }
    };
  };
  p = await newDevice(browser, appUrl, fb, { initScript: init });
  await p.waitForFunction(() => window.__qz.connects > 0, null, { timeout: 8000 }); // açılışta bağlantı
  await p.evaluate(() => document.querySelector('[data-route="repairs"],[data-go="repairs"]').click());
  await p.waitForSelector('[data-repair-print="REPQZ"]');
  await p.click('[data-repair-print="REPQZ"]');
  await p.waitForFunction(() => window.__qz.jobs.length > 0, null, { timeout: 10000 });
  // Varsayılan: PNG resim (Windows sürücüsü), siyah/beyaz, ortalı
  const r = await p.evaluate(async () => {
    const j = window.__qz.jobs[0], d = j.jobs[0];
    const img = new Image(); img.src = 'data:image/png;base64,' + d.data; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data; let dark = 0, grey = 0, minX = c.width, maxX = 0;
    for (let i = 0; i < px.length; i += 4) { if (px[i] < 100) { dark++; const x = (i / 4) % c.width; if (x < minX) minX = x; if (x > maxX) maxX = x; } if (px[i] > 0 && px[i] < 255) grey++; }
    return { left: minX, right: c.width - 1 - maxX, grey, type: d.type, format: d.format, flavor: d.flavor, w: img.width, h: img.height, dark, printer: j.cfg.name, scale: j.cfg.o.scaleContent, connects: window.__qz.connects };
  });
  assert.deepEqual([r.type, r.format, r.flavor, r.printer, r.scale], ['pixel', 'image', 'base64', 'ACLAS PP7X', true]);
  assert.equal(r.w, Math.round(80 / 25.4 * 203));
  assert.ok(r.h > 300, 'fiş yüksekliği: ' + r.h);
  assert.ok(r.dark > 2000, 'resimde yazı olmalı (koyu piksel: ' + r.dark + ')');
  assert.equal(r.grey, 0, 'termal yazıcı için yalnız siyah/beyaz nokta');
  assert.ok(Math.abs(r.left - r.right) < 25, 'fiş kâğıtta ortalı olmalı: sol ' + r.left + ' sağ ' + r.right);
  assert.match(await p.innerText('body'), /yazdırıldı · \d+,\d sn/);
  // Ayarlardan "Doğrudan komut" seçilirse ESC * 33 sütun resmi gider (GS v 0 değil; Aclas desteklemiyor)
  await p.click('#repairPrinterSettings'); await p.waitForSelector('#rpFormat');
  assert.equal(await p.inputValue('#rpFormat'), 'image');
  await p.selectOption('#rpFormat', 'escpos'); await p.fill('#rpCopies', '2'); assert.ok(await p.isChecked('#rpCut')); await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.click('[data-repair-print="REPQZ"]');
  await p.waitForFunction(() => window.__qz.jobs.length > 1, null, { timeout: 10000 });
  const e = await p.evaluate(() => {
    const d = window.__qz.jobs[1].jobs[0], b = Uint8Array.from(atob(d.data), (ch) => ch.charCodeAt(0));
    let i = 5, dark = 0, bands = 0, n = 0, gsv = 0;
    for (let q = 0; q + 1 < b.length; q++) if (b[q] === 0x1D && b[q + 1] === 0x76) gsv++;
    while (b[i] === 0x1B && b[i + 1] === 0x2A && b[i + 2] === 33) { n = b[i + 3] | (b[i + 4] << 8); i += 5; for (let k = 0; k < n * 3; k++) { let v = b[i++]; while (v) { dark += v & 1; v >>= 1; } } i++; bands++; }
    let cuts = 0, inits = 0; for (let q = 0; q + 2 < b.length; q++) { if (b[q] === 0x1D && b[q + 1] === 0x56 && b[q + 2] === 1) cuts++; if (b[q] === 0x1B && b[q + 1] === 0x40) inits++; }
    return { type: d.type, format: d.format, head: Array.from(b.slice(0, 5)), n, bands, dark, end: i, len: b.length, cuts, inits, afterFirst: Array.from(b.slice(i, i + 10)), padZero: b.slice(-24576).every((x, k) => x === (k % 2 ? 0x32 : 0x1B)), beforePad: Array.from(b.slice(-24579, -24576)) };
  });
  assert.deepEqual([e.type, e.format, e.head, e.n], ['raw', 'command', [0x1B, 0x40, 0x1B, 0x33, 24], 576]);
  assert.ok(e.bands > 12 && e.dark > 2000, 'fiş içeriği: ' + JSON.stringify(e));
  if (process.env.SHOT) { const png = await p.evaluate(() => { const d = window.__qz.jobs[1].jobs[0], b = Uint8Array.from(atob(d.data), (ch) => ch.charCodeAt(0)); let i = 5; const bands = [];
    while (b[i] === 0x1B && b[i + 1] === 0x2A) { const n = b[i + 3] | (b[i + 4] << 8); i += 5; bands.push(b.slice(i, i + n * 3)); i += n * 3 + 1; }
    const c = document.createElement('canvas'); c.width = 576; c.height = bands.length * 24; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000';
    bands.forEach((bd, k) => { for (let x = 0; x < 576; x++) for (let r = 0; r < 24; r++) if (bd[x * 3 + (r >> 3)] & (0x80 >> (r & 7))) g.fillRect(x, k * 24 + r, 1, 1); });
    return c.toDataURL('image/png').split(',')[1]; }); require('fs').writeFileSync(process.env.SHOT, Buffer.from(png, 'base64')); }
  assert.ok(e.padZero, 'sonda 24 KB ESC 2 dolgu'); assert.deepEqual(e.beforePad, [0x1D, 0x56, 1], 'dolgudan önce son kesme');
  assert.deepEqual(e.afterFirst, [0x1B, 0x32, 0x1B, 0x4A, 200, 0x1D, 0x56, 1, 0x1B, 0x33], 'kopya sonunda ~25 mm ilerlet + kes, 2. kopya sıfırlamadan başlar');
  assert.deepEqual([e.cuts, e.inits, e.len], [2, 1, 2 + (e.end - 2 + 8) * 2 + 24576], '2 kopya, her biri kesilir; ESC @ yalnız başta; sonda dolgu');
  assert.equal(r.connects, 1, 'bağlantı bir kez kurulur, baskıda yeniden kurulmaz');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
