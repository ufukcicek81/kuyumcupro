(function(){
  'use strict';
  var TYPES=['Tümü','Müşteri','Toptancı','Banka','Özel'];
  var active='Tümü',bound=false;
  function text(el){return String((el&&el.textContent)||'').trim()}
  function norm(v){return String(v||'').toLocaleLowerCase('tr-TR')}
  function grid(){return document.getElementById('cariCardGrid')}
  function searchInput(){return document.getElementById('cariCardSearch')||Array.from(document.querySelectorAll('input[type="search"],input.input,input')).find(function(i){return /cari|toptancı|hesap kodu|telefon/i.test(i.getAttribute('placeholder')||'')})}
  function cards(){var g=grid();return g?Array.from(g.children).filter(function(e){return e.classList&&e.classList.contains('card')}):[]}
  function type(card){var badge=card.querySelector('.badge'),bt=text(badge);if(TYPES.indexOf(bt)>0)return bt;var head=card.querySelector('.section-head'),ht=text(head);for(var i=1;i<TYPES.length;i++){if(new RegExp('(^|\\s)'+TYPES[i]+'(?=\\s|$)','i').test(ht))return TYPES[i]}var t=text(card).slice(0,500);for(var j=1;j<TYPES.length;j++){if(new RegExp('(^|\\n|\\s)'+TYPES[j]+'(?=\\n|\\s|$)','i').test(t))return TYPES[j]}return ''}
  function filterButtons(){var g=grid();return g?Array.from(document.querySelectorAll('button')).filter(function(b){var t=text(b);return TYPES.indexOf(t)>=0&&/Müşteri|Toptancı|Banka|Özel|Tümü/.test(text(b.parentElement||b))}):[]}
  function apply(){var input=searchInput(),q=norm(input&&input.value);cards().forEach(function(c){var ok=(active==='Tümü'||type(c)===active)&&(!q||norm(text(c)).indexOf(q)>=0);c.style.display=ok?'':'none'});filterButtons().forEach(function(b){var on=text(b)===active;b.classList.toggle('active',on);b.classList.toggle('btn-primary',on);b.setAttribute('aria-pressed',on?'true':'false')})}
  function bind(){if(!grid())return;if(!bound){bound=true;document.addEventListener('click',function(e){var b=e.target&&e.target.closest?e.target.closest('button'):null;if(!b||TYPES.indexOf(text(b))<0||filterButtons().indexOf(b)<0)return;e.preventDefault();e.stopPropagation();active=text(b);apply()},true);document.addEventListener('input',function(e){if(e.target===searchInput())apply()})}apply()}
  function addCompactStyle(){if(document.getElementById('ufukCariCompactStyle'))return;var st=document.createElement('style');st.id='ufukCariCompactStyle';st.textContent='#cariCardGrid{gap:10px!important;align-items:start!important}#cariCardGrid>.card{padding:11px!important;min-height:0!important}#cariCardGrid>.card .section-head{margin-bottom:5px!important}#cariCardGrid>.card .section-head h3{font-size:15px!important}#cariCardGrid>.card .summary-row{padding:3px 0!important}#cariCardGrid>.card .btn{min-height:32px!important;padding:6px 9px!important;font-size:11px!important}@media(min-width:1200px){#cariCardGrid{grid-template-columns:repeat(4,minmax(0,1fr))!important}}@media(min-width:900px) and (max-width:1199px){#cariCardGrid{grid-template-columns:repeat(3,minmax(0,1fr))!important}}';document.head.appendChild(st)}
  var mo=new MutationObserver(function(){if(grid()){addCompactStyle();bind()}unlockZiynetTakas()});

  var currencySalePending=false;
  var currencyPrintDone=false;
  function visible(el){if(!el)return false;var s=getComputedStyle(el);var r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0}
  function visibleCurrencySale(){
    var els=Array.from(document.querySelectorAll('button,[role="button"],h1,h2,h3,h4,.modal,.dialog,[class*="modal"],[class*="dialog"]'));
    return els.some(function(el){return visible(el)&&/döviz\s+satış/i.test(text(el))});
  }
  function fixCurrencyReceiptTitle(){
    var changed=false;
    Array.from(document.querySelectorAll('*')).forEach(function(el){
      if(!visible(el))return;
      var t=text(el);
      if(t==='ALTIN / ZİYNET İŞLEM FİŞİ'){
        el.textContent='DÖVİZ İŞLEM FİŞİ';
        changed=true;
      }
    });
    return changed;
  }
  function autoPrintCurrencyReceipt(){
    if(!currencySalePending||currencyPrintDone)return false;
    fixCurrencyReceiptTitle();
    var candidates=Array.from(document.querySelectorAll('button,[role="button"],a,input[type="button"],input[type="submit"]')).filter(visible);
    var btn=candidates.find(function(el){return /^fiş\s*yazdır$/i.test(text(el)||el.value||'')});
    if(!btn)btn=candidates.find(function(el){return /fiş\s*yazdır/i.test(text(el)||el.value||'')});
    if(!btn)return false;
    currencyPrintDone=true;
    try{btn.click()}catch(e){console.error('Döviz fişi otomatik yazdırma:',e)}
    return true;
  }
  function patchFinalize(){
    if(typeof window.finalizeSale!=='function')return false;
    if(window.finalizeSale.__ufukCurrencyPrint)return true;
    var original=window.finalizeSale;
    function wrapped(){
      currencySalePending=visibleCurrencySale();
      currencyPrintDone=false;
      var result=original.apply(this,arguments);
      [300,700,1200,2000,3500].forEach(function(ms){setTimeout(autoPrintCurrencyReceipt,ms)});
      return result;
    }
    wrapped.__ufukCurrencyPrint=true;
    wrapped.__original=original;
    window.finalizeSale=wrapped;
    return true;
  }
  function bindCurrencyPrint(){patchFinalize();autoPrintCurrencyReceipt()}

  var ziynetTakasBound=new WeakSet();
  function ziynetTakasModal(el){
    var t=text(el);
    return /Müşteriden\s+Al\s*\/\s*Takas\s*Mahsubu/i.test(t)||/Altın\s*\/\s*Ziynet/i.test(t)&&/Takas/i.test(t);
  }
  function fieldContainer(input){
    var p=input;
    for(var i=0;i<6&&p;i++,p=p.parentElement){
      var s=text(p);
      if(/Fiyat\s*\(TL\)/i.test(s)||/Toplam\s*Tutar/i.test(s))return p;
    }
    return input.parentElement||input;
  }
  function fieldLabel(input){
    var p=input;
    for(var i=0;i<6&&p;i++,p=p.parentElement){
      var lab=p.querySelector&&p.querySelector('label');
      if(lab){var t=text(lab);if(t)return t;}
    }
    var c=fieldContainer(input),ct=text(c);
    if(/Fiyat\s*\(TL\)/i.test(ct))return 'Fiyat (TL)';
    if(/Toplam\s*Tutar/i.test(ct))return 'Toplam Tutar';
    var prev=input.previousElementSibling;
    return prev?text(prev):'';
  }
  function unlockInput(input){
    if(!input||input.tagName==='SELECT')return;
    input.disabled=false;
    input.readOnly=false;
    input.removeAttribute('disabled');
    input.removeAttribute('readonly');
    input.setAttribute('aria-disabled','false');
    input.style.pointerEvents='auto';
    input.style.userSelect='text';
    input.style.cursor='text';
  }
  function unlockZiynetTakas(){
    var roots=Array.from(document.querySelectorAll('.modal,.dialog,[role="dialog"],[class*="modal"],[class*="dialog"]')).filter(visible).filter(ziynetTakasModal);
    roots.forEach(function(root){
      var inputs=Array.from(root.querySelectorAll('input,textarea'));
      inputs.forEach(function(input){
        var lab=fieldLabel(input);
        if(/Fiyat\s*\(TL\)/i.test(lab)||/Toplam\s*Tutar/i.test(lab))unlockInput(input);
      });
      var price=inputs.find(function(i){return /Fiyat\s*\(TL\)/i.test(fieldLabel(i))});
      var total=inputs.find(function(i){return /Toplam\s*Tutar/i.test(fieldLabel(i))});
      if(price&&!price.__ufukUnlock){
        price.__ufukUnlock=true;
        ['focus','click','keydown','input','change'].forEach(function(ev){price.addEventListener(ev,function(){unlockInput(price)},true)});
      }
      if(total&&!total.__ufukUnlock){
        total.__ufukUnlock=true;
        ['focus','click','keydown','input','change'].forEach(function(ev){total.addEventListener(ev,function(){unlockInput(total)},true)});
        total.addEventListener('input',function(){total.dataset.ufukManualTotal='1'},true);
      }
      if(price&&total){
        price.addEventListener('input',function(){
          if(String(price.value||'').trim()===''){
            total.dataset.ufukManualTotal='1';
            unlockInput(total);
          }
        },true);
      }
    });
  }
  function bindZiynetTakas(){unlockZiynetTakas()}

  function start(){
    if(!document.body)return;
    addCompactStyle();
    mo.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','readonly','class','style']});
    bind();
    setTimeout(bind,250);setTimeout(bind,1000);
    setTimeout(bindCurrencyPrint,300);setTimeout(bindCurrencyPrint,1000);setTimeout(bindCurrencyPrint,2000);
    setTimeout(bindZiynetTakas,250);setTimeout(bindZiynetTakas,800);setTimeout(bindZiynetTakas,1600);
    setInterval(unlockZiynetTakas,300);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();