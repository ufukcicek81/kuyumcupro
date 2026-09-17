# Asil Kuyumcu Pro V4.1 — Pusula Uyumlu Toplu Revizyon

GitHub Pages repo köküne doğrudan yüklenmeye hazır sürüm.

## Bu sürümde toplu olarak eklenen / düzenlenenler
- Pusula alışkanlığına daha yakın PC arayüzü: üst fiyat bandı, hızlı işlem butonları, kompakt tablolar, turuncu bölüm başlıkları ve klasik stok görünümü.
- Karanlık / Aydınlık ve PC / Tablet modları korunur.
- Gerçek Pusula başlangıç verileri kullanılır: barkodlu stok, açık stok, hurda, cariler, kasa/banka/POS bakiyeleri.
- Barkodlu stok başlangıcı: 1.691 gerçek ürün ve mevcut Pusula barkodları korunur.
- Cari başlangıç verileri ve TL/HAS/22/USD/EUR/CHF/GBP gibi çoklu bakiye türleri korunur.
- Satış ekranında barkodlu + barkodsuz/açık stok satışı aynı fişte.
- Satışta takas/mahsup: Altın-Ziynet, hurda, nakit, kart, açık hesap, ödeme, komisyon ve iade aynı fişte birlikte kullanılabilir.
- Açık stoktan barkodlu stok üretme: barkod basıldıkça gram ve maliyet işçiliği açık stoktan barkodlu stoğa aktarılır; mağaza toplam stoğu değişmez.
- Satılmamış barkod açık stoğa geri alınabilir.
- Pusula tipi stok + kasa özeti: açık stok, barkodlu stok, hurda, kasa, banka ve POS tek ekranda.
- Cari hareketlerin tamamı tek merkezden görülür ve bağlı belge mantığıyla geri alınabilir.
- Cari Hesap Kartı genişletildi: Müşteri, Toptancı, Kasa, Banka, POS, Personel, Krediler, İskonto, Kâr/Zarar, Özel, Gelir ve Gider hesap tipleri.
- Banka/POS tanımında muhasebe niteliği, komisyon oranı, valör, komisyon gider hesabı ve varsa komisyon gelir hesabı ayrımı.
- Sistem Parametreleri ekranı eklendi; Pusula'daki hesap/grup, satış, stok, fiyat/kur, POS/banka, yazıcı, RFID ve fatura parametreleri düzenlenebilir.
- Kullanıcı yetkileri: satan eleman, satış fiyatı değiştirme, maliyet görme ve finans yetkisi.
- Mevcut Asil Kuyumcu canlı fiyat altyapısı korunur: HAS alış/satış ile USD/EUR/GBP/CHF fiyatları Worker + Firebase ayarlarından otomatik alınır.

## GitHub Pages'e yükleme
1. ZIP'i bilgisayarda çıkarın.
2. İçindeki dosya ve `data` klasörünün tamamını repo ana dizinine yükleyin.
3. Commit edin.
4. Settings > Pages > Deploy from a branch > `main` > `/(root)` seçin.
5. Yayınlandıktan sonra `Ctrl + F5` yapın.
6. Sol üstte **PRO v4.1** görünmelidir.

## Önemli veri notu
Bu sürüm yeni localStorage anahtarı (`asil_kuyumcu_pro_v4_real`) kullanır. İlk açılışta deneme verileri yerine `data/pusula-initial.js` içindeki gerçek Pusula başlangıç verisi yüklenir. V4.1 üzerinde yaptığınız yeni hareketler tarayıcıda saklanır.

## Canlı fiyat
- Worker: `altin-proxy.ufuk87900.workers.dev`
- Firebase ayarları mevcut Asil Kuyumcu fiyat sistemiyle aynıdır.
- Dış kaynak fiyat istekleri Service Worker cache'ine alınmaz.


## V4.1 veri yükleme düzeltmesi
- 1.691 barkodlu ürün ve 82 gerçek cari `index.html` içine gömülüdür; `data/` klasörü eksik yüklense bile açılır.
- V4.0 ve önceki deneme localStorage kayıtları ilk açılışta otomatik sıfırlanır.
- Gerçek Pusula açılış stok/cari/kasa verisi yeniden yazılır.
- Deneme satış, hurda işlem, gider ve alış kayıtları temizdir.
- Cari bakiyeleri için yalnız `DEVİR / AÇILIŞ` satırları oluşturulmuştur.
