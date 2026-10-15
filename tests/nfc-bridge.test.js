'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

// Sahte Firebase: nfcSessions kuralını taklit eder (yetkili anahtar her şeyi yapar;
// anahtarsız yazım yalnız bekleyen ve süresi dolmamış koda READY olarak izin verilir).
function fakeFirebase(){
  const db={};const calls=[];
  global.fetch=async(url,init={})=>{
    const u=new URL(url);const code=decodeURIComponent(u.pathname.split('/').pop().replace(/\.json$/,''));
    const authed=u.searchParams.get('auth')==='GOOD';const method=init.method||'GET';calls.push({method,code,authed});
    const resp=(status,body)=>new Response(body===undefined?'':JSON.stringify(body),{status});
    if(method==='GET')return authed?resp(200,db[code]??null):resp(401,{error:'Permission denied'});
    if(method==='DELETE'){if(!authed)return resp(401,{error:'Permission denied'});delete db[code];return resp(200,null);}
    const next=JSON.parse(init.body);const cur=db[code];
    const ok=authed||(cur&&cur.status==='WAITING'&&cur.expiresAt>Date.now()&&next.status==='READY');
    if(!ok)return resp(401,{error:'Permission denied'});
    db[code]=next;return resp(200,next);
  };
  return {db,calls};
}
async function call(handler,body){
  let status=0,out;
  const res={setHeader(){},status(s){status=s;return this},json(b){out=b;return this},end(){return this}};
  await handler({method:'POST',body},res);
  return {status,body:out};
}
async function load(){return (await import(pathToFileURL(path.join(__dirname,'..','api','nfc.js')).href)).default;}

test('NFC köprüsü: giriş anahtarıyla oturum açılır, telefon anahtarsız yazar, kimlik anahtarla alınır',async()=>{
  delete process.env.FIREBASE_DB_SECRET;
  const fb=fakeFirebase();const handler=await load();
  const noAuth=await call(handler,{action:'createNfcSession'});
  assert.equal(noAuth.status,401);
  const created=await call(handler,{action:'createNfcSession',idToken:'GOOD'});
  assert.equal(created.status,200);const code=created.body.code;assert.match(code,/^\d{8}$/);
  assert.equal(fb.db[code].status,'WAITING');
  const waiting=await call(handler,{action:'pollNfcSession',code,idToken:'GOOD'});
  assert.equal(waiting.body.status,'WAITING');
  const sub=await call(handler,{action:'submitNfcIdentity',code,payload:{fullName:'TEST KİŞİ',tckn:'12345678901'}});
  assert.equal(sub.status,200);
  assert.ok(fb.calls.filter(c=>c.method==='PUT'&&!c.authed).length===1,'telefon anahtarsız yazmalı');
  const ready=await call(handler,{action:'pollNfcSession',code,idToken:'GOOD'});
  assert.equal(ready.body.status,'READY');assert.equal(ready.body.payload.fullName,'TEST KİŞİ');
  assert.equal(fb.db[code],undefined,'okunan oturum silinmeli');
  const again=await call(handler,{action:'submitNfcIdentity',code,payload:{fullName:'X'}});
  assert.equal(again.status,404);
});
