(() => {
  'use strict';
  if (window.__asilCariHistoryV1) return;
  window.__asilCariHistoryV1 = true;

  const esc = (v) => String(v ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const money = (v) => {
    const n = Number(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n.toLocaleString('tr-TR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : esc(v);
  };
  const norm = (v) => String(v ?? '').toLocaleLowerCase('tr-TR');

  function readStores() {
    const out = [];
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (!key) continue;
        let raw;
        try { raw = JSON.parse(store.getItem(key)); } catch { continue; }
        out.push({key, raw});
      }
    }
    return out;
  }

  function flatten(value, path = '') {
    const rows = [];
    if (Array.isArray(value)) {
      value.forEach((x, i) => rows.push(...flatten(x, `${path}[${i}]`)));
      return rows;
    }
    if (!value || typeof value !== 'object') return rows;
    rows.push({value, path});
    for (const [k, v] of Object.entries(value)) {
      if (v && typeof v === 'object') rows.push(...flatten(v, path ? `${path}.${k}` : k));
    }
    return rows;
  }

  function objectName(o) {
    const keys = ['name','adSoyad','adsoyad','unvan','cariAdi','cariAd','customerName','customer','musteriAdi','musteri','title','fullName'];
    for (const k of keys) if (o && o[k] != null && String(o[k]).trim()) return String(o[k]);
    return '';
  }

  function looksLikeCustomer(o) {
    if (!o || typeof o !== 'object') return false;
    const text = norm(Object.keys(o).join(' '));
    return Boolean(objectName(o)) && /(cari|musteri|müşteri|customer|unvan|adsoyad|ad_soyad)/.test(text);
  }

  function looksLikeMovement(o) {
    if (!o || typeof o !== 'object') return false;
    const text = norm(Object.keys(o).join(' '));
    return /(hareket|islem|işlem|transaction|sale|satis|satış|tahsil|odeme|ödeme|borc|borç|alacak|iade|tamir|repair)/.test(text);
  }

  function movementText(o) {
    const keys = ['type','tur','işlem','islem','description','aciklama','açıklama','note','not','category','kategori','operation'];
    for (const k of keys) if (o?.[k] != null && String(o[k]).trim()) return String(o[k]);
    return 'Cari hareket';
  }

  function movementName(o) {
    return objectName(o) || o?.cariId || o?.customerId || o?.musteriId || o?.cari || '';
  }

  function movementDate(o) {
    const keys = ['date','tarih','createdAt','created_at','updatedAt','time','timestamp'];
    for (const k of keys) if (o?.[k] != null && String(o[k]).trim()) return String(o[k]);
    return '';
  }

  function amount(o) {
    const keys = ['amount','tutar','total','toplam','borc','borç','alacak','tl','has','gram'];
    for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k];
    return '';
  }

  function collect() {
    const stores = readStores();
    const customers = [];
    const movements = [];
    const seen = new Set();
    for (const {key, raw} of stores) {
      for (const item of flatten(raw, key)) {
        const o = item.value;
        if (!o || typeof o !== 'object') continue;
        const id = o.id ?? o.cariId ?? o.customerId ?? o.musteriId ?? o.code ?? o.kod ?? '';
        const name = objectName(o);
        if (looksLikeCustomer(o)) {
          const sig = `${id}|${name}`;
          if (!seen.has('c:'+sig)) { seen.add('c:'+sig); customers.push({id, name, source:key, raw:o}); }
        }
        if (looksLikeMovement(o)) movements.push({name:movementName(o), text:movementText(o), date:movementDate(o), amount:amount(o), source:key, raw:o});
      }
    }
    return {customers, movements};
  }

  function css() {
    if (document.getElementById('asil-cari-history-style')) return;
    const s = document.createElement('style');
    s.id = 'asil-cari-history-style';
    s.textContent = `
      #asil-cari-history-btn{position:fixed;right:18px;bottom:18px;z-index:9990;border:1px solid #6b5730;background:#17191d;color:#f0cf7d;border-radius:12px;padding:10px 14px;font-weight:750;box-shadow:0 8px 24px rgba(0,0,0,.3)}
      #asil-cari-history-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9991;display:none;place-items:center;padding:18px}
      #asil-cari-history-backdrop.show{display:grid}
      #asil-cari-history-modal{width:min(1080px,96vw);max-height:88vh;overflow:auto;background:#14171b;border:1px solid #343a43;border-radius:18px;color:#f4f5f7;box-shadow:0 24px 80px rgba(0,0,0,.55)}
      .ach-head{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid #2d323a;position:sticky;top:0;background:#14171b;z-index:2}.ach-head h3{margin:0}.ach-close{border:0;background:#242831;color:#fff;border-radius:9px;padding:7px 11px}
      .ach-body{padding:16px 18px}.ach-toolbar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}.ach-input,.ach-select{background:#0f1114;border:1px solid #343a43;color:#fff;border-radius:10px;padding:10px}.ach-input{min-width:280px;flex:1}
      .ach-table{width:100%;border-collapse:collapse}.ach-table th,.ach-table td{padding:10px;border-bottom:1px solid #292e35;text-align:left;font-size:13px}.ach-table th{color:#aeb4bd;background:#111318;position:sticky;top:65px}.ach-num{text-align:right}.ach-muted{color:#9ca3af}.ach-empty{padding:28px;text-align:center;color:#9ca3af}.ach-pill{display:inline-flex;border:1px solid #5f5132;border-radius:99px;padding:4px 7px;color:#f0cf7d;font-size:11px}
    `;
    document.head.appendChild(s);
  }

  function render() {
    css();
    if (!document.getElementById('asil-cari-history-btn')) {
      const b = document.createElement('button');
      b.id = 'asil-cari-history-btn'; b.type='button'; b.textContent='Cari Geçmişi';
      b.onclick = open;
      document.body.appendChild(b);
    }
    if (document.getElementById('asil-cari-history-backdrop')) return;
    const wrap = document.createElement('div'); wrap.id='asil-cari-history-backdrop';
    wrap.innerHTML = `<div id="asil-cari-history-modal" role="dialog" aria-modal="true"><div class="ach-head"><h3>Cari Hesap İşlem Geçmişi</h3><button class="ach-close" type="button">Kapat</button></div><div class="ach-body"><div class="ach-toolbar"><input id="ach-search" class="ach-input" placeholder="Cari adı veya işlem ara..."><select id="ach-customer" class="ach-select"><option value="">Tüm cariler</option></select><button id="ach-refresh" class="ach-close" type="button">Yenile</button></div><div id="ach-content"></div></div></div>`;
    document.body.appendChild(wrap);
    wrap.querySelector('.ach-close').onclick=close;
    wrap.addEventListener('click', e=>{ if(e.target===wrap) close(); });
    wrap.querySelector('#ach-refresh').onclick=populate;
    wrap.querySelector('#ach-search').oninput=draw;
    wrap.querySelector('#ach-customer').onchange=draw;
  }

  let state={customers:[],movements:[]};
  function populate(){
    state=collect();
    const sel=document.getElementById('ach-customer');
    if(!sel) return;
    const current=sel.value;
    sel.innerHTML='<option value="">Tüm cariler</option>'+state.customers.slice(0,500).sort((a,b)=>a.name.localeCompare(b.name,'tr')).map((c,i)=>`<option value="${i}">${esc(c.name)}</option>`).join('');
    if([...sel.options].some(o=>o.value===current)) sel.value=current;
    draw();
  }
  function draw(){
    const content=document.getElementById('ach-content'); if(!content) return;
    const q=norm(document.getElementById('ach-search')?.value||'');
    const idx=document.getElementById('ach-customer')?.value||'';
    const selected=idx===''?null:state.customers[Number(idx)];
    let rows=state.movements.filter(r=>{
      const text=norm(`${r.name} ${r.text} ${r.date} ${r.amount}`);
      if(q&&!text.includes(q)) return false;
      if(selected){ const a=norm(r.name), b=norm(selected.name); if(a!==b&&!a.includes(b)&&!b.includes(a)) return false; }
      return true;
    });
    rows=rows.slice(0,1000);
    if(!rows.length){content.innerHTML='<div class="ach-empty">Bu seçim için kayıtlı cari hareketi bulunamadı.<br><span class="ach-muted">Yenile ile tekrar tarayabilirsiniz.</span></div>';return;}
    content.innerHTML=`<div class="ach-muted" style="margin-bottom:10px">${rows.length} hareket gösteriliyor · ilk 1000 kayıt</div><div style="overflow:auto"><table class="ach-table"><thead><tr><th>Tarih</th><th>Cari</th><th>İşlem</th><th class="ach-num">Tutar</th><th>Kaynak</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.date)}</td><td><span class="ach-pill">${esc(r.name||'Cari')}</span></td><td>${esc(r.text)}</td><td class="ach-num">${r.amount===''?'':money(r.amount)}</td><td class="ach-muted">${esc(r.source)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function open(){ render(); document.getElementById('asil-cari-history-backdrop').classList.add('show'); populate(); }
  function close(){ document.getElementById('asil-cari-history-backdrop')?.classList.remove('show'); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',render,{once:true}); else render();
})();
