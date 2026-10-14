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
  ]), 'Cari');
  XLSX.writeFile(wb, file);

  const fb = createFakeFirebase();
  const p = await newDevice(browser, appUrl, fb);
  await p.click('[data-go="backup"]');
  await p.click('#pusulaImportBackupV7');
  await p.selectOption('#piMode', 'cari');
  await p.setInputFiles('#piFile', file);
  await p.waitForFunction(() => /Excel'de:<\/b> 2 cari/.test(document.getElementById('piResult').innerHTML), null, { timeout: 10000 });
  const txt = await p.innerText('#piResult');
  assert.match(txt, /Yeni: 1/); assert.match(txt, /YENİ MÜŞTERİ/);
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
  // Hareket defteri bakiye ile tutarlı: Ali'nin TL hareketleri toplamı = 10000
  const sum = st.customerMoves.filter((m) => m.customerId === ali.id && m.unit === 'TL').reduce((n, m) => n + Number(m.debit || 0) - Number(m.credit || 0), 0);
  assert.equal(Math.round(sum * 100) / 100, 10000);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
