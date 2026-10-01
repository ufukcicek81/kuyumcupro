/* KUYUMCUPRO V7 - STABLE CARI FILTER
 * The filter UI is intentionally independent from the application's card renderer.
 * It must survive card-grid rerenders without rewriting the application's version text.
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

  function isCariPage(){
    return !!grid() || [...document.querySelectorAll('h1,h2,h3')].some(x=>norm(text(x)).includes('cari hesap işlemleri'));
  }

  function cardType(card){
    const badges=[...card.querySelectorAll('.badge')];
    for(const badge of badges){
      const t=text(badge);
      if(TYPES.includes(t) && t!=='Tümü') return t;
    }
    const hay=text(card);
    for(const type of TYPES.slice(1)){
      if(new RegExp('(^|[\\s\\n])'+type.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')+'(?=[$\\s\\n])','i').test(hay)) return type;
    }
    return '';
  }

  function cards(){
    const g=grid();
    return g ? [...g.children].filter(x=>x.classList && x.classList.contains('card')) : [];
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
      if(ok) shown++;
    }
    const count=document.querySelector('#'+BAR_ID+' .kuyumcu-v7-count');
    if(count) count.textContent=shown+' cari';
    document.querySelectorAll('#'+BAR_ID+' [data-cari-type]').forEach(btn=>{
      const on=btn.dataset.cariType===active;
      btn.classList.toggle('active',on);
      btn.setAttribute('aria-pressed',on?'true':'false');
    });
  }

  function ensureStyle(){
    if(document.getElementById(STYLE_ID)) return;
    const style=document.createElement('style');
    style.id=STYLE_ID;
    style.textContent=`
      #${BAR_ID}{margin:10px 0 14px;padding:10px 12px;background:var(--panel,#14161a);border:1px solid var(--line,#2d323a);border-radius:12px;position:relative;z-index:5}
      #${BAR_ID} .kuyumcu-v7-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      #${BAR_ID} .kuyumcu-v7-tabs{display:flex;gap:6px;flex-wrap:wrap}
      #${BAR_ID} button{border:1px solid #343941;background:transparent;color:#aeb3bd;border-radius:9px;padding:7px 11px;font-weight:700;font-size:12px;cursor:pointer}
      #${BAR_ID} button.active{background:linear-gradient(135deg,#d6b15f,#b99243);border-color:#d6b15f;color:#101113}
      #${BAR_ID} input{flex:1;min-width:240px;background:#0f1114;border:1px solid #343941;color:#fff;border-radius:9px;padding:8px 10px;outline:none}
      #${BAR_ID} .kuyumcu-v7-count{font-size:11px;color:#8f97a2;white-space:nowrap}
    `;
    document.head.appendChild(style);
  }

  function ensureBar(){
    if(!isCariPage()) return;
    ensureStyle();
    let bar=document.getElementById(BAR_ID);
    if(!bar){
      const g=grid();
      const heading=[...document.querySelectorAll('h1,h2,h3')].find(x=>norm(text(x)).includes('cari hesap işlemleri'));
      const host=heading ? (heading.closest('.page-title')||heading.parentElement) : g?.parentElement;
      if(!host) return;
      bar=document.createElement('div');
      bar.id=BAR_ID;
      bar.innerHTML=`<div class="kuyumcu-v7-row"><div class="kuyumcu-v7-tabs">${TYPES.map(t=>`<button type="button" data-cari-type="${t}" aria-pressed="${t==='Tümü'?'true':'false'}">${t}</button>`).join('')}</div><input type="search" aria-label="Cari ara" placeholder="Cari / toptancı / hesap kodu / telefon ara"><span class="kuyumcu-v7-count"></span></div>`;
      host.insertAdjacentElement('afterend',bar);
      const input=bar.querySelector('input');
      input.value=query;
      input.addEventListener('input',()=>{query=input.value;apply()});
      bar.addEventListener('click',event=>{
        const button=event.target.closest('[data-cari-type]');
        if(!button) return;
        event.preventDefault();
        event.stopPropagation();
        active=button.dataset.cariType||'Tümü';
        apply();
      });
    }
    apply();
  }

  function observeGrid(){
    const g=grid();
    if(!g || gridObserver) return;
    gridObserver=new MutationObserver(()=>requestAnimationFrame(apply));
    gridObserver.observe(g,{childList:true,subtree:true});
  }

  function run(){
    if(!isCariPage()) return;
    ensureBar();
    observeGrid();
  }

  function start(){
    run();
    pageObserver=new MutationObserver(()=>{
      if(!document.getElementById(BAR_ID)) run();
      if(!gridObserver) observeGrid();
    });
    pageObserver.observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
