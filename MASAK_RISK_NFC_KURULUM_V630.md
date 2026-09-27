# Asil Kuyumcu Pro V6.30 — MASAK Risk + NFC Kurulum

## 1) Sistemde neler çalışıyor?

### Kimlik / MASAK
- MASAK müşterileri carilerden bağımsızdır.
- TCKN/VKN, belge no, doğum, uyruk, adres, meslek, anne-baba adı, telefon/e-posta ve ıslak imza takibi vardır.
- Kimlik ön/arka fotoğrafı ve imzalı form cihazdaki IndexedDB alanına eklenebilir.
- NFC'den gelen kayıt **otomatik doğrulandı yapılmaz**; görevli asıl belgeyi gördükten sonra doğrulama seçeneğini açar.

### Yerel MASAK listesi
- MASAK sitesinden indirilen CSV dosyaları `Kimlik / MASAK > Resmî MASAK Liste Yedeği` bölümünden içe alınabilir.
- Program ad/unvan, kimlik no ve doğum tarihi alanlarını kullanarak yerel eşleştirme yapar.
- Yerel liste internet kesilse de çalışır.
- Resmî sayfalar:
  - https://masak.hmb.gov.tr/5-maddeye-iliskin-bakanlar-kurulu-kararlari
  - https://masak.hmb.gov.tr/7madde
  - https://masak.hmb.gov.tr/bkk-ile-malvarliklari-dondurulanlar

### OpenSanctions
- Cloudflare Worker'a `OPENSANCTIONS_API_KEY` secret olarak girilirse yaptırım + PEP + RCA taraması çalışır.
- Program `sanction`, `sanction.linked`, `debarment`, `role.pep`, `role.rca` konularını tarar.
- OpenSanctions ticari kullanım için lisans/ücret gerektirir. Güncel şartları sağlayıcıdan teyit edin.

## 2) Cloudflare Worker

Mevcut `worker.js` artık dört işi tek dosyada yapabilir:
1. Altın fiyat proxy'si (`GET /`)
2. Risk tarama (`POST action=screenCustomer`)
3. NFC eşleştirme (`createNfcSession`, `submitNfcIdentity`, `pollNfcSession`)
4. Özel entegratöre e-Fatura/e-Arşiv proxy'si (`createInvoice`)

### KV oluşturma
Cloudflare'da bir KV namespace oluşturun ve Worker'a binding adı tam olarak:

`NFC_SESSIONS`

olarak bağlayın.

`wrangler.example.toml` örneği pakettedir.

### OpenSanctions secret

```bash
wrangler secret put OPENSANCTIONS_API_KEY
```

Tarama skoru varsayılanı `0.78`'dir; `OPENSANCTIONS_THRESHOLD` ile değiştirilebilir.

### Fatura entegratörü

Worker değişkenleri:
- `INVOICE_PROVIDER_URL`
- `INVOICE_AUTH_HEADER` (ör. Authorization)
- `INVOICE_AUTH_VALUE` (secret olarak)

Özel entegratörün gerçek JSON alanları farklıysa `forwardInvoice()` içinde sağlayıcıya özel dönüştürücü eklenmelidir. API adı/şeması bilinmeden bunu güvenli şekilde otomatik tahmin etmeyin.

## 3) Android NFC Helper

Kaynak klasör: `android-nfc-helper/`

Android Studio ile açılır. NFC'li gerçek telefonda test edilmelidir.

Kullanım:
1. Web programında `Kimlik / MASAK > NFC İLE KİMLİK AL`.
2. Program 8 haneli eşleştirme kodu verir.
3. Android uygulamada Worker URL + kod girilir.
4. Kimlik arka yüzündeki MRZ'den belge no, doğum tarihi ve son geçerlilik tarihi girilir.
5. Kart telefona dokundurulur.
6. Çip erişimi başarılıysa bilgiler programa gelir ve MASAK formu açılır.

### Resmî doğrulama sınırı
Bu yardımcı uygulama ICAO/MRTD uyumlu NFC çip erişimini dener. Bu, T.C. Kimlik Kartı için resmî **EKDS/KEC kimlik doğrulaması** değildir. TÜBİTAK'ın resmî EKDS yapısında KEC, KDS, KDPS ve rol sunucusu bileşenleri bulunur ve yetkili altyapı gerekir.

Resmî kaynaklar:
- https://oktem.bilgem.tubitak.gov.tr/hizmetler/elektronik-kimlik-dogrulama-sistemi/
- https://tubitak.gov.tr/tr/duyuru/elektronik-kimlik-dogrulama-sunucu-teknolojileri

## 4) Satış kontrolü
- Kimlik tespit eşiği program ayarından değiştirilebilir.
- Eşik üzerindeki işlemde tamamlanmış MASAK müşterisi olmadan satış kapanmaz (ayar açıksa).
- Risk sonucu `EŞLEŞME` ise satışa bağlama engellenir (ayar açıksa).
- `İNCELEME` sonucu otomatik suç/ihlal kararı anlamına gelmez; kullanıcı eşleşme detayını inceler.

## 5) Veri güvenliği
Kimlik görselleri bu sürümde tarayıcının IndexedDB alanındadır. Uygulama bunları Firebase genel durum JSON'una koymaz. Ancak IndexedDB uygulama seviyesinde uçtan uca şifreli bir arşiv değildir. Çok cihazlı, merkezi ve mevzuata uygun üretim kullanımı için kimlik dosyalarının kimlik doğrulamalı, yetkilendirmeli ve şifreli sunucu/R2 depolamasına taşınması gerekir.
