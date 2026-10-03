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
  var mo=new MutationObserver(function(){if(grid()){addCompactStyle();bind()}});

  var currencySalePending=false;
  var currencyPrintDone=false;
  function visible(el){if(!el)return false;var s=getComputedStyle(el);var r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0}
  function visibleCurrencySale(){
    var els=Array.from(document.querySelectorAll('button,[role="button"],h1,h2,h3,h4,.modal,.dialog,[class*="modal"],[class*="dialog"]'));
    return els.some(function(el){return visible(el)&&/döviz\s+(satış|alış)/i.test(text(el))});
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
  function bindCurrencyPrint(){patchFinalize();autoPrintCurrencyReceipt();}

  // Döviz alış/satış için onaydan önce tek bir özet ekranı göster.
  // Kullanıcı onay verirse mevcut butonun kendi işlemi çalışır; işlem bittikten sonra
  // son fiş otomatik olarak yazdırılır. İşlem iptal edilirse hiçbir kayıt yapılmaz.
  var currencySummaryOpen=false;
  var currencySummaryBypass=false;
  var currencySummaryTarget=null;
  var currencySummaryKind='';
  function currencyPanel(){
    var roots=Array.from(document.querySelectorAll('.modal,.dialog,[role="dialog"],[class*="modal"],[class*="dialog"],main,section')).filter(visible);
    var hit=roots.filter(function(r){return /döviz\s+(alış|satış)/i.test(text(r))});
    return hit.length?hit.sort(function(a,b){return text(b).length-text(a).length})[0]:null;
  }
  function currencyKind(panel){
    var t=norm(text(panel));
    if(/döviz\s+alış/.test(t))return 'DÖVİZ ALIŞ';
    if(/döviz\s+satış/.test(t))return 'DÖVİZ SATIŞ';
    return '';
  }
  function fieldValue(panel,labelRx){
    var labels=Array.from(panel.querySelectorAll('label,th,.label,.form-label'));
    for(var i=0;i<labels.length;i++){
      if(labelRx.test(text(labels[i]))){
        var p=labels[i].parentElement;
        if(p){var inp=p.querySelector('input,select,textarea');if(inp)return String(inp.value||text(inp)||'').trim()}
      }
    }
    var inputs=Array.from(panel.querySelectorAll('input,select,textarea')).filter(function(x){return visible(x)});
    var vals=inputs.map(function(x){return String(x.value||'').trim()}).filter(Boolean);
    return vals.join(' | ');
  }
  function currencySummaryData(panel){
    var data=[];
    function add(k,v){v=String(v||'').trim();if(v)data.push([k,v])}
    add('İşlem',currencyKind(panel));
    add('Cari / Müşteri',fieldValue(panel,/cari|müşteri|müşter/i));
    add('Döviz',fieldValue(panel,/döviz|para birimi|currency/i));
    add('Miktar',fieldValue(panel,/miktar|adet|quantity/i));
    add('Kur',fieldValue(panel,/kur|alış kuru|satış kuru/i));
    add('Toplam TL',fieldValue(panel,/toplam|tutar|ödenecek/i));
    add('Hesap',fieldValue(panel,/hesap|kasa|ödeme/i));
    return data;
  }
  function closeCurrencySummary(){
    var old=document.getElementById('ufukCurrencySummary');
    if(old)old.remove();
    currencySummaryOpen=false;
    currencySummaryTarget=null;
  }
  function showCurrencySummary(panel,target,kind){
    if(currencySummaryOpen)return;
    currencySummaryOpen=true;currencySummaryTarget=target;currencySummaryKind=kind;
    var data=currencySummaryData(panel);
    var box=document.createElement('div');box.id='ufukCurrencySummary';
    box.style.cssText='position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Arial,sans-serif';
    var card=document.createElement('div');card.style.cssText='width:min(520px,96vw);max-height:90vh;overflow:auto;background:#fff;border-radius:14px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.3)';
    var title=document.createElement('h2');title.textContent=kind+' — İŞLEM ÖZETİ';title.style.cssText='margin:0 0 16px;font-size:21px';card.appendChild(title);
    data.forEach(function(row){var line=document.createElement('div');line.style.cssText='display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid #eee;padding:10px 0';var a=document.createElement('b');a.textContent=row[0];var b=document.createElement('span');b.textContent=row[1];line.appendChild(a);line.appendChild(b);card.appendChild(line)});
    var actions=document.createElement('div');actions.style.cssText='display:flex;gap:10px;justify-content:flex-end;margin-top:20px';
    var cancel=document.createElement('button');cancel.textContent='VAZGEÇ';cancel.style.cssText='border:0;border-radius:8px;padding:12px 20px;background:#eee;font-weight:700;cursor:pointer';cancel.onclick=function(){closeCurrencySummary()};
    var ok=document.createElement('button');ok.textContent='ONAYLA VE İŞLEMİ TAMAMLA';ok.style.cssText='border:0;border-radius:8px;padding:12px 20px;background:#b38b2e;color:#fff;font-weight:700;cursor:pointer';ok.onclick=function(){
      var btn=currencySummaryTarget;closeCurrencySummary();
      if(btn){currencySummaryBypass=true;currencySalePending=true;currencyPrintDone=false;try{btn.click()}finally{currencySummaryBypass=false}}
      [500,1000,1800,3000,5000].forEach(function(ms){setTimeout(autoPrintCurrencyReceipt,ms)});
    };
    actions.appendChild(cancel);actions.appendChild(ok);card.appendChild(actions);box.appendChild(card);document.body.appendChild(box);
  }
  function isCurrencyConfirmButton(btn,panel){
    var t=norm(text(btn)||btn.value||'');
    if(!/onayla|tamamla|kaydet|satış\s+yap|alış\s+yap|işlemi\s+tamamla/.test(t))return false;
    return !!panel;
  }
  function bindCurrencySummary(){
    if(document.documentElement.dataset.ufukCurrencySummaryBound==='1')return;
    document.documentElement.dataset.ufukCurrencySummaryBound='1';
    document.addEventListener('click',function(e){
      if(currencySummaryBypass)return;
      var btn=e.target&&e.target.closest?e.target.closest('button,[role="button"],input[type="button"],input[type="submit"]'):null;
      if(!btn||!visible(btn))return;
      var panel=currencyPanel();
      if(!panel)return;
      var kind=currencyKind(panel);
      if(!kind||!isCurrencyConfirmButton(btn,panel))return;
      e.preventDefault();e.stopImmediatePropagation();
      showCurrencySummary(panel,btn,kind);
    },true);
  }

  // Takas/ziynet penceresinde Fiyat ve Toplam Tutar alanlarını gerçekten serbest bırak.
  function ziynetTakasModal(el){return /Müşteriden\s+Al\s*\/\s*Takas\s*Mahsubu/i.test(text(el))}
  function fieldLabel(input){var p=input;for(var i=0;i<7&&p;i++,p=p.parentElement){var lab=p.querySelector&&p.querySelector('label');if(lab){var t=text(lab);if(t)return t}}var prev=input.previousElementSibling;return prev?text(prev):''}
  function isTakasField(input){var lab=fieldLabel(input),ph=String(input.getAttribute('placeholder')||''),name=String(input.getAttribute('name')||''),aria=String(input.getAttribute('aria-label')||'');return /Fiyat\s*\(TL\)|Toplam\s*Tutar/i.test(lab+' '+ph+' '+name+' '+aria)}
  function makeEditable(input){if(!input||!isTakasField(input))return;input.disabled=false;input.readOnly=false;input.removeAttribute('disabled');input.removeAttribute('readonly');input.removeAttribute('aria-disabled');input.style.pointerEvents='auto';input.style.userSelect='text';input.style.webkitUserSelect='text';input.tabIndex=0;input.classList.remove('disabled','readonly')}
  function unlockZiynetTakas(){var roots=Array.from(document.querySelectorAll('.modal,.dialog,[role="dialog"],[class*="modal"],[class*="dialog"]')).filter(visible).filter(ziynetTakasModal);roots.forEach(function(root){Array.from(root.querySelectorAll('input,textarea')).forEach(function(input){if(!isTakasField(input))return;makeEditable(input);if(input.dataset.ufukTakasBound==='1')return;input.dataset.ufukTakasBound='1';input.addEventListener('keydown',function(e){if((e.key==='Backspace'||e.key==='Delete')&&!input.readOnly&&!input.disabled){if(input.selectionStart===0&&input.selectionEnd===input.value.length||e.key==='Delete'||(e.key==='Backspace'&&input.selectionStart!==input.selectionEnd&&input.selectionStart===0&&input.selectionEnd===input.value.length)){e.preventDefault();e.stopImmediatePropagation();input.value='';return}}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a')e.stopImmediatePropagation()},true);input.addEventListener('beforeinput',function(e){if(e.inputType==='deleteContentBackward'||e.inputType==='deleteContentForward'||e.inputType==='deleteByCut'){if(input.selectionStart===0&&input.selectionEnd===input.value.length){e.preventDefault();e.stopImmediatePropagation();input.value=''}}},true);input.addEventListener('input',function(e){makeEditable(input);if(String(input.value||'').trim()==='')e.stopImmediatePropagation()},true);input.addEventListener('change',function(){makeEditable(input)},true)})})}
  function bindZiynetTakas(){unlockZiynetTakas()}

  function start(){
    if(!document.body)return;
    addCompactStyle();
    mo.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','readonly','class','style']});
    bind();
    setTimeout(bind,250);setTimeout(bind,1000);
    setTimeout(bindCurrencyPrint,300);setTimeout(bindCurrencyPrint,1000);setTimeout(bindCurrencyPrint,2000);
    bindCurrencySummary();
    bindZiynetTakas();
    setInterval(bindZiynetTakas,150);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();