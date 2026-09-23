# Asil Kuyumcu Pro v5.3 — Tüm Cari Hareketleri Bağlı Motor

Cari Hesap İşlemleri ekranındaki tüm tanımlı hareket kodları tek tek tamamlandı.

- AC Açıklama: belge/audit, bakiye yok
- AG Altın Giriş: mevcut detaylı alış ekranı, açık stok + cari
- AX Altın Çıkış: açık altın stok + cari HAS
- AL Alacaklandır: cari kontrollü alacak belgesi
- BR Borçlandır: cari kontrollü borç belgesi
- CI Çıkan İade: açık stoktan çıkış + cari
- CV Çevirme: aynı caride iki birim arasında çift kayıt
- HC/HG Hurda Çıkış/Giriş: hurda gram+milyem, stok+cari
- MH Mahsup: iki cari arasında çift taraflı kayıt
- NT/NO Nakit Tahsilat/Ödeme: cari+kasa/banka
- OC/OG Özel Ürün Çıkış/Alış: özel ürün stoğu+cari
- SI Satış İadesi: bağlı satışın stok/finans/cari ters kaydı
- TC/TG/TS Taş hareketleri: CT stoğu+cari CT
- ZC/ZG Ziynet Çıkış/Giriş: adet stoğu + HAS cari

Silme/geri alma işleminde aynı belgeye bağlı stok, cari, kasa/banka ve karşı kayıtlar birlikte ters çevrilir.
