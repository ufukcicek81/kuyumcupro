# Pusula'dan Asil Kuyumcu Pro'ya Aktarım

Pusula'daki güncel verileri üç Excel dosyasıyla aktarırsınız. Program sütunları
başlıklarından otomatik tanır; tanıyamadığı sütunu ekranda elle seçebilirsiniz.

**Nereden:** Yedek · Bulut → **Pusula'dan Aktarım**, ya da Stok sayfasında
**📥 Pusula'dan Excel Aktar**, ya da Cari sayfasında **📥 Pusula'dan Cari Bakiye Aktar**.

## Sıra
1. **Barkodlu stoklar**
2. **Barkodsuz (açık) stoklar**
3. **Cari bakiyeleri**

Her aktarımdan önce cihazda ve bulutta otomatik yedek alınır.

## 1. Barkodlu stoklar
Pusula'da barkodlu stok listesini (stokta olan ürünler) açın ve **Excel'e aktar**ın.
Bulunması gereken sütunlar:

| Gerekli | Olursa iyi olur |
|---|---|
| Barkod (veya Grup + Stok Kodu) | Has, Alış İşçilik, Satış İşçilik |
| Ayar (14, 22, 585, 916…) | Maliyet HAS, Satış HAS |
| Gram | Cins/Ürün adı, Model, Taş, Ölçü, Tedarikçi, Vitrin |

- Aktarım, aktif dönemdeki **tüm barkodlu stokları siler** ve Excel'dekileri yükler.
  Satılmış ürün kayıtları satış geçmişi için korunur.
- Has boşsa `gram × milyem` ile, Maliyet/Satış HAS boşsa `has + işçilik` ile hesaplanır.

## 2. Barkodsuz (açık) stoklar
Pusula'da stok özeti / açık stok listesini (çeyrek, yarım, gram altın, ayar bazında
hurda vb.) Excel'e aktarın.

| Gerekli | Olursa iyi olur |
|---|---|
| Stok Kodu veya Ürün Adı | Has, İşçilik, Maliyet HAS |
| Ayar | Birim (GR / ADET) |
| Miktar | Adetli ürünlerde birim gram (ör. çeyrek 1,75) |

- Aktif dönemdeki **tüm barkodsuz stoklar silinir**, Excel'dekiler yüklenir.

## 3. Cari bakiyeleri
Pusula'da cari bakiye listesini (tüm cariler, birim bazında bakiye) Excel'e aktarın.

| Gerekli | Olursa iyi olur |
|---|---|
| Cari Kodu ve/veya Cari Adı | Tür (Müşteri / Toptancı / Banka / Özel), Telefon |
| Bakiye sütunları: TL, HAS, USD, EUR, ayar (22, 14…) | |

- Bakiye tek sütunda (+/−) veya ayrı **Borç** / **Alacak** sütunlarında olabilir;
  ekranda her sütunun birimini ve yönünü kontrol edin.
- **"Excel'deki artı (+) bakiye"** seçeneğini Pusula'daki işarete göre seçin:
  çoğunlukla artı = cari bize borçlu.
- Her carinin bakiyesi Excel'deki değere eşitlenir; fark **DEVİR / AÇILIŞ** hareketi olarak
  yazılır, böylece cari ekstresi ile bakiye tutarlı kalır. Bulunamayan cari yeni açılır.
  **Cari kartları silinmez.**
- "Excel'de olmayan carilerin bakiyesini sıfırla" işaretliyse listede olmayan carilerin
  bakiyesi sıfırlanır.

## Kontrol
Aktarımdan sonra Stok · Stok + Kasa Özeti ve Cari sayfasındaki toplamları Pusula'daki
raporlarla karşılaştırın. Bir şey yanlışsa **Yedek · Bulut → Bulut Yedek Geçmişi**
listesinden "PUSULA AKTARIM ÖNCESİ" yedeğine dönebilirsiniz.
