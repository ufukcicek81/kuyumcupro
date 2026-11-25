# Dükkan Köprüsü — İşNet (NetteFatura) e-Fatura / e-Arşiv

Program faturayı dükkan bilgisayarındaki bu küçük köprüye gönderir, köprü de İşNet'e iletir.
İşNet kimliği **sabit IP + VKN** ile doğrular: hiçbir kullanıcı adı veya şifre gerekmez, girilmez.

## 1. Kurulum (dükkan bilgisayarı, bir kez)

1. https://nodejs.org adresinden **LTS** sürümünü indirip kurun (İleri → İleri → Bitir).
2. Bu `kopru` klasörünü bilgisayara kopyalayın (ör. `C:\AsilKopru`).
3. `BASLAT.bat` dosyasına çift tıklayın. Siyah pencerede
   `Asil Kuyumcu Köprü çalışıyor → http://127.0.0.1:8787` yazmalı. **Pencereyi kapatmayın.**
4. **Otomatik başlatma (önerilen):** `OTOMATIK_BASLAT_KUR.bat` dosyasına bir kez çift tıklayın.
   Köprü bundan sonra bilgisayar her açıldığında **pencere açmadan** arka planda kendiliğinden başlar
   (şu anda da başlatılır). Kayıtları bu klasördeki `kopru.log` dosyasındadır.
   - Kontrol: programda **Bağlantıyı Test Et** ya da tarayıcıda `http://127.0.0.1:8787`.
   - Kaldırmak / durdurmak için: `OTOMATIK_BASLAT_KALDIR.bat`.
   - Otomatik başlatma kuruluyken `BASLAT.bat` açılırsa "zaten çalışıyor" der ve kapanır.

## Güncelleme

`GUNCELLE.bat` dosyasına çift tıklayın: köprünün son sürümünü indirir, çalışan köprüyü yeni sürümle
yeniden başlatır. `asil-kopru.json` (ayarlarınız) değiştirilmez. Sürüm, programda **Bağlantıyı Test Et**'te görünür.

## 2. Programda ayar

e-Fatura / e-Arşiv → **Entegrasyon Ayarları**:

- **Köprü / Proxy URL:** `http://127.0.0.1:8787`
- **Ayarları Kaydet** → **Bağlantıyı Test Et**. "Köprü çalışıyor · İşNet: bağlı · Kontör: …" görünmeli.
- Tarayıcı "yerel ağdaki cihazlara erişim" izni sorarsa **İzin ver** deyin.

## 3. Test ortamı (şu anki ayar)

`asil-kopru.json`:

```json
{ "mode": "test", "vkn": "4810173324", "port": 8787 }
```

Test faturaları İşNet'in test firması (isnet test, 4810173324) adına kesilir; gerçek fatura değildir.
Kesilen faturalar http://efatura.isnet.net.tr test portalında görülebilir.

## 4. Canlıya geçiş

1. Testte başarıyla gönderilen bir faturanın XML dosyasını alın: Fatura Kayıtları → **XML** düğmesi.
2. Bu XML dosyasını ve dükkânın **sabit IP adresini** efaturadestek@nettefatura.com.tr adresine gönderin.
3. İşNet canlı tanımı yapıp canlı servis adresini bildirince `asil-kopru.json` dosyasını şöyle değiştirin:

```json
{ "mode": "live", "vkn": "FİRMANIZIN VKN'si", "port": 8787, "serviceUrl": "İşNet'in bildirdiği canlı adres" }
```

   (Adres `.../InvoiceService/ServiceContract/InvoiceService.svc` kısmından önceki bölümdür,
   ör. `https://einvoiceservice.isnet.net.tr`.)
4. Köprü penceresini kapatıp `BASLAT.bat` ile yeniden açın; programda **Bağlantıyı Test Et** → Ortam: **CANLI**.

Canlıda programdaki "Firma VKN" ile köprüdeki VKN aynı değilse köprü faturayı göndermez (yanlışlıkla
başka firma adına fatura kesilmesin diye).

## Nasıl karar verir?

- Alıcının VKN/TCKN'si İşNet'te e-Fatura mükellefi olarak kayıtlıysa **e-Fatura**, değilse **e-Arşiv** kesilir.
  TCKN yoksa `11111111111` kullanılır (e-Arşiv).
- **Perakende (varsayılan):** fatura tipi **ÖZEL MATRAH**. Her ürün tek satır (altın + işçilik); KDV yalnız
  işçilikten (%20) hesaplanır. Kod: altında **805**, gümüşte **808** (KDVK 23/e).
- **Toptan:** fatura tipi **İSTİSNA** (230). Tutarın tamamı KDV %0, işçiliksiz. Taslakta "Toptan satış — tümü
  istisna" düğmesi ya da havale taslağında "Fatura Türü: Toptan" ile seçilir.
- Aynı faturada özel matrah ve istisna satırı birlikte olamaz; program göndermeden önce uyarır.
- Müşterinin e-postası yazılıysa e-Arşiv faturası müşteriye e-postayla gider, yoksa kâğıt (yazdırılır).

## WhatsApp otomatik mesaj (isteğe bağlı, ücretsiz)

Köprü, WhatsApp'a **bağlı cihaz** olarak bağlanır ve programdaki mesajları siz WhatsApp'ta
Gönder'e basmadan iletir (tamir alındı / hazır, cari bakiye, satış fişi …).

> Bu yol WhatsApp'ın resmî yolu değildir; numara kısıtlanabilir. Bildirimler için **ayrı bir hat**
> kullanın, toplu / reklam mesajı göndermeyin. Köprü mesajları aralıklı gönderir ve günde en çok
> 300 mesaja izin verir (`asil-kopru.json` → `"waDailyLimit"`).

1. `C:\kopru\GUNCELLE.bat` ile köprüyü güncelleyin (sürüm 1.2 ve üstü).
2. `C:\kopru\WHATSAPP_KUR.bat` dosyasına bir kez çift tıklayın (WhatsApp modülünü kurar, 1-2 dk).
3. Programda **Tamir → WhatsApp Ayarları → Nasıl açılsın: Otomatik — dükkân köprüsü**.
4. Çıkan QR kodu bildirim hattının telefonundan okutun: WhatsApp → Ayarlar → **Bağlı cihazlar** →
   **Cihaz bağla**. "✓ WhatsApp bağlı" yazınca hazırdır. Bağlantı bilgisi `C:\kopru\wa-oturum`
   klasöründe saklanır; bilgisayar yeniden açılınca kendiliğinden bağlanır.
5. **Sormadan gönder** işaretlenirse tamir açılınca / hazır olunca mesaj kendiliğinden gider;
   işaretlenmezse program "Mesaj gitsin mi?" diye sorar.

**Tamir teslim onayı (köprü 1.3 ve üstü):** WhatsApp Ayarları'nda "Teslimde müşteriden ONAY iste" açıksa teslim
mesajının sonuna "ONAY yazarak cevap verin" eklenir. Müşteri ONAY / EVET / TAMAM / ALDIM yazınca köprü cevabı
`wa-gelen.json` dosyasına kaydeder; program tamir listesinde "✓ Müşteri onayladı" ve tarih-saatini gösterir
(program kapalıyken gelen cevaplar da sonradan işlenir). Bunun için köprünün açık ve WhatsApp'ın bağlı olması yeterlidir.

Köprüye yalnız Asil Kuyumcu Pro sayfaları (ufukcicek81.github.io, kuyumcupro…vercel.app / workers.dev) erişebilir;
başka bir adres kullanıyorsanız `asil-kopru.json` → `"allowedOrigins": ["https://adres"]` ekleyin.

## İş Bankası online ekstre (köprü 1.4 ve üstü)

Program, banka carisinin ekstresindeki **🏦 Bankadan Getir** düğmesiyle İş Bankası hareketlerini alıp programdaki
banka hareketleriyle karşılaştırır (eşleşenler ✓, "bankada var programda yok" ve "programda var bankada yok" ayrı).

1. İş Bankası ticari internet şubesinde online ekstre için kullanıcı kodu ve şifre oluşturun.
2. `C:\kopru\asil-kopru.json` dosyasını Not Defteri ile açın, şu iki satırı ekleyin (virgüllere dikkat):

```json
{ "mode": "test", "vkn": "4810173324", "port": 8787,
  "isbankUid": "BANKANIN VERDİĞİ KULLANICI KODU",
  "isbankPwd": "OLUŞTURDUĞUNUZ ŞİFRE" }
```

3. `BASLAT.bat` ile köprüyü yeniden başlatın (otomatik başlatma kuruluysa bilgisayarı yeniden açmak da olur).

Kullanıcı kodu ve şifre **yalnız bu dosyada** durur; programa, buluta ya da başka bir yere gönderilmez.
Banka en fazla 1 hafta geriye, 300 harekete ve dakikada 2 sorguya izin verir.

### Otomatik havale bildirimi (köprü 1.7 ve üstü)

**Bankadan Getir** penceresindeki **🔔 Otomatik havale bildirimi** bölümünden açılır. Köprünün çalıştığı dükkân
bilgisayarında program açıkken her dakika bankaya sorulur; hesaba para gelince sağ altta uyarı çıkar ve ses verir.

- Açıklama kontrolü: "borç, ödünç, emanet…" gibi riskli kelimeler **kırmızı** uyarı verir (müşteriyle görüşüp iade düşünün).
  "Altın ödemesi / elden teslim aldım" gibi kabul edilen bir açıklama ya da TC kimlik numarası yoksa **turuncu** uyarı verir.
  Kelime listeleri aynı bölümden değiştirilebilir.
- Gelen havaleler **Fatura → Gelen Havaleler** sekmesine de düşer; açıklamadaki TC numarası fatura taslağına yazılır.
- Birden çok cihaz açık olsa da köprü bankaya en fazla 45 saniyede bir sorar (banka sınırı dakikada 2 sorgu).
