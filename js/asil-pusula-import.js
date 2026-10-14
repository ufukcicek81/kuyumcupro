/* Asil Kuyumcu Pro — Pusula Excel stok içe aktarma.
 *
 * Pusula'dan alınan Excel (veya CSV) satırlarından programın stok kayıtlarını üretir.
 * Sütun başlıkları eş anlamlılarla otomatik tanınır; tanınmayan sütun ekranda elle seçilir.
 * Bu modül yalnızca veriyi dönüştürür; programdaki stokları değiştirmez.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.AsilPusulaImport=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';

  function norm(v){
    return String(v==null?'':v).toLocaleLowerCase('tr-TR')
      .replace(/[çÇ]/g,'c').replace(/[ğĞ]/g,'g').replace(/[ıİ]/g,'i').replace(/[öÖ]/g,'o').replace(/[şŞ]/g,'s').replace(/[üÜ]/g,'u')
      .replace(/[^a-z0-9]/g,'');
  }
  function text(v){return String(v==null?'':v).trim()}
  /* "1.234,56", "3,15", "3.15", 3.15 → sayı. */
  function num(v){
    if(typeof v==='number')return isFinite(v)?v:0;
    var s=text(v).replace(/\s/g,'').replace(/[^0-9,.\-]/g,'');
    if(!s)return 0;
    if(s.indexOf(',')>=0&&s.indexOf('.')>=0){
      if(s.lastIndexOf(',')>s.lastIndexOf('.'))s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');
    }else if(s.indexOf(',')>=0)s=s.replace(/\./g,'').replace(',','.');
    var n=Number(s);return isFinite(n)?n:0;
  }
  function round(n,d){var f=Math.pow(10,d||4);return Math.round(n*f)/f}

  /* Ayar → milyem. "14", "14K", "585" hepsi kabul edilir. */
  var KARAT_TO_PURITY={8:333,9:375,10:417,14:585,18:750,21:875,22:916,24:995};
  function purityOf(karat,milyem){
    var m=num(milyem);if(m>=100&&m<=1000)return m;
    var k=num(karat);
    if(k>=100&&k<=1000)return k;
    if(KARAT_TO_PURITY[Math.round(k)])return KARAT_TO_PURITY[Math.round(k)];
    return 0;
  }

  /* Alan tanımları: anahtar, ekranda görünen ad, başlık eş anlamlıları (normalize edilmiş). */
  var BARCODE_FIELDS=[
    {key:'barcode',label:'Barkod',syn:['barkod','barkodno','barkodu','etiketno','etiket','barkodnumarasi']},
    {key:'code',label:'Stok / Ürün Kodu',syn:['stokkodu','urunkodu','kod','stokno','urunno','kodu','pusulakodu']},
    {key:'group',label:'Grup',syn:['grup','grupkodu','stokgrubu','urungrubu','grubu','grupadi']},
    {key:'name',label:'Ürün Adı / Cins',syn:['cins','urunadi','stokadi','urun','tanim','aciklama','cinsi','malinadi','urunismi','adi']},
    {key:'karat',label:'Ayar',syn:['ayar','ayari','karat','ayarkodu']},
    {key:'milyem',label:'Milyem',syn:['milyem','saflik','milyemi']},
    {key:'gram',label:'Gram',syn:['gram','gr','agirlik','brutgram','brut','miktar','gramaj','net','netgram']},
    {key:'has',label:'Has',syn:['has','hasgram','saf','safgram','hasagirlik','hasmiktari']},
    {key:'work',label:'Alış İşçilik (HAS)',syn:['iscilik','alisiscilik','alisisc','maliyetiscilik','isc','gelisiscilik','alisiscilikhas','iscilikhas']},
    {key:'saleWork',label:'Satış İşçilik (HAS)',syn:['satisiscilik','satisisc','satisiscilikhas','satiscilik']},
    {key:'costHas',label:'Maliyet (HAS)',syn:['maliyet','maliyethas','alishas','toplammaliyet','maliyethasi']},
    {key:'saleHas',label:'Satış (HAS)',syn:['satishas','satis','satisfiyati','satisfiyatihas','etikethas','satishasi']},
    {key:'count',label:'Adet',syn:['adet','adedi','miktaradet']},
    {key:'model',label:'Model',syn:['model','modeli','modelno']},
    {key:'stone',label:'Taş',syn:['tas','tasli','tasbilgisi','tasgram']},
    {key:'size',label:'Ölçü',syn:['olcu','boy','numara','olcusu']},
    {key:'supplier',label:'Tedarikçi',syn:['tedarikci','firma','toptanci','alinanfirma','cari','carikodu']},
    {key:'showcase',label:'Vitrin',syn:['vitrin','vitrinno']},
    {key:'banko',label:'Banko',syn:['banko']},
    {key:'origin',label:'Menşei',syn:['mensei','mense','uretici']},
    {key:'location',label:'Depo / Yer',syn:['depo','yer','lokasyon','sube','konum']}
  ];
  var OPEN_FIELDS=[
    {key:'code',label:'Stok / Ürün Kodu',syn:['stokkodu','urunkodu','kod','stokno','kodu']},
    {key:'name',label:'Ürün Adı',syn:['urunadi','stokadi','cins','urun','tanim','aciklama','adi','stokcinsi']},
    {key:'karat',label:'Ayar',syn:['ayar','ayari','karat']},
    {key:'milyem',label:'Milyem',syn:['milyem','saflik']},
    {key:'amount',label:'Miktar (gram/adet)',syn:['miktar','gram','gr','kalan','bakiye','stokmiktari','mevcut','adet']},
    {key:'unit',label:'Birim',syn:['birim','birimi','olcubirimi']},
    {key:'has',label:'Has',syn:['has','hasgram','saf','hasbakiye']},
    {key:'work',label:'İşçilik (HAS)',syn:['iscilik','toplamiscilik','iscilikhas']},
    {key:'zGram',label:'Birim Gram (adetli ürün)',syn:['zgram','birimgram','adetgram','gramadet','ortgram']},
    {key:'costHas',label:'Maliyet (HAS)',syn:['maliyet','maliyethas','toplammaliyet']}
  ];
  var CARI_FIELDS=[
    {key:'code',label:'Cari Kodu',syn:['carikodu','kod','hesapkodu','carino','kodu','musterikodu']},
    {key:'name',label:'Cari Adı / Ünvan',syn:['cariadi','unvan','cariunvani','adsoyad','adisoyadi','musteri','musteriadi','cari','hesapadi','adi','isim','ad']},
    {key:'type',label:'Cari Türü',syn:['tur','turu','caritipi','tip','grup','carigrubu','hesapturu']},
    {key:'phone',label:'Telefon',syn:['telefon','tel','gsm','ceptelefonu','cep','telefonno']}
  ];
  var MODES={barcode:BARCODE_FIELDS,open:OPEN_FIELDS,cari:CARI_FIELDS};
  var BALANCE_UNITS=['TL','HAS','USD','EUR','GBP','CHF','24','22','21','18','14','8'];

  /* Başlıktan bakiye birimi ve yönü: "TL Bakiye" → TL(+), "USD Alacak" → USD(-), "22 Ayar" → 22. */
  function balanceSpecOf(header){
    var h=norm(header);if(!h)return null;
    var sign=/alacak/.test(h)?-1:1;
    if(/kod|adi|unvan|telefon|tel$|tur|tip|adres|vergi|tckn|eposta|mail|tarih|not$|aciklama/.test(h)&&!/bakiye|borc|alacak/.test(h))return null;
    var unit=null;
    if(/(^|[^a-z])?(usd|dolar)/.test(h))unit='USD';
    else if(/eur|euro|avro/.test(h))unit='EUR';
    else if(/gbp|sterlin/.test(h))unit='GBP';
    else if(/chf|frank/.test(h))unit='CHF';
    else if(/has/.test(h))unit='HAS';
    else{var m=/^(24|22|21|18|14|8)(ayar|k|ayarbakiye|bakiye|gr|gram)?/.exec(h);if(m)unit=m[1];}
    if(!unit&&/^tl|tl$|tlbakiye|bakiyetl|^lira|turklirasi/.test(h))unit='TL';
    if(!unit&&/^(bakiye|borc|alacak|tutar)$/.test(h))unit='TL';
    return unit?{unit:unit,sign:sign}:null;
  }
  function detectBalances(headers,mapping){
    var used={};Object.keys(mapping||{}).forEach(function(k){used[mapping[k]]=1});
    var out={};
    (headers||[]).forEach(function(h,i){if(used[i])return;var sp=balanceSpecOf(h);if(sp)out[i]=sp;});
    return out;
  }
  function cariTypeOf(v){
    var t=norm(v);
    if(/toptan|tedarik|firma|imalat/.test(t))return 'Toptancı';
    if(/banka/.test(t))return 'Banka';
    if(/ozel|personel|ortak/.test(t))return 'Özel';
    return 'Müşteri';
  }
  /* Cari bakiye listesi → cari ve birim bazında bakiye.
     balanceCols: {sütunIndex:{unit,sign}}; positiveIsDebt=true ise + değer müşterinin borcu (bize borçlu). */
  function buildCariBalances(rows,headerIndex,mapping,balanceCols,opts){
    opts=opts||{};
    var positiveIsDebt=opts.positiveIsDebt!==false,out=[],errors=[],warnings=[],index={};
    for(var r=headerIndex+1;r<rows.length;r++){
      var row=rows[r];if(isEmptyRow(row))continue;
      var line=r+1,code=text(cell(row,mapping,'code')),name=text(cell(row,mapping,'name'));
      if(!code&&!name)continue;
      if(/toplam|genel/i.test(name)&&!code)continue;
      var balances={},any=false;
      Object.keys(balanceCols||{}).forEach(function(c){
        var sp=balanceCols[c];if(!sp||!sp.unit)return;
        var v=num(row[c]);if(!v)return;
        v=v*(sp.sign||1)*(positiveIsDebt?1:-1);
        balances[sp.unit]=round((balances[sp.unit]||0)+v,6);any=true;
      });
      var key=code?'K:'+code:'N:'+norm(name);
      if(index[key]!==undefined){
        // Aynı cari birden fazla satırda (birim başına satır) olabilir: bakiyeleri birleştir.
        var prev=out[index[key]];Object.keys(balances).forEach(function(u){prev.balances[u]=round((prev.balances[u]||0)+balances[u],6)});continue;
      }
      if(!name)warnings.push({line:line,message:'Cari adı boş (kod '+code+')'});
      index[key]=out.length;
      out.push({code:code,name:name||code,type:cariTypeOf(cell(row,mapping,'type')),phone:text(cell(row,mapping,'phone')),balances:balances,line:line});
    }
    return {customers:out,errors:errors,warnings:warnings};
  }

  /* İlk satırlar arasında en çok tanınan başlığı içeren satırı başlık kabul eder. */
  function detect(rows,mode){
    var fields=MODES[mode]||BARCODE_FIELDS,best={headerIndex:-1,score:0,mapping:{}};
    for(var r=0;r<Math.min(rows.length,25);r++){
      var row=rows[r]||[],mapping={},used={},score=0;
      fields.forEach(function(f){
        for(var c=0;c<row.length;c++){
          if(used[c])continue;
          var h=norm(row[c]);if(!h)continue;
          if(f.syn.indexOf(h)>=0){mapping[f.key]=c;used[c]=1;score++;return}
        }
      });
      // Tam eşleşmeyenler için başlık eş anlamlıyla başlıyorsa (ör. "Gram (gr)") ikinci tur.
      fields.forEach(function(f){
        if(mapping[f.key]!==undefined)return;
        for(var c=0;c<row.length;c++){
          if(used[c])continue;
          var h=norm(row[c]);if(!h)continue;
          if(f.syn.some(function(s){return s.length>=3&&h.indexOf(s)===0})){mapping[f.key]=c;used[c]=1;score+=0.5;return}
        }
      });
      if(score>best.score)best={headerIndex:r,score:score,mapping:mapping};
    }
    var headers=best.headerIndex>=0?(rows[best.headerIndex]||[]).map(text):[];
    return {headerIndex:best.headerIndex,mapping:best.mapping,headers:headers,fields:fields};
  }

  function cell(row,mapping,key){var c=mapping[key];return c===undefined||c===null||c===''?undefined:row[c]}
  function isEmptyRow(row){return !row||!row.some(function(v){return text(v)!==''})}

  function splitBarcode(barcode){var m=/^([A-Za-zÇĞİÖŞÜçğıöşü]+)0*(\d+)$/.exec(barcode);return m?{group:m[1].toLocaleUpperCase('tr-TR'),num:m[2]}:null}

  /* Barkodlu stok listesi → program stok kayıtları. */
  function buildBarcodeStocks(rows,headerIndex,mapping,opts){
    opts=opts||{};
    var period=opts.period||new Date().getFullYear(),out=[],errors=[],warnings=[],seen={};
    for(var r=headerIndex+1;r<rows.length;r++){
      var row=rows[r];if(isEmptyRow(row))continue;
      var line=r+1;
      var rawBarcode=text(cell(row,mapping,'barcode'));
      // Pusula grup ara toplam satırları ("122 ADET") ürün değildir; sessizce atla.
      if(/^\d+([.,]\d+)?\s*(adet|ad|tane|ad\.)$/i.test(rawBarcode))continue;
      var barcode=rawBarcode.toLocaleUpperCase('tr-TR').replace(/\s+/g,'');
      var code=text(cell(row,mapping,'code'));
      var group=text(cell(row,mapping,'group')).toLocaleUpperCase('tr-TR');
      if(!barcode&&code&&group)barcode=group+String(code).replace(/\D/g,'').padStart(7,'0');
      if(!barcode&&code)barcode=code.toLocaleUpperCase('tr-TR');
      if(!barcode){
        // Toplam / ara toplam satırlarını sessizce atla.
        if(/toplam|genel/i.test(row.map(text).join(' ')))continue;
        errors.push({line:line,message:'Barkod veya stok kodu yok'});continue;
      }
      if(seen[barcode]){errors.push({line:line,message:'Aynı barkod ikinci kez: '+barcode});continue}
      seen[barcode]=1;
      var parts=splitBarcode(barcode);
      if(!group&&parts)group=parts.group;
      if(!code&&parts)code=parts.num;
      var karat=text(cell(row,mapping,'karat')),purity=purityOf(karat,cell(row,mapping,'milyem'));
      var gram=round(num(cell(row,mapping,'gram')),3);
      var has=num(cell(row,mapping,'has'));if(!has&&gram&&purity)has=gram*purity/1000;has=round(has,4);
      var work=num(cell(row,mapping,'work')),saleWork=num(cell(row,mapping,'saleWork'));
      var costHas=num(cell(row,mapping,'costHas')),saleHas=num(cell(row,mapping,'saleHas'));
      if(!work&&costHas&&has)work=costHas-has;
      if(!costHas)costHas=has+work;
      if(!saleWork&&saleHas&&has)saleWork=saleHas-has;
      if(!saleHas)saleHas=has+saleWork;
      if(!gram)warnings.push({line:line,message:barcode+': gram 0'});
      if(!purity)warnings.push({line:line,message:barcode+': ayar tanınamadı ('+karat+')'});
      var name=text(cell(row,mapping,'name'))||group||'ÜRÜN';
      out.push({
        id:'PB-'+barcode,period:period,source:'Pusula Barkodlu Stok Excel',stockMode:'Barkodlu',
        barcode:barcode,code:barcode,pusulaCode:String(code||''),group:group,category:name,name:name,type:name,
        karat:purity?String(purity):karat,purity:purity,amount:gram,qty:gram,count:Math.max(1,Math.round(num(cell(row,mapping,'count'))||1)),
        hasWeight:has,materialHas:has,workmanshipEntryValue:round(work,4),workmanshipTotalHas:round(work,4),
        saleWorkmanshipTotalHas:round(saleWork,4),workmanshipUnit:'HAS',costHas:round(costHas,4),saleHas:round(saleHas,4),
        model:text(cell(row,mapping,'model')),banko:text(cell(row,mapping,'banko')),stone:text(cell(row,mapping,'stone')),
        origin:text(cell(row,mapping,'origin')),size:num(cell(row,mapping,'size')),resultGram:0,
        supplier:text(cell(row,mapping,'supplier')),showcase:text(cell(row,mapping,'showcase')),
        location:text(cell(row,mapping,'location'))||'Mağaza',status:'Stokta',saleTo:'',saleDate:'',
        importedAt:opts.importedAt||new Date().toISOString()
      });
    }
    return {stocks:out,errors:errors,warnings:warnings};
  }

  /* Açık (barkodsuz) stok / stok özeti → açık stok kayıtları. */
  function buildOpenStocks(rows,headerIndex,mapping,opts){
    opts=opts||{};
    var period=opts.period||new Date().getFullYear(),out=[],errors=[],warnings=[],seen={};
    for(var r=headerIndex+1;r<rows.length;r++){
      var row=rows[r];if(isEmptyRow(row))continue;
      var line=r+1,name=text(cell(row,mapping,'name')),code=text(cell(row,mapping,'code'));
      if(!name&&!code)continue;
      if(/toplam|genel/i.test(name)&&!code)continue;
      var key=code||name;if(seen[key]){errors.push({line:line,message:'Aynı ürün ikinci kez: '+key});continue}seen[key]=1;
      var unitRaw=norm(cell(row,mapping,'unit'));
      var unit=/adet|ad$/.test(unitRaw)?'ADET':'GR';
      var karat=text(cell(row,mapping,'karat')),purity=purityOf(karat,cell(row,mapping,'milyem'))||916;
      var amount=num(cell(row,mapping,'amount')),zGram=num(cell(row,mapping,'zGram'));
      var has=num(cell(row,mapping,'has'));
      if(!has)has=unit==='ADET'?amount*zGram*purity/1000:amount*purity/1000;
      var work=num(cell(row,mapping,'work')),costHas=num(cell(row,mapping,'costHas'))||has+work;
      var unitCost=amount>0?costHas/amount:(unit==='ADET'?zGram*purity/1000:purity/1000);
      if(amount<0)warnings.push({line:line,message:(name||code)+': eksi miktar'});
      out.push({
        id:'OPEN-'+(code||norm(name)),period:period,source:'Pusula Stok Özeti Excel',stockMode:'Açık',
        name:name||code,productCode:code,pusulaCode:code,displayAyar:purity,purity:purity,amount:round(amount,3),unit:unit,
        hasWeight:round(has,4),workmanshipTotalHas:round(work,4),averageWorkmanship:amount?round(work/amount,8):0,
        count:unit==='ADET'?Math.round(amount):0,zGram:zGram,location:'Açık Stok',stockCardId:'SC-OPEN-'+(code||norm(name)),
        openingUnitCostHas:round(unitCost,6),inventoryUnitCostHas:round(unitCost,6),openingCostHas:round(costHas,6),
        costBasisSource:'Pusula Excel içe aktarma',importedAt:opts.importedAt||new Date().toISOString()
      });
    }
    return {stocks:out,errors:errors,warnings:warnings};
  }

  return {norm:norm,num:num,purityOf:purityOf,detect:detect,buildBarcodeStocks:buildBarcodeStocks,buildOpenStocks:buildOpenStocks,buildCariBalances:buildCariBalances,detectBalances:detectBalances,balanceSpecOf:balanceSpecOf,BALANCE_UNITS:BALANCE_UNITS,MODES:MODES};
});
