(()=>{'use strict';if(window.__cariPaymentLedgerV1)return;window.__cariPaymentLedgerV1=true;
const PAY='kuyumcu_cari_payments_v1', MOV='kuyumcu_sale_cari_movements_v1', MARK='__cariPaymentLedgerV1';
const read=k=>{try{const x=JSON.parse(localStorage.getItem(k)||'[]');return Array.isArray(x)?x:[]}catch{return[]}};
const write=(k,x)=>localStorage.setItem(k,JSON.stringify(x));
function sync(){
 const pays=read(PAY), mov=read(MOV); let changed=false;
 const ids=new Set(mov.filter(x=>x&&x[MARK]).map(x=>String(x.paymentId||x.id)));
 for(const p of pays){
   if(!p||!p.id||ids.has(String(p.id)))continue;
   const amount=Number(p.amount||p.total||p.tl||0); if(!(amount>0)||!String(p.customer||p.cari||'').trim())continue;
   mov.push({id:'CARIPAY-'+p.id,paymentId:p.id,date:p.date||new Date().toISOString(),createdAt:p.date||new Date().toISOString(),customer:String(p.customer||p.cari).trim(),type:'Tahsilat',transactionType:'payment',amount:-Math.abs(amount),total:-Math.abs(amount),tl:-Math.abs(amount),grams:Number(p.grams||0),milyem:Number(p.milyem||0),method:p.method||'',note:p.note||'',source:'cari-payment',[MARK]:true});
   ids.add(String(p.id)); changed=true;
 }
 if(changed){write(MOV,mov.slice(-5000));window.dispatchEvent(new CustomEvent('kuyumcu:cari-ledger-synced'));}
}
sync();setInterval(sync,1200);window.addEventListener('kuyumcu:cari-payment-saved',sync);
})();
