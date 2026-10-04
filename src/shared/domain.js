(function (root, factory) {
  'use strict';
  const CG = (root.CyberGuard = root.CyberGuard || {});
  if (!CG.pslRules && typeof require === 'function') require('./psl-data.js');
  const api = (CG.domain = factory(CG));
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (CG) {
  'use strict';

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

  function hostFromUrl(urlString) {
    try {
      return normalizeHost(new URL(urlString).hostname);
    } catch {
      return '';
    }
  }

  function getPublicSuffix(host) {
    loadRules();
    const labels = normalizeHost(host).split('.');
    for (let i = 0; i < labels.length; i++) {
      const candidate = labels.slice(i).join('.');
      if (exceptions.has(candidate)) return labels.slice(i + 1).join('.');
      if (rules.has(candidate)) return candidate;
      if (i + 1 < labels.length && wildcards.has(labels.slice(i + 1).join('.'))) return candidate;
    }
    return labels[labels.length - 1];
  }

  function hasKnownTld(host) {
    loadRules();
    const tld = normalizeHost(host).split('.').pop();
    return rules.has(tld) || wildcards.has(tld);
  }

  function isPublicSuffix(host) {
    const h = normalizeHost(host);
    return !!h && getPublicSuffix(h) === h;
  }

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

  function siteKeyForTrust(host) {
    const h = normalizeHost(host);
    return isUserContentHost(h) ? h : getSiteKey(h);
  }

  function registrableLabel(host) {
    const site = getSiteKey(host);
    if (!site.includes('.')) return site;
    const suffix = getPublicSuffix(site);
    return site === suffix ? site.split('.')[0] : site.slice(0, site.length - suffix.length - 1);
  }

  function isLocalHost(host) {
    const h = normalizeHost(host);
    if (!h.includes('.') && !h.includes(':')) return true;
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
