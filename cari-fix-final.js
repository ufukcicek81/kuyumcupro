/* KUYUMCUPRO V7 - STABLE CARI FILTER + MOVEMENT BRIDGE
 * Live entrypoint loaded by index.html.
 * Keeps the stable cari filter and exposes the V7 movement API from one file.
 */
(function(){
  'use strict';

  const BAR_ID='kuyumcuV7CariFilterBar';
  const STYLE_ID='kuyumcuV7CariFilterStyle';
  const TYPES=['Tümü','Müşteri','Toptancı','Banka','Özel'];

  let active='Tümü';
  let query='';
  let gridObserver=null;
  let pageObserver=null;

  const norm=v=>String(v||'').trim().toLocaleLowerCase('tr-TR');
  const text=el=>String((el&&el.textContent)||'').trim();
  const grid=()=>document.getElementById('cariCardGrid');

  /* ---------- V7 MOVEMENT BRIDGE ---------- */
  const cryptoRandom=()=>{
    try{return crypto.randomUUID();}
    catch(_){return 'v7-'+Date.now()+'-'+Math.random().toString(36).slice(2);}
  };

  const movement=(raw={})=>({
    id:raw.id||raw.docId||raw.c_islemID||cryptoRandom(),
    cariId:raw.cariId??raw.firkod??raw.firmaKodu??raw.carinum??null,
    date:raw.date||raw.CariTrh||raw.tarih||raw.createdAt||new Date().toISOString(),
    type:raw.type||raw.HrkTip||raw.hareketTipi||'HAREKET',
    debit:Number(raw.debit??raw.borc??raw.borctutar??0)||0,
    credit:Number(raw.credit??raw.alacak??raw.alacaktutar??0)||0,
    amount:Number(raw.amount??raw.Tutar??raw.tutar??0)||0,
    quantity:Number(raw.quantity??raw.Miktar??raw.miktar??0)||0,
    unit:raw.unit||raw.Birim||raw.birim||'',
    price:Number(raw.price??raw.Fiyat??raw.fiyat??0)||0,
    purity:Number(raw.purity??raw.Ayar??raw.ayar??raw.milyem??0)||0,
    has:Number(raw.has??raw.Tutar_Bil??raw.tutarHas??0)||0,
    workmanship:Number(raw.workmanship??raw.IscTut??raw.iscilik??0)||0,
    currency:raw.currency||raw.Dovcinsi||raw.doviz||'TL',
    rate:Number(raw.rate??raw.Kur??raw.kur??0)||0,
    description:raw.description||raw.Aciklama||raw.aciklama||'',
    serial:raw.serial||raw.CariSeri||raw.cariSeri||'',
    sourceId:raw.sourceId??raw.c_islemID??null,
    sourceType:raw.sourceType||raw.KayitTuru||'CARI',
    counterAccount:raw.counterAccount??raw.KarsiHesap??null,
    reversed:!!raw.reversed
  });

  window.kuyumcuV7=window.kuyumcuV7||{};
  window.kuyumcuV7.normalizeCariMovement=movement;

  window.kuyumcuV7.getCariMovements=function(cariId){
    const sources=[window.cariHareketleri,window.cariKayitlari,window.carHrk,window.cariHareketler];
    for(const src of sources){
      if(!Array.isArray(src))continue;
      return src.map(movement).filter(x=>cariId==null||String(x.cariId)===String(cariId));
    }
    return [];
  };

  window.kuyumcuV7.cariBalance=function(cariId){
    return window.kuyumcuV7.getCariMovements(cariId).reduce((a,m)=>({
      debit:a.debit+m.debit,
      credit:a.credit+m.credit,
      balance:a.balance+m.debit-m.credit,
      has:a.has+m.has,
      quantity:a.quantity+m.quantity
    }),{debit:0,credit:0,balance:0,has:0,quantity:0});
  };

  function ensureArray(name){
    if(!Array.isArray(window[name]))window[name]=[];
    return window[name];
  }

  function push(name,raw){
    const arr=ensureArray(name);
    const m=movement(raw);
    arr.push(m);
    return m;
  }

  window.kuyumcuV7.postSale=function(input={}){
    const id=input.transactionId||cryptoRandom();
    const cariId=input.cariId??input.firkod??input.firmaKodu??input.carinum??null;
    const total=Number(input.total??input.amount??input.Tutar??0)||0;
    const has=Number(input.has??input.Tutar_Bil??0)||0;
    const items=Array.isArray(input.items)?input.items:[];

    const sale=push('cariHareketleri',{
      ...input,
      id:cryptoRandom(),
      sourceId:id,
      sourceType:'SATIS',
      cariId,
      type:'SATIS',
      debit:total,
      amount:total,
      has,
      description:input.description||'SATIŞ'
    });

    if(items.length){
      const stock=ensureArray('stokHareketleri');
      items.forEach(it=>stock.push({
        ...it,
        id:cryptoRandom(),
        transactionId:id,
        type:'CIKIS',
        sourceType:'SATIS'
      }));
    }

    if(has||input.goldQuantity){
      const gold=ensureArray('altinHareketleri');
      gold.push({
        id:cryptoRandom(),
        transactionId:id,
        cariId,
        type:'SATIS',
        has,
        quantity:Number(input.goldQuantity||0)||0,
        purity:Number(input.purity||input.ayar||0)||0
      });
    }

    window.dispatchEvent(new CustomEvent('kuyumcu:v7-movement',{
      detail:{kind:'sale',transactionId:id,cariId,movement:sale}
    }));

    return{transactionId:id,movement:sale};
  };

  window.kuyumcuV7.postPayment=function(input={}){
    const id=input.transactionId||cryptoRandom();
    const cariId=input.cariId??input.firkod??input.firmaKodu??input.carinum??null;
    const amount=Number(input.amount??input.Tutar??input.tutar??0)||0;
    const has=Number(input.has??input.Tutar_Bil??0)||0;

    const payment=push('cariHareketleri',{
      ...input,
      id:cryptoRandom(),
      sourceId:id,
      sourceType:'TAHSILAT',
      cariId,
      type:'TAHSILAT',
      credit:amount,
      amount,
      has,
      description:input.description||'TAHSİLAT'
    });

    ensureArray('paymentAllocations').push({
      id:cryptoRandom(),
      paymentId:id,
      cariId,
      amount,
      has,
      sourceType:'TAHSILAT'
    });

    window.dispatchEvent(new CustomEvent('kuyumcu:v7-movement',{
      detail:{kind:'payment',transactionId:id,cariId,movement:payment}
    }));

    return{transactionId:id,movement:payment};
  };

  window.kuyumcuV7.postReturn=function(input={}){
    const id=input.transactionId||cryptoRandom();
    const cariId=input.cariId??input.firkod??input.firmaKodu??input.carinum??null;
    const amount=Number(input.amount??input.Tutar??0)||0;

    const m=push('cariHareketleri',{
      ...input,
      id:cryptoRandom(),
      sourceId:id,
      sourceType:'IADE',
      cariId,
      type:'IADE',
      credit:amount,
      amount,
      has:Number(input.has||0),
      quantity:Number(input.quantity||input.Miktar||0),
      purity:Number(input.purity||input.Ayar||input.milyem||0),
      description:input.description||'İADE'
    });

    const stock=ensureArray('stokHareketleri');
    (Array.isArray(input.items)?input.items:[]).forEach(it=>stock.push({
      ...it,
      id:cryptoRandom(),
      transactionId:id,
      type:'GIRIS',
      sourceType:'IADE'
    }));

    window.dispatchEvent(new CustomEvent('kuyumcu:v7-movement',{
      detail:{kind:'return',transactionId:id,cariId,movement:m}
    }));

    return{transactionId:id,movement:m};
  };

  /* ---------- STABLE CARI FILTER ---------- */
  function isCariPage(){
    return !!grid()||[...document.querySelectorAll('h1,h2,h3')].some(x=>norm(text(x)).includes('cari hesap işlemleri'));
  }

  function cardType(card){
    const badges=[...card.querySelectorAll('.badge')];
    for(const badge of badges){
      const t=text(badge);
      if(TYPES.includes(t)&&t!=='Tümü')return t;
    }
    const hay=text(card);
    for(const type of TYPES.slice(1)){
      if(new RegExp('(^|[\\s\\n])'+type.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')+'(?=[$\\s\\n])','i').test(hay))return type;
    }
    return '';
  }

  function cards(){
    const g=grid();
    return g?[...g.children].filter(x=>x.classList&&x.classList.contains('card')):[];
  }

  function apply(){
    const list=cards();
    let shown=0;
    const q=norm(query);
    for(const card of list){
      const type=cardType(card);
      const hay=norm(text(card));
      const ok=(active==='Tümü'||type===active)&&(!q||hay.includes(q));
      card.hidden=!ok;
      if(ok)shown++;
    }
    const count=document.querySelector('#'+BAR_ID+' .kuyumcu-v7-count');
    if(count)count.textContent=shown+' cari';
    document.querySelectorAll('#'+BAR_ID+' [data-cari-type]').forEach(btn=>{
      const on=btn.dataset.cariType===active;
      btn.classList.toggle('active',on);
      btn.setAttribute('aria-pressed',on?'true':'false');
    });
  }

  function ensureStyle(){
    if(document.getElementById(STYLE_ID))return;
    const style=document.createElement('style');
    style.id=STYLE_ID;
    style.textContent=`#${BAR_ID}{margin:10px 0 14px;padding:10px 12px;background:var(--panel,#14161a);border:1px solid var(--line,#2d323a);border-radius:12px;position:relative;z-index:5}#${BAR_ID} .kuyumcu-v7-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}#${BAR_ID} .kuyumcu-v7-tabs{display:flex;gap:6px;flex-wrap:wrap}#${BAR_ID} button{border:1px solid #343941;background:transparent;color:#aeb3bd;border-radius:9px;padding:7px 11px;font-weight:700;font-size:12px;cursor:pointer}#${BAR_ID} button.active{background:linear-gradient(135deg,#d6b15f,#b99243);border-color:#d6b15f;color:#101113}#${BAR_ID} input{flex:1;min-width:240px;background:#0f1114;border:1px solid #343941;color:#fff;border-radius:9px;padding:8px 10px;outline:none}#${BAR_ID} .kuyumcu-v7-count{font-size:11px;color:#8f97a2;white-space:nowrap}`;
    document.head.appendChild(style);
  }

  function ensureBar(){
    if(!isCariPage())return;
    ensureStyle();
    let bar=document.getElementById(BAR_ID);
    if(bar){apply();return;}
    const g=grid();
    const heading=[...document.querySelectorAll('h1,h2,h3')].find(x=>norm(text(x)).includes('cari hesap işlemleri'));
    const host=heading?(heading.closest('.page-title')||heading.parentElement):g?.parentElement;
    if(!host)return;
    bar=document.createElement('div');
    bar.id=BAR_ID;
    bar.innerHTML=`<div class="kuyumcu-v7-row"><div class="kuyumcu-v7-tabs">${TYPES.map(t=>`<button type="button" data-cari-type="${t}" aria-pressed="${t==='Tümü'?'true':'false'}">${t}</button>`).join('')}</div><input type="search" aria-label="Cari ara" placeholder="Cari / toptancı / hesap kodu / telefon ara"><span class="kuyumcu-v7-count"></span></div>`;
    host.insertAdjacentElement('afterend',bar);
    const input=bar.querySelector('input');
    input.value=query;
    input.addEventListener('input',()=>{query=input.value;apply();});
    bar.addEventListener('click',event=>{
      const button=event.target.closest('[data-cari-type]');
      if(!button)return;
      event.preventDefault();
      event.stopPropagation();
      active=button.dataset.cariType||'Tümü';
      apply();
    });
    apply();
  }

  function observeGrid(){
    const g=grid();
    if(!g||gridObserver===g)return;
    gridObserver=new MutationObserver(()=>requestAnimationFrame(apply));
    gridObserver.observe(g,{childList:true,subtree:true});
  }

  function run(){
    if(!isCariPage())return;
    ensureBar();
    observeGrid();
  }

  function start(){
    run();
    pageObserver=new MutationObserver(()=>{
      if(!document.getElementById(BAR_ID))run();
      if(!gridObserver)observeGrid();
    });
    pageObserver.observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
