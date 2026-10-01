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
  function start(){if(!document.body)return;addCompactStyle();mo.observe(document.body,{childList:true,subtree:true});bind();setTimeout(bind,250);setTimeout(bind,1000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();