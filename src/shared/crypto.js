(function (root, factory) {
  'use strict';
  const CG = (root.CyberGuard = root.CyberGuard || {});
  const api = (CG.crypto = factory(root));
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (root) {
  'use strict';

  const PBKDF2_ITERATIONS = 100000;
  const SALT_BYTES = 16;

  function bytesToHex(buffer) {
    return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function bytesToBase64(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }

  function base64ToBytes(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function newSaltBase64() {
    return bytesToBase64(root.crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
  }

  function isAvailable() {
    return !!(root.crypto && root.crypto.subtle);
  }

  async function fingerprint(password, saltBase64) {
    const subtle = root.crypto.subtle;
    const key = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: base64ToBytes(saltBase64), iterations: PBKDF2_ITERATIONS },
      key,
      256
    );
    return bytesToHex(bits);
  }

  return { fingerprint, newSaltBase64, isAvailable, PBKDF2_ITERATIONS };
});
