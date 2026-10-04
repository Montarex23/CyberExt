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

  function prune(passwords, max = MAX_ENTRIES) {
    const keys = Object.keys(passwords);
    if (keys.length <= max) return;
    keys
      .sort((a, b) => passwords[a].lastUsed - passwords[b].lastUsed)
      .slice(0, keys.length - max)
      .forEach((k) => delete passwords[k]);
  }

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
