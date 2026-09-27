# MASAK / NFC / Risk Tarama Entegrasyonu

## 1. Kimlik kaydı
Programdaki MASAK müşteri havuzu cari hesaplardan bağımsızdır. Satış muhasebesindeki cari ile kimlik tespit kaydı ayrı tutulur ve yalnız işlem sırasında `masakIdentityId` ile bağlanır.

## 2. Kimlik görselleri
- `front`: kimlik ön yüzü
- `back`: kimlik arka yüzü
- `signed`: imzalı kimlik tespit formu/belgesi

Bu dosyalar tarayıcı IndexedDB alanında tutulur. Firebase state JSON'una dahil edilmez.

## 3. NFC
Saf web/PWA sürümü T.C. Kimlik Kartının güvenli çipini doğrudan okuyamaz. Gerçek NFC entegrasyonu için iki seçenek önerilir:
1. Android native yardımcı uygulama: NFC/ISO-DEP ile TCKK okuyup doğrulanan alanları PWA'ya güvenli köprüyle iletir.
2. PC EKDS/kart erişim cihazı: yetkili cihaz/middleware üzerinden kimlik kartı doğrulaması yapılır.

NFC ile veri çekilmesi tek başına mevzuata uygun kimlik tespitinin bütün şartlarını ortadan kaldırmaz; imza ve diğer zorunlu teyit adımları ayrıca uygulanmalıdır.

## 4. Risk tarama backend sözleşmesi
Program şu yapıda POST gönderir:

```json
{
  "action": "screenCustomer",
  "customer": {
    "id": "KYC-...",
    "personType": "Gerçek Kişi",
    "fullName": "AD SOYAD",
    "tckn": "...",
    "vkn": "",
    "birthDate": "YYYY-MM-DD",
    "birthPlace": "...",
    "nationality": "T.C.",
    "documentNo": "..."
  }
}
```

Backend'in önerilen cevabı:

```json
{
  "ok": true,
  "status": "CLEAN",
  "provider": "MASAK + PEP provider",
  "sources": ["MASAK 6415/5", "MASAK 6415/7"],
  "matches": [],
  "message": ""
}
```

`status` için CLEAN/TEMİZ -> TEMİZ, MATCH/HIT/EŞLEŞME -> EŞLEŞME, diğer durumlar -> İNCELEME olarak gösterilir.

## 5. Backend kaynakları
Arka servis en az şu veri kümelerini güncel tutmalıdır:
- MASAK / 6415 md. 5 kapsamındaki BM kaynaklı malvarlığı dondurma listeleri
- MASAK / 6415 md. 7 kapsamındaki iç dondurma listeleri
- Gerekirse 6415 md. 6 ve 7262 kapsamındaki diğer yaptırım/dondurma listeleri
- PEP/Kamusal Nüfuz Sahibi Kişi taraması için uygun bir veri kaynağı veya ticari servis

Bir isim benzerliği otomatik olarak müşterinin suçlu veya yasaklı olduğu anlamına gelmez. Eşleşmeler kimlik numarası, doğum tarihi/yeri, uyruk ve diğer ayırt edici bilgilerle incelemeye alınmalıdır.

## 6. Güvenlik
- Risk servisi API anahtarları yalnız backend/Worker secret alanında tutulmalıdır.
- Tarayıcıya API anahtarı yazılmamalıdır.
- Tarama sonucu, kaynak sürümü/tarihi ve kullanıcı denetim izi kaydedilmelidir.
- Çok cihazlı üretim kullanımında kimlik görselleri yerel tarayıcı yerine şifreli ve erişim kontrollü sunucu depolamasına taşınmalıdır.
