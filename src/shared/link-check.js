/**
 * CyberGuard — Deceptive link check (service worker side).
 *
 * A link whose visible text is a web address ("www.mbank.pl") but whose real
 * target belongs to someone else ("mbank-weryfikacja.xyz") is a classic
 * phishing trick in e-mails and messages.
 *
 * Mail services wrap links in their own redirectors (Outlook Safe Links,
 * Google, Facebook…). Those are unwrapped first, so a genuine link in an
 * Outlook e-mail is not reported.
 */
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

  /** Redirectors that carry the real destination in a query parameter. */
  const REDIRECTORS = [
    { host: /(^|\.)safelinks\.protection\.outlook\.com$/, params: ['url'] },
    { host: /^(www\.)?google\.[a-z.]+$/, path: /^\/url$/, params: ['q', 'url'] },
    { host: /^(l|lm)\.facebook\.com$/, params: ['u'] },
    { host: /^l\.instagram\.com$/, params: ['u'] },
    { host: /^(www\.)?youtube\.com$/, path: /^\/redirect$/, params: ['q'] },
    { host: /^(www\.)?linkedin\.com$/, path: /^\/redir/, params: ['url'] },
    { host: /^steamcommunity\.com$/, path: /^\/linkfilter/, params: ['url', 'u'] },
  ];

  /** Follows known redirectors (max 3 levels). Returns the final URL string. */
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

  /**
   * @param {string} text  Visible text of the link.
   * @param {string} href  Absolute URL the link points to.
   * @returns {{ ok: true } | { ok: false, shown: string, real: string, realUrl: string }}
   */
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
      // If the real target imitates a known company, show exactly how.
      diff: CG.addressDiff.describe(realHost),
    };
  }

  return { checkLink, unwrapRedirect };
});
