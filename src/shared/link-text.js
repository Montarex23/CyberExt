/**
 * CyberGuard — "Does this link's text look like a web address?"
 *
 * Loaded in the content script (fast, synchronous pre-check on click) and in
 * the service worker (the real decision, see link-check.js). No dependencies.
 *
 *   hostFromLinkText("https://www.mbank.pl/logowanie") → "www.mbank.pl"
 *   hostFromLinkText("allegro.pl")                     → "allegro.pl"
 *   hostFromLinkText("Kliknij tutaj")                  → null
 *   hostFromLinkText("jan@firma.pl")                   → null  (e-mail)
 *   hostFromLinkText("README.md")                      → null  (file name)
 */
(function (root, factory) {
  'use strict';
  const CG = (root.CyberGuard = root.CyberGuard || {});
  const api = (CG.linkText = factory());
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // Non-ASCII letters allowed in domain names (IDN). Built from char codes: Chrome
  // rejects content scripts containing the literal noncharacter U+FFFF.
  const U = `${String.fromCharCode(0xa1)}-${String.fromCharCode(0xfffd)}`;

  // [scheme://] host [:port] [/path?query#hash] — the whole text, nothing else.
  const URLISH = new RegExp(
    String.raw`^(?:(https?):\/\/)?((?:[a-z0-9${U}](?:[a-z0-9${U}-]{0,61}[a-z0-9${U}])?\.)+[a-z${U}][a-z0-9${U}-]{1,62})\.?(?::\d{1,5})?(?:[/?#]\S*)?$`,
    'i'
  );

  /** Real TLDs that are much more often file extensions ("README.md", "film.mov"). */
  const FILE_LIKE_TLDS = new Set(['zip', 'mov', 'md', 'py', 'rs', 'sh', 'pm']);

  const LEADING = /^[(<[{"'«„‚]+/;
  const TRAILING = /[.,;:!?)\]}>"'»”’]+$/;

  /** Hostname written in the link's visible text, or null if the text isn't an address. */
  function hostFromLinkText(raw) {
    const text = String(raw || '').trim().replace(LEADING, '').replace(TRAILING, '');
    if (!text || text.length > 300 || /\s/.test(text) || text.includes('@')) return null;
    const m = text.match(URLISH);
    if (!m) return null;
    const hasScheme = !!m[1];
    const hostText = m[2];
    const tld = hostText.split('.').pop().toLowerCase();
    if (/^\d+$/.test(tld)) return null; // IP address or version number ("v2.0")
    if (FILE_LIKE_TLDS.has(tld) && !hasScheme && !/^www\./i.test(hostText)) return null;
    try {
      return new URL(`http://${hostText}`).hostname.toLowerCase(); // also converts to punycode
    } catch {
      return null;
    }
  }

  /** Same host, ignoring "www." and subdomains of each other (cheap check, no PSL). */
  function looseSameHost(a, b) {
    const x = String(a).replace(/^www\./, '');
    const y = String(b).replace(/^www\./, '');
    return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
  }

  return { hostFromLinkText, looseSameHost };
});
