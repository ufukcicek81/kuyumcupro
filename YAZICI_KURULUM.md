# Barkod Yazıcı Kurulumu — Pusula 72×10 Kuyumcu Etiketi

Bu sürümde kuyumcu etiketi **72 × 10 mm** olarak Pusula düzenine göre hazırlanmıştır.

## Program içinden

1. **Stok Yönetimi → Barkod / Etiket** ekranına girin.
2. **Yazıcı Ayarları** düğmesine basın.
3. **Pusula 72×10 Hazır Ayar** düğmesine basın.
4. Etiket ölçülerinin **72 mm × 10 mm** olduğunu kontrol edin.
5. Önce **Test Etiketi Bas** ile deneme yapın.

Etiket düzeni:
- Sol kafa: barkod + ürün/barkod kodu + ASİL KUYUMCULUK
- Sağ kafa: üst HAS fiyatı + satış HAS + ayar + Pusula iç kod
- Uzun sağ kuyruk: boş

## Yazıcı sürücüsünde

Yazıcı özelliklerinde özel kağıt/etiket boyutu oluşturun:

- Genişlik: **72 mm**
- Yükseklik: **10 mm**
- Ölçek: **%100 / Gerçek boyut**
- Sayfaya sığdır: **Kapalı**
- Kenar boşluğu: **0 mm**
- Yön: **Normal / Portrait**

Tarayıcı yazdırma ekranında da aynı 72 × 10 mm kağıt boyutunu seçin.

## Pusula tarzı fareyle yerleşim

**Yazıcı Ayarları** ekranının üstünde 72×10 mm etiketin büyütülmüş bir önizlemesi vardır.

- Barkod
- Ürün Kodu
- Şirket Adı
- Etiket / Üst HAS
- Satış HAS
- Ayar
- Özel Kod

alanlarının her biri fareyle tutulup sürüklenebilir. Seçilen alan için ayrıca **X, Y, genişlik, yükseklik, yazı boyutu ve Bold** değerleri değiştirilebilir. Ok tuşları alanı **0.1 mm** adımlarla hassas kaydırır.

Baskının tamamı fiziksel etikete göre kayıksa:

- **Tüm Etiketi Yatay Kaydır:** `+` sağa, `-` sola
- **Tüm Etiketi Dikey Kaydır:** `+` aşağı, `-` yukarı

Sadece bir yazı veya barkod kayıksa tüm etiketi değil, önizleme üstünde yalnız o alanı sürükleyin.

**Tüm Yerleşimi Sıfırla** düğmesi başlangıç Pusula düzenine döndürür.

## Pusula örneği

Test etiketi karşılaştırma için ALY0001348 örneğini kullanır:
- Üst: 4.88 HAS
- Alt: 4.36 HAS
- Ayar: 14 K
- İç kod: 0291.0.00.80.3.98

Üst HAS değeri varsayılan olarak satış HAS × **1.12** hesaplanır. Bu çarpan Yazıcı Ayarları ekranından değiştirilebilir.

## QZ Tray (isteğe bağlı)

Doğrudan termal yazıcıya göndermek için:
1. QZ Tray kurun ve çalıştırın.
2. Yazdırma yöntemi olarak **QZ Tray — Doğrudan Etiket Yazıcısı** seçin.
3. **QZ Bağlantısını Test Et** düğmesine basın.
4. **Yazıcıları Bul** ile etiket yazıcısını seçin.
5. Test etiketi basın.

203 DPI yazıcıda DPI 203, 300 DPI yazıcıda DPI 300 seçin.

## v6.15 — Yazdırma ekranını açmadan doğrudan baskı

Bu sürümde **Barkod Yazdır** varsayılan olarak `QZ Tray — Doğrudan Etiket Yazıcısı` modundadır. Tarayıcının yazdırma önizlemesi açılmaz.

İlk kullanımda bir kez:
1. QZ Tray'i bilgisayara kurup çalıştırın.
2. Programda **Barkod / Etiket → Yazıcı Ayarları** açın.
3. **Yazıcıları Bul** düğmesine basın.
4. Etiket yazıcınızı seçip **AYARLARI KAYDET** deyin.
5. Bundan sonra **Barkod Yazdır** düğmesi etiketi doğrudan seçilen yazıcıya yollar.

Not: Normal web tarayıcısı güvenlik nedeniyle tek başına sessiz/doğrudan baskı yapamaz. Bu nedenle doğrudan baskı QZ Tray üzerinden yapılır. `Tarayıcı Yazdır` modu seçilirse önizleme ekranı tekrar açılır.

## V6.17 - QZ İmzalı Sessiz Baskı
Yazıcı ayarlarından `QZ Yetkilendir (1 Kez)` düğmesine basıp `private-key.pem` dosyasını seçin. Bu özel anahtar GitHub'a yüklenmez, yalnızca o tarayıcıda tutulur. Ardından QZ bağlantısını test edin ve yazıcıyı seçin.
