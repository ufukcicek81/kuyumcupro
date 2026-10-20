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
  await closeAlert();
  await p.locator('#modalRoot tbody tr').first().locator('[data-recent-receipt]').click();
  for (let i = 0; i < 40 && popups.length < 2; i++) await p.waitForTimeout(250);
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
  await p.context().route(/tesseract\.min\.js/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: `window.Tesseract={createWorker:async()=>({setParameters:async()=>{},recognize:async()=>({data:{text:${JSON.stringify(ocr)}}}),terminate:async()=>{}})};` }));
  await p.evaluate(() => document.querySelector('[data-go="compliance"]')?.click());
  await p.click('#startCameraKyc');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await p.setInputFiles('#camKycFile', { name: 'kimlik.png', mimeType: 'image/png', buffer: png });
  await p.waitForSelector('#camKycSave');
  assert.equal(await p.inputValue('#ckName'), 'AHMET CAN YILMAZ');
  assert.equal(await p.inputValue('#ckTckn'), '10000000146');
  assert.equal(await p.inputValue('#ckDoc'), 'A12B34567');
  assert.equal(await p.inputValue('#ckBirth'), '1990-01-15');
  assert.equal(await p.inputValue('#ckExpiry'), '2031-05-20');
  await p.click('#camKycSave');
  await p.waitForSelector('#kycName');
  assert.equal(await p.inputValue('#kycName'), 'AHMET CAN YILMAZ');
  const rec = await p.evaluate(() => JSON.parse(localStorage.getItem('asil_kuyumcu_pro_kyc_v2') || '[]')[0]);
  assert.equal(rec.tckn, '10000000146'); assert.equal(rec.mrzCameraRead, true); assert.notEqual(rec.verified, true);
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

test('fatura taslağı: altın bedeli, işçilik ve yalnız işçilikten KDV ayrılır; entegratöre ayrıntılı gider', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  let sent = null;
  await p.context().route('https://fatura.test/api', async (r) => { sent = JSON.parse(r.request().postData()); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'Gönderildi', invoiceNo: 'TST2026000000001' }) }); });
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
  await p.fill('#invProxy', 'https://fatura.test/api'); await p.click('#saveInvoiceSettings');
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
  await p.fill('[data-inv-gold="0"]', '10000'); await p.click('#modalConfirm'); await p.waitForTimeout(300);
  assert.match(await p.innerText('.content'), /SAT-\d{4}-0+1/);
  assert.match(await p.innerText('.content'), /50\.000,00/, 'işçilik (60.000 − KDV 10.000) listede görünmeli');
  await p.click('[data-invoice-send]'); await p.waitForTimeout(800);
  assert.ok(sent, 'entegratöre istek gitmeli');
  assert.equal(sent.sale.products[0].goldValue, 10000);
  assert.equal(sent.sale.products[0].labourAmount, 50000);
  assert.equal(sent.sale.products[0].vatAmount, 10000);
  // Varsayılan düzen: altın satırı (KDV %0, kod 230) + İŞÇİLİK satırı (KDV %20)
  assert.equal(sent.invoiceType, 'ISTISNA');
  assert.deepEqual([sent.sale.lines[0].total, sent.sale.lines[0].vatRate, sent.sale.lines[0].exemptionCode], [10000, 0, '230']);
  assert.match(sent.sale.lines[1].name, /^İŞÇİLİK/);
  assert.deepEqual([sent.sale.lines[1].total, sent.sale.lines[1].vatRate, sent.sale.lines[1].vatAmount], [50000, 20, 10000]);
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
  assert.equal(await p.locator('[data-bankfeed-post]').count(), 2, 'silinen hareketin ekstre satırı yeniden kaydedilebilmeli');
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
  await p.selectOption('#tiItem', { label: 'CEYREK' }); await p.fill('#tiQty', '1'); await p.fill('#tiPrice', '10400'); await p.waitForTimeout(200);
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

test('fatura: altın ve işçilik ayrı satır, altın kodu 230, fatura tipi İSTİSNA; özel matrah düzeni seçilebilir', async () => {
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
  assert.equal(await p.inputValue('#invLayout'), 'SPLIT', 'varsayılan düzen altın + işçilik ayrı');
  assert.equal(await p.inputValue('#invGoldCode'), '230');
  await p.fill('#invProxy', 'https://fatura.test/api'); await p.click('#saveInvoiceSettings');
  await p.click('[data-invoice-view="sales"]');
  await p.click('[data-invoice-draft]');
  await p.waitForSelector('.invoice-lines');
  let draft = await p.innerText('.invoice-draft');
  assert.match(draft, /Fatura Tipi\s+İSTİSNA/);
  const lines = await p.innerText('.invoice-lines tbody');
  assert.match(lines, /24 Ayar[^\n]*%0[^\n]*230/, 'altın satırı KDV %0 ve 230 koduyla');
  assert.match(lines, /İŞÇİLİK[^\n]*%20/, 'işçilik ayrı satır, KDV %20');
  assert.match(draft, /230 · İstisna\s+Külçe altın, külçe gümüş ve kıymetli taşların teslimi/);
  await p.click('#modalConfirm'); await p.waitForTimeout(300);
  await p.click('[data-invoice-send]'); await p.waitForTimeout(800);
  assert.equal(sent.invoiceType, 'ISTISNA');
  assert.equal(sent.layout, 'SPLIT');
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
  await p.waitForSelector('#tiItem');
  const ti = await p.$$eval('#tiItem option', (os) => os.map((o) => o.textContent));
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
  await p.click('[data-pay="Altın / Ziynet"]'); await p.waitForSelector('#tiItem');
  const opts = await p.$$eval('#tiItem option', (os) => os.map((o) => o.textContent));
  assert.ok(opts.includes('REŞAT ÇEYREK BİLEKLİK') && opts.includes('RESAT CEYREK BİLEKLİK'), 'yeni kart eski stok satırıyla birlikte listede olmalı: ' + opts.join(', '));
  await p.selectOption('#tiItem', { label: 'REŞAT ÇEYREK BİLEKLİK' }); await p.fill('#tiQty', '2'); await p.fill('#tiPrice', '10000'); await p.waitForTimeout(200);
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
  assert.match(await p.innerText('table.gold-stock-v7'), /REŞAT ÇEYREK BİLEKLİK\t1590\t0,00/, 'iptalde stok geri alınmalı');
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
  const rate = Number(await p.inputValue('#cmCounterRate'));
  assert.ok(rate > 0);
  // Ödeme (BORÇ) seçilince karşılık kuru alış kuruna döner ve satıştan küçük olur
  await p.selectOption('#cmType', 'NO'); await p.waitForTimeout(200);
  const rateOut = Number(await p.inputValue('#cmCounterRate'));
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

test('stok kartı birleştir: eski kartın stoğu yeni karta aktarılır, eski kart silinir', async () => {
  const p = await newDevice(browser, appUrl, createFakeFirebase());
  p.on('dialog', () => {});
  await p.evaluate(() => document.querySelector('[data-route="stocks"],[data-go="stocks"]').click());
  await p.waitForTimeout(300);
  await p.evaluate(() => (document.getElementById('newStockCard') || document.querySelector('[data-new-stockcard]')).click());
  await p.waitForSelector('#scProductCode');
  await p.fill('#scProductDefinition', 'YENI 24 AYAR 5 GRAM');
  await p.fill('#scPurity', '4975'); await p.fill('#scFixedMilyem', '4975'); await p.fill('#scZGram', '5');
  await p.selectOption('#scUnit12', 'AD'); await p.check('#scCounted'); await p.check('#scZiynet');
  await p.click('#modalConfirm'); await p.waitForTimeout(300);
  // Eski kartı bul ve birleştir
  const found = await p.evaluate(() => { const b = [...document.querySelectorAll('[data-merge-stockcard]')].find((x) => /24 Ayar 5 Gram Külçe/i.test(x.closest('.stock-card-box')?.innerText || '')); if (b) b.click(); return !!b; });
  assert.ok(found, 'eski kartın Birleştir düğmesi bulunmalı');
  await p.waitForSelector('#mergeTarget');
  await p.selectOption('#mergeTarget', { label: (await p.$$eval('#mergeTarget option', (os) => os.map((o) => o.textContent))).find((x) => x.includes('YENI 24 AYAR 5 GRAM')) });
  await p.click('#modalConfirm'); await p.waitForTimeout(500);
  assert.doesNotMatch(await p.innerText('.content'), /24 Ayar 5 Gram Külçe/, 'eski kart silinmeli');
  await p.evaluate(() => document.querySelector('[data-route="sales"],[data-go="sales"]').click());
  await p.waitForSelector('#saleProductSearch');
  await p.fill('#saleProductSearch', '24 ayar 5'); await p.waitForTimeout(400);
  const list = await p.innerText('#saleSearchResults');
  assert.match(list, /YENI 24 AYAR 5 GRAM[\s\S]*1 ADET stok/, 'eski kartın 1 adet stoğu yeni karta geçmeli: ' + list);
  assert.doesNotMatch(list, /Külçe/i);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
