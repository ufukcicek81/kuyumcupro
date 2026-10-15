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
    {key:'barcode',label:'Barkod',syn:['barkod','barkodno','barkodu','etiketno','etiket','barkodnumarasi','urunkodu']},
    {key:'code',label:'Stok / Ürün Kodu',syn:['kod','stokkodu','stokno','urunno','kodu','pusulakodu']},
    {key:'group',label:'Grup',syn:['grup','grupkodu','stokgrubu','urungrubu','grubu','grupadi']},
    {key:'name',label:'Ürün Adı / Cins',syn:['cins','urunadi','stokadi','urun','tanim','aciklama','cinsi','malinadi','urunismi','adi']},
    {key:'karat',label:'Ayar',syn:['ayar','ayari','karat','ayarkodu']},
    {key:'milyem',label:'Milyem',syn:['milyem','saflik','milyemi']},
    {key:'gram',label:'Gram',syn:['gram','gr','agirlik','brutgram','brut','miktar','gramaj','net','netgram']},
    {key:'has',label:'Has',syn:['has','hasgram','saf','safgram','hasagirlik','hasmiktari']},
    {key:'work',label:'Alış İşçilik (HAS)',syn:['iscilik','alisiscilik','alisisc','maliyetiscilik','isc','gelisiscilik','alisiscilikhas','iscilikhas']},
    {key:'saleWork',label:'Satış İşçilik (HAS)',syn:['satisiscilik','satisisc','satisiscilikhas','satiscilik']},
    {key:'costHas',label:'Maliyet (HAS)',syn:['maliyet','maliyethas','alishas','toplammaliyet','maliyethasi']},
    {key:'saleHas',label:'Satış (HAS)',syn:['satishas','satis','satisfiyati','satfiyati','satisfiyatihas','etikethas','satishasi']},
    {key:'unit',label:'İşçilik Birimi',syn:['birim','birimi']},
    {key:'resultGram',label:'Sonuç Gram',syn:['sonucgr','sonucgram']},
    {key:'count',label:'Adet',syn:['adet','adedi','miktaradet']},
    {key:'model',label:'Model',syn:['model','modeli','modelno']},
    {key:'stone',label:'Taş',syn:['tas','tasli','tasbilgisi','tasgram']},
    {key:'size',label:'Ölçü',syn:['olcu','boy','numara','olcusu']},
    {key:'supplier',label:'Tedarikçi',syn:['tedarikci','firma','toptanci','alinanfirma','cari','carikodu']},
    {key:'showcase',label:'Vitrin',syn:['vitrin','vitrinno']},
    {key:'banko',label:'Banko',syn:['banko']},
    {key:'origin',label:'Orj. Kod / Menşei',syn:['orjkod','orjinalkod','orijinalkod','mensei','mense','uretici']},
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
    {key:'name',label:'Cari Adı / Ünvan',syn:['firmaunvani','firmaadi','cariadi','unvan','cariunvani','adsoyad','adisoyadi','musteri','musteriadi','cari','hesapadi','adi','isim','ad']},
    {key:'type',label:'Cari Türü',syn:['tur','turu','caritipi','tip','grup','carigrubu','hesapturu']},
    {key:'phone',label:'Telefon',syn:['telefon','tel','gsm','ceptelefonu','cep','telefonno']}
  ];
  var MODES={barcode:BARCODE_FIELDS,open:OPEN_FIELDS,cari:CARI_FIELDS};
  var BALANCE_UNITS=['TL','HAS','USD','EUR','GBP','CHF','SAR','CAD','AUD','CEY','GRM','GMS','24','22','21','18','14','8'];

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
    else if(/^sar|riyal/.test(h))unit='SAR';
    else if(/^cad|kanada/.test(h))unit='CAD';
    else if(/^aud|avustralya/.test(h))unit='AUD';
    else if(/^cey|ceyrek/.test(h))unit='CEY';
    else if(/^grm$|^gramaltin/.test(h))unit='GRM';
    else if(/^gms$|gumus/.test(h))unit='GMS';
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
  /* Tür sütunu yoksa addan tahmin: Pusula iç hesapları "Özel", bankalar "Banka". */
  var INTERNAL_CARI=/^(donemkz|donemkarzarar|genelgider|karhesabi|karzarar|hurdakarzarar|iskonto|sermaye|stokduzeltme|kkartikomisyon|kredikartikomisyon|kasa$|havale$|caricislemler|cariislemler|dovizas$)/;
  function cariTypeOf(v,name){
    var t=norm(v);
    if(!t&&name){var n=norm(name);if(INTERNAL_CARI.test(n))return 'Özel';if(/bank|bankasi$/.test(n))return 'Banka';}
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
      out.push({code:code,name:name||code,type:cariTypeOf(cell(row,mapping,'type'),name),phone:text(cell(row,mapping,'phone')),balances:balances,line:line});
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

  /* Pusula grup kodu → ürün adı (Excel'de ürün adı sütunu olmadığında). */
  var GROUP_NAMES={ALY:'ALYANS',BIL:'BİLEKLİK',KOL:'KOLYE',KUP:'KÜPE',YUZ:'YÜZÜK',ZIN:'ZİNCİR',NZL:'NAZARLIK',KEL:'KELEPÇE'};
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
      var workEntry=num(cell(row,mapping,'work')),work=workEntry,saleWork=num(cell(row,mapping,'saleWork'));
      var costHas=num(cell(row,mapping,'costHas')),saleHas=num(cell(row,mapping,'saleHas'));
      // Pusula ISCILIK sütunu ürüne göre gram başı ya da adet başı girilmiş olabilir; gerçek işçilik = maliyet − has.
      if(costHas&&has)work=costHas-has;
      var workMode=gram&&workEntry&&Math.abs(workEntry*gram-work)<Math.abs(workEntry-work)?'Gram İşçilik':'Birim İşçilik';
      if(!costHas)costHas=has+work;
      if(!saleWork&&saleHas&&has)saleWork=saleHas-has;
      if(!saleHas)saleHas=has+saleWork;
      if(!gram)warnings.push({line:line,message:barcode+': gram 0'});
      if(!purity)warnings.push({line:line,message:barcode+': ayar tanınamadı ('+karat+')'});
      var name=text(cell(row,mapping,'name'))||(opts.groupNames&&opts.groupNames[group])||GROUP_NAMES[group]||group||'ÜRÜN';
      out.push({
        id:'PB-'+barcode,period:period,source:'Pusula Barkodlu Stok Excel',stockMode:'Barkodlu',
        barcode:barcode,code:barcode,pusulaCode:String(code||''),group:group,category:name,name:name,type:name,
        karat:purity?String(purity):karat,purity:purity,amount:gram,qty:gram,count:Math.max(1,Math.round(num(cell(row,mapping,'count'))||1)),
        hasWeight:has,materialHas:has,workmanshipEntryValue:round(workEntry,4),workmanshipMode:workMode,workmanshipTotalHas:round(work,4),
        saleWorkmanshipTotalHas:round(saleWork,4),workmanshipUnit:text(cell(row,mapping,'unit')).toLocaleUpperCase('tr-TR')||'HAS',costHas:round(costHas,4),saleHas:round(saleHas,4),
        model:text(cell(row,mapping,'model')),banko:text(cell(row,mapping,'banko')),stone:text(cell(row,mapping,'stone')),
        origin:text(cell(row,mapping,'origin')),size:num(cell(row,mapping,'size')),resultGram:num(cell(row,mapping,'resultGram')),
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

  /* Pusula "Stok Özeti" raporu: bölümler (TIP) — 0 altın/ziynet açık stok, 1 barkodlu toplamları,
     2 hurda, 3 özel ürün, 4 kasa. Bölüm sütunu yoksa TOPLAM satırlarına göre ayrılır. */
  function isStockSummary(rows){
    for(var r=0;r<Math.min(rows.length,10);r++){var h=(rows[r]||[]).map(norm);if(h.indexOf('tanim')>=0&&h.indexOf('miktar')>=0&&h.indexOf('has')>=0)return r}
    return -1;
  }
  function parseStockSummary(rows,opts){
    opts=opts||{};
    var hi=isStockSummary(rows);if(hi<0)return null;
    var H=(rows[hi]||[]).map(norm),col=function(n){return H.indexOf(n)};
    var cName=col('tanim'),cAyar=col('ayar'),cQty=col('miktar'),cHas=col('has'),cWork=col('iscilik'),cAvg=col('ortalama'),cType=col('tip');
    var cCode=cAvg>0?cAvg-1:-1,cTip=Math.max(H.length-1,0);
    var period=opts.period||new Date().getFullYear(),out={open:[],scrap:[],cash:[],barcodeSummary:{count:0,gram:0,has:0,rows:[]},skipped:[],headerIndex:hi};
    var section='open';
    for(var r=hi+1;r<rows.length;r++){
      var row=rows[r]||[];if(isEmptyRow(row))continue;
      var name=text(row[cName]),n=norm(name),tip=row[cTip];
      if(/^toplam/.test(n)){if(n==='toplamaltin')section='barcode';else if(n==='toplambarkodlualtin')section='scrap';else if(n==='toplamhurda')section='special';continue}
      if(n==='kasa'){section='cash';continue}
      if(typeof tip==='number'&&tip>=0&&tip<=4&&row.length>cTip)section=['open','barcode','scrap','special','cash'][tip];
      var line=r+1,ayar=num(row[cAyar]),qtyV=num(row[cQty]),has=num(row[cHas]),work=num(row[cWork]);
      if(section==='open'){
        var code=text(row[cCode]);
        var piece=ayar>1000||/gram|kulce|külçe/i.test(name);
        var purity=piece?(/^24|24\s*ayar/i.test(name)?995:916):ayar;
        var typeValue=cType>=0&&typeof row[cType]==='number'?row[cType]:'';
        out.open.push({
          id:'OPEN-'+(code||n),period:period,source:'Pusula Stok Özeti Excel',stockMode:'Açık',name:name,productCode:code,pusulaCode:code,
          displayAyar:ayar,purity:purity,amount:round(qtyV,3),unit:piece?'ADET':'GR',hasWeight:round(has,4),workmanshipTotalHas:round(work,4),
          averageWorkmanship:cAvg>=0?num(row[cAvg]):0,typeValue:typeValue,count:piece?Math.round(qtyV):0,zGram:piece&&purity?round(ayar/purity,4):0,
          location:'Açık Stok',stockCardId:'SC-OPEN-'+(code||n),
          inventoryUnitCostHas:round(typeValue?typeValue/1000:(qtyV>0?(has+work)/qtyV:ayar/1000),6),
          costBasisSource:'Pusula stok özeti içe aktarma',line:line
        });
      }else if(section==='barcode'){
        var c=num(String(cAvg>=0?row[cAvg]:''));
        out.barcodeSummary.count+=c;out.barcodeSummary.gram+=qtyV;out.barcodeSummary.has+=has;out.barcodeSummary.rows.push({name:name,ayar:ayar,count:c,gram:qtyV,has:has});
      }else if(section==='scrap'){
        out.scrap.push({id:'SCR-'+(text(row[cCode])||n),period:period,name:name,milyem:ayar,amount:round(qtyV,3),hasWeight:round(has,4),unit:'GR',line:line});
      }else if(section==='cash'){
        var cur=text(row[cAyar]).replace(/\./g,'').toLocaleUpperCase('tr-TR');if(!cur)continue;
        var debt=num(row[cQty]),credit=num(row[cHas]);
        out.cash.push({currency:cur==='TL'?'TL':cur,amount:round(debt-credit,4),line:line});
      }else out.skipped.push({line:line,name:name,qty:qtyV,unit:text(row[5]),cost:work,avg:cAvg>=0?num(row[cAvg]):0,currency:currencyOf(row[5])});
    }
    out.barcodeSummary.gram=round(out.barcodeSummary.gram,3);out.barcodeSummary.has=round(out.barcodeSummary.has,4);
    return out;
  }
  var ITEM_CODE_RE=/^[A-Za-zÇĞİÖŞÜçğıöşü]+\d+$/;
  function isItemRow(r){return r&&ITEM_CODE_RE.test(text(r[0]))}
  /* Pusula listelerinin sonundaki genel toplam satırı: "1693 Adet" (+ gram, has). */
  function fileGrandTotal(rows,mapping){
    for(var r=rows.length-1;r>=0;r--){var m=/^(\d+)\s*adet$/i.exec(text(rows[r]&&rows[r][0]));if(m)return {count:Number(m[1]),gram:num(mapping&&mapping.gram!==undefined?rows[r][mapping.gram]:rows[r][2]),line:r+1}}
    return null;
  }
  /* Excel'den alınan liste yarıda kesilmiş mi? (son ürün satırının sütunları eksik) */
  function looksTruncated(rows,headerIndex){
    var data=rows.slice(headerIndex+1).filter(isItemRow);
    if(data.length<5)return false;
    var filled=function(r){return r.filter(function(v){return text(v)!==''}).length};
    var last=data[data.length-1],typical=filled(data[Math.floor(data.length/2)]);
    return filled(last)<typical-2;
  }

  /* Özel ürünler (gümüş, saat, pırlanta, tesbih…): fiyatlar TL/USD/HAS cinsinden. */
  var SPECIAL_GROUP_NAMES={BIJ:'BİJUTERİ',CLK:'ÇELİK',GUM:'GÜMÜŞ',PIR:'PIRLANTA',SAA:'SAAT',TSB:'TESBİH'};
  function currencyOf(v){var t=text(v).replace(/\./g,'').toLocaleUpperCase('tr-TR');return t==='TL'||!t?'TL':t}
  function buildSpecialStocks(rows,headerIndex,mapping,opts){
    opts=opts||{};
    var period=opts.period||new Date().getFullYear(),out=[],errors=[],warnings=[],seen={},totals={cost:{},sale:{},count:0,gram:0},fileTotals={cost:{},sale:{}};
    for(var r=headerIndex+1;r<rows.length;r++){
      var row=rows[r]||[];if(isEmptyRow(row))continue;
      var first=text(row[0]);
      // Pusula dosya toplamları: "TOPLAM MLYT" (maliyet) ve "TOPLAM SATIŞ" satırları.
      var nf=norm(first);
      if(/^toplammlyt|^toplammaliyet/.test(nf)){var cu=currencyOf(cell(row,mapping,'unit'));fileTotals.cost[cu]=(fileTotals.cost[cu]||0)+num(cell(row,mapping,'costHas'));continue}
      if(/^toplamsatis|^toplam\d+adet/.test(nf)){var cs=currencyOf(cell(row,mapping,'unit'));fileTotals.sale[cs]=(fileTotals.sale[cs]||0)+num(cell(row,mapping,'saleHas'));continue}
      if(!ITEM_CODE_RE.test(first))continue; // grup ara toplamları
      var barcode=first.toLocaleUpperCase('tr-TR');
      if(seen[barcode]){errors.push({line:r+1,message:'Aynı barkod ikinci kez: '+barcode});continue}seen[barcode]=1;
      var parts=splitBarcode(barcode),group=text(cell(row,mapping,'group')).toLocaleUpperCase('tr-TR')||(parts&&parts.group)||'';
      var cur=currencyOf(cell(row,mapping,'unit')),cost=num(cell(row,mapping,'costHas')),sale=num(cell(row,mapping,'saleHas'));
      var gram=round(num(cell(row,mapping,'gram')),3),purity=purityOf(cell(row,mapping,'karat'),'');
      var name=(opts.groupNames&&opts.groupNames[group])||SPECIAL_GROUP_NAMES[group]||group||'ÖZEL ÜRÜN';
      totals.cost[cur]=(totals.cost[cur]||0)+cost;totals.sale[cur]=(totals.sale[cur]||0)+sale;totals.count++;totals.gram+=gram;
      if(!sale)warnings.push({line:r+1,message:barcode+': satış fiyatı yok'});
      out.push({
        id:'PS-'+barcode,period:period,source:'Özel Ürün',specialV7:true,stockMode:'Barkodlu',barcode:barcode,code:barcode,
        pusulaBarcode:first,pusulaCode:text(cell(row,mapping,'code'))||(parts?parts.num:''),group:group,category:name,name:name,type:name,productType:name,
        karat:purity?String(purity):'',purity:purity,amount:gram,qty:gram,count:1,hasWeight:round(num(cell(row,mapping,'has')),4),materialHas:round(num(cell(row,mapping,'has')),4),
        priceCurrency:cur,saleCurrency:cur,costNative:round(cost,4),saleNative:round(sale,4),line:r+1,workmanshipTotalHas:0,saleWorkmanshipTotalHas:0,
        model:text(cell(row,mapping,'model')),stone:text(cell(row,mapping,'stone')),size:num(cell(row,mapping,'size')),
        status:'Stokta',location:'Mağaza',importedAt:opts.importedAt||new Date().toISOString()
      });
    }
    var resolved=resolveSaleCurrencies(rows,headerIndex,mapping,out);
    totals.sale={};out.forEach(function(x){totals.sale[x.saleCurrency]=(totals.sale[x.saleCurrency]||0)+x.saleNative});
    ['cost','sale'].forEach(function(k){Object.keys(totals[k]).forEach(function(c){totals[k][c]=round(totals[k][c],2)});Object.keys(fileTotals[k]).forEach(function(c){fileTotals[k][c]=round(fileTotals[k][c],2)})});
    totals.gram=round(totals.gram,3);
    out.forEach(function(x){delete x.line});
    return {stocks:out,errors:errors,warnings:warnings,totals:totals,fileTotals:fileTotals,currencyFixes:resolved.fixes,currencyUnresolved:resolved.unresolved};
  }
  /* Pusula özel ürün listesinde satış birimi sütunu yok; her grubun ara toplamında satışlar birime göre ayrı verilir.
     Ara toplam ile BİRİM'e göre toplam tutmuyorsa, tutarı tutan ürün alt kümesi (alt küme toplamı) bulunup
     o ürünlerin satış birimi düzeltilir. Birden fazla çözüm varsa "belirsiz" olarak raporlanır. */
  function subsetSum(values,target){
    var T=Math.round(target),parent=new Int32Array(T+1).fill(-1),cnt=new Uint8Array(T+1);cnt[0]=1;parent[0]=-2;
    for(var i=0;i<values.length;i++){var v=values[i];if(v<=0||v>T)continue;for(var t=T;t>=v;t--){if(cnt[t-v]){if(parent[t]===-1)parent[t]=i;cnt[t]=Math.min(2,cnt[t]+cnt[t-v]);}}}
    if(!cnt[T])return null;
    var pick=[],t2=T;while(t2>0){var k=parent[t2];if(k<0)return null;pick.push(k);t2-=values[k];}
    return {pick:pick,unique:cnt[T]===1};
  }
  function resolveSaleCurrencies(rows,headerIndex,mapping,stocks){
    var byLine={};stocks.forEach(function(x){byLine[x.line]=x});
    var fixes=[],unresolved=[],block=[],cUnit=mapping.unit,cCost=mapping.costHas,cSale=mapping.saleHas,cSaleCur=cSale!==undefined?cSale+1:undefined;
    for(var r=headerIndex+1;r<rows.length;r++){
      var row=rows[r]||[],first=text(row[0]);
      if(ITEM_CODE_RE.test(first)){if(byLine[r+1])block.push(byLine[r+1]);continue}
      if(!/adet$/i.test(first)||/^toplam/i.test(norm(first))){continue}
      var saleBy={},j=r;
      do{var rr=rows[j]||[];var sc=cSaleCur!==undefined?text(rr[cSaleCur]):'';if(sc){var c=currencyOf(sc);saleBy[c]=(saleBy[c]||0)+num(rr[cSale]);}j++;}while(j<rows.length&&!text((rows[j]||[])[0])&&!isEmptyRow(rows[j]));
      var ours={};block.forEach(function(x){ours[x.saleCurrency]=(ours[x.saleCurrency]||0)+x.saleNative});
      var cur=Object.keys(Object.assign({},ours,saleBy)),diff={};cur.forEach(function(c){diff[c]=Math.round(((saleBy[c]||0)-(ours[c]||0))*100)});
      var from=cur.filter(function(c){return diff[c]<0}),to=cur.filter(function(c){return diff[c]>0});
      if(Object.keys(saleBy).length&&(from.length||to.length)){
        if(from.length===1&&to.length===1&&diff[from[0]]===-diff[to[0]]){
          var cand=block.filter(function(x){return x.saleCurrency===from[0]}),vals=cand.map(function(x){return Math.round(x.saleNative*100)});
          var sol=subsetSum(vals,-diff[from[0]]);
          if(sol){sol.pick.forEach(function(k){cand[k].saleCurrency=to[0]});fixes.push({group:first,from:from[0],to:to[0],amount:-diff[from[0]]/100,items:sol.pick.length,unique:sol.unique,barcodes:sol.pick.map(function(k){return cand[k].barcode})});}
          else unresolved.push({group:first,saleBy:saleBy,ours:ours});
        }else unresolved.push({group:first,saleBy:saleBy,ours:ours});
      }
      block=[];r=j-1;
    }
    return {fixes:fixes,unresolved:unresolved};
  }

  /* ---- Pusula bilanço raporu (Hesap Tanimi, Cins, Borcumuz, Alacağımız, HAS Borcumuz, HAS Alacağımız) ---- */
  function balanceUnitOf(v){
    var u=text(v).toUpperCase().replace(/\s+\d+$/,'').replace(/\.$/,'').trim();
    if(u==='TL'||u==='TL.')return 'TL';
    return u;
  }
  /* Karşılaştırma anahtarı: hesap grubu + birim. Gram/adet stok satırlarında birim yazımı farklı olabilir. */
  function balanceKey(group,unit){
    var u=balanceUnitOf(unit);if(u==='GR'||u==='ADET')u='';
    return norm(group)+'|'+u;
  }
  function isBalanceSheet(rows){
    for(var i=0;i<Math.min(rows.length,5);i++){var r=rows[i]||[];if(/^hesaptanimi/.test(norm(r[0]))&&/^cins/.test(norm(r[1])))return true;}
    return false;
  }
  function parseBalanceSheet(rows){
    var out={rows:[],totals:null,kur:{},period:{},total:{},capital:{},periodLabel:''},start=-1,i;
    for(i=0;i<rows.length;i++){var r0=rows[i]||[];if(/^hesaptanimi/.test(norm(r0[0]))){start=i+1;break;}}
    if(start<0)throw new Error('Pusula bilanço başlığı (Hesap Tanimi / Cins) bulunamadı');
    var plKeys={satiskari:'salesProfit',iskonto:'discount',gider:'expense',gelir:'income',kurfarki:'fx',netkarzarar:'net'};
    for(i=start;i<rows.length;i++){
      var r=rows[i]||[],g=text(r[0]),c=text(r[1]),lbl3=norm(r[3]),lbl5=norm(r[5]);
      if(g&&norm(g)==='toplam'){out.totals={debtHas:num(r[5]),recvHas:num(r[6])};continue;}
      if(g&&c){
        out.rows.push({group:g.replace(/\s+/g,' '),rawGroup:g,unit:balanceUnitOf(c),note:(/\s(\d+)\s*$/.exec(c)||[])[1]||'',debt:num(r[2]),recv:num(r[3]),debtHas:num(r[5]),recvHas:num(r[6]),line:i+1});
        continue;
      }
      if(lbl3==='kurfarki'&&!out.periodLabel&&text(r[6])!==''&&text(r[5])===''){out.kur.total=num(r[6]);continue;}
      if(lbl3==='eskikurfarki'){out.kur.old=num(r[6]);continue;}
      if(lbl3==='gunlukkurfarki'){out.kur.daily=num(r[6]);continue;}
      if(norm(r[6])==='toplam'&&text(r[5])){out.periodLabel=text(r[5]);continue;}
      if(lbl3&&plKeys[lbl3]&&out.periodLabel){out.period[plKeys[lbl3]]=num(r[5]);out.total[plKeys[lbl3]]=num(r[6]);continue;}
      if(lbl5==='sermaye')out.capital.capital=num(r[6]);
      else if(lbl5==='demirbas')out.capital.fixed=num(r[6]);
      else if(lbl5==='netkarzarar')out.capital.net=num(r[6]);
      else if(lbl5==='kalansermaye')out.capital.remaining=num(r[6]);
    }
    if(!out.rows.length)throw new Error('Pusula bilançosunda hesap satırı bulunamadı');
    return out;
  }

  /* ---- Cari temizleme listesi (KOD, CARİ, İŞLEM: KALSIN / TEMİZLE, YENİ GRUP) ---- */
  function parseCariCleanup(rows){
    var h=-1,cols=null,i;
    for(i=0;i<Math.min(rows.length,10);i++){
      var r=(rows[i]||[]).map(norm),code=r.indexOf('kod'),name=-1,act=-1,grp=-1;
      r.forEach(function(c,j){if(name<0&&/^cari(adi|unvan)?$|^firmaunvani$/.test(c))name=j;if(act<0&&/^islem/.test(c))act=j;if(grp<0&&/^yenigrup/.test(c))grp=j;});
      if(act>=0&&(code>=0||name>=0)){h=i;cols={code:code,name:name,action:act,group:grp};break;}
    }
    if(h<0)throw new Error('Cari temizleme listesi başlığı (KOD / CARİ / İŞLEM) bulunamadı');
    var items=[],errors=[];
    for(i=h+1;i<rows.length;i++){
      var row=rows[i]||[];if(isEmptyRow(row))continue;
      var code=cols.code>=0?text(row[cols.code]):'',name=cols.name>=0?text(row[cols.name]):'';
      if(!code&&!name)continue;
      var a=norm(row[cols.action]),action=!a||/^kal/.test(a)?'keep':/^temiz|^sil|^sifir/.test(a)?'clear':null;
      if(!action){errors.push({line:i+1,message:'İŞLEM anlaşılamadı: "'+text(row[cols.action])+'" (KALSIN ya da TEMİZLE yazın)'});continue;}
      var g=cols.group>=0?text(row[cols.group]).toLocaleUpperCase('tr-TR'):'';
      items.push({code:code,name:name||code,action:action,group:g,line:i+1});
    }
    return {items:items,errors:errors};
  }

  return {parseCariCleanup:parseCariCleanup,parseBalanceSheet:parseBalanceSheet,isBalanceSheet:isBalanceSheet,balanceKey:balanceKey,balanceUnitOf:balanceUnitOf,buildSpecialStocks:buildSpecialStocks,fileGrandTotal:fileGrandTotal,SPECIAL_GROUP_NAMES:SPECIAL_GROUP_NAMES,cariTypeOf:cariTypeOf,parseStockSummary:parseStockSummary,isStockSummary:isStockSummary,looksTruncated:looksTruncated,GROUP_NAMES:GROUP_NAMES,norm:norm,num:num,purityOf:purityOf,detect:detect,buildBarcodeStocks:buildBarcodeStocks,buildOpenStocks:buildOpenStocks,buildCariBalances:buildCariBalances,detectBalances:detectBalances,balanceSpecOf:balanceSpecOf,BALANCE_UNITS:BALANCE_UNITS,MODES:MODES};
});
