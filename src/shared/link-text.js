(function (root, factory) {
  'use strict';
  const CG = (root.CyberGuard = root.CyberGuard || {});
  const api = (CG.linkText = factory());
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const U = `${String.fromCharCode(0xa1)}-${String.fromCharCode(0xfffd)}`;

  const URLISH = new RegExp(
    String.raw`^(?:(https?):\/\/)?((?:[a-z0-9${U}](?:[a-z0-9${U}-]{0,61}[a-z0-9${U}])?\.)+[a-z${U}][a-z0-9${U}-]{1,62})\.?(?::\d{1,5})?(?:[/?#]\S*)?$`,
    'i'
  );

  const FILE_LIKE_TLDS = new Set(['zip', 'mov', 'md', 'py', 'rs', 'sh', 'pm']);

  const LEADING = /^[(<[{"'«„‚]+/;
  const TRAILING = /[.,;:!?)\]}>"'»”’]+$/;

  function hostFromLinkText(raw) {
    const text = String(raw || '').trim().replace(LEADING, '').replace(TRAILING, '');
    if (!text || text.length > 300 || /\s/.test(text) || text.includes('@')) return null;
    const m = text.match(URLISH);
    if (!m) return null;
    const hasScheme = !!m[1];
    const hostText = m[2];
    const tld = hostText.split('.').pop().toLowerCase();
    if (/^\d+$/.test(tld)) return null;
    if (FILE_LIKE_TLDS.has(tld) && !hasScheme && !/^www\./i.test(hostText)) return null;
    try {
      return new URL(`http://${hostText}`).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  function looseSameHost(a, b) {
    const x = String(a).replace(/^www\./, '');
    const y = String(b).replace(/^www\./, '');
    return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
  }

  return { hostFromLinkText, looseSameHost };
});
