# Asil Kuyumcu Pro V5.0 — Pusula Çekirdek

Bu sürüm, Pusula eğitimlerinden çıkarılan ana farkları uygulamak için V4.x üzerindeki yamaları tek bir işlem çekirdeğinde toplamaya başlar.

## Uygulananlar
- Bağlı işlem defteri / Transaction ID
- Satış, cari, kasa/POS, stok ve alış belgelerinin belge numarasıyla eşleştirilmesi
- Ürün değişimi: eski satış geri alınır, yeni ürün aynı fişe açılır, fiyat farkı satış ekranında kapatılır
- Tam müşteri satış iadesi ve iptal arşivi
- Toptancıya barkodlu ürün iadesi + HAS cari ters hareketi
- Barkodlu ürün → hurda dönüşümü
- Hurda → açık stok/mamul dönüşümü; fire ve işçilik HAS
- Pırlanta, saat, gümüş, çelik, taş ve diğer özel ürün kartları; seri no, RFID, sertifika, fotoğraf
- POS valör/komisyon sonrası banka net aktarımı
- Gerçek dönem kapatma/devir
- Asil'in mevcut Firebase RTDB altyapısında merkezi PC/tablet veri senkronu
- Kullanıcı bazlı iade, dönüşüm, dönem kapatma ve bulut yetkileri
- Mevcut barkod/RFID sayım ve etiket yazdırma altyapısı korunur
- V4.11 HAS raporları ve gerçek Pusula stok/cari başlangıç verileri korunur

## Merkezi veri
Uygulama yerel tarayıcı verisini korur ve ayrıca mevcut Asil Firebase projesindeki `kuyumcuProV5/state` yoluyla merkezi senkron yapar. Bağlantı veya Firebase kuralı izin vermezse yerel kullanım devam eder; İşlem Merkezi/Yedek sayfasında durum görünür.

## SQL geçişi
`database/schema.sql` dosyası aynı işlem modelinin PostgreSQL/SQL sunucuya taşınması için hazırlanmıştır. Statik GitHub Pages içinde doğrudan SQL sunucusuna güvenli kimlik bilgisi koyulmadığı için canlı merkezde mevcut Asil Firebase kullanılmıştır.
