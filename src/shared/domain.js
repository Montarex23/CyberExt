/**
 * CyberGuard — Domain utilities (shared by the service worker, builder and tests).
 *
 *   getSiteKey("login.mbank.pl")        → "mbank.pl"      (eTLD+1 via Public Suffix List)
 *   getSiteKey("konto.pekao.com.pl")    → "pekao.com.pl"
 *   getSiteKey("evil.github.io")        → "evil.github.io" (github.io is a public suffix)
 *   siteKeyForTrust("docs.google.com")  → "docs.google.com" (user-content host, never "google.com")
 */
(function (root, factory) {
  'use strict';
  const CG = (root.CyberGuard = root.CyberGuard || {});
  if (!CG.pslRules && typeof require === 'function') require('./psl-data.js');
  const api = (CG.domain = factory(CG));
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (CG) {
  'use strict';

  /**
   * Hosts that belong to a big company but serve content anyone can publish
   * (Google Forms, Sites, shared files...). Phishing pages live there often,
   * so they must never inherit the trust of the parent brand.
   */
  const USER_CONTENT_HOSTS = new Set([
    'sites.google.com',
    'docs.google.com',
    'drive.google.com',
    'forms.gle',
    'storage.googleapis.com',
    'firebasestorage.googleapis.com',
    'script.google.com',
    'forms.office.com',
    'forms.microsoft.com',
    'onedrive.live.com',
    '1drv.ms',
  ]);
  const USER_CONTENT_SUFFIXES = ['.sharepoint.com', '.googleusercontent.com'];

  let rules = null;
  let wildcards = null;
  let exceptions = null;

  function loadRules() {
    if (rules) return;
    rules = new Set();
    wildcards = new Set();
    exceptions = new Set();
    for (const line of (CG.pslRules || '').split('\n')) {
      if (!line) continue;
      if (line.startsWith('!')) exceptions.add(line.slice(1));
      else if (line.startsWith('*.')) wildcards.add(line.slice(2));
      else rules.add(line);
    }
  }

  /** Lowercases, strips a trailing dot and IPv6 brackets. */
  function normalizeHost(host) {
    return String(host || '')
      .trim()
      .toLowerCase()
      .replace(/\.$/, '')
      .replace(/^\[(.*)\]$/, '$1');
  }

  function isIp(host) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  }

  /** Hostname of a URL, or "" if the URL can't be parsed. */
  function hostFromUrl(urlString) {
    try {
      return normalizeHost(new URL(urlString).hostname);
    } catch {
      return '';
    }
  }

  /** Returns the public suffix of an ASCII host ("pekao.com.pl" → "com.pl"). */
  function getPublicSuffix(host) {
    loadRules();
    const labels = normalizeHost(host).split('.');
    for (let i = 0; i < labels.length; i++) {
      const candidate = labels.slice(i).join('.');
      if (exceptions.has(candidate)) return labels.slice(i + 1).join('.');
      if (rules.has(candidate)) return candidate;
      if (i + 1 < labels.length && wildcards.has(labels.slice(i + 1).join('.'))) return candidate;
    }
    return labels[labels.length - 1]; // Default rule "*".
  }

  /** True if the host ends with a real top-level domain (".pl", ".com"…, not ".pdf"/".html"). */
  function hasKnownTld(host) {
    loadRules();
    const tld = normalizeHost(host).split('.').pop();
    return rules.has(tld) || wildcards.has(tld);
  }

  function isPublicSuffix(host) {
    const h = normalizeHost(host);
    return !!h && getPublicSuffix(h) === h;
  }

  /** Registrable domain (eTLD+1). IPs and single-label hosts are returned unchanged. */
  function getSiteKey(host) {
    const h = normalizeHost(host);
    if (!h || isIp(h) || !h.includes('.')) return h;
    const suffix = getPublicSuffix(h);
    if (suffix === h) return h;
    const rest = h.slice(0, h.length - suffix.length - 1);
    return `${rest.split('.').pop()}.${suffix}`;
  }

  function isUserContentHost(host) {
    const h = normalizeHost(host);
    return USER_CONTENT_HOSTS.has(h) || USER_CONTENT_SUFFIXES.some((s) => h.endsWith(s));
  }

  /** Like getSiteKey, but user-content hosts keep their full name. */
  function siteKeyForTrust(host) {
    const h = normalizeHost(host);
    return isUserContentHost(h) ? h : getSiteKey(h);
  }

  /** "mbank.pl" → "mbank", "pekao.com.pl" → "pekao". */
  function registrableLabel(host) {
    const site = getSiteKey(host);
    if (!site.includes('.')) return site;
    const suffix = getPublicSuffix(site);
    return site === suffix ? site.split('.')[0] : site.slice(0, site.length - suffix.length - 1);
  }

  /** Local / private network addresses (routers, NAS, dev servers). */
  function isLocalHost(host) {
    const h = normalizeHost(host);
    if (!h.includes('.') && !h.includes(':')) return true; // "localhost", intranet names
    if (/\.(localhost|local|lan|home|internal|home\.arpa|test)$/.test(h)) return true;
    if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return h.includes(':');
    const m = h.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }

  return {
    normalizeHost,
    isIp,
    hostFromUrl,
    getPublicSuffix,
    hasKnownTld,
    isPublicSuffix,
    getSiteKey,
    siteKeyForTrust,
    isUserContentHost,
    registrableLabel,
    isLocalHost,
  };
});
