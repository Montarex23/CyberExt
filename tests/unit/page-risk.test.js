'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { analyzePage } = require('../../src/shared/page-risk.js');

const ids = (r) => r.findings.map((f) => f.id);

test('ordinary https page without a login form → no findings', () => {
  assert.deepEqual(ids(analyzePage({ url: 'https://przepisy-babci.pl/' })), []);
});

test('lookalike address is reported with the real brand', () => {
  const r = analyzePage({ url: 'https://mbank-logowanie.com/' });
  assert.deepEqual(ids(r), ['lookalike']);
  assert.equal(r.findings[0].brandName, 'mBank');
  assert.equal(r.findings[0].brandSite, 'mbank.pl');
});

test('password field on plain HTTP → insecure, but not on a local router', () => {
  assert.deepEqual(ids(analyzePage({ url: 'http://forum.example.com/login', hasPassword: true })), ['insecure']);
  assert.deepEqual(ids(analyzePage({ url: 'http://192.168.1.1/', hasPassword: true })), []);
  assert.deepEqual(ids(analyzePage({ url: 'http://forum.example.com/', hasPassword: false })), []);
});

test('login form posting to another company → crossForm warning', () => {
  const r = analyzePage({
    url: 'https://sklep.example.com/login',
    hasPassword: true,
    formActions: ['https://collector.evil-site.ru/steal.php'],
  });
  assert.deepEqual(ids(r), ['crossForm']);
  assert.equal(r.findings[0].target, 'evil-site.ru');
});

test('form posting within the same site or company is fine', () => {
  for (const action of ['https://sklep.example.com/auth', 'https://auth.example.com/login']) {
    assert.deepEqual(ids(analyzePage({ url: 'https://example.com/', hasPassword: true, formActions: [action] })), [], action);
  }
  // ING: ing.pl page → login.ingbank.pl (same brand, different domain)
  assert.deepEqual(ids(analyzePage({ url: 'https://www.ing.pl/', hasPassword: true, formActions: ['https://login.ingbank.pl/'] })), []);
});

test('trusted sites get no findings', () => {
  const r = analyzePage({ url: 'https://mbank-logowanie.com/' }, { 'mbank-logowanie.com': 1 });
  assert.deepEqual(ids(r), []);
});

test('danger findings come first', () => {
  const r = analyzePage({
    url: 'http://xn--pypal-4ve.com/',
    hasPassword: true,
  });
  assert.equal(r.findings[0].id, 'homograph');
  assert.equal(r.findings[0].level, 'danger');
  assert.ok(ids(r).includes('insecure'));
});

test('non-web URLs are ignored', () => {
  assert.deepEqual(ids(analyzePage({ url: 'chrome://settings' })), []);
  assert.deepEqual(ids(analyzePage({ url: 'not a url' })), []);
});
