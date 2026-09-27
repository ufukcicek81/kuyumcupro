# V6.30 Değişiklikleri

- MASAK müşterileri cari kartlardan bağımsız kaldı.
- Yerel MASAK CSV watchlist içe aktarma ve eşleştirme motoru eklendi.
- OpenSanctions yaptırım + PEP/RCA taraması için gerçek Worker entegrasyonu eklendi.
- Risk sonucu ayrıntı ekranı eklendi.
- Kesin risk eşleşmesinde satış bağlama engeli eklendi (ayar kapatılabilir).
- NFC eşleştirme oturumu: 8 haneli kod, Worker KV, otomatik polling ve forma aktarım eklendi.
- `android-nfc-helper` Android Studio kaynak projesi eklendi.
- NFC verisi resmi EKDS sonucu gibi işaretlenmiyor; görevli doğrulaması ayrı tutuluyor.
- Kimlik ön/arka fotoğrafı + imzalı form alanları korundu; NFC çip fotoğrafı depolama alanı hazırlandı.
- Worker altın fiyatı + risk + NFC + e-Fatura proxy görevlerini tek dosyada topladı.
- `wrangler.example.toml` ve ayrıntılı kurulum belgesi eklendi.
- Uygulama sürümü 6.30'a yükseltildi.
