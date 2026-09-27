# Asil Kuyumcu Pro V6.20 Değişiklikleri

## PC modu
- PC modunda menü, tablo, buton, form, özet, satış ve metrik yazıları büyütüldü.
- Tablo satır yükseklikleri ve form alanları artırıldı.
- Masaüstü menü genişliği okunabilirlik için büyütüldü; mobil kırılım etkilenmez.

## Kimlik / MASAK
- Yeni `Kimlik / MASAK` menüsü.
- Gerçek/tüzel kişi kimlik kayıt formu.
- Varsayılan 185.000 TL kimlik tespit eşiği (ekrandan değiştirilebilir).
- Eşik üzeri satışta cari/kimlik doğrulaması eksikse satış kapanmaz.
- TCKN/VKN, belge no, adres, doğum, anne/baba, uyruk, meslek ve doğrulayan personel kaydı.
- Hassas kimlik kayıtları Firebase genel durum verisine dahil edilmez; cihazda ayrı localStorage alanında tutulur.

## Banka Hareketleri
- Yeni `Banka Hareketleri` menüsü.
- CSV/ekstre içe aktarma.
- Mükerrer satır kontrolü.
- Mevcut finans hareketiyle tutar/tarih bazlı olası eşleştirme.
- Eşleşmeyen satırı kontrollü şekilde yeni banka hareketine kaydetme.
- Ekstreyi içeri almak tek başına banka bakiyesini değiştirmez; çift kayıt riski azaltılır.

## e-Fatura / e-Arşiv
- Yeni fatura menüsü.
- Faturası kesilmemiş satış listesi.
- Satıştan fatura taslağı üretme.
- Fatura kayıt ve durum ekranı.
- Özel entegratöre bağlanmak için güvenli Proxy / Cloudflare Worker URL ayarı.
- API kullanıcı adı/şifresi tarayıcıya yazılmaz; sunucu tarafında tutulacak şekilde tasarlandı.

## Dosyalar
- `FATURA_ENTEGRASYON.md`: entegrasyon istek/cevap sözleşmesi.
- `BANKA_CSV_ORNEK.csv`: banka hareketi içe aktarma için örnek dosya.
