const test = require('node:test');
const assert = require('node:assert/strict');
const { encrypt, decrypt, isEncrypted } = require('../js/asil-backup-crypto.js');

test('şifreli yedek doğru parolayla açılır, yanlışla açılmaz', async () => {
  const data = { users: [{ id: 'U1' }], stocks: [{ id: 'X', gram: 1.5 }], note: 'Çeyrek ğüşiöç' };
  const env = await encrypt(data, 'guclu-parola-123', { createdAt: 'x' });
  assert.ok(isEncrypted(env));
  assert.ok(!JSON.stringify(env).includes('Çeyrek'));
  assert.deepEqual(await decrypt(env, 'guclu-parola-123'), data);
  await assert.rejects(decrypt(env, 'yanlis-parola'), /parolası hatalı/);
});

test('kısa parola reddedilir', async () => {
  await assert.rejects(encrypt({}, '123'), /en az 8/);
});
