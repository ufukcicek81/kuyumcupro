/* Asil Kuyumcu Pro — T.C. kimlik kartı (TD1, 3 x 30) MRZ ayrıştırıcı.
 *
 * Kamera/OCR metni satır sırası, satır bölünmesi ve O/0, I/1, B/8 gibi karışıklıklar içerebilir.
 * Satırlar konumdan değil desenden bulunur; seri no, doğum ve son geçerlilik ICAO 9303 kontrol
 * haneleriyle doğrulanır. NFC Helper (Android/iOS) uygulamasındaki ayrıştırıcıyla aynı algoritma.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.AsilMrz=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  var TO_DIGIT={O:'0',Q:'0',D:'0',I:'1',L:'1',Z:'2',S:'5',G:'6',B:'8'};
  var TO_LETTER={'0':'O','1':'I','2':'Z','5':'S','6':'G','8':'B'};
  function toDigit(c){return TO_DIGIT[c]||c}
  function toLetter(c){return TO_LETTER[c]||c}
  function toDigits(s){var o='';for(var i=0;i<s.length;i++){var d=toDigit(s[i]);if(d<'0'||d>'9')return null;o+=d}return o}
  function toLetters(s){var o='';for(var i=0;i<s.length;i++)o+=toLetter(s[i]);return o}

  function normalize(s){
    return String(s==null?'':s).toLocaleUpperCase('tr-TR')
      .replace(/İ/g,'I').replace(/Ğ/g,'G').replace(/Ü/g,'U').replace(/Ş/g,'S').replace(/Ö/g,'O').replace(/Ç/g,'C')
      .replace(/[«‹≤]/g,'<').replace(/\s+/g,'').replace(/[^A-Z0-9<]/g,'');
  }

  /** ICAO 9303 kontrol hanesi (ağırlıklar 7-3-1). */
  function checkDigit(s){
    var w=[7,3,1],sum=0;
    for(var i=0;i<s.length;i++){var c=s[i],v=c>='0'&&c<='9'?c.charCodeAt(0)-48:c>='A'&&c<='Z'?c.charCodeAt(0)-55:0;sum+=v*w[i%3]}
    return sum%10;
  }
  function plausibleDate(yymmdd){var mm=+yymmdd.slice(2,4),dd=+yymmdd.slice(4,6);return mm>=1&&mm<=12&&dd>=1&&dd<=31}

  function isValidTckn(s){
    if(!/^[1-9]\d{10}$/.test(s))return false;
    var n=s.split('').map(Number),odd=n[0]+n[2]+n[4]+n[6]+n[8],even=n[1]+n[3]+n[5]+n[7];
    if(((odd*7-even)%10+10)%10!==n[9])return false;
    return n.slice(0,10).reduce(function(a,b){return a+b},0)%10===n[10];
  }
  function findTckn(s){
    var d='';for(var i=0;i<s.length;i++){var c=toDigit(s[i]);if(c>='0'&&c<='9')d+=c}
    for(var j=0;j+11<=d.length;j++){var c11=d.slice(j,j+11);if(isValidTckn(c11))return c11}
    return '';
  }

  /** 2. satır: YYMMDD c C YYMMDD c NAT — en az bir kontrol hanesi tutmalı. */
  function findLine2(sources){
    var best=null;
    sources.forEach(function(s){
      for(var i=0;i+18<=s.length;i++){
        var w=s.slice(i,i+18),sex=w[7];
        if('MFKE<'.indexOf(sex)<0)continue;
        var birth=toDigits(w.slice(0,6)),bChk=toDigits(w[6]),exp=toDigits(w.slice(8,14)),eChk=toDigits(w[14]);
        if(!birth||!bChk||!exp||!eChk||!plausibleDate(birth)||!plausibleDate(exp))continue;
        var nat=toLetters(w.slice(15,18)),score=0;
        if(checkDigit(birth)===+bChk)score+=2;
        if(checkDigit(exp)===+eChk)score+=2;
        if(/^[A-Z]{3}$/.test(nat))score+=1;
        if(nat==='TUR')score+=1;
        if(score<3)continue;
        if(!best||score>best.score)best={birth:birth,expiry:exp,sex:sex==='M'?'M':sex==='<'?'':'F',nationality:nat,score:score,checked:checkDigit(birth)===+bChk&&checkDigit(exp)===+eChk};
      }
    });
    return best;
  }

  /** Türk kimlik seri no: harf, 2 rakam, harf, 5 rakam (ör. A12B34567). */
  function fixTurkishDocNo(raw){
    if(!raw||raw.length!==9)return null;
    var o='';
    for(var i=0;i<9;i++){var letter=i===0||i===3,f=letter?toLetter(raw[i]):toDigit(raw[i]);
      if(letter?!(f>='A'&&f<='Z'):!(f>='0'&&f<='9'))return null;o+=f}
    return o;
  }
  /** 1. satır: seri no + doğru kontrol hanesi; "TUR" sonrası öncelikli. */
  function findLine1(sources){
    var fallback=null;
    for(var k=0;k<sources.length;k++){var s=sources[k];
      for(var i=0;i+10<=s.length;i++){
        var doc=fixTurkishDocNo(s.slice(i,i+9)),chk=toDigits(s[i+9]);
        if(!doc||!chk||checkDigit(doc)!==+chk)continue;
        var r={documentNumber:doc,tckn:findTckn(s.slice(i+10,i+25))};
        if(i>=3&&toLetters(s.slice(i-3,i))==='TUR')return r;
        // "TUR" ön eki okunamadıysa: yanlış eşleşmeyi önlemek için harf yerleri OCR'da gerçekten harf olmalı.
        if(!fallback&&/[A-Z]/.test(s[i])&&/[A-Z]/.test(s[i+3]))fallback=r;
      }
    }
    return fallback;
  }
  function findName(lines){
    for(var i=lines.length-1;i>=0;i--){var l=lines[i];
      if(l.indexOf('<<')<0||l.replace(/[A-Z<]/g,'').length>1)continue;
      // Dolgu işaretleri (<) OCR'da sıkça K/L okunur: yalnız K/L'den oluşan parçalar isim değildir.
      var clean=function(t){return t.replace(/</g,' ').split(/\s+/).filter(function(w){return w&&!/^[KL]{3,}$/.test(w)}).join(' ')};
      var parts=l.split('<<'),surname=clean(parts[0]),given=clean(parts.slice(1).join(' '));
      var full=(given+' '+surname).trim();
      if(full.length>=3)return {fullName:full,givenNames:given,surname:surname};
    }
    return {fullName:'',givenNames:'',surname:''};
  }

  /** Okunabilen alanları döndürür; okunamayan alanlar boş kalır. */
  function parse(text){
    var lines=String(text==null?'':text).split(/\r?\n/).map(normalize).filter(Boolean);
    var sources=lines.slice();
    for(var i=0;i+1<lines.length;i++)sources.push(lines[i]+lines[i+1]);
    sources.push(lines.join(''));
    var d={documentNumber:'',birthYYMMDD:'',expiryYYMMDD:'',tckn:'',fullName:'',givenNames:'',surname:'',sex:'',nationality:'',raw:lines.join('\n')};
    var l2=findLine2(sources);if(l2){d.birthYYMMDD=l2.birth;d.expiryYYMMDD=l2.expiry;d.sex=l2.sex;d.nationality=l2.nationality}
    var l1=findLine1(sources);if(l1){d.documentNumber=l1.documentNumber;d.tckn=l1.tckn}
    if(!d.tckn)d.tckn=findTckn(lines.join(''));
    var n=findName(lines);d.fullName=n.fullName;d.givenNames=n.givenNames;d.surname=n.surname;
    d.complete=!!(d.documentNumber&&d.birthYYMMDD&&d.expiryYYMMDD);
    return d;
  }

  /** YYMMDD → YYYY-MM-DD. Doğum geleceğe düşerse 1900'lü, son geçerlilik hep 2000'li. */
  function toIsoDate(yymmdd,kind,now){
    if(!/^\d{6}$/.test(yymmdd||''))return '';
    var yy=+yymmdd.slice(0,2),cur=(now||new Date()).getFullYear()%100;
    var year=kind==='birth'?(yy>cur?1900+yy:2000+yy):2000+yy;
    return year+'-'+yymmdd.slice(2,4)+'-'+yymmdd.slice(4,6);
  }

  return {parse:parse,checkDigit:checkDigit,isValidTckn:isValidTckn,toIsoDate:toIsoDate,normalize:normalize};
});
