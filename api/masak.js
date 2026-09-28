const SOURCES = [
  {
    key: '6415-5',
    label: 'MASAK 6415/5 - BMGK kararları',
    page: 'https://masak.hmb.gov.tr/5-maddeye-iliskin-bakanlar-kurulu-kararlari'
  },
  {
    key: '6415-7',
    label: 'MASAK 6415/7 - İç dondurma kararları',
    page: 'https://masak.hmb.gov.tr/7madde'
  },
  {
    key: '7262-3AB',
    label: 'MASAK 7262/3A-3B - KİSYF kararları',
    page: 'https://masak.hmb.gov.tr/3a3b'
  }
];

function cors(res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  res.setHeader('Cache-Control','s-maxage=1800, stale-while-revalidate=86400');
}
function clean(v){ return String(v ?? '').trim(); }
function decodeHtml(v){
  return clean(v)
    .replace(/&amp;/g,'&').replace(/&#38;/g,'&')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}
function stripTags(v){ return decodeHtml(String(v||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ')); }
function absUrl(href,base){
  try{return new URL(decodeHtml(href),base).toString();}catch{return '';}
}
function normalizeEscapes(html){
  return String(html||'')
    .replace(/\\u002F/gi,'/')
    .replace(/\\u003A/gi,':')
    .replace(/\\u0026/gi,'&')
    .replace(/\\\//g,'/');
}
function discoverCsvLinks(html,page){
  html=normalizeEscapes(html);
  const out=[];
  const seen=new Set();
  const add=(href,label='')=>{
    const u=absUrl(href,page);
    if(!u || seen.has(u)) return;
    const hay=(href+' '+label).toLowerCase();
    if(!hay.includes('csv')) return;
    seen.add(u);
    out.push({url:u,label:clean(label)||'CSV'});
  };
  const anchor=/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=anchor.exec(html))) add(m[1],stripTags(m[2]));
  const urlish=/(https?:\\?\/\\?\/[^"'<>\s]+|\/[A-Za-z0-9_./?=&%-]*csv[A-Za-z0-9_./?=&%-]*)/gi;
  while((m=urlish.exec(html))) add(m[1].replace(/\\/g,''),'CSV');
  return out;
}
function normKey(v){
  return clean(v).toLocaleLowerCase('tr-TR')
    .replace(/[çÇ]/g,'c').replace(/[ğĞ]/g,'g').replace(/[ıİ]/g,'i')
    .replace(/[öÖ]/g,'o').replace(/[şŞ]/g,'s').replace(/[üÜ]/g,'u')
    .replace(/[^a-z0-9]/g,'');
}
function splitCsvLine(line,delim){
  const out=[];let cur='',q=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){
      if(q&&line[i+1]==='"'){cur+='"';i++;} else q=!q;
    } else if(ch===delim&&!q){out.push(cur);cur='';}
    else cur+=ch;
  }
  out.push(cur);return out;
}
function parseCsv(text,source){
  const lines=String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());
  if(lines.length<2)return [];
  const counts={';':(lines[0].match(/;/g)||[]).length,',':(lines[0].match(/,/g)||[]).length,'\t':(lines[0].match(/\t/g)||[]).length};
  const delim=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
  const heads=splitCsvLine(lines[0],delim).map(normKey);
  const idx=(ks)=>heads.findIndex(h=>ks.includes(h));
  const iName=idx(['adsoyad','adisoyadi','adisoyadiunvan','adsoyadunvan','adivesoyadi','isim','name','unvan','kisiunvan','adiunvani','adsoyadunvani']);
  const iFirst=idx(['adi','ad','firstname','isim']);
  const iLast=idx(['soyadi','soyad','lastname']);
  const iBirth=idx(['dogumtarihi','birthdate','dtarihi','dogumyili']);
  const iId=idx(['tckimlikno','tckn','kimlikno','ulusalno','nationalid','pasaportno','passportno','belgeno','kimliknumarasi']);
  const iNote=idx(['aciklama','orgut','yaptirimturu','liste','program','not','digerbilgiler','uyruk']);
  const out=[];
  for(const line of lines.slice(1)){
    const c=splitCsvLine(line,delim);
    let name=iName>=0?c[iName]:'';
    if(!clean(name)&&iFirst>=0)name=[c[iFirst],iLast>=0?c[iLast]:''].filter(Boolean).join(' ');
    name=clean(name);
    if(!name)continue;
    out.push({
      name,
      birthDate:iBirth>=0?clean(c[iBirth]):'',
      idNo:iId>=0?clean(c[iId]):'',
      note:iNote>=0?clean(c[iNote]):'',
      source
    });
  }
  return out;
}
async function getText(url){
  const r=await fetch(url,{
    redirect:'follow',
    headers:{
      'User-Agent':'Mozilla/5.0 (compatible; AsilKuyumcuPro/1.0; +https://kuyumcuproo.vercel.app)',
      'Accept':'text/html,text/csv,text/plain,application/octet-stream,*/*'
    },
    cache:'no-store'
  });
  if(!r.ok)throw new Error(`HTTP ${r.status} ${url}`);
  return {text:await r.text(),type:r.headers.get('content-type')||'',finalUrl:r.url};
}

export default async function handler(req,res){
  cors(res);
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='GET')return res.status(405).json({ok:false,message:'Desteklenmeyen istek.'});

  const records=[];
  const files=[];
  const warnings=[];
  for(const src of SOURCES){
    try{
      const page=await getText(src.page);
      const links=discoverCsvLinks(page.text,page.finalUrl||src.page);
      if(!links.length)warnings.push(`${src.label}: CSV bağlantısı sayfada bulunamadı.`);
      for(const link of links.slice(0,6)){
        try{
          const f=await getText(link.url);
          const source=`${src.label} / ${link.label||'CSV'}`;
          const rows=parseCsv(f.text,source);
          if(rows.length){
            records.push(...rows);
            files.push({source,url:f.finalUrl||link.url,rows:rows.length});
          }else{
            warnings.push(`${source}: CSV okundu ancak tanınan kişi/ünvan satırı bulunamadı.`);
          }
        }catch(e){
          warnings.push(`${src.label}: ${String(e?.message||e)}`);
        }
      }
    }catch(e){
      warnings.push(`${src.label}: ${String(e?.message||e)}`);
    }
  }
  const seen=new Set();
  const unique=[];
  for(const r of records){
    const key=[r.name.toLocaleUpperCase('tr-TR'),r.idNo,r.birthDate,r.source].join('|');
    if(seen.has(key))continue;seen.add(key);unique.push(r);
  }
  return res.status(200).json({
    ok:true,
    provider:'T.C. Hazine ve Maliye Bakanlığı / MASAK',
    fetchedAt:new Date().toISOString(),
    count:unique.length,
    records:unique,
    files,
    warnings,
    officialPages:SOURCES
  });
}
