# Asil Kuyumcu Pro V6.21

## Kimlik / MASAK
- MASAK müşteri kayıtları mevcut cari kartlarından tamamen ayrıldı.
- Her kimlik tespiti yeni bir bağımsız MASAK müşterisi olarak kaydedilir.
- Satış kimlik eşiğini aştığında normal cari seçimi yerine bağımsız MASAK müşterisi seçilir.
- Satış kaydına `masakIdentityId` denetim bağı olarak kaydedilir.
- Gerçek kişi kaydında ıslak imzanın alındığı ayrıca işaretlenir.
- Kimlik ön/arka görüntüsü telefon kamerasıyla çekilebilir veya dosyadan eklenebilir.
- İmzalı kimlik tespit formu/görseli isteğe bağlı eklenebilir.
- Kimlik belge dosyaları normal Firebase state verisine eklenmez; cihazdaki IndexedDB alanında saklanır.
- Kimlik görüntüsü kaydı zorunlu alan yapılmadı; operasyonel/denetim delili olarak isteğe bağlıdır.

## NFC
- Web/PWA içinden T.C. Kimlik Kartının güvenli çipine sahte bir NFC okuyucu eklenmedi.
- Chrome Web NFC yalnız NDEF seviyesini desteklediğinden TCKK çip okuması için native Android yardımcı uygulaması veya EKDS/kart erişim cihazı gerekir.
- Form ve veri modeli daha sonra bu köprüden otomatik doldurulabilecek şekilde ayrık tasarlandı.

## Risk taraması
- Kimlik / MASAK ayarlarına Risk Tarama Proxy/Worker URL alanı eklendi.
- Her MASAK müşterisinde `Risk Tara` düğmesi bulunur.
- Program backend'e minimum kimlik eşleştirme alanlarını gönderir.
- Beklenen sonuçlar: TEMİZ / İNCELEME / EŞLEŞME.
- Tarama zamanı, kaynaklar, eşleşmeler, sağlayıcı etiketi ve kontrol eden kullanıcı denetim izi için kaydedilir.
- API anahtarı veya ticari veri sağlayıcı şifresi tarayıcı içine konmaz.

## Fatura
- Satışa bağlı bağımsız MASAK kimliği varsa e-Fatura/e-Arşiv alıcı bilgilerinde öncelikle bu kayıt kullanılır.

## Not
Kimlik belge görüntüleri ve TCKN yüksek riskli kişisel verilerdir. Canlı kullanımda çok cihazlı yapı için erişim kontrollü, şifreli sunucu depolaması ve KVKK süreçleri ayrıca kurulmalıdır.
