(function () {
  'use strict';

  const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

  function rich(key, values) {
    const markers = values.map((_, i) => `\u0001${i}\u0002`);
    const frag = document.createDocumentFragment();
    for (const part of t(key, markers).split(/(\u0001\d+\u0002)/)) {
      const m = part.match(/^\u0001(\d+)\u0002$/);
      if (m) {
        const strong = document.createElement('strong');
        strong.textContent = String(values[Number(m[1])] || '');
        frag.append(strong);
      } else if (part) {
        frag.append(part);
      }
    }
    return frag;
  }

  function apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      const msg = chrome.i18n.getMessage(el.dataset.i18n);
      if (msg) {
        el.textContent = msg;
      } else if (!el.textContent.trim()) {
        el.textContent = el.dataset.i18n;
      }
    });
    root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const msg = chrome.i18n.getMessage(el.dataset.i18nAria);
      if (msg) {
        el.setAttribute('aria-label', msg);
      }
    });
  }

  document.documentElement.lang = t('langCode');
  const titleKey = document.documentElement.dataset.i18nTitle;
  if (titleKey) document.title = t(titleKey);
  apply();

  self.CyberGuardI18n = { t, rich, apply };
})();
