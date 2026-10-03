'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const filter = require('../../src/shared/blocklist-filter.js');
const builder = require('../../scripts/build-rules.js');

test('normalizeFeedHost accepts URLs and bare domains, rejects junk', () => {
  assert.equal(filter.normalizeFeedHost('https://WWW.Evil-Bank.com/login?x=1'), 'evil-bank.com');
  assert.equal(filter.normalizeFeedHost('inpost-doplata.top'), 'inpost-doplata.top');
  assert.equal(filter.normalizeFeedHost('http://xn--pypal-4ve.com/'), 'xn--pypal-4ve.com');
  for (const bad of ['', '# comment', 'http://192.168.0.1/', 'localhost', 'http://[::1]/', 'not a host!']) {
    assert.equal(filter.normalizeFeedHost(bad), null, bad);
  }
});

test('blockDecision never blocks big platforms or known companies', () => {
  assert.deepEqual(filter.blockDecision('docs.google.com'), { ok: false, reason: 'first-party' });
  assert.deepEqual(filter.blockDecision('sites.google.com'), { ok: false, reason: 'first-party' });
  assert.deepEqual(filter.blockDecision('mbank.pl'), { ok: false, reason: 'first-party' });
  assert.deepEqual(filter.blockDecision('github.io'), { ok: false, reason: 'public-suffix' });
  assert.deepEqual(filter.blockDecision('weebly.com'), { ok: false, reason: 'platform' });
  // ...but a user's page on such a platform can be blocked.
  assert.deepEqual(filter.blockDecision('fake-bank.github.io'), { ok: true });
  assert.deepEqual(filter.blockDecision('fake-bank.weebly.com'), { ok: true });
  assert.deepEqual(filter.blockDecision('mbank-logowanie.com'), { ok: true });
});

test('collapseSubdomains drops hosts already covered by a parent', () => {
  assert.deepEqual(filter.collapseSubdomains(['evil.com', 'a.evil.com', 'b.c.evil.com', 'other.pl']), ['evil.com', 'other.pl']);
});

test('parseCertJson keeps active entries, newest first', () => {
  const json = JSON.stringify([
    { DomainAddress: 'old.pl', InsertDate: '2025-01-01T00:00:00+00:00', DeleteDate: null },
    { DomainAddress: 'removed.pl', InsertDate: '2026-01-01T00:00:00+00:00', DeleteDate: '2026-02-01T00:00:00+00:00' },
    { DomainAddress: 'new.pl', InsertDate: '2026-09-01T00:00:00+00:00', DeleteDate: null },
  ]);
  assert.deepEqual(builder.parseCertJson(json), ['new.pl', 'old.pl']);
});

test('collect + buildRulesets: dedupe across sources, per-domain then archive chunks', () => {
  const { entries, skipped, perSource } = builder.collect([
    { id: 'openphish', raw: ['https://evil-a.com/x', 'https://docs.google.com/forms/abc', 'https://evil-a.com/y'] },
    { id: 'cert_pl', raw: ['evil-a.com', 'evil-b.pl', 'sub.evil-b.pl', 'evil-c.pl', 'evil-d.pl'] },
  ]);
  assert.deepEqual(entries.map((e) => `${e.src}:${e.host}`), ['openphish:evil-a.com', 'cert_pl:evil-b.pl', 'cert_pl:evil-c.pl', 'cert_pl:evil-d.pl']);
  assert.deepEqual(skipped['first-party'], ['docs.google.com']);
  assert.deepEqual(perSource, { openphish: 1, cert_pl: 4 });

  const { main, archive } = builder.buildRulesets(entries, 2);
  assert.equal(main.length, 2);
  assert.deepEqual(main[0], {
    id: 1,
    priority: 1,
    action: { type: 'redirect', redirect: { extensionPath: '/pages/warning/warning.html?domain=evil-a.com&src=openphish' } },
    condition: { requestDomains: ['evil-a.com'], resourceTypes: ['main_frame'] },
  });
  assert.equal(archive.length, 1);
  assert.deepEqual(archive[0].condition.requestDomains, ['evil-c.pl', 'evil-d.pl']);
  assert.equal(archive[0].action.redirect.extensionPath, '/pages/warning/warning.html?src=cert_pl');
});
