(function (root, factory) {
  'use strict';
  const CG = (root.CyberGuard = root.CyberGuard || {});
  const api = (CG.mascot = factory());
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const SHIELD = 'M50 5 L89 19 V50 C89 77 71 96 50 105 C29 96 11 77 11 50 V19 Z';
  const SHINE = 'M23 26 L48 16 V30 L25 38 Z';

  const COLORS = {
    calm: { body: '#17A589', edge: '#0B4F45', face: '#062E28' },
    happy: { body: '#17A589', edge: '#0B4F45', face: '#062E28' },
    worried: { body: '#F2A93B', edge: '#6B3A05', face: '#3A1F02' },
    alarmed: { body: '#E5484D', edge: '#6E0F14', face: '#3D070A' },
  };

  function face(mood, c) {
    const s = `stroke="${c.face}" stroke-width="4.5" stroke-linecap="round" fill="none"`;
    switch (mood) {
      case 'happy':
        return (
          `<path d="M30 52 Q37 44 44 52" ${s}/><path d="M56 52 Q63 44 70 52" ${s}/>` +
          `<path d="M33 64 Q50 86 67 64 Z" fill="${c.face}"/>` +
          `<circle cx="27" cy="64" r="5" fill="#F7A6A0" opacity=".8"/><circle cx="73" cy="64" r="5" fill="#F7A6A0" opacity=".8"/>`
        );
      case 'worried':
        return (
          `<path d="M27 43 Q35 41 42 35" ${s}/><path d="M73 43 Q65 41 58 35" ${s}/>` +
          `<circle cx="37" cy="54" r="6" fill="${c.face}"/><circle cx="63" cy="54" r="6" fill="${c.face}"/>` +
          `<path d="M39 79 Q50 72 61 79" ${s}/>`
        );
      case 'alarmed':
        return (
          `<path d="M27 36 Q35 30 43 36" ${s}/><path d="M57 36 Q65 30 73 36" ${s}/>` +
          `<circle cx="36" cy="52" r="9" fill="#fff"/><circle cx="64" cy="52" r="9" fill="#fff"/>` +
          `<circle cx="36" cy="53" r="5" fill="${c.face}"/><circle cx="64" cy="53" r="5" fill="${c.face}"/>` +
          `<ellipse cx="50" cy="79" rx="7" ry="8" fill="${c.face}"/>`
        );
      default:
        return (
          `<circle cx="37" cy="50" r="6" fill="${c.face}"/><circle cx="63" cy="50" r="6" fill="${c.face}"/>` +
          `<path d="M37 69 Q50 79 63 69" ${s}/>`
        );
    }
  }

  function svg(mood = 'calm', size = 64) {
    const m = COLORS[mood] ? mood : 'calm';
    const c = COLORS[m];
    const w = Math.round(size);
    const h = Math.round(size * 1.1);
    return (
      `<svg class="cg-mascot cg-mascot-${m}" viewBox="0 0 100 110" width="${w}" height="${h}" aria-hidden="true" focusable="false">` +
      `<path d="${SHIELD}" fill="${c.body}" stroke="${c.edge}" stroke-width="4" stroke-linejoin="round"/>` +
      `<path d="${SHINE}" fill="#fff" opacity=".22"/>` +
      face(m, c) +
      `</svg>`
    );
  }

  return { svg, MOODS: Object.keys(COLORS) };
});
