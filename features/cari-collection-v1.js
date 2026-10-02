(() => {
  'use strict';
  if (window.__asilCariCollectionV1) return;
  window.__asilCariCollectionV1 = true;

  const KEY = 'asil_cari_tahsilatlar_v1';
  const esc = v => String(v ?? '').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const money = v => Number(v||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const read = () => { try { const x=JSON.parse(localStorage.getItem(KEY)||'[]'); return Array.isArray(x)?x:[]; } catch { return []; } };
  const write = x => localStorage.setItem(KEY, JSON.stringify(x));
  const norm = v => String(v??'').toLocaleLowerCase('tr-TR');

  function customers(){
    const s=window.state;
    const arr=s?.customers || s?.cariler || s?.cariHesaplar || [];
    if(Array.isArray(arr)) return arr.filter(x=>x && (x.name||x.adSoyad||x.unvan||x.cariAdi));
    return [];
  }
  function customerName(c){ return c?.name || c?.adSoyad || c?.unvan || c?.cariAdi || c?.cariAd || ''; }
  function customerId(c){ return c?.id || c?.cariId || c?.customerId || ''; }

  function salesBalance(id,name){
    const s=window.state;
    const sales=Array.isArray(s?.sales)?s.sales:[];
    const target=norm(name);
    let total=0;
    for(const sale of sales){
      const sid=sale?.customerId || sale?.cariId || sale?.customer?.id;
      const sn=norm(sale?.customerName || sale?.cariName || sale?.customer?.name || '');
      if((id && String(sid)===String(id)) || (target && sn===target)){
        const t=Number(sale?.total ?? sale?.netTotal ?? sale?.amount ?? 0);
        const payments=Array.isArray(sale?.payments)?sale.payments.reduce((a,p)=>a+Math.max(0,Number(p?.amount||0)),0):0;
        total += Math.max(0,t-payments);
      }
    }
    const pays=read().filter(x=>(id&&String(x.customerId)===String(id)) || (!id&&target&&norm(x.customerName)===target));
    return Math.max(0,total-pays.reduce((a,x)=>a+Math.max(0,Number(x.amount||0)),0));
  }

  function css(){
    if(document.getElementById('asil-cari-collection-style')) return;
    const s=document.createElement('style'); s.id='asil-cari-collection-style'; s.textContent=`
      #asil-cari-collection-btn{position:fixed;right:18px;bottom:64px;z-index:9990;border:1px solid #8a6a2e;background:#191a1d;color:#f0cf7d;border-radius:12px;padding:10px 14px;font-weight:800;box-shadow:0 8px 24px rgba(0,0,0,.28)}
      #asil-cari-collection-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:9995;display:none;place-items:center;padding:18px}.acm-show{display:grid!important}
      #asil-cari-collection-modal{width:min(760px,95vw);background:#14171b;color:#fff;border:1px solid #343a43;border-radius:18px;box-shadow:0 25px 80px rgba(0,0,0,.55);overflow:hidden}
      .acm-head{padding:16px 18px;border-bottom:1px solid #2c3138;display:flex;justify-content:space-between;align-items:center}.acm-head h3{margin:0}.acm-close,.acm-save{border:0;border-radius:9px;padding:9px 13px;font-weight:750}.acm-close{background:#292e36;color:#fff}.acm-save{background:#a77b28;color:#111}.acm-body{padding:18px}.acm-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.acm-label{display:grid;gap:6px;font-size:12px;color:#aeb4bd}.acm-input,.acm-select{width:100%;box-sizing:border-box;background:#0e1013;border:1px solid #353b44;color:#fff;border-radius:10px;padding:11px}.acm-full{grid-column:1/-1}.acm-balance{margin:14px 0;padding:14px;border:1px solid #4e432f;background:#1b1915;border-radius:12px;display:flex;justify-content:space-between}.acm-muted{color:#9ca3af;font-size:12px}.acm-table{width:100%;border-collapse:collapse;margin-top:18px}.acm-table th,.acm-table td{padding:9px;border-bottom:1px solid #292e35;text-align:left;font-size:12px}.acm-table th{color:#aeb4bd}.acm-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:15px}
      @media(max-width:650px){.acm-grid{grid-template-columns:1fr}}
    `; document.head.appendChild(s);
  }

  function render(){
    css();
    if(!document.getElementById('asil-cari-collection-btn')){
      const b=document.createElement('button'); b.id='asil-cari-collection-btn'; b.type='button'; b.textContent='Tahsilat / Mahsup'; b.onclick=open; document.body.appendChild(b);
    }
    if(document.getElementById('asil-cari-collection-backdrop')) return;
    const wrap=document.createElement('div'); wrap.id='asil-cari-collection-backdrop';
    wrap.innerHTML=`<div id="asil-cari-collection-modal"><div class="acm-head"><h3>Cari Tahsilat / Açık Hesap Mahsup</h3><button class="acm-close" type="button">Kapat</button></div><div class="acm-body"><div class="acm-grid"><label class="acm-label acm-full">Cari<select id="acm-cari" class="acm-select"></select></label><label class="acm-label">Tahsilat türü<select id="acm-type" class="acm-select"><option>Nakit</option><option>Havale / EFT</option><option>Kredi Kartı</option><option>Altın / Ziynet</option><option>Hurda</option><option>Diğer</option></select></label><label class="acm-label">Tutar (TL)<input id="acm-amount" class="acm-input" type="number" step="0.01" min="0"></label><label class="acm-label acm-full">Açıklama<input id="acm-note" class="acm-input" placeholder="Örn. açık hesap borcundan tahsilat"></label></div><div class="acm-balance"><span>Mevcut açık hesap bakiyesi</span><strong id="acm-balance">—</strong></div><div class="acm-actions"><button class="acm-close" type="button">İptal</button><button class="acm-save" id="acm-save" type="button">Tahsilatı Kaydet ve Mahsup Et</button></div><div class="acm-muted" style="margin-top:10px">Bu aşamadaki kayıtlar ayrı tahsilat defterine yazılır; mevcut satış/stok kayıtları değiştirilmez. Böylece test verisi güvenli kalır.</div><div id="acm-list"></div></div></div>`;
    document.body.appendChild(wrap);
    wrap.querySelectorAll('.acm-close').forEach(x=>x.onclick=close);
    wrap.addEventListener('click',e=>{if(e.target===wrap)close();});
    wrap.querySelector('#acm-cari').onchange=refresh;
    wrap.querySelector('#acm-save').onclick=save;
  }
  function populate(){
    const sel=document.getElementById('acm-cari'); if(!sel)return;
    const cs=customers();
    sel.innerHTML=cs.length?cs.map(c=>`<option value="${esc(customerId(c))}">${esc(customerName(c))}</option>`).join(''):'<option value="">Cari listesi okunamadı</option>';
    refresh();
  }
  function selected(){
    const id=document.getElementById('acm-cari')?.value||''; return customers().find(c=>String(customerId(c))===String(id))||null;
  }
  function refresh(){
    const c=selected(); const id=customerId(c),name=customerName(c); const bal=salesBalance(id,name); const el=document.getElementById('acm-balance'); if(el)el.textContent=`${money(bal)} TL`;
    const list=document.getElementById('acm-list'); if(!list)return; const rows=read().filter(x=>(id&&String(x.customerId)===String(id))||(!id&&norm(x.customerName)===norm(name))).slice(-20).reverse();
    list.innerHTML=rows.length?`<table class="acm-table"><thead><tr><th>Tarih</th><th>Tür</th><th>Tutar</th><th>Açıklama</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.date)}</td><td>${esc(x.type)}</td><td>${money(x.amount)} TL</td><td>${esc(x.note)}</td></tr>`).join('')}</tbody></table>`:'<div class="acm-muted" style="margin-top:16px">Bu cari için henüz bu ekrandan tahsilat yok.</div>';
  }
  function save(){
    const c=selected(); if(!c)return alert('Önce cari seçin.'); const amount=Number(document.getElementById('acm-amount')?.value||0); if(!(amount>0))return alert('Geçerli bir tahsilat tutarı girin.');
    const balance=salesBalance(customerId(c),customerName(c)); if(balance<=0)return alert('Bu cari için mahsup edilecek açık hesap bakiyesi bulunamadı.');
    if(amount>balance+0.01)return alert(`Tahsilat açık hesap bakiyesini aşamaz. Kalan: ${money(balance)} TL`);
    const rows=read(); rows.push({id:'TAH-'+Date.now(),customerId:customerId(c),customerName:customerName(c),type:document.getElementById('acm-type').value,amount:Math.round(amount*100)/100,note:document.getElementById('acm-note').value||'Cari açık hesap tahsilatı',date:new Date().toLocaleString('tr-TR'),source:'Cari Tahsilat / Mahsup v1'}); write(rows); window.dispatchEvent(new StorageEvent('storage',{key:KEY})); document.getElementById('acm-amount').value=''; document.getElementById('acm-note').value=''; refresh();
  }
  function open(){render();document.getElementById('asil-cari-collection-backdrop').classList.add('acm-show');populate();}
  function close(){document.getElementById('asil-cari-collection-backdrop')?.classList.remove('acm-show');}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',render,{once:true});else render();
})();
