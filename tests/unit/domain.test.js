'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const domain = require('../../src/shared/domain.js');
const punycode = require('../../src/shared/punycode.js');

test('getSiteKey returns the registrable domain (eTLD+1)', () => {
  const cases = {
    'login.mbank.pl': 'mbank.pl',
    'mbank.pl': 'mbank.pl',
    'konto.pekao.com.pl': 'pekao.com.pl',
    'a.b.c.example.co.uk': 'example.co.uk',
    'evil.github.io': 'evil.github.io',
    'LOGIN.MBANK.PL.': 'mbank.pl',
    'login.gov.pl': 'login.gov.pl',
    '192.168.1.1': '192.168.1.1',
    localhost: 'localhost',
  };
  for (const [host, expected] of Object.entries(cases)) {
    assert.equal(domain.getSiteKey(host), expected, host);
  }
});

test('siteKeyForTrust keeps user-content hosts separate from their company', () => {
  assert.equal(domain.siteKeyForTrust('docs.google.com'), 'docs.google.com');
  assert.equal(domain.siteKeyForTrust('sites.google.com'), 'sites.google.com');
  assert.equal(domain.siteKeyForTrust('firma.sharepoint.com'), 'firma.sharepoint.com');
  assert.equal(domain.siteKeyForTrust('accounts.google.com'), 'google.com');
});

test('isPublicSuffix', () => {
  assert.equal(domain.isPublicSuffix('com'), true);
  assert.equal(domain.isPublicSuffix('com.pl'), true);
  assert.equal(domain.isPublicSuffix('github.io'), true);
  assert.equal(domain.isPublicSuffix('mbank.pl'), false);
});

test('registrableLabel', () => {
  assert.equal(domain.registrableLabel('login.mbank.pl'), 'mbank');
  assert.equal(domain.registrableLabel('pekao.com.pl'), 'pekao');
});

test('isLocalHost covers routers, intranet and dev hosts, but not public sites', () => {
  for (const h of ['localhost', '127.0.0.1', '192.168.0.1', '10.1.2.3', '172.20.0.5', 'router.lan', 'nas.local', 'app.localhost', '::1']) {
    assert.equal(domain.isLocalHost(h), true, h);
  }
  for (const h of ['mbank.pl', '8.8.8.8', '172.32.0.1', 'fcbarcelona.com']) {
    assert.equal(domain.isLocalHost(h), false, h);
  }
});

test('punycode decodes IDN labels', () => {
  assert.equal(punycode.toUnicode('xn--mnchen-3ya.de'), 'münchen.de');
  assert.equal(punycode.toUnicode('xn--bcher-kva.example'), 'bücher.example');
  assert.equal(punycode.toUnicode('xn--pple-43d.com'), 'аpple.com');
  assert.equal(punycode.toUnicode('plain.example.com'), 'plain.example.com');
  assert.equal(punycode.toUnicode('xn--!!!.com'), 'xn--!!!.com');
});
