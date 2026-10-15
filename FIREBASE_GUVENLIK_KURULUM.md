# Firebase Bulut Güvenliği Kurulumu (V6.96)

> **Proje:** Program kendi Firebase projesini kullanır: `kuyumpro-f33c2`
> (`https://kuyumpro-f33c2-default-rtdb.europe-west1.firebasedatabase.app`). Fiyat ekranı eski
> `asil-kuyumculuk-2feb6` projesinde kalır; iki sistemin kotaları birbirini etkilemez.
>
> **Veri kullanımı:** Durum buluta gzip ile sıkıştırılmış yazılır; cihazlar yalnız küçük
> `kuyumcuProV5/rev` kaydını dinler ve veriyi ancak başka bir cihaz değiştirdiğinde indirir.
> Yedek temizliği yedek içeriklerini indirmez; otomatik/açılış yedekleri 3 gün tutulur.

Bu adımlar tamamlanana kadar bulut veritabanı **herkese açıktır**: adresi bilen
herkes müşteri, kimlik, bakiye ve stok verisini okuyabilir, değiştirebilir veya silebilir.
Kod tarafı hazırdır; aşağıdaki adımları Firebase konsolunda **sırasıyla** yapın.

> Sıra önemlidir. Kuralları (5. adım) en son yayınlayın; önce tüm cihazlarda bulut girişi yapın.
> Aksi halde girişi yapılmamış cihazlar senkron yapamaz (yerel veri kaybolmaz, sadece senkron durur).

## 1. E-posta/şifre girişini açın
Firebase Console → **Authentication** → **Sign-in method** → **Email/Password** → Etkinleştir.

## 2. Mağaza hesabını oluşturun
Authentication → **Users** → **Add user**. Örn. `magaza@asilkuyumculuk.com` ve güçlü bir şifre
(en az 12 karakter). Oluşan kullanıcının **User UID** değerini kopyalayın.

## 3. Yeni hesap açılmasını kapatın
Authentication → **Settings** → **User actions** → **Enable create (sign-up)** kutusunu kaldırın.
(Kurallar ayrıca UID listesiyle korur; bu ek bir önlemdir.)

## 4. Yetkili UID'yi ekleyin
Realtime Database → **Data** → kök düğümde `yetkiliKullanicilar` adlı bir alan ekleyin,
altına `<User UID>` : `true` yazın. Birden fazla hesap kullanacaksanız hepsini ekleyin.

## 5. Her cihazda bulut girişi yapın
Firebase Console → **Project settings** → **General** → **Web API Key** değerini kopyalayın.
Programda **Yedek · Bulut → Bulut Girişi / Ayarları** (veya giriş ekranındaki **☁ Bulut Girişi**)
→ Web API anahtarı, e-posta, şifre → **GİRİŞ YAP**. Bunu mağazadaki her PC/tablette bir kez yapın.

## 6. NFC köprüsü için sunucu anahtarı
Firebase Console → Project settings → **Service accounts** → **Database secrets** → anahtarı kopyalayın.
Vercel → Proje → Settings → **Environment Variables** → `FIREBASE_DB_SECRET` = anahtar → yeniden deploy.
(Bu anahtar yalnızca sunucuda durur; tarayıcıya gönderilmez.)

## 7. Kuralları yayınlayın
Realtime Database → **Rules** → bu repodaki `database.rules.json` içeriğini yapıştırın → **Publish**.

## 8. Kontrol
- Tarayıcıda giriş yapmadan `https://kuyumpro-f33c2-default-rtdb.europe-west1.firebasedatabase.app/kuyumcuProV5/state.json`
  adresini açın: **"Permission denied"** görmelisiniz.
- Programda Yedek · Bulut sayfasında rozet **GİRİŞLİ**, durum **Bağlı** olmalı.

## Kullanıcı şifreleri
Eski yedek dosyası (index.before-drag-editor.html) bir süre herkese açık yayında kaldı ve
içinde `1234` şifreleri vardı. **Tüm program kullanıcılarının şifrelerini değiştirin**
(Tanımlamalar → Kullanıcılar).
