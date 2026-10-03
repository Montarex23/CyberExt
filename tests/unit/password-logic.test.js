'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const logic = require('../../src/shared/password-logic.js');
const cryptoApi = require('../../src/shared/crypto.js');

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

test('unknown password → none', () => {
  assert.equal(logic.evaluate({}, H1, 'example.com').level, 'none');
});

test('same site or same company → ok', () => {
  const pw = {};
  logic.remember(pw, H1, 'online.mbank.pl');
  assert.equal(logic.evaluate(pw, H1, 'login.mbank.pl').level, 'ok');
  assert.equal(logic.evaluate(pw, H1, 'mbank.com').level, 'ok'); // Same brand, other domain.
});

test('bank password on a foreign site → danger with the bank name', () => {
  const pw = {};
  logic.remember(pw, H1, 'online.mbank.pl');
  const v = logic.evaluate(pw, H1, 'mbank-logowanie.com');
  assert.equal(v.level, 'danger');
  assert.equal(v.brandName, 'mBank');
  assert.equal(v.brandSite, 'mbank.pl');
  assert.equal(v.site, 'mbank-logowanie.com');
});

test('Google password typed into a Google Form → danger (user content is not Google)', () => {
  const pw = {};
  logic.remember(pw, H1, 'accounts.google.com');
  assert.equal(logic.evaluate(pw, H1, 'docs.google.com').level, 'danger');
});

test('ordinary password reused on another ordinary site → reuse (gentle tip)', () => {
  const pw = {};
  logic.remember(pw, H1, 'forum-wedkarskie.pl');
  const v = logic.evaluate(pw, H1, 'sklep-z-butami.pl');
  assert.equal(v.level, 'reuse');
  assert.deepEqual(v.sites, ['forum-wedkarskie.pl']);
});

test('bank password reused on ANOTHER official site → reuse, not danger', () => {
  const pw = {};
  logic.remember(pw, H1, 'mbank.pl');
  assert.equal(logic.evaluate(pw, H1, 'allegro.pl').level, 'reuse');
});

test('remember adds sites once and bounds storage', () => {
  const pw = {};
  logic.remember(pw, H1, 'a.example.com', 1);
  logic.remember(pw, H1, 'b.example.com', 2);
  assert.deepEqual(pw[H1].sites, ['example.com']);
  for (let i = 0; i < logic.MAX_ENTRIES + 5; i++) {
    logic.remember(pw, i.toString(16).padStart(64, '0'), `site${i}.pl`, 10 + i);
  }
  assert.equal(Object.keys(pw).length, logic.MAX_ENTRIES);
});

test('summarize and forget never need the full hash', () => {
  const pw = {};
  logic.remember(pw, H1, 'mbank.pl', 1);
  logic.remember(pw, H2, 'forum.pl', 2);
  const summary = logic.summarize(pw);
  assert.equal(summary[0].sites[0], 'forum.pl'); // Most recent first.
  assert.equal(summary[1].important, true);
  assert.equal(summary[0].id.length, 16);
  assert.equal(logic.forget(pw, summary[1].id), true);
  assert.equal(pw[H1], undefined);
});

test('isValidHash rejects anything that is not 64 hex chars', () => {
  assert.equal(logic.isValidHash(H1), true);
  assert.equal(logic.isValidHash('abc'), false);
  assert.equal(logic.isValidHash(42), false);
});

test('fingerprint is deterministic per salt and differs between salts', async () => {
  const salt1 = cryptoApi.newSaltBase64();
  const salt2 = cryptoApi.newSaltBase64();
  const a = await cryptoApi.fingerprint('MojeHaslo123!', salt1);
  const b = await cryptoApi.fingerprint('MojeHaslo123!', salt1);
  const c = await cryptoApi.fingerprint('MojeHaslo123!', salt2);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
});
