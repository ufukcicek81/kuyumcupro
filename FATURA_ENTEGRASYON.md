# e-Fatura / e-Arşiv Entegrasyonu (V6.20)

Program tarayıcı içinde çalıştığı için özel entegratör API kullanıcı adı, parola veya API anahtarı `index.html` içine yazılmamalıdır.

## Önerilen yapı

Asil Kuyumcu Pro -> HTTPS POST -> Cloudflare Worker / güvenli backend -> Özel Entegratör API -> GİB

Programdaki **e-Fatura / e-Arşiv > Entegrasyon Ayarları** alanına sadece Worker/Proxy URL girilir. Entegratör kimlik bilgileri sunucu tarafında secret/env olarak tutulur.

## Programın gönderdiği örnek istek

```json
{
  "action": "createInvoice",
  "documentType": "AUTO",
  "issuer": {"vkn": "...", "title": "..."},
  "receiver": {"name": "...", "tckn": "...", "vkn": "...", "address": "...", "phone": "...", "email": "..."},
  "sale": {"id": "...", "docNo": "SAT-...", "date": "...", "total": 0, "currency": "TL", "discount": 0, "note": "...",
    "lines": [{"code": "...", "name": "...", "quantity": 1, "unit": "GR", "karat": "916", "hasWeight": 0.229,
               "total": 70000, "goldValue": 10000, "labourAmount": 50000, "vatRate": 20, "vatAmount": 10000,
               "taxType": "OZELMATRAH", "exemptionCode": "805",
               "exemptionReason": "Altından mamul veya altın içeren ziynet eşyaları ile sikke altınların teslimi",
               "legalBasis": "KDVK md. 23/e"}]},
  "invoiceType": "OZELMATRAH",
  "totals": {"goldValue": 10000, "labourAmount": 50000, "vatRate": 20, "vatAmount": 10000, "total": 70000}
}
```

## Altın bedeli / işçilik / KDV ayrımı

- **Altın bedeli** = satırın HAS miktarı × satış anındaki HAS satış fiyatı. Taslak ekranında satır satır elle düzeltilebilir.
- **İşçilik** = satış tutarı − altın bedeli. Satış fiyatı KDV dahil kabul edilir; KDV yalnız işçilikten iç yüzdeyle ayrılır
  (KDV Kanunu md. 23/e). `labourAmount` KDV hariç işçiliktir: `goldValue + labourAmount + vatAmount = total`.
- Satıştaki iskonto/iade satırlara tutarlarıyla orantılı dağıtılır.
- KDV oranı Sistem Ayarları > Satış > KDV Oranı parametresinden gelir.
- Entegratörde altın bedeli satırı KDV'siz (matrah dışı) kalem, işçilik KDV'li kalem olarak eşlenmelidir; eşleme biçimini mali müşavir ve entegratörle teyit edin.

## Beklenen cevap

```json
{
  "ok": true,
  "status": "Gönderildi",
  "invoiceNo": "ABC2026000000001",
  "uuid": "...",
  "pdfUrl": "https://..."
}
```

Özel entegratör seçildiğinde (ör. firmanızın kullandığı sağlayıcı) Worker tarafındaki alan eşleştirmesi sağlayıcının güncel API dokümanına göre yapılmalıdır.

## Vergi türü ve istisna / özel matrah kodu

Her satır bir vergi türü ve GİB kodu taşır (`taxType`, `exemptionCode`, `exemptionReason`, `legalBasis`):

| Tür | Kod | Kullanım | Hesap |
|---|---|---|---|
| OZELMATRAH | 805 | Altın ziynet ve sikke altın (KDVK 23/e) | KDV yalnız işçilikten |
| OZELMATRAH | 808 | Gümüş ziynet ve sikke gümüş (KDVK 23/e) | KDV yalnız işçilikten |
| ISTISNA | 230 | Külçe altın / gümüş / kıymetli taş (KDVK 17/4-g) | KDV yok |
| SATIS | — | Normal satış | KDV tutarın tamamından |

- Kod ürüne göre otomatik seçilir (ADET veya ziynet adı → 805, gümüş → 808, 995+ milyem gram/külçe → 230), taslakta satır satır değiştirilebilir.
- Kod listesi e-Fatura > Entegrasyon Ayarları > "KDV İstisna ve Özel Matrah Kodları" bölümünden düzenlenir; yeni kod eklenebilir.
- GİB'de bir faturanın tek tipi olur. Satışta farklı türler varsa `invoiceType` = `KARMA` gelir; entegratör satışı ayrı faturalara bölmelidir.
- Kod numaraları GİB UBL-TR Kod Listeleri kılavuzundan ve mali müşavirle teyit edilmelidir.
