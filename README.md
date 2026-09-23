# Asil Kuyumcu Pro V5.1 — Toptancı + Banka/POS Akışı

Bu sürüm V5.0 Pusula çekirdeğini korur ve finans/cari akışını genişletir.

## TOPTANCI.xlsx aktarımı
- Pusula TOPTANCI.xlsx dosyasındaki 25 toptancı cari hesaba eklenir.
- Hesap kodları korunur.
- HAS, TL, USD ve 22 bakiyeleri DEVİR / AÇILIŞ hareketleriyle taşınır.
- Toplam aktarılan bakiye kontrolü: 22 = 1,67; HAS = -165,31; TL = -10.421,43; USD = -1.470,58.
- Mevcut kullanıcı verisi sıfırlanmaz; aktarım tek seferlik migration olarak çalışır.

## Cari Hesaplar
- Cari kartlarında Tümü / Müşteri / Toptancı / Banka / POS / Özel filtreleri.
- Tüm Cari Hareketler ekranında Hesap Tipi filtresi.
- Toptancılar cari arama ve hareket merkezinde görünür.

## Banka yönetimi
- Kasa / Finans ekranından + Banka Hesabı ile ekleme.
- Her banka hesabında Düzenle / Sil.
- Bakiye, finans hareketi veya bağlı POS bulunan banka güvenlik nedeniyle silinemez.

## POS yönetimi
- Kasa / Finans ekranında POS Hesapları / Komisyon Oranları bölümü.
- POS başına komisyon %, valör günü, komisyon gider hesabı ve hesaba geçeceği banka seçilir.
- Kredi kartı çekimi brüt POS bakiyesine girer.
- Valör aktarımında çekim anındaki komisyon oranı otomatik düşülür.
- Komisyon gider hesabına ayrı gider; net tutar seçilen banka hesabına girer.
- Eski POS hareketlerinde daha önce yazılmış komisyon varsa ikinci kez kesilmez.

## Havale / EFT
- Satış ödeme/takas bölümüne Havale / EFT sekmesi eklendi.
- Banka seçildiğinde işlem otomatik Havale / EFT Tahsilat veya Havale / EFT Ödeme olur.
- Havale komisyonsuzdur; seçilen banka hesabına net tutar işlenir.
- Kasa seçildiğinde nakit, POS seçildiğinde kredi kartı akışı otomatik seçilir.

## Sürüm
Arayüz: PRO v5.1
