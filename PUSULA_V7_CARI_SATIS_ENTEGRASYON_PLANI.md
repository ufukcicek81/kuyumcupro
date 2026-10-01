# V7 Cari → Satış → Ödeme → Stok Entegrasyonu

Bu belge, Pusula SQL incelemesinden çıkarılan hareket modelinin KuyumcuPro ekranlarına bağlanması için uygulama planıdır.

## Pusula'dan doğrulanan hareket alanları

`CarHrk` içinde cari hareket; tarih, cari numarası, hareket tipi, firma kodu, miktar, birim, fiyat, ayar, tutar, döviz, kur, has karşılığı, açıklama, fiş bilgileri, karşı hesap, işçilik, stok ID, taksit, kullanıcı ve işlem ID gibi alanlarla tutuluyor.

Özellikle satış tarafında `470` hareketleri satış fişleriyle ilişkili ürün/altın hareketleri olarak incelendi.

## KuyumcuPro uygulama akışı

Her ticari işlem tek bir `transaction_id` altında yürütülecek:

1. İşlem başlığı oluşturulur.
2. Satış/iade/takas/hurda kalemleri kaydedilir.
3. Cari hareket oluşturulur.
4. Stok hareketi oluşturulur.
5. Altın/has hareketi oluşturulur.
6. Ödeme dağılımları oluşturulur.
7. Fiş ve kaynak işlem bağlantıları oluşturulur.
8. İşlem tamamlanmadan önce tüm alt hareketler doğrulanır.

## Satış için zorunlu veri

- Cari
- Ürün/stok
- Miktar
- Birim
- Ayar
- Milyem
- Gram
- Has
- İşçilik
- Satış tutarı
- Tahsilat türleri
- Açık hesap bakiyesi
- Fiş numarası

## İade / takas / hurda

İade ve ters işlemler kaynak satışa bağlanacak. Adetli ziynet ürünlerinde miktar ve manuel milyem desteklenecek. Hurda ve altın ödemeleri ayrı altın/has hareketi olarak tutulacak.

## Uygulama sırası

- [ ] Cari liste ve filtreleme
- [ ] Cari kart bakiye özeti
- [ ] Cari hareket ekranı
- [ ] Satış → stok/cari/has bağlantısı
- [ ] Çoklu ödeme → ödeme dağılımı
- [ ] İade
- [ ] Takas
- [ ] Hurda
- [ ] Stok hareket raporu
- [ ] Cari ekstre
- [ ] Pusula import/mapping

Bu dosya yalnızca plan ve veri sözlüğüdür; mevcut veriyi değiştirmez.
