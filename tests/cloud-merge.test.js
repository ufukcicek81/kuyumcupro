const test = require('node:test');
const assert = require('node:assert/strict');
const { merge3, mergeState, deepEqual } = require('../js/asil-cloud-merge.js');

const base = {
  meta: { updatedAt: '2026-10-12T10:00:00Z' },
  sales: [{ id: 'S1', total: 100 }],
  tradeMoves: [],
  accounts: [{ key: 'Kasa:TL', balance: 1000 }, { key: 'Kasa:USD', balance: 50 }],
  customers: [{ id: 'C1', name: 'Ali', hasBalance: 2 }],
  cloudSync: { lastPush: 'a' },
};
const clone = (o) => JSON.parse(JSON.stringify(o));

test('iki cihazda eklenen satışların ikisi de korunur', () => {
  const local = clone(base); local.sales.unshift({ id: 'S2', total: 200 });
  const remote = clone(base); remote.sales.unshift({ id: 'S3', total: 300 });
  const m = mergeState(base, local, remote, ['cloudSync']);
  assert.deepEqual(m.sales.map((s) => s.id).sort(), ['S1', 'S2', 'S3']);
});

test('kasa bakiyesindeki değişiklikler toplanır', () => {
  const local = clone(base); local.accounts[0].balance = 1200;   // +200
  const remote = clone(base); remote.accounts[0].balance = 900;  // -100
  const m = mergeState(base, local, remote, []);
  assert.equal(m.accounts[0].balance, 1100);
});

test('cari HAS bakiyesi kesirli değerlerde doğru toplanır', () => {
  const local = clone(base); local.customers[0].hasBalance = 2.1;
  const remote = clone(base); remote.customers[0].hasBalance = 1.7;
  assert.equal(mergeState(base, local, remote, []).customers[0].hasBalance, 1.8);
});

test('yalnızca bulutta değişen kayıt cihaza gelir', () => {
  const local = clone(base);
  const remote = clone(base); remote.customers[0].name = 'Ali Veli';
  assert.equal(mergeState(base, local, remote, []).customers[0].name, 'Ali Veli');
});

test('bir cihazda silinen kayıt silinir', () => {
  const local = clone(base); local.sales = [];
  const remote = clone(base); remote.tradeMoves.push({ id: 'T1' });
  const m = mergeState(base, local, remote, []);
  assert.equal(m.sales.length, 0);
  assert.equal(m.tradeMoves.length, 1);
});

test('cihaza özel alanlar yerel kalır', () => {
  const local = clone(base); local.cloudSync.lastPush = 'local';
  const remote = clone(base); remote.cloudSync.lastPush = 'remote'; remote.sales.push({ id: 'S9' });
  assert.equal(mergeState(base, local, remote, ['cloudSync']).cloudSync.lastPush, 'local');
});

test('ortak taban yoksa birleştirme yapılmaz', () => {
  assert.equal(mergeState(null, base, clone(base), []), null);
});

test('değişiklik yoksa sonuç bulutla aynıdır', () => {
  const remote = clone(base); remote.sales.push({ id: 'S5' });
  assert.ok(deepEqual(merge3(base, clone(base), remote), remote));
});

test('fiyat gibi toplanmayan alanlarda farklar toplanmaz', () => {
  const b = { prices: { has: { buy: 6600 } }, cashAccounts: [{ id: 'K', balance: 10 }] };
  const local = { prices: { has: { buy: 6661 } }, cashAccounts: [{ id: 'K', balance: 15 }] };
  const remote = { prices: { has: { buy: 6665 } }, cashAccounts: [{ id: 'K', balance: 12 }] };
  const m = mergeState(b, local, remote, [], ['prices']);
  assert.equal(m.prices.has.buy, 6661);
  assert.equal(m.cashAccounts[0].balance, 17);
});

test('Firebase biçimine normalleştirme boş dizi, boş nesne ve null değerleri atar', () => {
  const { firebaseNormalize } = require('../js/asil-cloud-merge.js');
  assert.deepEqual(firebaseNormalize({ a: [], b: {}, c: null, d: 0, e: '', f: [{ x: null }], g: [1, null, 3] }), { d: 0, e: '', g: [1, null, 3] });
});

test('bulutta boş liste anahtarı yoksa cihazdaki boş liste silinmez, buluttaki yeni kayıt gelir', () => {
  const { firebaseNormalize } = require('../js/asil-cloud-merge.js');
  const b = firebaseNormalize({ sales: [], stocks: [{ id: 'A' }] });
  const local = { sales: [], stocks: [{ id: 'A' }] };
  const remote = firebaseNormalize({ sales: [{ id: 'S1' }], stocks: [{ id: 'A' }] });
  assert.deepEqual(mergeState(b, local, remote, []).sales, [{ id: 'S1' }]);
});

test('başka cihazda silinen kayıtlar, bu cihazda boş alanlar farklı görünse de geri gelmez', () => {
  const { firebaseNormalize } = require('../js/asil-cloud-merge.js');
  const full = { stocks: [{ id: 'A', tags: [], note: null }, { id: 'B', tags: [], note: null }], meta: { x: 1 } };
  const base = firebaseNormalize(full);
  const local = firebaseNormalize(JSON.parse(JSON.stringify(full)));
  const remote = firebaseNormalize({ stocks: [{ id: 'C' }], meta: { x: 1, stockReplaceV7: { id: 'R' } } });
  const m = mergeState(base, local, remote, [], ['meta']);
  assert.deepEqual(m.stocks.map((x) => x.id), ['C']);
});
