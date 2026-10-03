/**
 * CyberGuard — Punycode decoder (RFC 3492), shared by the service worker and tests.
 *
 * Browsers hand us hostnames in ASCII form ("xn--pple-43d.com"). To spot
 * homograph attacks we need the Unicode form ("аpple.com", Cyrillic "а").
 */
(function (root, factory) {
  'use strict';
  const CG = (root.CyberGuard = root.CyberGuard || {});
  const api = (CG.punycode = factory());
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const BASE = 36;
  const TMIN = 1;
  const TMAX = 26;
  const SKEW = 38;
  const DAMP = 700;
  const INITIAL_BIAS = 72;
  const INITIAL_N = 128;

  function adapt(delta, numPoints, firstTime) {
    delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
    delta += Math.floor(delta / numPoints);
    let k = 0;
    while (delta > ((BASE - TMIN) * TMAX) >> 1) {
      delta = Math.floor(delta / (BASE - TMIN));
      k += BASE;
    }
    return k + Math.floor(((BASE - TMIN + 1) * delta) / (delta + SKEW));
  }

  function basicToDigit(cp) {
    if (cp >= 48 && cp < 58) return cp - 22; // '0'..'9' → 26..35
    if (cp >= 65 && cp < 91) return cp - 65; // 'A'..'Z' → 0..25
    if (cp >= 97 && cp < 123) return cp - 97; // 'a'..'z' → 0..25
    return BASE;
  }

  /** Decodes the part after "xn--". Throws on malformed input. */
  function decodeLabel(input) {
    const output = [];
    let n = INITIAL_N;
    let i = 0;
    let bias = INITIAL_BIAS;

    const basic = Math.max(input.lastIndexOf('-'), 0);
    for (let j = 0; j < basic; j++) {
      if (input.charCodeAt(j) >= 0x80) throw new Error('Non-basic code point');
      output.push(input.charCodeAt(j));
    }

    for (let index = basic > 0 ? basic + 1 : 0; index < input.length; ) {
      const oldi = i;
      for (let w = 1, k = BASE; ; k += BASE) {
        if (index >= input.length) throw new Error('Truncated input');
        const digit = basicToDigit(input.charCodeAt(index++));
        if (digit >= BASE) throw new Error('Invalid digit');
        i += digit * w;
        const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
        if (digit < t) break;
        w *= BASE - t;
      }
      const out = output.length + 1;
      bias = adapt(i - oldi, out, oldi === 0);
      n += Math.floor(i / out);
      i %= out;
      if (n > 0x10ffff) throw new Error('Code point out of range');
      output.splice(i++, 0, n);
    }
    return String.fromCodePoint(...output);
  }

  /** "xn--pple-43d.com" → "аpple.com". Labels that fail to decode stay as-is. */
  function toUnicode(host) {
    return String(host)
      .split('.')
      .map((label) => {
        if (!label.toLowerCase().startsWith('xn--')) return label;
        try {
          return decodeLabel(label.slice(4).toLowerCase());
        } catch {
          return label;
        }
      })
      .join('.');
  }

  return { toUnicode, decodeLabel };
});
