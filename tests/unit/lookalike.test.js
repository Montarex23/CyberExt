'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const lookalike = require('../../src/shared/lookalike.js');
const knownSites = require('../../src/shared/known-sites.js');

function brandOf(host) {
  const r = lookalike.analyzeHost(host);
  return r && r.brand ? r.brand.id : null;
}

test('detects brand names inside foreign domains', () => {
  assert.equal(brandOf('mbank-logowanie.com'), 'mbank');
  assert.equal(brandOf('allegro.pl-oferta24.xyz'), 'allegro');
  assert.equal(brandOf('inpost-doplata.top'), 'inpost');
  assert.equal(brandOf('olx.pl-dostawa.com'), 'olx');
  assert.equal(brandOf('gov-pl-zwrot.com'), 'govpl');
  assert.equal(brandOf('secure.pkobp-weryfikacja.net'), 'pko');
});

test('detects one-letter typos and digit swaps', () => {
  assert.equal(brandOf('alegro.pl'), 'allegro');
  assert.equal(brandOf('paypa1.com'), 'paypal');
  assert.equal(brandOf('santnader.pl'), 'santander');
});

test('homographs (other alphabets) are reported as danger', () => {
  const r = lookalike.analyzeHost('xn--pypal-4ve.com');
  assert.equal(r.kind, 'homograph');
  assert.equal(r.level, 'danger');
  assert.equal(r.brand.id, 'paypal');
});

test('official sites and ordinary domains are not flagged', () => {
  for (const host of [
    'mbank.pl', 'online.mbank.pl', 'allegro.pl', 'allegrolokalnie.pl', 'pkobp.pl', 'ipko.pl', 'login.gov.pl',
    'accounts.google.com', 'google.de', 'amazon.de', 'olx.ua', 'shopping.com', 'revolution-shop.pl',
    'apple-pie.pl', 'google-ads-agency.pl', 'energetyka.pl', 'wp.mojafirma.pl', 'docs.google.com',
    'xn--mnchen-3ya.de', 'localhost', '192.168.1.1',
  ]) {
    assert.equal(lookalike.analyzeHost(host), null, host);
  }
});

test('legitimate company domains (other countries, subsidiaries) are not flagged', () => {
  const { LEGIT_SAMPLES } = require('./legit-domains.js');
  const flagged = LEGIT_SAMPLES.filter((h) => lookalike.analyzeHost(h));
  assert.deepEqual(flagged, []);
});

test('brand on free hosting, scam endings or with investment lures is flagged', () => {
  const { SUSPICIOUS_SAMPLES } = require('./legit-domains.js');
  for (const h of SUSPICIOUS_SAMPLES) assert.ok(lookalike.analyzeHost(h), h);
  assert.equal(brandOf('mbank.top'), 'mbank');
  assert.equal(brandOf('allegro.oferty-xyz.com'), 'allegro');
});

test('short or common brand words need a suspicious context', () => {
  assert.equal(brandOf('ing-logowanie.xyz'), 'ing');
  assert.equal(brandOf('ing-art.pl'), null);
  assert.equal(brandOf('apple-verify.xyz'), 'apple');
  assert.equal(brandOf('dhl-paczka.pl'), 'dhl');
});

test('mixed alphabets without a brand still produce a warning', () => {
  const host = new URL('http://tеst-shop.com').hostname;
  const r = lookalike.analyzeHost(host);
  assert.equal(r.kind, 'mixedScripts');
  assert.equal(r.level, 'warn');
});

test('editDistance handles transpositions', () => {
  assert.equal(lookalike.editDistance('allegro', 'alelgro', 2), 1);
  assert.equal(lookalike.editDistance('allegro', 'allegro', 2), 0);
  assert.equal(lookalike.editDistance('allegro', 'xyz', 1), 2);
});

test('every known site has a name and at least one domain', () => {
  for (const site of knownSites.SITES) {
    assert.ok(site.name && site.domains.length, site.id);
  }
});
