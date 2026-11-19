# Dükkan Köprüsü — İşNet (NetteFatura) e-Fatura / e-Arşiv

Program faturayı dükkan bilgisayarındaki bu küçük köprüye gönderir, köprü de İşNet'e iletir.
İşNet kimliği **sabit IP + VKN** ile doğrular: hiçbir kullanıcı adı veya şifre gerekmez, girilmez.

## 1. Kurulum (dükkan bilgisayarı, bir kez)

1. https://nodejs.org adresinden **LTS** sürümünü indirip kurun (İleri → İleri → Bitir).
2. Bu `kopru` klasörünü bilgisayara kopyalayın (ör. `C:\AsilKopru`).
3. `BASLAT.bat` dosyasına çift tıklayın. Siyah pencerede
   `Asil Kuyumcu Köprü çalışıyor → http://127.0.0.1:8787` yazmalı. **Pencereyi kapatmayın.**
   - Bilgisayar açılınca kendiliğinden başlasın isterseniz: `Win+R` → `shell:startup` → açılan klasöre
     `BASLAT.bat` için bir kısayol koyun.

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
- Altın satırı **KDV %0, 230 istisna kodu**, işçilik satırı **KDV %20** olarak gider; fatura tipi **İSTİSNA**.
- Müşterinin e-postası yazılıysa e-Arşiv faturası müşteriye e-postayla gider, yoksa kâğıt (yazdırılır).
