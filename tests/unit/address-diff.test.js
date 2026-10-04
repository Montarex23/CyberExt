'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { describe, editOps } = require('../../src/shared/address-diff.js');
const mascot = require('../../src/shared/mascot.js');

function show(host) {
  const d = describe(host);
  return d && { text: d.parts.map((p) => (p.gap ? '[_]' : p.m ? `[${p.t}]` : p.t)).join(''), real: d.realSite, note: d.note };
}

test('one missing / extra / swapped / replaced letter is pinpointed', () => {
  assert.deepEqual(show('alegro.pl'), { text: 'a[_]legro.pl', real: 'allegro.pl', note: { key: 'diffMissing', params: ['l'] } });
  assert.deepEqual(show('allegrro.pl'), { text: 'alleg[r]ro.pl', real: 'allegro.pl', note: { key: 'diffExtra', params: ['r'] } });
  assert.deepEqual(show('santnader.pl'), { text: 'sant[na]der.pl', real: 'santander.pl', note: { key: 'diffSwap', params: ['na'] } });
  assert.deepEqual(show('paypa1.com'), { text: 'paypa[1].com', real: 'paypal.com', note: { key: 'diffSub', params: ['1', 'l'] } });
});

test('letters from another alphabet are highlighted in the readable (Unicode) form', () => {
  const d = show('xn--pypal-4ve.com');
  assert.equal(d.text, 'p[а]ypal.com');
  assert.deepEqual(d.note, { key: 'diffHomograph', params: ['а', 'a'] });
});

test('brand used as decoration: the real owner of the address is highlighted', () => {
  assert.equal(show('allegro.pl-oferta24.xyz').text, 'allegro.[pl-oferta24.xyz]');
  assert.deepEqual(show('allegro.pl-oferta24.xyz').note, { key: 'diffOwner', params: ['pl-oferta24.xyz', 'Allegro'] });
  assert.equal(show('mbank-logowanie.com').text, 'mbank[-logowanie.com]');
  assert.equal(show('secure.pkobp-weryfikacja.net').text, 'secure.pkobp[-weryfikacja.net]');
});

test('exact brand name on a scam ending: the ending is highlighted', () => {
  assert.deepEqual(show('mbank.top'), { text: 'mbank.[top]', real: 'mbank.pl', note: { key: 'diffSuffix', params: ['top', 'pl'] } });
});

test('ordinary and official addresses produce no diff', () => {
  assert.equal(describe('example.com'), null);
  assert.equal(describe('allegro.pl'), null);
});

test('editOps describes the transformation fake → real', () => {
  assert.deepEqual(editOps('ab', 'ab').map((o) => o.op), ['keep', 'keep']);
  assert.deepEqual(editOps('abc', 'ac').map((o) => o.op), ['keep', 'extra', 'keep']);
});

test('mascot renders every mood as a decorative SVG', () => {
  for (const mood of mascot.MOODS) {
    const svg = mascot.svg(mood, 64);
    assert.match(svg, /^<svg [^>]*aria-hidden="true"/);
    assert.match(svg, new RegExp(`cg-mascot-${mood}`));
  }
  assert.match(mascot.svg('nonsense'), /cg-mascot-calm/);
});
