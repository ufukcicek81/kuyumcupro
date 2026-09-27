const FIREBASE_BASE = 'https://asil-kuyumculuk-2feb6-default-rtdb.firebaseio.com/kuyumcuProV5/nfcSessions';

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
}
function code8(){
  const n = Math.floor(Math.random()*100000000);
  return String(n).padStart(8,'0');
}
function clean(v){ return String(v ?? '').trim(); }
function safePayload(p={}){
  return {
    fullName: clean(p.fullName).slice(0,180),
    tckn: clean(p.tckn).replace(/\D/g,'').slice(0,11),
    documentNumber: clean(p.documentNumber || p.documentNo).slice(0,40),
    birthDate: clean(p.birthDate).slice(0,20),
    expiryDate: clean(p.expiryDate).slice(0,20),
    nationality: clean(p.nationality).slice(0,60),
    sex: clean(p.sex).slice(0,20),
    birthPlace: clean(p.birthPlace).slice(0,160),
    occupation: clean(p.occupation).slice(0,160),
    address: clean(p.address).slice(0,400),
    phone: clean(p.phone).slice(0,60),
    mrzCameraRead: Boolean(p.mrzCameraRead),
    reader: clean(p.reader || 'Asil NFC Helper').slice(0,80),
    protocol: clean(p.protocol || 'ICAO NFC').slice(0,80)
  };
}
async function fbGet(code){
  const r=await fetch(`${FIREBASE_BASE}/${encodeURIComponent(code)}.json`,{cache:'no-store'});
  if(!r.ok) throw new Error(`Firebase GET ${r.status}`);
  return await r.json();
}
async function fbPut(code,data){
  const r=await fetch(`${FIREBASE_BASE}/${encodeURIComponent(code)}.json`,{
    method:'PUT',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(data)
  });
  if(!r.ok) throw new Error(`Firebase PUT ${r.status}`);
}
async function fbDelete(code){
  const r=await fetch(`${FIREBASE_BASE}/${encodeURIComponent(code)}.json`,{method:'DELETE'});
  if(!r.ok) throw new Error(`Firebase DELETE ${r.status}`);
}
export default async function handler(req,res){
  cors(res);
  if(req.method==='OPTIONS') return res.status(204).end();
  if(req.method==='GET'){
    return res.status(200).json({ok:true,service:'Asil NFC Bridge',version:'1.0',provider:'Vercel'});
  }
  if(req.method!=='POST') return res.status(405).json({ok:false,message:'Desteklenmeyen istek.'});

  try{
    const body = typeof req.body==='string' ? JSON.parse(req.body||'{}') : (req.body||{});
    const action = clean(body.action);

    if(action==='createNfcSession'){
      let code=code8();
      for(let i=0;i<5;i++){
        if(!(await fbGet(code))) break;
        code=code8();
      }
      const now=Date.now();
      await fbPut(code,{status:'WAITING',createdAt:new Date(now).toISOString(),expiresAt:now+10*60*1000});
      return res.status(200).json({ok:true,code,expiresIn:600});
    }

    if(action==='submitNfcIdentity'){
      const code=clean(body.code).replace(/\D/g,'');
      if(code.length!==8) return res.status(400).json({ok:false,message:'Eşleştirme kodu 8 hane olmalı.'});
      const current=await fbGet(code);
      if(!current) return res.status(404).json({ok:false,message:'Kod bulunamadı veya süresi doldu.'});
      if(Number(current.expiresAt||0)<Date.now()){
        await fbDelete(code);
        return res.status(410).json({ok:false,message:'Kodun süresi doldu.'});
      }
      const payload=safePayload(body.payload||{});
      if(!payload.fullName && !payload.documentNumber) return res.status(400).json({ok:false,message:'Kimlik verisi boş.'});
      await fbPut(code,{status:'READY',createdAt:current.createdAt||new Date().toISOString(),readyAt:new Date().toISOString(),expiresAt:Date.now()+10*60*1000,payload});
      return res.status(200).json({ok:true,status:'READY'});
    }

    if(action==='pollNfcSession'){
      const code=clean(body.code).replace(/\D/g,'');
      if(code.length!==8) return res.status(400).json({ok:false,message:'Eşleştirme kodu 8 hane olmalı.'});
      const current=await fbGet(code);
      if(!current) return res.status(404).json({ok:false,status:'EXPIRED',message:'Kod bulunamadı veya süresi doldu.'});
      if(Number(current.expiresAt||0)<Date.now()){
        await fbDelete(code);
        return res.status(410).json({ok:false,status:'EXPIRED',message:'Kodun süresi doldu.'});
      }
      if(current.status!=='READY') return res.status(200).json({ok:true,status:'WAITING'});
      const payload=current.payload||{};
      await fbDelete(code);
      return res.status(200).json({ok:true,status:'READY',payload});
    }

    return res.status(400).json({ok:false,message:'Bilinmeyen action.'});
  }catch(e){
    return res.status(500).json({ok:false,message:String(e?.message||e)});
  }
}
