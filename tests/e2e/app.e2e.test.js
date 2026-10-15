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
  assert.match(await p.innerText('table.gold-stock-v7'), /ÖZEL ÜRÜN \(BARKODLU\)/);
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

test('cari temizleme listesi: işaretli cari sıfırlanır, karşılığı düzeltme hesabına yazılır, grup değişir', async () => {
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
  assert.equal(Number(adj.tlBalance), 1500, 'temizlenen tutar düzeltme hesabına yazılmalı');
  assert.equal(adj.balanceGroupV7, 'GIDER');
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
