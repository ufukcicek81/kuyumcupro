# Asil Kuyumcu Pro V2.3

GitHub Pages üzerinde doğrudan çalışacak şekilde hazırlanmış statik repo sürümüdür.

## Giriş
- Kullanıcı: `Admin`
- Şifre: `1234`

## GitHub'a yükleme
Bu klasörün **içindeki dosyaları** reponun ana dizinine yükleyin. `index.html` repo kökünde olmalıdır.

Beklenen yapı:

```text
/
├─ index.html
├─ manifest.webmanifest
├─ icon.svg
├─ sw.js
├─ .nojekyll
└─ README.md
```

## GitHub Pages
1. Repo > **Settings** > **Pages**
2. **Build and deployment** altında Source: **Deploy from a branch**
3. Branch: **main**
4. Folder: **/(root)**
5. **Save**

GitHub kısa süre sonra Pages adresini oluşturur.

## Önemli
Bu V2.3 sürümü tarayıcıdaki `localStorage` ile veri tutar. Yani GitHub Pages üzerinde program açılır; ancak farklı bilgisayar/telefonlar arasında ortak veritabanı senkronizasyonu henüz yoktur. SQL/Supabase/Firebase gibi merkezi veritabanı sonraki aşamada bağlanmalıdır.
