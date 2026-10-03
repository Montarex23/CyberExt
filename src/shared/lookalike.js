/**
 * CyberGuard — Lookalike / homograph domain detection (100% offline).
 *
 * Catches addresses that pretend to be a known site:
 *   mbank-logowanie.com        → keyword "mbank" in a foreign domain
 *   allegro.pl-oferta24.xyz    → "allegro" + fake ".pl" + cheap TLD
 *   alegro.pl / paypa1.com     → one-letter typo / digit swap
 *   xn--pypal-4ve.com          → "pаypal" written with a Cyrillic "а" (homograph)
 */
(function (root, factory) {
  'use strict';
  const CG = (root.CyberGuard = root.CyberGuard || {});
  if (typeof require === 'function') {
    if (!CG.punycode) require('./punycode.js');
    if (!CG.domain) require('./domain.js');
    if (!CG.knownSites) require('./known-sites.js');
  }
  const api = (CG.lookalike = factory(CG));
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (CG) {
  'use strict';

  /** Non-Latin letters that look like Latin ones. */
  const CONFUSABLES = {
    // Cyrillic
    'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'з': '3', 'і': 'i', 'ї': 'i', 'ј': 'j', 'к': 'k', 'м': 'm',
    'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x', 'ѕ': 's', 'ԁ': 'd', 'һ': 'h',
    'ӏ': 'l', 'ԛ': 'q', 'ԝ': 'w', 'ь': 'b', 'п': 'n', 'г': 'r',
    // Greek
    'α': 'a', 'β': 'b', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u',
    'χ': 'x', 'γ': 'y', 'η': 'n', 'ω': 'w',
    // Latin look-alikes that do not decompose
    'ı': 'i', 'ł': 'l', 'ø': 'o', 'đ': 'd', 'ɑ': 'a', 'ɡ': 'g', 'ℓ': 'l', 'ß': 'ss',
  };

  /** Digits/symbols used instead of letters ("paypa1", "a11egro"). */
  const LEET = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a' };

  /**
   * Word fragments scammers put next to a brand ("mbank-logowanie", "inpostdoplata24").
   * A brand name WITHOUT any of these (e.g. "santanderleasing.pl", "netflixtechblog.com")
   * is usually the company itself, so we stay quiet — measured on the CERT Polska list
   * with scripts/measure-lookalike.js.
   */
  const LURE_FRAGMENTS = [
    'logow', 'login', 'logon', 'signin', 'zaloguj', 'konto', 'account', 'secure', 'bezpiecz', 'weryfik', 'verif',
    'potwierdz', 'auth', 'autoryz', 'doplat', 'oplat', 'platnos', 'payment', 'zwrot', 'refund', 'odbior', 'paczk',
    'przesyl', 'dostaw', 'delivery', 'kurier', 'blik', 'blokad', 'odblok', 'aktualiz', 'update', 'pomoc',
    'support', 'help', 'serwis', 'online', 'portfel', 'wallet', 'nagrod', 'wygran', 'bonus', 'prezent', 'oferta',
    'okazj', 'promoc', 'premia', 'klient', 'panel', 'zamow', 'order', 'faktur', 'invoice', 'przelew', 'transakc',
    'sprzedaj', 'kupuj', 'lokaln', 'ogloszen', 'checkout', 'confirm', 'alert', 'unlock', 'reset', 'poczta',
    'poland', 'shop', 'seller', 'trade', 'invest', 'crypto', 'coin', 'profit', 'earn',
  ];

  /** Tokens that fake a domain ending inside the name: "allegro.pl-oferta.com". */
  const FAKE_TLD_TOKENS = new Set(['pl', 'com', 'net', 'eu', 'org']);

  /** TLDs that are cheap and heavily abused by scammers. */
  const ABUSED_TLDS = new Set([
    'xyz', 'top', 'shop', 'online', 'site', 'icu', 'cfd', 'sbs', 'click', 'buzz', 'live', 'info', 'store',
    'app', 'rest', 'lol', 'cyou', 'bond', 'help', 'support', 'services', 'website', 'space', 'fun', 'monster',
    'quest', 'skin', 'mom', 'lat', 'uno', 'pw', 'tk', 'ml', 'ga', 'cf', 'gq', 'cc', 'ws', 'su', 'win', 'vip',
    'cam', 'bar', 'beauty', 'hair', 'autos', 'boats', 'financial',
  ]);

  /** Free hosting where anyone gets "name.platform" in minutes — a brand there is never official. */
  const FREE_HOSTING = new Set([
    'vercel.app', 'netlify.app', 'pages.dev', 'github.io', 'web.app', 'firebaseapp.com', 'workers.dev', 'glitch.me',
    'repl.co', 'herokuapp.com', 'blogspot.com', 'onrender.com', 'fly.dev', 'surge.sh', 'r2.dev', 'ngrok-free.app',
  ]);

  function isScamEnding(tld) {
    return ABUSED_TLDS.has(tld) || FREE_HOSTING.has(tld);
  }

  function hasLatin(s) {
    return /[a-zÀ-ɏ]/i.test(s);
  }
  function hasCyrillic(s) {
    return /[Ѐ-ӿ]/.test(s);
  }
  function hasGreek(s) {
    return /[Ͱ-Ͽ]/.test(s);
  }

  /** A single label mixing Latin with Cyrillic/Greek letters — classic homograph trick. */
  function hasMixedScripts(label) {
    const scripts = [hasLatin(label), hasCyrillic(label), hasGreek(label)].filter(Boolean).length;
    return scripts > 1;
  }

  /** Maps look-alike characters to plain ASCII ("ра у pal" → "paypal", "żabka" → "zabka"). */
  function skeleton(text) {
    let out = '';
    for (const ch of text.normalize('NFD')) {
      if (/[̀-ͯ]/.test(ch)) continue; // Combining accents.
      out += CONFUSABLES[ch] || ch;
    }
    return out.toLowerCase();
  }

  function unleet(text) {
    return text.replace(/[0134578@]/g, (c) => LEET[c]);
  }

  /** Optimal-string-alignment distance, capped (returns max+1 if larger). */
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const d = [];
    for (let i = 0; i <= a.length; i++) d.push([i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      let rowMin = Infinity;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
        d[i][j] = v;
        rowMin = Math.min(rowMin, v);
      }
      if (rowMin > max) return max + 1;
    }
    return d[a.length][b.length];
  }

  function parseKeyword(raw) {
    if (raw.startsWith('=')) return { word: raw.slice(1), mode: 'token-context' };
    if (raw.startsWith('~')) return { word: raw.slice(1), mode: 'token-typo' };
    return { word: raw, mode: 'full' };
  }

  /**
   * Breaks a host into comparable labels. Each label has two spellings:
   *   plain — look-alike letters mapped to Latin ("pаypal" → "paypal")
   *   leet  — additionally digits mapped to letters ("paypa1" → "paypal")
   * A brand reached only through the "leet" spelling is a disguise, not the brand.
   */
  function describeHost(host) {
    const ascii = CG.domain.normalizeHost(host);
    const unicode = CG.punycode.toUnicode(ascii);
    const suffix = CG.domain.getPublicSuffix(ascii);
    const suffixLabels = suffix.split('.').length;
    const labelsU = unicode.split('.');
    const nameLabels = labelsU.slice(0, Math.max(labelsU.length - suffixLabels, 0));

    const labels = nameLabels.map((label, i) => {
      const plain = skeleton(label);
      return { plain, leet: unleet(plain), isMain: i === nameLabels.length - 1 };
    });

    return {
      ascii,
      unicode,
      tld: suffix,
      isIdn: ascii !== unicode.toLowerCase(),
      mixedScripts: labelsU.some(hasMixedScripts),
      labels,
      allText: labels.map((l) => l.plain).join('.'),
    };
  }

  /**
   * Finds a brand keyword in the host.
   * @returns {null | { how: 'exact'|'token'|'contains'|'typo', disguised: boolean, inMain: boolean, rest: string }}
   *   rest — the name with the brand word removed (used to look for lure words)
   */
  function findKeyword(info, raw) {
    const { word, mode } = parseKeyword(raw);
    let best = null;
    const consider = (m) => {
      const rank = { exact: 0, token: 1, contains: 2, typo: 3 };
      if (!best || rank[m.how] < rank[best.how] || (m.inMain && !best.inMain && m.how === best.how)) best = m;
    };

    for (const label of info.labels) {
      for (const [spelling, disguised] of [[label.plain, false], [label.leet, true]]) {
        if (disguised && spelling === label.plain) continue;
        const joined = spelling.replace(/-/g, '');
        const tokens = spelling.split('-');
        const rest = () => info.allText.replace(label.plain, joined.replace(word, ' ').trim() || ' ');
        if (label.isMain && joined === word) {
          consider({ how: 'exact', disguised, inMain: true, rest: rest() });
        } else if (tokens.includes(word)) {
          consider({ how: 'token', disguised, inMain: label.isMain, rest: rest() });
        } else if (mode === 'full' && word.length >= 5 && joined.includes(word)) {
          consider({ how: 'contains', disguised, inMain: label.isMain, rest: rest() });
        } else if (mode !== 'token-context' && label.isMain && word.length >= 6 && editDistance(joined, word, 1) === 1) {
          consider({ how: 'typo', disguised, inMain: true, rest: rest() });
        }
      }
    }
    return best;
  }

  /** Signs that a brand name is being abused rather than used by the company. */
  function isSuspicious(info, match, mode) {
    if (isScamEnding(info.tld)) return true;
    // Distinctive brand only in a subdomain: "allegro.oferty-xyz.com". Not for short
    // common words ("wp.mojafirma.pl" is just someone's WordPress).
    if (!match.inMain && mode !== 'token-context') return true;
    const rest = match.rest;
    if (/\d{2,}/.test(rest)) return true; // "inpost-48213", "olx24-7"
    if (rest.split(/[.\s-]+/).some((t) => FAKE_TLD_TOKENS.has(t))) return true; // "allegro-pl-oferta"
    return LURE_FRAGMENTS.some((f) => rest.includes(f));
  }

  /**
   * Returns null when the host looks fine, otherwise:
   *   { kind: 'homograph' | 'lookalike', level: 'danger' | 'warn', brand, matchedBy }
   * or { kind: 'mixedScripts', level: 'warn' } for odd alphabets without a brand match.
   */
  function analyzeHost(host) {
    const h = CG.domain.normalizeHost(host);
    if (!h || CG.domain.isIp(h) || CG.domain.isLocalHost(h)) return null;
    if (CG.knownSites.brandForHost(h)) return null; // Official site.

    const info = describeHost(h);
    const homograph = info.isIdn || info.mixedScripts;

    for (const brand of CG.knownSites.SITES) {
      for (const kw of brand.keywords) {
        const m = findKeyword(info, kw);
        if (!m) continue;

        let flagged;
        if (homograph || m.disguised || m.how === 'typo') {
          flagged = true; // Look-alike letters, digits for letters, one-letter typo.
        } else if (m.how === 'exact') {
          // "mbank.cz", "santander.de": the company in another country — unless a scam ending.
          flagged = isScamEnding(info.tld);
        } else {
          flagged = isSuspicious(info, m, parseKeyword(kw).mode);
        }
        if (!flagged) continue;

        return {
          kind: homograph ? 'homograph' : 'lookalike',
          level: homograph ? 'danger' : 'warn',
          brand: { id: brand.id, name: brand.name, site: brand.domains[0] },
          matchedBy: m.disguised && m.how !== 'typo' ? 'disguised' : m.how,
        };
      }
    }
    if (info.mixedScripts) return { kind: 'mixedScripts', level: 'warn', brand: null, matchedBy: 'scripts' };
    return null;
  }

  return { analyzeHost, skeleton, editDistance, hasMixedScripts, describeHost };
});
