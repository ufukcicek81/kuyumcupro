/* UFUK_CARI_STABLE_FILTER_V692 */
(function(){
  'use strict';
  const ID='ufukStableCariFilter';
  const TYPES=['Tümü','Müşteri','Toptancı','Banka','Özel'];
  let active='Tümü';
  let query='';
  const norm=v=>String(v||'').trim().toLocaleLowerCase('tr-TR');
  const esc=v=>String(v||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function syncVersion(){
    document.querySelectorAll('body *').forEach(el=>{
      if(el.children.length===0 && /V6\.\d+/i.test(el.textContent||'')) el.textContent=el.textContent.replace(/V6\.\d+/ig,'V6.94');
    });
    if(document.title && /V6\.\d+/i.test(document.title)) document.title=document.title.replace(/V6\.\d+/ig,'V6.94');
  }
  function isCariPage(){ return [...document.querySelectorAll('h1,h2,h3')].some(x=>norm(x.textContent).includes('cari hesap işlemleri')); }
  function typeOfCard(card){
    const badges=[...card.querySelectorAll('.badge')];
    for(const b of badges){ const t=String(b.textContent||'').trim(); if(TYPES.includes(t)&&t!=='Tümü') return t; }
    return '';
  }
  function getCards(){ return [...document.querySelectorAll('.card')].filter(c=>typeOfCard(c)); }
  function apply(){
    const cards=getCards(); let shown=0;
    cards.forEach(card=>{
      const type=typeOfCard(card), hay=norm(card.textContent);
      const ok=(active==='Tümü'||type===active)&&(!query||hay.includes(norm(query)));
      card.style.display=ok?'':'none'; if(ok) shown++;
    });
    const bar=document.getElementById(ID);
    if(bar){
      bar.querySelectorAll('[data-ufuk-type]').forEach(b=>{ const on=b.dataset.ufukType===active; b.classList.toggle('ufuk-active',on); b.setAttribute('aria-pressed',on?'true':'false'); });
      const count=bar.querySelector('.ufuk-count'); if(count) count.textContent=shown+' cari';
    }
  }
  function makeBar(){
    if(!isCariPage()||document.getElementById(ID)) return;
    const heading=[...document.querySelectorAll('h1,h2,h3')].find(x=>norm(x.textContent).includes('cari hesap işlemleri'));
    if(!heading)return;
    const host=heading.closest('.page-title')||heading.parentElement; if(!host)return;
    const bar=document.createElement('div'); bar.id=ID;
    bar.innerHTML=`<div class="ufuk-row"><div class="ufuk-tabs">${TYPES.map(t=>`<button type="button" data-ufuk-type="${esc(t)}" aria-pressed="${t===active?'true':'false'}">${esc(t)}</button>`).join('')}</div><input class="ufuk-search" type="search" placeholder="Cari / toptancı adı, hesap kodu, telefon veya tür ara"><span class="ufuk-count"></span></div>`;
    host.insertAdjacentElement('afterend',bar);
    const input=bar.querySelector('.ufuk-search'); input.value=query; input.addEventListener('input',()=>{query=input.value;apply()});
    bar.addEventListener('click',e=>{ const b=e.target.closest('[data-ufuk-type]'); if(!b)return; active=b.dataset.ufukType; apply(); });
    apply();
  }
  function compact(){
    if(!isCariPage())return;
    if(!document.getElementById('ufukCariCompactStyle')){
      const s=document.createElement('style'); s.id='ufukCariCompactStyle';
      s.textContent=`#${ID}{margin:10px 0 14px;padding:10px 12px;background:var(--panel,#14161a);border:1px solid var(--line,#2d323a);border-radius:12px}.ufuk-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.ufuk-tabs{display:flex;gap:6px;flex-wrap:wrap}.ufuk-tabs button{border:1px solid #343941;background:transparent;color:#aeb3bd;border-radius:9px;padding:7px 11px;font-weight:700;font-size:12px}.ufuk-tabs button.ufuk-active{background:linear-gradient(135deg,#d6b15f,#b99243);border-color:#d6b15f;color:#101113}.ufuk-search{flex:1;min-width:260px;background:#0f1114;border:1px solid #343941;color:#fff;border-radius:9px;padding:8px 10px;outline:none}.ufuk-count{font-size:11px;color:#8f97a2;white-space:nowrap}.card{padding:12px!important}.card .section-head{margin-bottom:8px!important}.card .summary-row{padding:5px 0!important}.card .btn{padding:7px 10px!important;font-size:12px!important}`;
      document.head.appendChild(s);
    }
  }
  function run(){syncVersion();compact();makeBar();apply()}
  let timer=0; const schedule=()=>{clearTimeout(timer);timer=setTimeout(run,80)};
  document.addEventListener('DOMContentLoaded',run); window.addEventListener('load',run);
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
})();
