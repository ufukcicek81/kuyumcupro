# QZ Tray Sessiz Baskı Kurulumu — V6.17

Bu sürüm, QZ Tray uyarı penceresini kaldırmak için imzalı istek kullanır.

## Önemli güvenlik kararı
- `digital-certificate.txt` herkese açık sertifikadır ve projeye eklenmiştir.
- `private-key.pem` projeye / GitHub'a EKLENMEMİŞTİR.
- Özel anahtar yalnızca kullanıcının kendi tarayıcısında `localStorage` içinde tutulur.

## İlk kurulum (bir kere)
1. QZ Tray açık olsun.
2. Programda Barkod / Etiket > Yazıcı Ayarları'nı aç.
3. `QZ Yetkilendir (1 Kez)` düğmesine bas.
4. QZ Tray Demo Cert klasöründeki `private-key.pem` dosyasını seç.
5. `QZ Bağlantısını Test Et` de.
6. `Yazıcıları Bul` de, etiket yazıcısını seç.
7. `AYARLARI KAYDET` de.
8. Bundan sonra `Barkod Yazdır` doğrudan seçili yazıcıya gider.

## Not
Tarayıcı verileri temizlenirse özel anahtar da silinir ve 3. adımı yeniden yapmak gerekir.
