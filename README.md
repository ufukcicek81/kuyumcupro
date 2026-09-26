# Asil Kuyumcu Pro v6.12 — Pusula 72×10 Barkod Etiketi

Bu paket, kuyumcu barkod etiketini Pusula çıktısına yakın olacak şekilde yeniden düzenler.

## Yeni etiket düzeni
- Varsayılan fiziksel etiket: **72 × 10 mm**
- Tek ürün = tek 72×10 mm baskı sayfası
- Sol etiket kafası: barkod, ürün kodu, ASİL KUYUMCULUK
- Sağ etiket kafası: iki HAS fiyatı, ayar ve iç kod
- Sağdaki uzun kuyruk boş bırakılır
- ALY0001348 gibi alfanümerik kodlar için **CODE128** barkod kullanılır

## Yazıcı ayarları
- **Pusula 72×10 Hazır Ayar** düğmesi
- Yatay ve dikey milimetrik kaydırma
- Sol ve sağ kafa X konumları
- Sol ve sağ kafa genişlikleri
- Üst HAS fiyat çarpanı (varsayılan 1.12)
- Firma adı
- 203 / 300 / 600 DPI
- Tarayıcı veya QZ Tray baskısı

## İlk kurulum
Detaylı adımlar için `YAZICI_KURULUM.md` dosyasına bakın.


## v6.15
- Barkod Yazdır varsayılan olarak QZ Tray üzerinden doğrudan seçili/default etiket yazıcısına gönderilir.
- Tarayıcı yazdırma önizlemesi doğrudan modda açılmaz.
- İlk doğrudan baskıda default yazıcı otomatik bulunup kaydedilebilir.
