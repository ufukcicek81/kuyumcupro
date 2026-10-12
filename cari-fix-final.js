/* UFUK_DOVIZ_MULTI_V2
   Döviz Alış / Satış ekranına çoklu döviz satırı, işlem özeti ve fiş yazdırma adımı ekler.
   Uygulamanın kendi kaydetme fonksiyonu kullanılır; her satır ayrı belge olarak kaydedilir. */
(function(){
'use strict';
var KINDS=['Döviz Alış','Döviz Satış'];
var flow=null,bypass=false;
function tx(e){return String(e&&e.textContent||'').trim()}
function no(v){return String(v||'').toLocaleLowerCase('tr-TR')}
function num(v){return parseFloat(String(v||'').replace(',','.'))||0}
function $(id){return document.getElementById(id)}
function fxModal(){var m=$('modalRoot');return m&&m.querySelector('#stFx')?m:null}
function kindOf(m){var h=m&&m.querySelector('.modal-head h3');return /satış/.test(no(tx(h)))?'Döviz Satış':'Döviz Alış'}
function selText(s){if(!s)return '';var o=s.options[s.selectedIndex];return o?String(o.text).trim():''}
function fire(el,type){el.dispatchEvent(new Event(type,{bubbles:true}))}
function setSelect(s,v){if(!s||!v)return false;var o=Array.from(s.options).find(function(x){return x.value===v||String(x.text).trim()===v});if(!o)return false;s.value=o.value;fire(s,'change');return true}
function setInput(i,v){if(!i)return;i.value=v;fire(i,'input');fire(i,'change')}
function receiptIds(m){return Array.from((m||document).querySelectorAll('[data-receipt-kind="trade"][data-receipt-id]')).map(function(b){return b.dataset.receiptId})}
function wait(test,timeout,done){var t0=Date.now();(function loop(){var r=test();if(r)return done(r);if(Date.now()-t0>timeout)return done(null);setTimeout(loop,100)})()}
function opener(kind){return Array.from(document.querySelectorAll('[data-home-trade],[data-special-trade]')).find(function(b){return (b.dataset.homeTrade||b.dataset.specialTrade)===kind})}

/* Ana ekrandaki kur hesaplamasını kullanarak seçilen dövizin güncel kurunu okur. */
function currentRate(cur){
  var fx=$('stFx'),price=$('stPrice'),acc=$('stFxAccount');if(!fx||!price)return '';
  if(fx.value===cur)return price.value;
  var oldCur=fx.value,oldPrice=price.value,oldAcc=acc&&acc.value,oldTotal=$('stTotal')&&$('stTotal').value;
  fx.value=cur;fire(fx,'change');var rate=price.value;
  fx.value=oldCur;fire(fx,'change');price.value=oldPrice;if(acc&&oldAcc)acc.value=oldAcc;if($('stTotal'))$('stTotal').value=oldTotal;
  return rate;
}

function mainRow(){return{currency:$('stFx').value,amount:$('stQty').value,rate:$('stPrice').value,total:$('stTotal').value,tl:$('stTlAccount')&&$('stTlAccount').value,tlText:selText($('stTlAccount')),fx:$('stFxAccount')&&$('stFxAccount').value,fxText:selText($('stFxAccount')),customer:$('stCustomer')?$('stCustomer').value:''}}
function collectRows(m){
  var base=mainRow(),rows=[base];
  m.querySelectorAll('[data-ufuk-extra-rows] [data-row]').forEach(function(r){
    var cur=r.querySelector('select').value,inp=r.querySelectorAll('input'),amt=inp[0].value,rate=inp[1].value;
    if(num(amt)>0&&num(rate)>0)rows.push({currency:cur,amount:amt,rate:rate,total:(num(amt)*num(rate)).toFixed(2),tl:base.tl,tlText:base.tlText,fx:cur===base.currency?base.fx:'',customer:base.customer});
  });
  return rows.filter(function(r){return r.currency&&num(r.amount)>0&&num(r.rate)>0});
}
function fill(r){
  setSelect($('stFx'),r.currency);
  setInput($('stQty'),r.amount);
  setInput($('stPrice'),r.rate);
  if(r.tl)setSelect($('stTlAccount'),r.tl);
  if(r.fx)setSelect($('stFxAccount'),r.fx);
  if($('stCustomer'))$('stCustomer').value=r.customer||'';
}

function addRowsUi(m){
  if(m.querySelector('[data-ufuk-extra-rows]'))return;
  var grid=m.querySelector('#stFx').closest('.form-grid');if(!grid)return;
  var wrap=document.createElement('div');wrap.style.cssText='margin-top:8px';
  var box=document.createElement('div');box.dataset.ufukExtraRows='1';box.style.cssText='margin:7px 0;width:100%';
  var add=document.createElement('button');add.type='button';add.className='btn btn-outline';add.textContent='+ Döviz Ekle';
  add.onclick=function(e){e.preventDefault();e.stopPropagation();addRow(box)};
  wrap.appendChild(add);wrap.appendChild(box);grid.parentNode.insertBefore(wrap,grid.nextSibling);
}
function addRow(box){
  var row=document.createElement('div');row.dataset.row='1';row.style.cssText='display:grid;grid-template-columns:minmax(80px,1fr) minmax(80px,1fr) minmax(80px,1fr) minmax(90px,1fr) 38px;gap:6px;margin-top:7px;align-items:center';
  var sel=$('stFx').cloneNode(true);sel.removeAttribute('id');sel.value=$('stFx').value;
  function inp(ph,ro){var i=document.createElement('input');i.className='input';i.placeholder=ph;i.type=ro?'text':'number';i.step='any';i.readOnly=!!ro;return i}
  var amt=inp('Miktar'),rate=inp('Kur'),tot=inp('TL Toplam',true);
  var del=document.createElement('button');del.type='button';del.className='btn btn-outline';del.textContent='×';del.onclick=function(){row.remove()};
  function calc(){var a=num(amt.value),q=num(rate.value);tot.value=a&&q?(a*q).toFixed(2):''}
  sel.addEventListener('change',function(){rate.value=currentRate(sel.value);calc()});
  amt.addEventListener('input',calc);rate.addEventListener('input',calc);
  rate.value=currentRate(sel.value);
  [sel,amt,rate,tot,del].forEach(function(x){row.appendChild(x)});
  box.appendChild(row);amt.focus();
}

function overlay(title){
  close();var b=document.createElement('div');b.id='ufukCurrencySummary';
  b.style.cssText='position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center;padding:18px;font-family:Arial,sans-serif';
  var c=document.createElement('div');c.style.cssText='width:min(680px,96vw);max-height:90vh;overflow:auto;background:#fff;color:#111;border-radius:15px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.35)';
  var h=document.createElement('h2');h.textContent=title;h.style.margin='0 0 15px';c.appendChild(h);b.appendChild(c);document.body.appendChild(b);return c;
}
function close(){var e=$('ufukCurrencySummary');if(e)e.remove()}
function money(n){return n.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}

function showSummary(m,rows){
  var kind=kindOf(m),c=overlay(kind.toLocaleUpperCase('tr-TR')+' — İŞLEM ÖZETİ'),sum=0;
  rows.forEach(function(r,idx){
    var t=num(r.amount)*num(r.rate);sum+=t;
    var d=document.createElement('div');d.style.cssText='padding:10px 0;border-bottom:1px solid #eee;display:flex;justify-content:space-between;gap:10px';
    var a=document.createElement('b');a.textContent=(idx+1)+'. '+r.currency;
    var s=document.createElement('span');s.textContent=r.amount+' × '+r.rate+' = '+money(t)+' TL';
    d.appendChild(a);d.appendChild(s);c.appendChild(d);
  });
  var z=document.createElement('div');z.style.cssText='padding:12px 0;font-size:17px;font-weight:700';z.textContent='Toplam TL: '+money(sum)+' TL';c.appendChild(z);
  var box=document.createElement('div');box.style.cssText='margin-top:12px;padding:12px;background:#f7f7f7;border-radius:10px';
  box.innerHTML='<label style="font-weight:700">Fiş yazdırmak istiyor musunuz?</label><select style="display:block;margin-top:8px;padding:8px;width:100%"><option value="no">Hayır</option><option value="yes">Evet</option></select><div style="font-size:12px;margin-top:8px;color:#666">Fiş adedi</div><input type="number" min="1" max="10" value="1" style="display:block;margin-top:4px;padding:8px;width:100%;box-sizing:border-box">';
  c.appendChild(box);var sel=box.querySelector('select'),count=box.querySelector('input');
  var foot=document.createElement('div');foot.style.cssText='display:flex;justify-content:flex-end;gap:8px;margin-top:20px';
  var noBtn=document.createElement('button');noBtn.type='button';noBtn.textContent='VAZGEÇ';noBtn.style.cssText='border:1px solid #ccc;background:#fff;border-radius:8px;padding:12px 18px';noBtn.onclick=close;
  var yes=document.createElement('button');yes.type='button';yes.textContent='ONAYLA VE İŞLEMİ TAMAMLA';yes.style.cssText='background:#b38b2e;color:white;border:0;border-radius:8px;padding:12px 18px;font-weight:700';
  yes.onclick=function(){
    if(flow)return;
    flow={kind:kind,queue:rows.slice(),total:rows.length,saved:0,print:sel.value==='yes',copies:Math.max(1,Math.min(10,parseInt(count.value,10)||1)),known:receiptIds(m)};
    close();next(m);
  };
  foot.appendChild(noBtn);foot.appendChild(yes);c.appendChild(foot);
}

function finish(msg){var f=flow;flow=null;if(msg)alert(msg);return f}
function next(m){
  var r=flow.queue.shift();
  fill(r);
  var btn=m.querySelector('#modalConfirm');if(!btn)return finish('Döviz kaydet düğmesi bulunamadı.');
  bypass=true;try{btn.click()}finally{bypass=false}
  /* Uygulama başarılı kayıtta modalı kapatır; hata varsa modal açık kalır ve uyarı gösterir. */
  wait(function(){return $('modalRoot')!==m},1500,function(closed){
    if(!closed)return finish((flow.saved+1)+'. satır ('+r.currency+') kaydedilemedi. '+(flow.saved?flow.saved+' satır kaydedildi, ':'')+'kalan satırlar işlenmedi.');
    flow.saved++;
    if(!flow.queue.length&&!flow.print){finish();return}
    reopen(function(nm){
      if(!nm)return finish('Döviz ekranı yeniden açılamadı. '+flow.saved+'/'+flow.total+' satır kaydedildi.');
      if(flow.queue.length)return next(nm);
      printNew(nm);
    });
  });
}
function reopen(cb){
  var b=opener(flow.kind);if(!b)return cb(null);
  b.click();
  wait(function(){var m=fxModal();return m&&kindOf(m)===flow.kind?m:null},3000,cb);
}
function printNew(m){
  var known=flow.known;
  wait(function(){var ids=receiptIds(m).filter(function(id){return known.indexOf(id)<0});return ids.length?ids:null},2500,function(ids){
    var f=finish();
    if(!ids){alert('Kayıt tamamlandı ancak fiş butonu bulunamadı. Fişi Geçmiş listesinden yazdırabilirsiniz.');return}
    var jobs=[];for(var c=0;c<f.copies;c++)ids.forEach(function(id){jobs.push(id)});
    jobs.forEach(function(id,i){setTimeout(function(){var b=m.querySelector('[data-receipt-kind="trade"][data-receipt-id="'+id+'"]');if(b)b.click()},i*1200)});
    setTimeout(function(){if($('modalRoot')===m){var x=m.querySelector('#modalX');if(x)x.click()}},jobs.length*1200+300);
  });
}

window.addEventListener('click',function(e){
  if(bypass)return;
  var b=e.target&&e.target.closest&&e.target.closest('#modalConfirm');if(!b)return;
  var m=fxModal();if(!m||!m.contains(b)||KINDS.indexOf(kindOf(m))<0)return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  if(flow)return;
  var rows=collectRows(m);
  if(!rows.length||num(rows[0].amount)<=0||num(rows[0].rate)<=0){alert('Döviz miktarı ve kur girin.');return}
  showSummary(m,rows);
},true);

new MutationObserver(function(){var m=fxModal();if(m)addRowsUi(m)}).observe(document.body,{childList:true});
})();
