const C='asil-v6-90-cari-filter-stable-20261001';
const CARI_FIX=`<style id="ufuk-cari-sw-fix-css">
.ufuk-cari-card-compact{padding:10px!important;margin:0!important;min-height:0!important}
.ufuk-cari-card-compact .section-head{margin-bottom:5px!important}
.ufuk-cari-card-compact .summary-row{padding:3px 0!important;min-height:0!important}
.ufuk-cari-card-compact .btn{min-height:30px!important;padding:5px 8px!important;font-size:12px!important}
</style><script id="ufuk-cari-sw-fix">(function(){
'use strict';
var active='Tümü';
var names={'tümü':'Tümü','müşteri':'Müşteri','musteri':'Müşteri','toptancı':'Toptancı','toptanci':'Toptancı','banka':'Banka','özel':'Özel','ozel':'Özel'};
function norm(x){return String(x||'').replace(/\\s+/g,' ').trim().toLocaleLowerCase('tr-TR')}
function typeOf(x){return names[norm(x)]||null}
function search(){return document.querySelector('#cariCardSearch,input[placeholder*="Cari /"]')||document.querySelector('input[placeholder*="Cari"]')}
function cards(){
 var i=search();
 if(i){var p=i.parentElement;for(var n=0;n<10&&p;n++,p=p.parentElement){var d=p.querySelectorAll(':scope > .card');if(d.length>=2)return Array.from(d);var a=p.querySelectorAll('.card');if(a.length>=4)return Array.from(a).filter(function(c){return !c.parentElement.closest('.card')})}}
 var m=Array.from(document.querySelectorAll('.ufuk-cari-card-compact'));if(m.length)return m;return [];
}
function cardType(c){var b=c.querySelector('.badge'),t=typeOf(b&&b.textContent);if(t)return t;var x=norm(c.textContent);if(/\\btoptancı\\b|\\btoptanci\\b/.test(x))return 'Toptancı';if(/\\bbanka\\b/.test(x))return 'Banka';if(/\\bözel\\b|\\bozel\\b/.test(x))return 'Özel';if(/\\bmüşteri\\b|\\bmusteri\\b/.test(x))return 'Müşteri';return null}
function apply(){var i=search(),q=norm(i&&i.value),a=cards();a.forEach(function(c){c.classList.add('ufuk-cari-card-compact');var t=cardType(c),ok=active==='Tümü'||t===active;if(ok&&q)ok=norm(c.textContent).indexOf(q)>=0;c.style.display=ok?'':'none'});document.querySelectorAll('button').forEach(function(b){var t=typeOf(b.textContent);if(!t)return;b.classList.toggle('btn-primary',t===active);b.classList.toggle('btn-outline',t!==active);b.setAttribute('aria-pressed',t===active?'true':'false')})}
function clickCapture(e){var b=e.target&&e.target.closest?e.target.closest('button'):null,t=typeOf(b&&b.textContent);if(!t)return;if(!search())return;e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation();active=t;apply()}
document.addEventListener('click',clickCapture,true);
document.addEventListener('input',function(e){if(e.target===search())apply()},true);
document.addEventListener('DOMContentLoaded',function(){apply();setTimeout(apply,250);setTimeout(apply,800);setTimeout(apply,1600)});
})();</script>`;
self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(C).then(c=>c.addAll(['./','./index.html'])));
});
self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    await caches.keys().then(a=>Promise.all(a.filter(x=>x!==C).map(x=>caches.delete(x))));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin!==self.location.origin || u.pathname.startsWith('/api/')) return;
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request,{cache:'no-store'}).then(async r=>{
      if(!r.ok) return r;
      const ct=r.headers.get('content-type')||'';
      if(!ct.includes('text/html')) return r;
      const text=await r.text();
      if(text.includes('ufuk-cari-sw-fix')) return new Response(text,{status:r.status,statusText:r.statusText,headers:r.headers});
      return new Response(text.replace('</body>',CARI_FIX+'</body>'),{status:r.status,statusText:r.statusText,headers:r.headers});
    }).catch(()=>caches.match('./index.html')));
    return;
  }
  e.respondWith(fetch(e.request,{cache:'no-store'}).catch(()=>caches.match(e.request)));
});
