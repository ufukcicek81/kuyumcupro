# Pusula'dan Asil Kuyumcu Pro'ya Aktarım

Pusula'daki güncel verileri üç Excel dosyasıyla aktarırsınız. Program sütunları
başlıklarından otomatik tanır; tanıyamadığı sütunu ekranda elle seçebilirsiniz.

**Nereden:** Yedek · Bulut → **Pusula'dan Aktarım**, ya da Stok sayfasında
**📥 Pusula'dan Excel Aktar**, ya da Cari sayfasında **📥 Pusula'dan Cari Bakiye Aktar**.

## Sıra
1. **Stok özeti** (barkodsuz altın/ziynet + hurda + kasa) — önce bu: içindeki barkodlu
   toplamı (adet / gram), barkodlu listenin eksiksiz olup olmadığını kontrol etmek için kullanılır.
2. **Barkodlu ürün listesi** (altın)
3. **Özel ürün listesi** (gümüş, saat, pırlanta, tesbih, bijuteri, çelik)
4. **Cari bakiye listesi**

Her aktarımdan önce cihazda ve bulutta otomatik yedek alınır.

## 1. Barkodlu stoklar
Pusula'da barkodlu ürün listesini (stokta olan ürünler) açın ve **Excel'e aktar**ın
(sütunlar: URUN KODU, AYAR, MIKTAR, HAS, ISCILIK, BIRIM, MALIYET, SAT.FİYATI, MODEL, Grup, Kod, BANKO, TAŞ, ORJKOD, BOY, SONUC GR).

> **Listenin tamamı alınmalı.** Excel'e aktarım yarıda kesilirse (son satır yarım kalırsa) ya da
> adet/gram stok özetindeki barkodlu toplamla tutmazsa program uyarır ve aktarımı durdurur;
> aksi halde eksik ürünler programdan silinirdi. Grup ara toplam satırları ("122 Adet") atlanır.

Bulunması gereken sütunlar:

| Gerekli | Olursa iyi olur |
|---|---|
| Barkod (veya Grup + Stok Kodu) | Has, Alış İşçilik, Satış İşçilik |
| Ayar (14, 22, 585, 916…) | Maliyet HAS, Satış HAS |
| Gram | Cins/Ürün adı, Model, Taş, Ölçü, Tedarikçi, Vitrin |

- Aktarım, aktif dönemdeki **tüm barkodlu stokları siler** ve Excel'dekileri yükler.
  Satılmış ürün kayıtları satış geçmişi için korunur.
- Has boşsa `gram × milyem` ile, Maliyet/Satış HAS boşsa `has + işçilik` ile hesaplanır.
- Pusula'nın ISCILIK sütunu ürüne göre gram başı ya da adet başıdır; gerçek işçilik `maliyet − has`
  olarak alınır (Pusula'nın toplamlarındaki gibi), girilen değer ayrıca saklanır.
- Dosyanın sonundaki genel toplam ("1693 Adet") okunan ürün sayısıyla karşılaştırılır.

## 2. Stok özeti (barkodsuz stok + hurda + kasa)
Pusula'nın stok özeti raporu (sütunlar: TANIM, AYAR, MIKTAR, HAS, ISCILIK, BIRIM, …, ORTALAMA, Adet, TIP)
doğrudan tanınır ve bölümlerine ayrılır:
- **Altın / ziynet** (çeyrek, yarım, gram altın, 22 bilezik…) → barkodsuz stoklar. Mevcut ürünlerin
  birim gramı ve maliyet esası korunur.
- **Barkodlu toplamları** (ayar bazında adet/gram) → aktarılmaz, barkodlu liste kontrolünde kullanılır.
- **Hurda** → hurda stokları (isteğe bağlı).
- **Kasa** (TL, USD, EUR…) → kasa bakiyeleri eşitlenir (isteğe bağlı).
- **Özel ürün** → aktarılmaz.

Başka biçimde bir açık stok listesi de verilebilir:

| Gerekli | Olursa iyi olur |
|---|---|
| Stok Kodu veya Ürün Adı | Has, İşçilik, Maliyet HAS |
| Ayar | Birim (GR / ADET) |
| Miktar | Adetli ürünlerde birim gram (ör. çeyrek 1,75) |

- Aktif dönemdeki **tüm barkodsuz stoklar silinir**, Excel'dekiler yüklenir.

## 3. Özel ürünler
Pusula'nın özel ürün listesi (barkodlu ürünle aynı sütunlar; BIRIM = TL. / USD / HAS) aktarılır.
- Maliyet ve satış fiyatı kendi biriminde saklanır; satış ekranında o günün kuruyla TL'ye çevrilir.
- Excel'de satış birimi sütunu yoktur; satış birimi BİRİM'den farklı olan ürünler, grup ara
  toplamlarındaki ("KOLYE 380 Adet … TL / USD") birim dağılımından bulunur. Birden fazla eşleşme
  olası gruplar ve çözülemeyen gruplar ekranda listelenir.
- Altın barkodlu aktarım özel ürünlere, özel ürün aktarımı altın barkodlulara dokunmaz.
- Barkoddaki küçük "ı" büyük "I" yapılır (BıJ0000048 → BIJ0000048).

## 4. Cari bakiyeleri
Pusula'da cari bakiye listesini (tüm cariler, birim bazında bakiye) Excel'e aktarın.

| Gerekli | Olursa iyi olur |
|---|---|
| Cari Kodu ve/veya Cari Adı | Tür (Müşteri / Toptancı / Banka / Özel), Telefon |
| Bakiye sütunları: TL, HAS, USD, EUR, ayar (22, 14…) | |

- Pusula'nın bakiye listesi (FIRMA UNVANI, KOD, GRM, GMS, 22, HAS, TL., USD, EUR, CHF, GBP, CEY, CAD, AUD)
  doğrudan tanınır; TOPLAM satırları atlanır.
- Pusula iç hesapları (Dönem K/Z, Genel Giderler, Sermaye, Kasa, Kâr hesabı…) toplamlar tutsun diye
  aktarılır ama **Özel** türünde açılır; bankalar **Banka** türünde. Banka hesabına bağlı carinin TL
  bakiyesi banka hesabına da işlenir.
- Bakiye tek sütunda (+/−) veya ayrı **Borç** / **Alacak** sütunlarında olabilir;
  ekranda her sütunun birimini ve yönünü kontrol edin.
- **"Excel'deki artı (+) bakiye"** seçeneğini Pusula'daki işarete göre seçin:
  çoğunlukla artı = cari bize borçlu.
- Her carinin bakiyesi Excel'deki değere eşitlenir; fark **DEVİR / AÇILIŞ** hareketi olarak
  yazılır, böylece cari ekstresi ile bakiye tutarlı kalır. Bulunamayan cari yeni açılır.
  **Cari kartları silinmez.**
- "Excel'de olmayan carilerin bakiyesini sıfırla" işaretliyse listede olmayan carilerin
  bakiyesi sıfırlanır.

## Bilanço karşılaştırma
Raporlar → **BİLANÇO** Pusula'nın bilanço düzenindedir: hesap grupları (MUSTERI, OZEL, TOPTANCI, GIDER, KASA,
ISKONTO, KAR / ZARAR, SERMAYE, POS, BANKA, PERSONEL, KREDILER…) birim bazında borç/alacak ve HAS karşılığı;
altında stoklar, kur farkı, kâr/zarar (dönem ve TOPLAM) ve sermaye.
- Pusula'nın cari listesinde hesap tipi sütunu yoktur. İç hesaplar adından (DONEM K/Z, SERMAYE → SERMAYE;
  GENEL GIDERLER, K.KARTI KOMISYONU, STOK DUZELTME, HURDA KAR/ZARAR → GIDER; KAR HESABI → KAR / ZARAR …),
  diğerleri cari türünden gruplanır. Pusula'dakinden farklı olanları **Hesap Grupları** ekranından düzeltin.
- KASA grubu kasa hesaplarından, banka/POS'a bağlı cariler hesap bakiyesinden okunur (çift sayılmaz).
- **📥 Pusula bilançosu ile karşılaştır:** Pusula'daki bilançoyu Excel'e aktarıp seçin; satır satır fark tablosu çıkar.
- Pusula'nın cari listesinde ILS sütunu yoktur; ILS bakiyeleri elle girilmelidir.
- Çeyrek (CEY) bakiyesi çeyrek alış milyemiyle HAS'a çevrilir (Pusula 0 gösterir).

## Kontrol
Aktarımdan sonra Stok · Stok + Kasa Özeti ve Cari sayfasındaki toplamları Pusula'daki
raporlarla karşılaştırın. Bir şey yanlışsa **Yedek · Bulut → Bulut Yedek Geçmişi**
listesinden "PUSULA AKTARIM ÖNCESİ" yedeğine dönebilirsiniz.
