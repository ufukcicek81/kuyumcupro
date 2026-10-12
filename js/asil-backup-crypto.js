/* Asil Kuyumcu Pro — parola ile şifrelenmiş yedek dosyası.
 * PBKDF2-SHA256 (250.000 tur) ile paroladan anahtar türetilir, veri AES-GCM ile şifrelenir.
 * Parola unutulursa yedek açılamaz; parola hiçbir yerde saklanmaz. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(globalThis.crypto);
  else root.AsilBackupCrypto=factory(root.crypto);
})(typeof self!=='undefined'?self:this,function(cryptoApi){
  'use strict';
  var FORMAT='ASIL_KUYUMCU_BACKUP_ENC_V1',ITER=250000;
  function b64(bytes){var s='';bytes=new Uint8Array(bytes);for(var i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(s)}
  function unb64(str){var s=atob(str),out=new Uint8Array(s.length);for(var i=0;i<s.length;i++)out[i]=s.charCodeAt(i);return out}
  async function keyFor(password,salt,iter){
    var base=await cryptoApi.subtle.importKey('raw',new TextEncoder().encode(String(password)),'PBKDF2',false,['deriveKey']);
    return cryptoApi.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:salt,iterations:iter},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function encrypt(obj,password,meta){
    if(!password||String(password).length<8)throw new Error('Yedek parolası en az 8 karakter olmalı');
    var salt=cryptoApi.getRandomValues(new Uint8Array(16)),iv=cryptoApi.getRandomValues(new Uint8Array(12));
    var key=await keyFor(password,salt,ITER);
    var data=await cryptoApi.subtle.encrypt({name:'AES-GCM',iv:iv},key,new TextEncoder().encode(JSON.stringify(obj)));
    return Object.assign({},meta||{},{format:FORMAT,encrypted:true,kdf:'PBKDF2-SHA256',iterations:ITER,salt:b64(salt),iv:b64(iv),data:b64(data)});
  }
  function isEncrypted(env){return !!(env&&env.format===FORMAT&&env.encrypted)}
  async function decrypt(env,password){
    if(!isEncrypted(env))throw new Error('Şifreli yedek değil');
    var key=await keyFor(password,unb64(env.salt),Number(env.iterations||ITER));
    try{
      var plain=await cryptoApi.subtle.decrypt({name:'AES-GCM',iv:unb64(env.iv)},key,unb64(env.data));
      return JSON.parse(new TextDecoder().decode(plain));
    }catch(_){throw new Error('Yedek parolası hatalı veya dosya bozuk')}
  }
  return {FORMAT:FORMAT,encrypt:encrypt,decrypt:decrypt,isEncrypted:isEncrypted};
});
