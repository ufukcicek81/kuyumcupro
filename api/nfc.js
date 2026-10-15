import { randomInt } from 'node:crypto';
const FIREBASE_BASE = 'https://kuyumpro-f33c2-default-rtdb.europe-west1.firebasedatabase.app/nfcSessions';
// Oturum açma/sorgulama, programda bulut girişi yapmış cihazın kısa ömürlü kimlik anahtarıyla
// (idToken) yapılır. Telefondaki NFC yardımcısı anahtarsız yazar; Firebase kuralı buna yalnız
// bekleyen (WAITING) ve süresi dolmamış bir kod için izin verir. İsteğe bağlı olarak Vercel
// ortam değişkeni FIREBASE_DB_SECRET tanımlanırsa sunucu onunla erişir.
function fbUrl(code,token){
  const auth=process.env.FIREBASE_DB_SECRET||token||'';
  return `${FIREBASE_BASE}/${encodeURIComponent(code)}.json${auth?`?auth=${encodeURIComponent(auth)}`:''}`;
}
function fbError(op,r,text){
  if(r.status===401||r.status===403)return Object.assign(new Error(`Firebase ${op} yetkisiz: programda Bulut Girişi yapın`),{status:401});
  if(r.status===402)return Object.assign(new Error(`Firebase ${op} 402: Firebase kotası doldu`),{status:503});
  return Object.assign(new Error(`Firebase ${op} ${r.status}${text?` · ${String(text).slice(0,160)}`:''}`),{status:502});
}

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
}
// Eşleştirme kodu tahmin edilemesin diye kriptografik rastgele sayı kullanılır.
function code8(){
  return String(randomInt(0,100000000)).padStart(8,'0');
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
async function fbGet(code,token){
  const r=await fetch(fbUrl(code,token),{cache:'no-store'});
  if(!r.ok) throw fbError('GET',r,await r.text().catch(()=>''));
  return await r.json();
}
async function fbPut(code,data,token){
  const r=await fetch(fbUrl(code,token),{
    method:'PUT',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(data)
  });
  if(!r.ok) throw fbError('PUT',r,await r.text().catch(()=>''));
}
async function fbDelete(code,token){
  const r=await fetch(fbUrl(code,token),{method:'DELETE'});
  if(!r.ok) throw fbError('DELETE',r,await r.text().catch(()=>''));
}
export default async function handler(req,res){
  cors(res);
  if(req.method==='OPTIONS') return res.status(204).end();
  if(req.method==='GET'){
    return res.status(200).json({ok:true,service:'Asil NFC Bridge',version:'2.0',provider:'Vercel',firebase:'kuyumpro-f33c2'});
  }
  if(req.method!=='POST') return res.status(405).json({ok:false,message:'Desteklenmeyen istek.'});

  try{
    const body = typeof req.body==='string' ? JSON.parse(req.body||'{}') : (req.body||{});
    const action = clean(body.action);
    const token = clean(body.idToken);

    if(action==='createNfcSession'){
      if(!token && !process.env.FIREBASE_DB_SECRET) return res.status(401).json({ok:false,message:'NFC için önce programda Bulut Girişi yapın.'});
      let code=code8();
      for(let i=0;i<5;i++){
        if(!(await fbGet(code,token))) break;
        code=code8();
      }
      const now=Date.now();
      await fbPut(code,{status:'WAITING',createdAt:new Date(now).toISOString(),expiresAt:now+10*60*1000},token);
      return res.status(200).json({ok:true,code,expiresIn:600});
    }

    if(action==='submitNfcIdentity'){
      const code=clean(body.code).replace(/\D/g,'');
      if(code.length!==8) return res.status(400).json({ok:false,message:'Eşleştirme kodu 8 hane olmalı.'});
      const payload=safePayload(body.payload||{});
      if(!payload.fullName && !payload.documentNumber) return res.status(400).json({ok:false,message:'Kimlik verisi boş.'});
      // Telefon anahtarsız yazar: kural yalnız bekleyen ve süresi dolmamış koda izin verir,
      // bu yüzden reddedilen yazım "kod yok / süresi doldu" demektir. Kimlik verisi okunamaz.
      try{
        await fbPut(code,{status:'READY',readyAt:new Date().toISOString(),expiresAt:Date.now()+10*60*1000,payload},token);
      }catch(e){
        if(e.status===401) return res.status(404).json({ok:false,message:'Kod bulunamadı veya süresi doldu.'});
        throw e;
      }
      return res.status(200).json({ok:true,status:'READY'});
    }

    if(action==='pollNfcSession'){
      const code=clean(body.code).replace(/\D/g,'');
      if(code.length!==8) return res.status(400).json({ok:false,message:'Eşleştirme kodu 8 hane olmalı.'});
      const current=await fbGet(code,token);
      if(!current) return res.status(404).json({ok:false,status:'EXPIRED',message:'Kod bulunamadı veya süresi doldu.'});
      if(Number(current.expiresAt||0)<Date.now()){
        await fbDelete(code,token);
        return res.status(410).json({ok:false,status:'EXPIRED',message:'Kodun süresi doldu.'});
      }
      if(current.status!=='READY') return res.status(200).json({ok:true,status:'WAITING'});
      const payload=current.payload||{};
      await fbDelete(code,token);
      return res.status(200).json({ok:true,status:'READY',payload});
    }

    return res.status(400).json({ok:false,message:'Bilinmeyen action.'});
  }catch(e){
    return res.status(e?.status||500).json({ok:false,message:String(e?.message||e)});
  }
}
