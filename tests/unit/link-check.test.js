'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { hostFromLinkText, looseSameHost } = require('../../src/shared/link-text.js');
const { checkLink, unwrapRedirect } = require('../../src/shared/link-check.js');

test('hostFromLinkText recognises addresses written as link text', () => {
  const cases = {
    'https://www.mbank.pl/logowanie': 'www.mbank.pl',
    'www.mbank.pl': 'www.mbank.pl',
    'allegro.pl': 'allegro.pl',
    'ALLEGRO.PL/oferta/123': 'allegro.pl',
    '(inpost.pl)': 'inpost.pl',
    'mbank.pl.': 'mbank.pl',
    'http://xn--pypal-4ve.com/': 'xn--pypal-4ve.com',
    'https://github.com/x/y/archive.zip': 'github.com',
  };
  for (const [text, host] of Object.entries(cases)) assert.equal(hostFromLinkText(text), host, text);
});

test('hostFromLinkText ignores ordinary text, e-mails, files and numbers', () => {
  for (const text of ['Kliknij tutaj', 'Zaloguj się na mbank.pl', 'jan@firma.pl', 'README.md', 'faktura.zip',
    'v2.0', '192.168.0.1', '', 'e.g.', 'np.']) {
    assert.equal(hostFromLinkText(text), null, text);
  }
});

test('looseSameHost ignores www and subdomains', () => {
  assert.ok(looseSameHost('www.mbank.pl', 'mbank.pl'));
  assert.ok(looseSameHost('mbank.pl', 'online.mbank.pl'));
  assert.ok(!looseSameHost('mbank.pl', 'mbank-weryfikacja.xyz'));
});

test('deceptive link: text shows the bank, link goes elsewhere', () => {
  const v = checkLink('https://www.mbank.pl/logowanie', 'https://mbank-weryfikacja.xyz/login');
  assert.deepEqual({ ok: v.ok, shown: v.shown, real: v.real }, { ok: false, shown: 'mbank.pl', real: 'mbank-weryfikacja.xyz' });
});

test('honest links and links within the same company are fine', () => {
  assert.equal(checkLink('mbank.pl', 'https://online.mbank.pl/').ok, true);
  assert.equal(checkLink('www.pkobp.pl', 'https://www.ipko.pl/').ok, true); // PKO: two domains, one company
  assert.equal(checkLink('allegro.pl', 'https://allegrolokalnie.pl/').ok, true);
  assert.equal(checkLink('Kliknij tutaj', 'https://evil.example/').ok, true); // text isn't an address
  assert.equal(checkLink('raport.pdf', 'https://drive.example.com/raport').ok, true); // not a real TLD
});

test('mail redirectors are unwrapped before comparing', () => {
  const safe = 'https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fwww.mbank.pl%2F&data=abc';
  assert.equal(unwrapRedirect(safe), 'https://www.mbank.pl/');
  assert.equal(checkLink('www.mbank.pl', safe).ok, true);

  const evil = 'https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fmbank-weryfikacja.xyz%2F';
  const v = checkLink('www.mbank.pl', evil);
  assert.equal(v.ok, false);
  assert.equal(v.real, 'mbank-weryfikacja.xyz'); // Shows the REAL target, not outlook.com

  assert.equal(checkLink('allegro.pl', 'https://www.google.com/url?q=https://allegro.pl/oferta&sa=D').ok, true);
  assert.equal(checkLink('allegro.pl', 'https://l.facebook.com/l.php?u=https%3A%2F%2Fallegro.pl%2F').ok, true);
});

test('link shorteners and trackers are reported (the text promises another address)', () => {
  assert.equal(checkLink('www.mbank.pl', 'https://bit.ly/3abcd').ok, false);
});
