# Asil Kuyumcu Pro V2.5 — Pusula Cari Hareket + Altın Giriş

GitHub Pages üzerinde doğrudan açılacak repo sürümüdür.

## V2.5 düzeltmeleri
- Altın ürün giriş ekranında **Brüt Gram / Net Gram alanı yoktur**.
- Altın girişinde yalnızca **Miktar (GR)** kullanılır.
- Ayar / milyem stok kartındaki **Milyem Sabiti** değerinden otomatik gelir.
- HAS = Miktar × Milyem / 1000.
- Birim İşçilik / Adet İşçilik HAS olarak girilir.
- Toplam İşçilik ve Karşı Hesap otomatik hesaplanır.
- Sol üst sürüm etiketi artık **PRO v2.5** görünür; böylece GitHub'da hangi dosyanın açık olduğu anlaşılır.

## Pusula'dan eklenen Cari Hareket Kodları
- AC - AÇIKLAMA
- AG - ALTIN GİRİŞ
- AL - ALACAKLANDIR
- BR - BORÇLANDIR
- CI - ÇIKAN İADE
- CV - ÇEVİRME
- HC - HURDA ÇIKIŞ
- HG - HURDA GİRİŞ
- MH - MAHSUP
- NO - NAKİT ÖDEME
- NT - NAKİT TAHSİLAT
- OC - ÖZEL ÜRÜN ÇIKIŞ
- OG - ÖZEL ÜRÜN ALIŞ
- SI - SATIŞ İADESİ
- TC - TAŞ ÇIKIŞ
- TG - TAŞ GİRİŞ
- TS - TAŞ SATIŞ
- ZC - ZİYNET ÇIKIŞ
- ZG - ZİYNET GİRİŞ

AG seçildiğinde ayrı **Altın Giriş** ekranına yönlenir. Diğer hareketler cari ekstreye koduyla kaydedilir. Göndereceğiniz ek Pusula hareketleri aynı kataloğa eklenebilir.

## Giriş
- Kullanıcı: `Admin`
- Şifre: `1234`

## GitHub'a yükleme
Repo ana dizinindeki şu dosyaları yükleyin:

```text
/
├─ index.html
├─ manifest.webmanifest
├─ icon.svg
├─ sw.js
├─ .nojekyll
└─ README.md
```

GitHub Pages: **Settings → Pages → Deploy from a branch → main → /(root)**.

> Not: Eski V2.3/V2.4 açık kalırsa tarayıcı önbelleği nedeniyle eski ekran görülebilir. Yeni dosyaları yükledikten sonra `Ctrl + F5` ile zorla yenileyin. V2.5 doğru açıldığında sol üstte **PRO v2.5** yazar.
