(function (root, factory) {
  'use strict';
  const CG = (root.CyberGuard = root.CyberGuard || {});
  if (typeof require === 'function') {
    if (!CG.domain) require('./domain.js');
    if (!CG.knownSites) require('./known-sites.js');
    if (!CG.linkText) require('./link-text.js');
    if (!CG.addressDiff) require('./address-diff.js');
  }
  const api = (CG.linkCheck = factory(CG));
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (CG) {
  'use strict';

  const REDIRECTORS = [
    { host: /(^|\.)safelinks\.protection\.outlook\.com$/, params: ['url'] },
    { host: /^(www\.)?google\.[a-z.]+$/, path: /^\/url$/, params: ['q', 'url'] },
    { host: /^(l|lm)\.facebook\.com$/, params: ['u'] },
    { host: /^l\.instagram\.com$/, params: ['u'] },
    { host: /^(www\.)?youtube\.com$/, path: /^\/redirect$/, params: ['q'] },
    { host: /^(www\.)?linkedin\.com$/, path: /^\/redir/, params: ['url'] },
    { host: /^steamcommunity\.com$/, path: /^\/linkfilter/, params: ['url', 'u'] },
  ];

  function unwrapRedirect(href, depth = 0) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return href;
    }
    if (depth >= 3) return url.href;
    const host = url.hostname.toLowerCase();
    for (const r of REDIRECTORS) {
      if (!r.host.test(host) || (r.path && !r.path.test(url.pathname))) continue;
      for (const p of r.params) {
        const target = url.searchParams.get(p);
        if (target && /^https?:\/\//i.test(target)) return unwrapRedirect(target, depth + 1);
      }
    }
    return url.href;
  }

  function checkLink(text, href) {
    const shownHost = CG.linkText.hostFromLinkText(text);
    if (!shownHost || !CG.domain.hasKnownTld(shownHost)) return { ok: true };

    const target = unwrapRedirect(href);
    let realHost;
    try {
      const u = new URL(target);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: true };
      realHost = CG.domain.normalizeHost(u.hostname);
    } catch {
      return { ok: true };
    }

    if (CG.knownSites.sameOwnerHost(shownHost, realHost)) return { ok: true };
    return {
      ok: false,
      shown: shownHost.replace(/^www\./, ''),
      real: realHost.replace(/^www\./, ''),
      realUrl: target,
      diff: CG.addressDiff.describe(realHost),
    };
  }

  return { checkLink, unwrapRedirect };
});
