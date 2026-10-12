// index.html içindeki satır içi betikler ve tüm JS dosyaları için sözdizimi kontrolü.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asil-check-'));
const files = [];
let i = 0;
for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (/\bsrc=/.test(m[1])) {
    const src = m[1].match(/src="\.\/([^"]+)"/);
    if (src && !fs.existsSync(path.join(root, src[1]))) throw new Error('Eksik betik: ' + src[1]);
    continue;
  }
  const f = path.join(tmp, `inline-${i++}.js`);
  fs.writeFileSync(f, m[2]);
  files.push(f);
}
for (const dir of ['js', 'api']) for (const f of fs.readdirSync(path.join(root, dir))) if (f.endsWith('.js')) files.push(path.join(root, dir, f));
files.push(path.join(root, 'cari-fix-final.js'), path.join(root, 'sw.js'));
for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
console.log(`Sözdizimi kontrolü geçti (${files.length} dosya).`);
