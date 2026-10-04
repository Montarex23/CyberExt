/**
 * CyberGuard — On-page warnings (content script, part 1 of 2).
 *
 * Everything is drawn inside a CLOSED Shadow DOM, so the page's CSS can't
 * break it and the page's scripts can't read or restyle it.
 *
 *   showPasswordAlert(alert) — blocking dialog: important password on a foreign site
 *   showToast(sites)         — gentle tip: same password used elsewhere
 *   showBanner(findings, …)  — one banner listing page risks (fake address, no HTTPS…)
 *
 * Design for every age: 18px+ text, high contrast (WCAG AAA for text),
 * big buttons (52px), one obvious safe choice, plain Polish/English words.
 */
(function () {
  'use strict';

  const CG = (self.CyberGuard = self.CyberGuard || {});
  if (CG.ui) return;

  const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .cg { font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-size: 18px;
          line-height: 1.5; color: #111; text-align: left; letter-spacing: normal; }
    h2 { font-size: 26px; line-height: 1.25; margin: 10px 0 14px; font-weight: 800; color: #8A0018; }
    p { margin: 0 0 12px; }
    strong { font-weight: 800; overflow-wrap: anywhere; }
    button { font: inherit; cursor: pointer; border-radius: 12px; min-height: 52px; padding: 12px 20px; }
    button:focus-visible { outline: 4px solid #1A56DB; outline-offset: 3px; }
    .primary { background: #075E26; color: #fff; border: 2px solid #075E26; font-weight: 800; font-size: 20px; }
    .primary:hover { background: #054A1E; }
    .secondary { background: #fff; color: #111; border: 2px solid #444; font-weight: 700; }
    .secondary:hover { background: #F2F2F2; }
    .danger-outline { background: #fff; color: #8A0018; border: 2px solid #8A0018; font-weight: 700; }
    .linkish { background: none; border: none; color: #222; text-decoration: underline; min-height: 44px;
               font-size: 16px; font-weight: 500; padding: 8px 4px; }
    .icon { width: 56px; height: 56px; display: block; }

    .backdrop { position: fixed; inset: 0; background: rgba(17, 17, 17, 0.75); display: flex;
                align-items: center; justify-content: center; padding: 16px; z-index: 2147483647; }
    .dialog { background: #fff; border-radius: 16px; width: 100%; max-width: 580px;
              max-height: calc(100vh - 32px); overflow: auto; border-top: 12px solid #B00020;
              box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45); padding: 24px 28px; }
    .dialog .icon { color: #B00020; }
    .dialog.link { border-top-color: #B45309; }
    .dialog.link .icon { color: #B45309; }
    .dialog.link h2 { color: #7A2E00; }
    .compare { border: 2px solid #D6D6D6; border-radius: 12px; padding: 4px 16px; margin: 4px 0 16px; }
    .compare-row { padding: 10px 0; }
    .compare-row + .compare-row { border-top: 1px solid #D6D6D6; }
    .compare-label { display: block; font-size: 16px; color: #333; }
    .compare-value { display: block; font-size: 20px; font-weight: 800; font-family: ui-monospace, Consolas, monospace;
                     overflow-wrap: anywhere; color: #111; }
    .compare-value.real { color: #8A0018; }
    .actions { display: flex; flex-direction: column; gap: 12px; margin-top: 20px; }

    .toast { position: fixed; right: 16px; bottom: 16px; width: min(440px, calc(100vw - 32px));
             background: #fff; border-left: 10px solid #1A56DB; border-radius: 14px; padding: 18px 20px;
             box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3); z-index: 2147483646; }
    .toast h2 { color: #0F3D99; font-size: 21px; margin-top: 0; }

    .banner { position: fixed; top: 12px; left: 0; right: 0; margin: 0 auto; width: min(700px, calc(100vw - 24px));
              background: #fff; border-radius: 14px; border-left: 12px solid #B45309; padding: 18px 56px 18px 20px;
              box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35); max-height: 75vh; overflow: auto; z-index: 2147483646; }
    .banner.danger { border-left-color: #B00020; }
    .banner h2 { font-size: 22px; margin-top: 0; }
    .banner.warn h2 { color: #7A2E00; }
    .banner .row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
    .close { position: absolute; top: 8px; right: 8px; width: 44px; height: 44px; min-height: 44px; padding: 0;
             border: none; background: none; font-size: 28px; line-height: 1; color: #222; border-radius: 8px; }

    @media (prefers-reduced-motion: no-preference) {
      .dialog, .banner, .toast { animation: cg-in 0.2s ease-out; }
    }
    @keyframes cg-in { from { opacity: 0; translate: 0 -8px; } to { opacity: 1; translate: 0 0; } }
  `;

  const ICON_WARNING =
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' +
    '<line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

  // -------------------------------------------------------------------------
  // Shadow root management
  // -------------------------------------------------------------------------

  let hostEl = null;
  let shadow = null;
  let openCount = 0;
  const HOST_ATTR = 'data-cyberguard-ui';

  /**
   * False once the extension was reloaded or updated: this copy of the script is
   * then "orphaned" (it can't talk to the extension any more) and must step aside
   * for the fresh copy the service worker injects.
   */
  function isAlive() {
    try {
      return !!chrome.runtime.id;
    } catch {
      return false;
    }
  }

  function getRoot() {
    if (!hostEl) {
      // Remove warnings left behind by an older copy of this script (after an update).
      document.querySelectorAll(`[${HOST_ATTR}]`).forEach((old) => old.remove());
      hostEl = document.createElement('div');
      hostEl.setAttribute(HOST_ATTR, '');
      shadow = hostEl.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = CSS;
      shadow.append(style);
      // If the page removes our element while a warning is open, put it back.
      const observer = new MutationObserver(() => {
        if (!isAlive()) {
          observer.disconnect();
          return;
        }
        if (openCount > 0 && !hostEl.isConnected) attach();
      });
      observer.observe(document.documentElement || document, { childList: true });
    }
    attach();
    return shadow;
  }

  /** Called by content.js when it notices the extension was reloaded. */
  function destroy() {
    if (hostEl) hostEl.remove();
    openCount = 0;
  }

  function attach() {
    if (!hostEl.isConnected) (document.documentElement || document).appendChild(hostEl);
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v; // Only used for our static SVG icon.
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    node.append(...children.filter(Boolean));
    return node;
  }

  /** Message with bold parameters: values never pass through innerHTML. */
  function rich(key, values) {
    const markers = values.map((_, i) => `\u0001${i}\u0002`);
    const text = t(key, markers);
    const frag = document.createDocumentFragment();
    for (const part of text.split(/(\u0001\d+\u0002)/)) {
      const m = part.match(/^\u0001(\d+)\u0002$/);
      if (m) frag.append(el('strong', { text: String(values[Number(m[1])] || '') }));
      else if (part) frag.append(part);
    }
    return frag;
  }

  function trapFocus(container, event) {
    if (event.key !== 'Tab') return;
    const items = [...container.querySelectorAll('button')];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = shadow.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // -------------------------------------------------------------------------
  // 1. Blocking dialog — important password typed on a foreign site
  // -------------------------------------------------------------------------

  let alertPromise = null;

  function showPasswordAlert(alert) {
    if (alertPromise) return alertPromise;
    alertPromise = new Promise((resolve) => {
      const root = getRoot();
      openCount++;
      const dialog = el('div', { class: 'dialog cg', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'cg-title' });
      const backdrop = el('div', { class: 'backdrop' }, dialog);
      backdrop.addEventListener('keydown', (e) => {
        e.stopPropagation();
        trapFocus(dialog, e);
      });

      const finish = (choice) => {
        backdrop.remove();
        openCount--;
        alertPromise = null;
        resolve(choice);
      };

      const step1 = () => {
        dialog.replaceChildren(
          el('div', { html: ICON_WARNING }),
          el('h2', { id: 'cg-title', text: t('pwAlertTitle') }),
          el('p', {}, rich('pwAlertUsedOn', [alert.brandName, alert.brandSite])),
          el('p', {}, rich('pwAlertThisSite', [alert.site, alert.brandName])),
          el('p', { text: t('pwAlertExplain') }),
          el('div', { class: 'actions' },
            el('button', { class: 'primary', type: 'button', text: t('btnLeave'), onclick: () => finish('leave') }),
            el('button', { class: 'linkish', type: 'button', text: t('pwAlertTrustLink'), onclick: step2 })
          )
        );
        dialog.querySelector('.primary').focus();
      };

      const step2 = () => {
        dialog.replaceChildren(
          el('div', { html: ICON_WARNING }),
          el('h2', { id: 'cg-title', text: t('pwConfirmTitle') }),
          el('p', {}, rich('pwConfirmText', [alert.brandName])),
          el('p', { text: t('pwConfirmNewAccount') }),
          el('div', { class: 'actions' },
            el('button', { class: 'primary', type: 'button', text: t('btnNoLeave'), onclick: () => finish('leave') }),
            el('button', { class: 'danger-outline', type: 'button', text: t('pwConfirmYes'), onclick: () => finish('trust') })
          )
        );
        dialog.querySelector('.primary').focus();
      };

      root.append(backdrop);
      step1();
    });
    return alertPromise;
  }

  // -------------------------------------------------------------------------
  // 1b. Blocking dialog — link text shows one address, the link goes elsewhere
  // -------------------------------------------------------------------------

  let linkAlertPromise = null;

  /** @returns {Promise<'stay'|'open'>} */
  function showLinkAlert(alert) {
    if (linkAlertPromise) return linkAlertPromise;
    linkAlertPromise = new Promise((resolve) => {
      const root = getRoot();
      openCount++;
      const dialog = el('div', { class: 'dialog link cg', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'cg-link-title' });
      const backdrop = el('div', { class: 'backdrop' }, dialog);

      const finish = (choice) => {
        backdrop.remove();
        openCount--;
        linkAlertPromise = null;
        resolve(choice);
      };
      backdrop.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') finish('stay'); // Escape = the safe choice.
        trapFocus(dialog, e);
      });

      dialog.append(
        el('div', { html: ICON_WARNING }),
        el('h2', { id: 'cg-link-title', text: t('linkAlertTitle') }),
        el('div', { class: 'compare' },
          el('div', { class: 'compare-row' },
            el('span', { class: 'compare-label', text: t('linkAlertShown') }),
            el('span', { class: 'compare-value', text: alert.shown })
          ),
          el('div', { class: 'compare-row' },
            el('span', { class: 'compare-label', text: t('linkAlertReal') }),
            el('span', { class: 'compare-value real', text: alert.real })
          )
        ),
        el('p', { text: t('linkAlertExplain') }),
        el('div', { class: 'actions' },
          el('button', { class: 'primary', type: 'button', text: t('linkAlertStay'), onclick: () => finish('stay') }),
          el('button', { class: 'linkish', type: 'button', text: t('linkAlertOpen'), onclick: () => finish('open') })
        )
      );
      root.append(backdrop);
      dialog.querySelector('.primary').focus();
    });
    return linkAlertPromise;
  }

  // -------------------------------------------------------------------------
  // 2. Gentle tip — password reused on ordinary sites
  // -------------------------------------------------------------------------

  let toastEl = null;

  function showToast(sites) {
    if (toastEl) return;
    const root = getRoot();
    const close = () => {
      if (!toastEl) return;
      toastEl.remove();
      toastEl = null;
      openCount--;
    };
    openCount++;
    toastEl = el('div', { class: 'toast cg', role: 'status' },
      el('h2', { text: t('reuseTitle') }),
      el('p', {}, rich('reuseBody', [sites.join(', ')])),
      el('p', { text: t('reuseAdvice') }),
      el('button', { class: 'secondary', type: 'button', text: t('btnUnderstood'), onclick: close })
    );
    root.append(toastEl);
    setTimeout(close, 30000);
  }

  // -------------------------------------------------------------------------
  // 3. Page banner — fake address, no HTTPS, form sending password elsewhere
  // -------------------------------------------------------------------------

  const FINDING_TEXT = {
    lookalike: (f) => [t('findLookalikeTitle', [f.brandName]), rich('findLookalikeBody', [f.host, f.brandName, f.brandSite])],
    homograph: (f) => [t('findHomographTitle'), rich('findHomographBody', [f.host, f.brandName, f.brandSite])],
    mixedScripts: (f) => [t('findMixedTitle'), rich('findMixedBody', [f.host])],
    insecure: () => [t('findInsecureTitle'), document.createTextNode(t('findInsecureBody'))],
    crossForm: (f) => [t('findCrossFormTitle'), rich('findCrossFormBody', [f.target])],
    blocklisted: (f) => [t('findBlocklistedTitle'), rich('findBlocklistedBody', [f.host])],
  };
  const LEAVE_FOR = new Set(['lookalike', 'homograph', 'blocklisted', 'mixedScripts']);
  const TRUST_FOR = new Set(['lookalike', 'homograph', 'mixedScripts', 'crossForm']);

  let bannerEl = null;

  function hideBanner() {
    if (!bannerEl) return;
    bannerEl.remove();
    bannerEl = null;
    openCount--;
  }

  /**
   * @param {object[]} findings  From the service worker, most serious first.
   * @param {{onLeave: Function, onTrust: Function, onUnderstood: Function, onClose: Function}} actions
   *   onTrust / onUnderstood are remembered for the site; onClose (×) only hides the banner now.
   */
  function showBanner(findings, actions) {
    const known = findings.filter((f) => FINDING_TEXT[f.id]);
    hideBanner();
    if (!known.length) return;

    const root = getRoot();
    openCount++;
    const level = known.some((f) => f.level === 'danger') ? 'danger' : 'warn';
    const texts = known.map((f) => FINDING_TEXT[f.id](f));
    const ids = new Set(known.map((f) => f.id));

    const buttons = [];
    if ([...ids].some((id) => LEAVE_FOR.has(id))) {
      buttons.push(el('button', { class: 'primary', type: 'button', text: t('btnLeave'), onclick: actions.onLeave }));
    }
    if (!ids.has('blocklisted') && [...ids].some((id) => TRUST_FOR.has(id))) {
      buttons.push(el('button', { class: 'secondary', type: 'button', text: t('btnTrustSite'), onclick: actions.onTrust }));
    }
    if (!buttons.length) {
      // Remembered for this site — the same warning won't come back here.
      buttons.push(el('button', { class: 'secondary', type: 'button', text: t('btnUnderstoodRemember'), onclick: actions.onUnderstood }));
    }

    // First problem: title + text. Further problems: bold title in front of their text.
    const paragraphs = texts.map(([title, body], i) =>
      i === 0 ? el('p', {}, body) : el('p', {}, el('strong', { text: `${title}. ` }), body)
    );

    bannerEl = el('div', { class: `banner cg ${level}`, role: 'alert' },
      el('h2', { text: texts[0][0] }),
      ...paragraphs,
      el('div', { class: 'row' }, ...buttons),
      el('button', { class: 'close', type: 'button', 'aria-label': t('btnClose'), title: t('btnClose'), text: '×', onclick: actions.onClose })
    );
    root.append(bannerEl);
  }

  CG.ui = { showPasswordAlert, showLinkAlert, showToast, showBanner, hideBanner, destroy, isAlive };
})();
