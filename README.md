# Asil Kuyumcu Pro

Kuyumcu stok, satış, cari, kasa/banka, ziynet/hurda/döviz, etiket ve fiş yönetimi.
Tek sayfalık web uygulaması (`index.html`); Vercel üzerinde yayınlanır.

## Dosyalar

| Yol | Açıklama |
|---|---|
| `index.html` | Uygulamanın kendisi |
| `js/` | Bulut girişi, çakışmasız senkron ve şifreli yedek modülleri |
| `cari-fix-final.js` | Döviz Alış/Satış çoklu satır ve işlem özeti |
| `api/` | Vercel sunucu fonksiyonları (MASAK listesi, NFC köprüsü) |
| `worker.js`, `wrangler.example.toml` | Cloudflare Worker (fiyat, risk tarama, e-fatura aktarımı) |
| `database.rules.json` | Firebase güvenlik kuralları |
| `sw.js` | Eski önbellekleri temizleyen güvenli service worker |
| `digital-certificate.txt` | QZ Tray sessiz baskı sertifikası |
| `BANKA_CSV_ORNEK.csv`, `MASAK_CSV_ORNEK.csv` | İçe aktarma örnek dosyaları |
| `tests/`, `scripts/` | Otomatik testler ve sözdizimi kontrolü |

## Kurulum rehberleri
- Bulut güvenliği (önce bu): `FIREBASE_GUVENLIK_KURULUM.md`
- Etiket yazıcısı: `YAZICI_KURULUM.md`
- QZ Tray sessiz baskı: `QZ_SESSIZ_BASKI_KURULUM.md`
- Pusula'dan aktarım (stoklar, cari bakiyeleri): `PUSULA_AKTARIM.md`
- MASAK, risk tarama ve NFC: `MASAK_RISK_NFC_KURULUM_V630.md`
- e-Fatura / e-Arşiv: `FATURA_ENTEGRASYON.md`

## Testler
```
cd tests
npm ci
npm run check      # sözdizimi
npm test           # birim testleri
npm run test:e2e   # tarayıcı testleri (Chromium gerekir)
```
Testler her push ve PR'da GitHub Actions ile çalışır (`.github/workflows/test.yml`).
