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
  "sale": {"id": "...", "docNo": "SAT-...", "date": "...", "total": 0, "currency": "TL", "discount": 0, "note": "...", "lines": []}
}
```

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
