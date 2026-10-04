/**
 * CyberGuard — "address comparison" box, the visual signature of every warning:
 *
 *   ┌──────────────────────────────────┐
 *   │ Prawdziwa strona Allegro:        │
 *   │ allegro.pl                       │
 *   ├──────────────────────────────────┤
 *   │ Ta strona:                       │
 *   │ a[_]legro.pl                     │  ← highlighted difference
 *   └──────────────────────────────────┘
 *   Brakuje jednej litery: „l”.
 *
 * Builds DOM with textContent only (never innerHTML). Styles: .cg-compare*
 * in content/ui.js (shadow DOM) and pages/common.css.
 */
(function (root, factory) {
  'use strict';
  const CG = (root.CyberGuard = root.CyberGuard || {});
  const api = (CG.compareView = factory());
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  /** Only these translation keys may be used for the explanation line. */
  const NOTE_KEYS = new Set([
    'diffSub', 'diffExtra', 'diffMissing', 'diffSwap', 'diffSeveral', 'diffSuffix', 'diffHomograph', 'diffOwner',
  ]);
  const MAX_PARTS = 80;

  function node(doc, tag, cls, text) {
    const el = doc.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  /**
   * @param {Document} doc
   * @param {{ rows: {label: string, value?: string, parts?: {t:string,m:boolean,gap?:boolean}[], bad?: boolean}[],
   *           note?: {key: string, params: string[]} }} spec
   * @param {(key: string, subs?: string[]) => string} t  Translation function.
   */
  function render(doc, spec, t) {
    const box = node(doc, 'div', 'cg-compare');
    const list = node(doc, 'div', 'cg-compare-rows');
    for (const row of spec.rows) {
      const r = node(doc, 'div', `cg-compare-row${row.bad ? ' cg-bad' : ''}`);
      r.append(node(doc, 'span', 'cg-compare-label', row.label));
      const value = node(doc, 'span', 'cg-compare-value');
      if (Array.isArray(row.parts)) {
        for (const p of row.parts.slice(0, MAX_PARTS)) {
          const text = String((p && p.t) || '').slice(0, 64);
          if (p && p.gap) value.append(node(doc, 'span', 'cg-mk cg-gap', '_'));
          else if (p && p.m) value.append(node(doc, 'mark', 'cg-mk', text));
          else value.append(text);
        }
      } else {
        value.textContent = String(row.value || '');
      }
      r.append(value);
      list.append(r);
    }
    box.append(list);

    const note = spec.note;
    if (note && NOTE_KEYS.has(note.key)) {
      const params = (Array.isArray(note.params) ? note.params : []).slice(0, 3).map((p) => String(p).slice(0, 100));
      box.append(node(doc, 'p', 'cg-compare-note', t(note.key, params)));
    }
    return box;
  }

  return { render, NOTE_KEYS };
});
