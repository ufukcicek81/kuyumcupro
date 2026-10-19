/* Asil Kuyumcu Pro — çakışmasız bulut senkronu için üç yönlü birleştirme.
 *
 * base   : Bu cihazın buluttan en son gördüğü (veya buluta yazdığı) durum.
 * local  : Cihazdaki güncel durum.
 * remote : Buluttaki güncel durum.
 *
 * Kurallar:
 * - Bir değeri yalnızca bir taraf değiştirdiyse o tarafın değeri alınır.
 * - İki taraf da sayısal bir alanı değiştirdiyse farklar toplanır
 *   (ör. kasa bakiyesi, cari bakiye, stok miktarı): remote + (local - base).
 * - id/docNo/code alanı olan kayıt listeleri kayıt kayıt birleştirilir;
 *   iki cihazda eklenen kayıtların hepsi korunur, bir tarafta silinen kayıt silinir.
 * - Gerçek çakışmada (ikisi de aynı metni farklı değiştirdi) bu cihazın değeri kalır.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.AsilCloudMerge=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  var KEY_FIELDS=['id','docNo','code','key'];

  function isObj(v){return v!==null&&typeof v==='object'&&!Array.isArray(v)}
  function deepEqual(a,b){
    if(a===b)return true;
    if(typeof a!==typeof b||a===null||b===null||typeof a!=='object')return typeof a==='number'&&typeof b==='number'&&isNaN(a)&&isNaN(b);
    if(Array.isArray(a)!==Array.isArray(b))return false;
    if(Array.isArray(a)){
      if(a.length!==b.length)return false;
      for(var i=0;i<a.length;i++)if(!deepEqual(a[i],b[i]))return false;
      return true;
    }
    var ka=Object.keys(a),kb=Object.keys(b);
    if(ka.length!==kb.length)return false;
    for(var j=0;j<ka.length;j++){var k=ka[j];if(!Object.prototype.hasOwnProperty.call(b,k)||!deepEqual(a[k],b[k]))return false}
    return true;
  }
  function roundNum(n){return Math.round(n*1e9)/1e9}

  /* Listedeki tüm kayıtları benzersiz tanımlayan alanı bulur. */
  function keyFieldOf(){
    var lists=Array.prototype.slice.call(arguments).filter(Array.isArray);
    var all=[];lists.forEach(function(l){all=all.concat(l)});
    if(!all.length)return null;
    for(var f=0;f<KEY_FIELDS.length;f++){
      var field=KEY_FIELDS[f],ok=true;
      for(var li=0;li<lists.length&&ok;li++){
        var seen={};
        for(var i=0;i<lists[li].length;i++){
          var x=lists[li][i];
          if(!isObj(x)||x[field]===undefined||x[field]===null||x[field]===''){ok=false;break}
          var k=String(x[field]);if(seen[k]){ok=false;break}seen[k]=1;
        }
      }
      if(ok)return field;
    }
    return null;
  }
  function index(list,field){var m={};(list||[]).forEach(function(x){m[String(x[field])]=x});return m}

  // deleteWins: muhasebe kayıtlarında (satış, kasa hareketi...) silme her zaman kazanır. Silen cihaz bakiyeyi zaten geri aldı;
  // diğer cihazdaki küçük bir alan değişikliği kaydı geri getirirse liste ile bakiye ayrışır.
  function mergeKeyed(b,l,r,field,additive,deleteWins){
    var bi=index(b,field),li=index(l,field),ri=index(r,field),out=[];
    // Bulut sırası esas alınır; bu cihazda yeni eklenenler kendi konumlarına göre başa/sona eklenir.
    r.forEach(function(rx){
      var k=String(rx[field]),inB=k in bi,inL=k in li;
      if(inL)out.push(merge3(inB?bi[k]:undefined,li[k],rx,additive));
      else if(!inB)out.push(rx);                    // başka cihazda eklendi
      else if(!deleteWins&&!deepEqual(bi[k],rx))out.push(rx);    // burada silindi ama orada değişti: değişikliği koru
      // aksi halde bu cihazda silindi
    });
    var newLocal=l.filter(function(lx){var k=String(lx[field]);return !(k in ri)&&!(k in bi)});
    var deletedRemoteButChangedLocal=deleteWins?[]:l.filter(function(lx){var k=String(lx[field]);return !(k in ri)&&(k in bi)&&!deepEqual(bi[k],lx)});
    var add=newLocal.concat(deletedRemoteButChangedLocal);
    if(!add.length)return out;
    var front=l.length&&add.indexOf(l[0])>=0;
    return front?add.concat(out):out.concat(add);
  }

  function merge3(b,l,r,additive){
    if(additive===undefined)additive=true;
    if(deepEqual(l,r))return l;
    if(b!==undefined&&deepEqual(b,l))return r;
    if(b!==undefined&&deepEqual(b,r))return l;
    if(typeof l==='number'&&typeof r==='number'){
      return additive&&typeof b==='number'?roundNum(r+(l-b)):l;
    }
    if(isObj(l)&&isObj(r)){
      var bo=isObj(b)?b:{},out={},keys={};
      Object.keys(r).forEach(function(k){keys[k]=1});Object.keys(l).forEach(function(k){keys[k]=1});
      Object.keys(keys).forEach(function(k){
        var inL=k in l,inR=k in r,inB=k in bo;
        if(inL&&inR){out[k]=merge3(inB?bo[k]:undefined,l[k],r[k],additive);return}
        if(inL){ if(!inB||!deepEqual(bo[k],l[k]))out[k]=l[k]; return } // bulutta silindiyse ve burada değişmediyse sil
        if(inR){ if(!inB||!deepEqual(bo[k],r[k]))out[k]=r[k]; }
      });
      return out;
    }
    if(Array.isArray(l)&&Array.isArray(r)){
      var bl=Array.isArray(b)?b:[];
      var field=keyFieldOf(bl,l,r);
      if(field)return mergeKeyed(bl,l,r,field,additive);
    }
    return l;
  }

  /* Durum nesnesini birleştirir; cihaza özel alanlar her zaman yerel kalır. */
  /* nonAdditiveKeys: fiyat/ayar gibi alanlarda sayılar toplanmaz, bu cihazın değeri kalır. */
  function mergeState(base,local,remote,localOnlyKeys,nonAdditiveKeys,deleteWinsKeys){
    if(!remote)return local;
    if(!base)return null; // ortak taban yoksa güvenli birleştirme yapılamaz
    var na=nonAdditiveKeys||[],merged={},keys={};
    Object.keys(remote).forEach(function(k){keys[k]=1});Object.keys(local).forEach(function(k){keys[k]=1});
    Object.keys(keys).forEach(function(k){
      var inL=k in local,inR=k in remote,inB=k in base;
      if(inL&&inR){
        var bl=inB&&Array.isArray(base[k])?base[k]:[],field=(deleteWinsKeys||[]).indexOf(k)>=0&&Array.isArray(local[k])&&Array.isArray(remote[k])?keyFieldOf(bl,local[k],remote[k]):null;
        merged[k]=field&&!deepEqual(local[k],remote[k])?mergeKeyed(bl,local[k],remote[k],field,na.indexOf(k)<0,true):merge3(inB?base[k]:undefined,local[k],remote[k],na.indexOf(k)<0);
      }
      else if(inL){if(!inB||!deepEqual(base[k],local[k]))merged[k]=local[k]}
      else if(!inB||!deepEqual(base[k],remote[k]))merged[k]=remote[k];
    });
    (localOnlyKeys||[]).forEach(function(k){if(local&&k in local)merged[k]=local[k];else delete merged[k]});
    return merged;
  }

  /* Firebase Realtime Database null değerleri, boş dizi ve boş nesneleri saklamaz.
     Karşılaştırmalar ve taban bu biçimde tutulur ki gereksiz "fark" oluşmasın. */
  function firebaseNormalize(v){
    if(v===null||v===undefined)return undefined;
    if(typeof v==='number')return isFinite(v)?v:undefined;
    if(typeof v!=='object')return typeof v==='function'?undefined:v;
    if(typeof v.toJSON==='function')return firebaseNormalize(v.toJSON());
    if(Array.isArray(v)){
      var arr=v.map(firebaseNormalize);
      if(!arr.some(function(x){return x!==undefined}))return undefined;
      // Firebase dizideki boşlukları korumaz; ortadaki boş öğeler null olarak döner, sondakiler düşer.
      while(arr.length&&arr[arr.length-1]===undefined)arr.pop();
      return arr.map(function(x){return x===undefined?null:x});
    }
    var out={},any=false;
    Object.keys(v).forEach(function(k){var n=firebaseNormalize(v[k]);if(n!==undefined){out[k]=n;any=true}});
    return any?out:undefined;
  }
  return {deepEqual:deepEqual,merge3:merge3,mergeState:mergeState,firebaseNormalize:firebaseNormalize};
});
