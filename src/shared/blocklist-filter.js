/**
 * CyberGuard — Blocklist filtering (shared by scripts/build-rules.js and the
 * live CERT Polska updater in the service worker).
 *
 * Public phishing feeds sometimes list URLs on huge shared platforms, e.g.
 * "https://docs.google.com/forms/...". Blocking the whole host would break
 * Google Docs for everybody, so such entries are skipped here.
 */
(function (root, factory) {
  'use strict';
  const CG = (root.CyberGuard = root.CyberGuard || {});
  if (typeof require === 'function') {
    if (!CG.domain) require('./domain.js');
    if (!CG.knownSites) require('./known-sites.js');
  }
  const api = (CG.blocklistFilter = factory(CG));
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (CG) {
  'use strict';

  /**
   * Sites where NOTHING may be blocked (neither the site nor any subdomain):
   * big first-party services whose subdomains are all run by the company.
   * Known brands from known-sites.js are added automatically.
   */
  const FIRST_PARTY = [
    'github.com', 'gitlab.com', 'bitbucket.org', 'cloudflare.com', 'dropbox.com', 'box.com', 'wetransfer.com',
    'canva.com', 'notion.so', 'zoom.us', 'slack.com', 'discord.com', 'telegram.org', 'twitter.com', 'x.com',
    'linkedin.com', 'tiktok.com', 'pinterest.com', 'reddit.com', 'wikipedia.org', 'mozilla.org', 'adobe.com',
    'ebay.com', 'ebay.pl', 'aliexpress.com', 'temu.com', 'shein.com', 'booking.com', 'airbnb.com', 'spotify.com',
    'steamcommunity.com', 'steampowered.com', 'roblox.com', 'epicgames.com', 'twitch.tv', 'cloudfront.net',
    'akamaihd.net', 'office.net', 'sharepoint.com', 'googleusercontent.com', 'translate.goog', 'onedrive.live.com',
    'gov.pl', 'edu.pl', 'ceneo.pl', 'empik.com', 'mediaexpert.pl', 'x-kom.pl', 'morele.net', 'rtveuroagd.pl',
    'pyszne.pl', 'otodom.pl', 'otomoto.pl', 'pracuj.pl', 'gumtree.pl', 'sprzedajemy.pl', 'zalando.pl',
    'tvn24.pl', 'tvp.pl', 'polsatnews.pl', 'gazeta.pl', 'o2.pl', 'money.pl', 'bankier.pl', 'pit.pl',
    'cert.pl', 'nask.pl', 'mojeid.pl', 'kir.pl', 'blik.com', 'przelewy24.pl', 'payu.pl', 'payu.com', 'tpay.com',
    'dotpay.pl', 'stripe.com', 'klarna.com', 'apple.com', 'icloud.com', 'whatsapp.net', 'signal.org',
  ];

  /**
   * Platforms where anyone can create "name.platform.com". Blocking a specific
   * subdomain is fine, blocking the platform itself is not.
   */
  const PLATFORMS = [
    'wixsite.com', 'wix.com', 'weebly.com', 'webflow.io', 'wordpress.com', 'square.site', 'godaddysites.com',
    'mystrikingly.com', 'jimdosite.com', 'webnode.page', 'site123.me', 'carrd.co', 'framer.website',
    'glitch.me', 'replit.app', 'repl.co', 'ipfs.io', 'dweb.link', 'cloudflare-ipfs.com', 'r2.dev',
    'blogspot.com', 'firebaseapp.com', 'web.app', 'vercel.app', 'netlify.app', 'pages.dev', 'github.io',
    'herokuapp.com', 'azurewebsites.net', 'amazonaws.com', 'appspot.com', 'workers.dev', 'ngrok.io',
    'ngrok-free.app', 'trycloudflare.com', 'surge.sh', 'gitbook.io', 'typeform.com', 'jotform.com',
    'formstack.com', 'qualtrics.com', 'surveymonkey.com', 'linktr.ee', 'bit.ly', 'tinyurl.com', 'is.gd',
  ];

  const firstParty = new Set([...FIRST_PARTY, ...CG.knownSites.allOfficialSites()].map((s) => CG.domain.getSiteKey(s)));
  const platforms = new Set(PLATFORMS);

  /** Normalizes a feed entry (URL or bare domain) to an ASCII host, or null. */
  function normalizeFeedHost(raw) {
    let s = String(raw || '').trim();
    if (!s || s.startsWith('#')) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
    let host;
    try {
      host = new URL(s).hostname;
    } catch {
      return null;
    }
    host = CG.domain.normalizeHost(host);
    if (host.startsWith('www.')) host = host.slice(4);
    if (!host.includes('.') || CG.domain.isIp(host) || host.length > 253) return null;
    if (!/^[a-z0-9.-]+$/.test(host)) return null;
    return host;
  }

  /**
   * @returns {{ ok: true } | { ok: false, reason: 'public-suffix' | 'first-party' | 'platform' }}
   */
  function blockDecision(host) {
    if (CG.domain.isPublicSuffix(host)) return { ok: false, reason: 'public-suffix' };
    if (platforms.has(host)) return { ok: false, reason: 'platform' };
    const site = CG.domain.getSiteKey(host);
    if (firstParty.has(site)) return { ok: false, reason: 'first-party' };
    if (CG.domain.isUserContentHost(host)) return { ok: false, reason: 'first-party' };
    return { ok: true };
  }

  /**
   * Removes hosts already covered by a blocked parent ("a.evil.com" when
   * "evil.com" is listed) — declarativeNetRequest's requestDomains also
   * matches subdomains.
   */
  function collapseSubdomains(hosts) {
    const set = new Set(hosts);
    return hosts.filter((host) => {
      let rest = host;
      for (let dot = rest.indexOf('.'); dot !== -1; dot = rest.indexOf('.')) {
        rest = rest.slice(dot + 1);
        if (!rest.includes('.')) break;
        if (set.has(rest)) return false;
      }
      return true;
    });
  }

  return { normalizeFeedHost, blockDecision, collapseSubdomains };
});
