'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../js/asil-mrz.js');

const cd=s=>M.checkDigit(s);
const doc='A12B34567',tc='10000000146';
const l1='I<TUR'+doc+cd(doc)+tc+'<<<<';
const l2='900115'+cd('900115')+'M'+'310520'+cd('310520')+'TUR'+'<<<<<<<<<<<0';
const l3='YILMAZ<<AHMET<CAN<<<<<<<<<<<<<';

test('temiz MRZ tüm alanları verir',()=>{
  const d=M.parse([l1,l2,l3].join('\n'));
  assert.equal(d.documentNumber,doc);assert.equal(d.birthYYMMDD,'900115');assert.equal(d.expiryYYMMDD,'310520');
  assert.equal(d.tckn,tc);assert.equal(d.sex,'M');assert.equal(d.nationality,'TUR');assert.equal(d.fullName,'AHMET CAN YILMAZ');assert.ok(d.complete);
});
test('OCR hataları, araya karışan metin ve bölünmüş satırlar düzeltilir',()=>{
  const noisy=['TÜRKİYE CUMHURİYETİ KİMLİK KARTI',l1.slice(0,15).replace('A12B','A1ZB'),l1.slice(15),l2.replace('900115','9O0115').slice(0,12)+' '+l2.slice(12),l3.replace(/</g,'«'),'footer 2031'].join('\n');
  const d=M.parse(noisy);
  assert.equal(d.documentNumber,doc);assert.equal(d.birthYYMMDD,'900115');assert.equal(d.expiryYYMMDD,'310520');assert.equal(d.tckn,tc);assert.equal(d.fullName,'AHMET CAN YILMAZ');
});
test('kontrol hanesi tutmayan seri no kabul edilmez; okunamayan alan boş kalır',()=>{
  const bad=l1.slice(0,14)+((cd(doc)+1)%10)+l1.slice(15);
  const d=M.parse([bad,l2,l3].join('\n'));
  assert.equal(d.documentNumber,'');assert.equal(d.birthYYMMDD,'900115');assert.equal(d.complete,false);
});
test('tarihler ISO biçimine çevrilir',()=>{
  const now=new Date('2026-10-16');
  assert.equal(M.toIsoDate('900115','birth',now),'1990-01-15');
  assert.equal(M.toIsoDate('050301','birth',now),'2005-03-01');
  assert.equal(M.toIsoDate('310520','expiry',now),'2031-05-20');
});
test('isimdeki dolgu işaretleri (K/L okunmuş) temizlenir',()=>{
  const d=M.parse([l1,l2,'YILMAZ<<AHMET<CAN<KLKLLLLLL<<<<<'].join('\n'));
  assert.equal(d.fullName,'AHMET CAN YILMAZ');
});
test('isimdeki tek harflik K/L dolgu gürültüsü de temizlenir',()=>{
  const d=M.parse([l1,l2,'YILMAZ<<AHMET<CAN<L<<<<<<<<<<<<'].join('\n'));
  assert.equal(d.fullName,'AHMET CAN YILMAZ');
});
