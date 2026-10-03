/**
 * CyberGuard — Password reuse logic (pure functions, no chrome.* APIs).
 *
 * Storage shape (chrome.storage.local → "passwords"):
 *   { [pbkdf2Hash]: { sites: ["mbank.pl", "allegro.pl"], created: ms, lastUsed: ms } }
 *
 * Verdicts for "this password is being typed on site X":
 *   none   — never seen this password (it will be remembered after login)
 *   ok     — used here before (or on another site of the same company)
 *   reuse  — also used on other ordinary sites → gentle tip, never blocks
 *   danger — also used on a KNOWN important site (bank, e-mail, gov...) and this
 *            site is NOT that company → blocking warning
 */
(function (root, factory) {
  'use strict';
  const CG = (root.CyberGuard = root.CyberGuard || {});
  if (typeof require === 'function') {
    if (!CG.domain) require('./domain.js');
    if (!CG.knownSites) require('./known-sites.js');
  }
  const api = (CG.passwordLogic = factory(CG));
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (CG) {
  'use strict';

  const MAX_ENTRIES = 500;
  const MAX_SITES_PER_PASSWORD = 50;
  const HASH_RE = /^[0-9a-f]{64}$/;

  function isValidHash(hash) {
    return typeof hash === 'string' && HASH_RE.test(hash);
  }

  /** Is this password used on a site that belongs to a known company? */
  function importantSitesOf(entry) {
    return entry.sites
      .map((site) => ({ site, brand: CG.knownSites.brandForSite(site) }))
      .filter((x) => x.brand);
  }

  function evaluate(passwords, hash, host) {
    const site = CG.domain.siteKeyForTrust(host);
    const entry = passwords[hash];
    if (!entry) return { level: 'none', site };

    if (entry.sites.some((s) => CG.knownSites.sameOwnerSite(s, site))) return { level: 'ok', site };

    const important = importantSitesOf(entry);
    const currentIsOfficial = !!CG.knownSites.brandForSite(site);
    if (important.length && !currentIsOfficial) {
      return {
        level: 'danger',
        site,
        brandName: important[0].brand.name,
        brandSite: important[0].site,
      };
    }
    return { level: 'reuse', site, sites: entry.sites.slice(0, 3) };
  }

  /** Adds the site to the password's list (creating the entry if needed). Returns true if changed. */
  function remember(passwords, hash, host, now = Date.now()) {
    const site = CG.domain.siteKeyForTrust(host);
    if (!site) return false;
    const entry = passwords[hash];
    if (!entry) {
      passwords[hash] = { sites: [site], created: now, lastUsed: now };
      prune(passwords);
      return true;
    }
    entry.lastUsed = now;
    if (!entry.sites.includes(site)) {
      entry.sites.push(site);
      if (entry.sites.length > MAX_SITES_PER_PASSWORD) entry.sites.shift();
    }
    return true;
  }

  /** Keeps storage bounded: drops the least recently used entries. */
  function prune(passwords, max = MAX_ENTRIES) {
    const keys = Object.keys(passwords);
    if (keys.length <= max) return;
    keys
      .sort((a, b) => passwords[a].lastUsed - passwords[b].lastUsed)
      .slice(0, keys.length - max)
      .forEach((k) => delete passwords[k]);
  }

  /** Data for the options page — never exposes full hashes. */
  function summarize(passwords) {
    return Object.entries(passwords)
      .sort(([, a], [, b]) => b.lastUsed - a.lastUsed)
      .map(([hash, entry]) => ({
        id: hash.slice(0, 16),
        sites: entry.sites.slice(),
        important: importantSitesOf(entry).length > 0,
        lastUsed: entry.lastUsed,
      }));
  }

  /** Removes the entry whose hash starts with the given 16-char id. */
  function forget(passwords, id) {
    const key = Object.keys(passwords).find((h) => h.slice(0, 16) === id);
    if (!key) return false;
    delete passwords[key];
    return true;
  }

  function isUsedOnSite(passwords, host) {
    const site = CG.domain.siteKeyForTrust(host);
    return Object.values(passwords).some((e) => e.sites.some((s) => CG.knownSites.sameOwnerSite(s, site)));
  }

  return { evaluate, remember, prune, summarize, forget, isUsedOnSite, isValidHash, MAX_ENTRIES };
});
