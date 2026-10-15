'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

// index.html içindeki çift belge denetimini tek başına çalıştırır.
const src=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const body=src.match(/function cloudDuplicateDocsV7\(\)\{[\s\S]*?return dup;\n  \}/)[0];
const make=new Function('getState',`let state;${body};return s=>{state=s;return cloudDuplicateDocsV7();};`);
const check=make();

test('çok kalemli tek altın alış fişi çift belge sayılmaz',()=>{
  assert.deepEqual(check({tradeMoves:[{docNo:'AZA-2026-000002',date:'2026-10-15T17:38:00Z',user:'Ufuk'},{docNo:'AZA-2026-000002',date:'2026-10-15T17:38:00Z',user:'Ufuk'}]}),[]);
});
test('aynı numara farklı zamanda iki ayrı belgeye verilirse uyarılır',()=>{
  assert.deepEqual(check({sales:[{docNo:'SAT-2026-000005',date:'2026-10-15T10:00:00Z',user:'A'},{docNo:'SAT-2026-000005',date:'2026-10-15T10:05:00Z',user:'B'}]}),['SAT-2026-000005']);
});
