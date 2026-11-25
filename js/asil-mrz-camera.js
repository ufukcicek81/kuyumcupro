/* Asil Kuyumcu Pro — kamerayla kimlik (MRZ) okuma: tarayıcıda Tesseract OCR + js/asil-mrz.js.
 * Ana program (index.html) ve telefondan açılan eşleştirme sayfası (kimlik.html) ortak kullanır.
 */
(function(root){
  'use strict';
  var AsilMrz=root.AsilMrz;
  const TESSERACT_URL_V7='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  function loadTesseractV7(){
    if(window.Tesseract)return Promise.resolve(window.Tesseract);
    if(loadTesseractV7.p)return loadTesseractV7.p;
    loadTesseractV7.p=new Promise((resolve,reject)=>{const sc=document.createElement('script');sc.src=TESSERACT_URL_V7;sc.onload=()=>window.Tesseract?resolve(window.Tesseract):reject(new Error('Yazı tanıma yüklenemedi'));sc.onerror=()=>{sc.remove();loadTesseractV7.p=null;reject(new Error('Yazı tanıma indirilemedi; internet bağlantısını kontrol edin'));};document.head.appendChild(sc);});
    return loadTesseractV7.p;
  }
  function loadImageFileV7(file){return new Promise((resolve,reject)=>{const u=URL.createObjectURL(file),img=new Image();img.onload=()=>{URL.revokeObjectURL(u);resolve(img);};img.onerror=()=>{URL.revokeObjectURL(u);reject(new Error('Fotoğraf açılamadı'));};img.src=u;});}
  /* Görüntünün alt kısmını (MRZ bölgesi) büyütüp gri tona ve siyah-beyaza çevirir. */
  function mrzCanvasV7(img,fromRatio,{threshold=true,rotate=0}={}){
    const W0=img.naturalWidth||img.width,H0=img.naturalHeight||img.height;
    // Ters tutulmuş kartta MRZ üstte kalır (180°); iPhone'da dik çekilen fotoğrafta kart yan durur (90° / 270°):
    // görüntü çevrilip aynı alt bölge okunur.
    const deg=rotate===true?180:Number(rotate)||0,side=deg===90||deg===270,W=side?H0:W0,H=side?W0:H0;
    let src=img;if(deg){const r=document.createElement('canvas');r.width=W;r.height=H;const rg=r.getContext('2d');rg.translate(W/2,H/2);rg.rotate(deg*Math.PI/180);rg.drawImage(img,-W0/2,-H0/2);src=r;}
    const sy=Math.floor(H*fromRatio),sh=H-sy;
    // iPhone fotoğrafları 4000 piksel genişliğe çıkar: ~2000 piksele indirmek yazı tanımayı hem hızlandırır hem düzeltir.
    const scale=Math.min(3,2000/W),c=document.createElement('canvas');c.width=Math.round(W*scale);c.height=Math.round(sh*scale);
    const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(src,0,sy,W,sh,0,0,c.width,c.height);
    const im=g.getImageData(0,0,c.width,c.height),px=im.data,hist=new Array(256).fill(0);
    for(let i=0;i<px.length;i+=4){const y=Math.round(px[i]*.299+px[i+1]*.587+px[i+2]*.114);px[i]=y;hist[y]++;}
    // Otsu eşiği
    let total=px.length/4,sum=0;for(let t=0;t<256;t++)sum+=t*hist[t];let sumB=0,wB=0,best=0,th=128;
    for(let t=0;t<256;t++){wB+=hist[t];if(!wB)continue;const wF=total-wB;if(!wF)break;sumB+=t*hist[t];const mB=sumB/wB,mF=(sum-sumB)/wF,v=wB*wF*(mB-mF)*(mB-mF);if(v>best){best=v;th=t;}}
    for(let i=0;i<px.length;i+=4){const v=threshold?(px[i]>th?255:0):px[i];px[i]=px[i+1]=px[i+2]=v;px[i+3]=255;}
    g.putImageData(im,0,0);return c;
  }
  function mergeMrzV7(a,b){
    if(!a)return {...b};
    const out={...a};['documentNumber','birthYYMMDD','expiryYYMMDD','tckn','fullName','givenNames','surname','sex','nationality'].forEach(k=>{if(!out[k]&&b[k])out[k]=b[k];});
    out.complete=!!(out.documentNumber&&out.birthYYMMDD&&out.expiryYYMMDD);return out;
  }
  function voteMrzV7(parses){
    const pick=(k)=>{const c=new Map();parses.forEach(p=>{const v=p[k];if(v)c.set(v,(c.get(v)||0)+1);});let best='',n=0;c.forEach((m,v)=>{if(m>n){best=v;n=m;}});return [best,n];};
    const out={};['documentNumber','birthYYMMDD','expiryYYMMDD','tckn','sex','nationality'].forEach(k=>{out[k]=pick(k)[0];});
    const [name,nameVotes]=pick('fullName'),src=parses.find(p=>p.fullName===name)||{};
    Object.assign(out,{fullName:name,givenNames:src.givenNames||'',surname:src.surname||'',nameVotes,complete:!!(out.documentNumber&&out.birthYYMMDD&&out.expiryYYMMDD)});
    return out;
  }
  async function readMrzFromPhotoV7(file,onStatus){
    onStatus('Yazı tanıma hazırlanıyor… (ilk seferde biraz sürer)');
    const T=await loadTesseractV7(),img=await loadImageFileV7(file);
    const worker=await T.createWorker('eng',1,{logger:m=>{if(m.status==='recognizing text')onStatus('Okunuyor… %'+Math.round((m.progress||0)*100));}});
    try{
      await worker.setParameters({tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',tessedit_pageseg_mode:'6'});
      // Farklı kırpma / eşikleme / döndürme denemeleri; her alan kontrol haneleriyle doğrulandığı için
      // denemelerden gelen alanlar birleştirilir (biri seri noyu, diğeri tarihleri okuyabilir).
      const portrait=(img.naturalHeight||img.height)>(img.naturalWidth||img.width)*1.1;
      const tries=[[0.55,{}],[0.4,{}],[0.55,{threshold:false}],[0,{}]];
      if(portrait)tries.splice(1,0,[0.55,{rotate:90}],[0.55,{rotate:270}],[0.4,{rotate:90}],[0.4,{rotate:270}]);
      tries.push([0.55,{rotate:180}],[0.4,{threshold:false,rotate:180}]);
      // Ad soyadın kontrol hanesi yoktur: tek okumaya güvenmek yerine denemeler arasında oylama yapılır;
      // diğer alanlarda da en çok tekrar eden değer seçilir (hepsi kontrol haneli / doğrulanmış adaylardır).
      const parses=[],texts=[];
      for(const [from,opt] of tries){
        const {data}=await worker.recognize(mrzCanvasV7(img,from,opt));
        texts.push(data.text||'');parses.push(AsilMrz.parse(data.text||''));
        const acc=voteMrzV7(parses);
        if(acc.complete&&acc.tckn&&acc.fullName&&acc.nameVotes>=2)break;
      }
      const acc=voteMrzV7(parses);
      acc.ocrText=texts.join('\n---\n');
      return acc;
    }finally{try{await worker.terminate();}catch{}}
  }

  root.AsilMrzCamera={read:readMrzFromPhotoV7,merge:mergeMrzV7,vote:voteMrzV7,load:loadTesseractV7};
})(typeof self!=='undefined'?self:this);
