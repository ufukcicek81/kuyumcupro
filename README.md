# Asil Kuyumcu Pro V2.9

GitHub Pages için repo köküne yüklemeye hazır sürüm.

## V2.9 — Asil canlı fiyat entegrasyonu
- Mevcut Asil Kuyumcu fiyat ekranında kullanılan Cloudflare Worker'a bağlandı: `altin-proxy.ufuk87900.workers.dev`.
- HAS alış / satış otomatik olarak canlı sistemden alınır.
- USD, EUR, GBP ve CHF alış / satış fiyatları otomatik alınır.
- Eski Asil fiyat ekranındaki Firebase ayarları (`hasDuzA/hasDuzS`, döviz düzeltmeleri ve ürün katsayıları) okunur; böylece iki ekrandaki fiyat mantığı aynı kalır.
- HAS değişince Çeyrek, Yarım, Tam/Ziynet, Ata, Reşat, 22 ayar ve hurda fiyatları mevcut Asil katsayılarından otomatik hesaplanır.
- Satış ekranındaki Ziynet / Hurda / Döviz alış-satış işlemleri canlı fiyatı otomatik kullanır.
- Fiyat & Kur ekranına canlı bağlantı durumu, son güncelleme, `Şimdi Güncelle` ve otomatik fiyat aç/kapat kontrolü eklendi.
- Bağlantı kesilirse program son başarılı fiyatlarla çalışmaya devam eder.
- Service Worker dış kaynak fiyat isteklerini cache'lemez; canlı fiyatın eski cache'den gelmesi önlenir.
- `worker.js`, kullanılan Cloudflare Worker kodunun repo içindeki referans kopyasıdır. GitHub Pages bu dosyayı Worker olarak çalıştırmaz; mevcut dağıtılmış Worker URL'si kullanılmaya devam eder.

## Önceki V2.8 özellikleri
- Satış ekranında Ziynet Alış/Satış, Hurda Alış/Satış, Döviz Alış/Satış.
- Tüm işlemler Kasa / Finans hareketlerine otomatik yansır.
- USD, EUR, GBP, CHF kasa hesapları.
- Ziynet standart gram ve HAS hesapları.
- Tüm cari hareketlerin tek ekrandan yönetimi ve bağlı belge geri alma.

## GitHub Pages
1. ZIP'i bilgisayarda çıkarın.
2. İçindeki dosyaların tamamını repo ana dizinine yükleyin.
3. Commit edin.
4. Settings > Pages > Deploy from a branch > `main` > `/(root)` seçin.
5. Yayınlandıktan sonra `Ctrl + F5` yapın. Sol üstte **PRO v2.9** görünmelidir.

## Canlı fiyat notu
Program ilk açılışta Firebase ayarlarını, ardından canlı Worker fiyatlarını çeker. Normal yenileme aralığı **5 saniyedir**. İnternet/Worker erişimi yoksa son kayıtlı fiyatlar korunur.
