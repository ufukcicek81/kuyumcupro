/* Asil Kuyumcu Pro — Firebase Authentication (e-posta/şifre) ile bulut erişimi.
 *
 * Firebase Realtime Database kuralları "giriş yapılmış ve yetkili kullanıcı" şartına
 * bağlandığında, bu modül tüm firebaseio.com isteklerine kısa ömürlü bir kimlik
 * anahtarı (?auth=ID_TOKEN) ekler. Şifre cihazda saklanmaz; yalnızca yenileme
 * anahtarı (refresh token) saklanır. Ayar yapılmamışsa istekler eskisi gibi gider.
 */
(function(root){
  'use strict';
  var STORE='asil_firebase_auth_v7';
  var DB_HOST_RE=/(^|\.)firebaseio\.com$|(^|\.)firebasedatabase\.app$/i;
  var nativeFetch=root.fetch?root.fetch.bind(root):null;
  var refreshing=null;

  function read(){try{return JSON.parse(root.localStorage.getItem(STORE)||'null')||null}catch(_){return null}}
  function write(v){try{if(v)root.localStorage.setItem(STORE,JSON.stringify(v));else root.localStorage.removeItem(STORE)}catch(_){}}
  function isConfigured(){var c=read();return !!(c&&c.apiKey&&c.refreshToken)}
  function status(){var c=read();return c?{configured:!!c.refreshToken,email:c.email||'',uid:c.uid||'',apiKey:c.apiKey||''}:{configured:false,email:'',uid:'',apiKey:''}}

  function authError(data,fallback){
    var code=String(data&&data.error&&data.error.message||fallback||'');
    var map={
      EMAIL_NOT_FOUND:'E-posta bulunamadı',INVALID_PASSWORD:'Şifre hatalı',INVALID_LOGIN_CREDENTIALS:'E-posta veya şifre hatalı',
      USER_DISABLED:'Kullanıcı devre dışı',TOO_MANY_ATTEMPTS_TRY_LATER:'Çok fazla deneme; biraz sonra tekrar deneyin',
      TOKEN_EXPIRED:'Oturum süresi doldu; tekrar giriş yapın',INVALID_REFRESH_TOKEN:'Oturum geçersiz; tekrar giriş yapın',
      'API key not valid. Please pass a valid API key.':'Web API anahtarı geçersiz'
    };
    return new Error(map[code.split(' :')[0]]||code||'Firebase giriş hatası');
  }

  async function signIn(apiKey,email,password){
    apiKey=String(apiKey||'').trim();email=String(email||'').trim();
    if(!apiKey||!email||!password)throw new Error('Web API anahtarı, e-posta ve şifre gerekli');
    var r=await nativeFetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(apiKey),{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,password:String(password),returnSecureToken:true})
    });
    var data=await r.json().catch(function(){return {}});
    if(!r.ok)throw authError(data,'HTTP '+r.status);
    var c={apiKey:apiKey,email:data.email||email,uid:data.localId,idToken:data.idToken,refreshToken:data.refreshToken,exp:Date.now()+Number(data.expiresIn||3600)*1000};
    write(c);return status();
  }
  function signOut(){write(null)}

  async function refresh(c){
    var r=await nativeFetch('https://securetoken.googleapis.com/v1/token?key='+encodeURIComponent(c.apiKey),{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:'grant_type=refresh_token&refresh_token='+encodeURIComponent(c.refreshToken)
    });
    var data=await r.json().catch(function(){return {}});
    if(!r.ok){
      var err=authError(data,'HTTP '+r.status);
      if(r.status===400)write(Object.assign({},c,{refreshToken:'',idToken:''})); // kalıcı hata: yeniden giriş gerekir
      throw err;
    }
    var n=Object.assign({},c,{idToken:data.id_token,refreshToken:data.refresh_token||c.refreshToken,uid:data.user_id||c.uid,exp:Date.now()+Number(data.expires_in||3600)*1000});
    write(n);return n.idToken;
  }
  async function token(){
    var c=read();if(!c||!c.apiKey||!c.refreshToken)return '';
    if(c.idToken&&Number(c.exp||0)-Date.now()>120000)return c.idToken;
    if(!refreshing)refreshing=refresh(c).finally(function(){refreshing=null});
    return refreshing;
  }
  function isDbUrl(u){try{return DB_HOST_RE.test(new URL(u,root.location&&root.location.href).hostname)}catch(_){return false}}
  async function authUrl(url){
    if(!isDbUrl(url))return url;
    var t=await token();if(!t)return url;
    var u=new URL(url,root.location&&root.location.href);u.searchParams.set('auth',t);return u.toString();
  }

  if(nativeFetch){
    root.fetch=async function(input,init){
      var url=typeof input==='string'?input:(input&&input.url)||String(input);
      if(isDbUrl(url)&&isConfigured()){
        try{
          var signed=await authUrl(url);
          if(typeof input==='string'||input instanceof URL)return nativeFetch(signed,init);
          return nativeFetch(new Request(signed,input),init);
        }catch(e){
          return new Response(JSON.stringify({error:'Bulut girişi yenilenemedi: '+(e&&e.message||e)}),{status:401,headers:{'Content-Type':'application/json'}});
        }
      }
      return nativeFetch(input,init);
    };
  }

  root.AsilCloudAuth={signIn:signIn,signOut:signOut,token:token,authUrl:authUrl,isConfigured:isConfigured,status:status};
})(typeof self!=='undefined'?self:this);
