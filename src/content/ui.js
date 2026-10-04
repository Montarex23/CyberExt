/**
 * CyberGuard — On-page warnings (content script, part 1 of 2).
 *
 * Everything is drawn inside a CLOSED Shadow DOM, so the page's CSS can't
 * break it and the page's scripts can't read or restyle it.
 *
 *   showPasswordAlert(alert) — blocking dialog: important password on a foreign site
 *   showLinkAlert(alert)     — blocking dialog: link text shows another address
 *   showToast(sites)         — gentle tip: same password used elsewhere
 *   showBanner(findings, …)  — one banner listing page risks (fake address, no HTTPS…)
 *
 * Visual language (same as the extension pages):
 *   - the shield mascot shows the mood (worried / alarmed / calm),
 *   - every warning starts calm ("Spokojnie – …"), then says what is wrong,
 *   - addresses are compared side by side with the difference highlighted,
 *   - one big safe button in the brand teal, risky choices are small links.
 * Text ≥ 16–18 px, AAA contrast, 52 px buttons.
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
    h2 { font-size: 25px; line-height: 1.25; margin: 0; font-weight: 800; color: #8A0018; }
    p { margin: 0 0 12px; }
    strong { font-weight: 800; overflow-wrap: anywhere; }
    button { font: inherit; cursor: pointer; border-radius: 12px; min-height: 52px; padding: 12px 20px; }
    button:focus-visible { outline: 4px solid #1A56DB; outline-offset: 3px; }
    .primary { background: #0B6158; color: #fff; border: 2px solid #0B6158; font-weight: 800; font-size: 20px; }
    .primary:hover { background: #084C45; }
    .secondary { background: #fff; color: #111; border: 2px solid #444; font-weight: 700; }
    .secondary:hover { background: #F2F2F2; }
    .danger-outline { background: #fff; color: #8A0018; border: 2px solid #8A0018; font-weight: 700; }
    .linkish { background: none; border: none; color: #222; text-decoration: underline; min-height: 44px;
               font-size: 16px; font-weight: 500; padding: 8px 4px; }

    .head { display: flex; gap: 16px; align-items: center; margin-bottom: 14px; }
    .head-text { min-width: 0; }
    .kicker { margin: 0 0 2px; font-size: 16px; color: #2B2B2B; }
    .cg-mascot { display: block; flex-shrink: 0; }

    .backdrop { position: fixed; inset: 0; background: rgba(8, 18, 22, 0.62); display: flex;
                -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
                align-items: center; justify-content: center; padding: 16px; z-index: 2147483647; }
    .dialog { background: #fff; border-radius: 18px; width: 100%; max-width: 580px;
              max-height: calc(100vh - 32px); overflow: auto; border-top: 10px solid #B00020;
              box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45); padding: 22px 28px 20px; }
    .dialog.warn { border-top-color: #B45309; }
    .dialog.warn h2 { color: #7A2E00; }
    .actions { display: flex; flex-direction: column; gap: 10px; margin-top: 18px; }

    .cg-compare { margin: 4px 0 14px; }
    .cg-compare-rows { border: 2px solid #D0D4D9; border-radius: 12px; padding: 2px 16px; }
    .cg-compare-row { padding: 10px 0; }
    .cg-compare-row + .cg-compare-row { border-top: 1px solid #D0D4D9; }
    .cg-compare-label { display: block; font-size: 16px; color: #333; }
    .cg-compare-value { display: block; font-size: 21px; font-weight: 800; color: #111; overflow-wrap: anywhere;
                        font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; }
    .cg-bad .cg-compare-value { color: #111; }
    .cg-mk { background: #FFE1E3; color: #8A0018; border-radius: 4px; padding: 0 2px;
             box-shadow: inset 0 -3px 0 #E5484D; font: inherit; }
    .cg-gap { display: inline-block; min-width: 0.8em; text-align: center; }
    .cg-compare-note { margin: 8px 0 0; font-size: 17px; font-weight: 700; color: #8A0018; }

    .toast { position: fixed; right: 16px; bottom: 16px; width: min(440px, calc(100vw - 32px));
             background: #fff; border-left: 10px solid #0B6158; border-radius: 0 14px 14px 0; padding: 16px 20px;
             box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3); z-index: 2147483646; }
    .toast h2 { color: #064A43; font-size: 21px; }
    .toast .head { margin-bottom: 8px; }

    .banner { position: fixed; top: 12px; left: 0; right: 0; margin: 0 auto; width: min(720px, calc(100vw - 24px));
              background: #fff; border-radius: 0 16px 16px 0; border-left: 12px solid #B45309; padding: 16px 56px 16px 20px;
              box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35); max-height: 80vh; overflow: auto; z-index: 2147483646; }
    .banner.danger { border-left-color: #B00020; padding-right: 20px; }
    .banner h2 { font-size: 22px; }
    .banner.warn h2 { color: #7A2E00; }
    .banner .head { margin-bottom: 10px; }
    .banner .row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
    .close { position: absolute; top: 8px; right: 8px; width: 44px; height: 44px; min-height: 44px; padding: 0;
             border: none; background: none; font-size: 28px; line-height: 1; color: #222; border-radius: 8px; }

    @media (prefers-reduced-motion: no-preference) {
      .dialog, .banner, .toast { animation: cg-in 0.22s ease-out; }
      .head .cg-mascot { animation: cg-pop 0.45s cubic-bezier(.3, 1.6, .5, 1); }
    }
    @keyframes cg-in { from { opacity: 0; translate: 0 -8px; } to { opacity: 1; translate: 0 0; } }
    @keyframes cg-pop { from { scale: 0.6; rotate: -8deg; } to { scale: 1; rotate: 0deg; } }
  `;

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
      else if (k === 'html') node.innerHTML = v; // Only for the static mascot SVG (no page data).
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

  function mascot(mood, size) {
    return el('span', { html: CG.mascot.svg(mood, size) }).firstChild;
  }

  /** Mascot + optional calm line + title. */
  function head(mood, size, kicker, title, titleId) {
    return el('div', { class: 'head' },
      mascot(mood, size),
      el('div', { class: 'head-text' },
        kicker ? el('p', { class: 'kicker', text: kicker }) : null,
        el('h2', titleId ? { id: titleId, text: title } : { text: title })
      )
    );
  }

  function compare(rows, note) {
    return CG.compareView.render(document, { rows, note }, t);
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

  /** Common modal frame: blurred backdrop, focus trap, optional Escape = safe choice. */
  function modal(cls, labelledBy, onEscape) {
    const dialog = el('div', { class: `dialog cg ${cls}`, role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': labelledBy });
    const backdrop = el('div', { class: 'backdrop' }, dialog);
    backdrop.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' && onEscape) onEscape();
      trapFocus(dialog, e);
    });
    return { dialog, backdrop };
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
      const { dialog, backdrop } = modal('danger', 'cg-title', null);

      const finish = (choice) => {
        backdrop.remove();
        openCount--;
        alertPromise = null;
        resolve(choice);
      };

      const diff = alert.diff || null;
      const step1 = () => {
        dialog.replaceChildren(
          head('alarmed', 64, t('pwAlertCalm'), t('pwAlertTitle'), 'cg-title'),
          compare(
            [
              { label: t('pwCompareYours'), value: `${alert.brandName} – ${alert.brandSite}` },
              { label: t('pwCompareThis'), parts: diff ? diff.parts : [{ t: alert.site, m: true }], bad: true },
            ],
            diff ? diff.note : null
          ),
          el('p', {}, rich('pwAlertExplain', [alert.brandName])),
          el('div', { class: 'actions' },
            el('button', { class: 'primary', type: 'button', text: t('btnLeave'), onclick: () => finish('leave') }),
            el('button', { class: 'linkish', type: 'button', text: t('pwAlertTrustLink'), onclick: step2 })
          )
        );
        dialog.querySelector('.primary').focus();
      };

      const step2 = () => {
        dialog.replaceChildren(
          head('worried', 56, null, t('pwConfirmTitle'), 'cg-title'),
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
      const finish = (choice) => {
        backdrop.remove();
        openCount--;
        linkAlertPromise = null;
        resolve(choice);
      };
      const { dialog, backdrop } = modal('warn', 'cg-link-title', () => finish('stay')); // Escape = don't open.

      const diff = alert.diff || null;
      dialog.append(
        head('worried', 64, t('linkAlertCalm'), t('linkAlertTitle'), 'cg-link-title'),
        compare(
          [
            { label: t('linkAlertShown'), value: alert.shown },
            { label: t('linkAlertReal'), parts: diff ? diff.parts : [{ t: alert.real, m: true }], bad: true },
          ],
          diff ? diff.note : null
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
      head('calm', 40, null, t('reuseTitle')),
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

  /** Address comparison for findings about a fake address. */
  function findingCompare(f) {
    if (!f.diff) return null;
    return compare(
      [
        { label: t('compareRealBrand', [f.diff.brandName]), value: f.diff.realSite },
        { label: t('compareThisSite'), parts: f.diff.parts, bad: true },
      ],
      f.diff.note
    );
  }

  const FINDING_TEXT = {
    lookalike: (f) => [t('findLookalikeTitle', [f.brandName]), document.createTextNode(t('findLookalikeBody'))],
    homograph: (f) => [t('findHomographTitle', [f.brandName]), document.createTextNode(t('findHomographBody'))],
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

    // First problem: title in the header, then its comparison and text.
    // Further problems: bold title in front of their text.
    const content = [];
    known.forEach((f, i) => {
      const [title, body] = texts[i];
      if (i > 0) content.push(el('p', {}, el('strong', { text: `${title}. ` }), body));
      else {
        content.push(findingCompare(f));
        content.push(el('p', {}, body));
      }
    });

    bannerEl = el('div', { class: `banner cg ${level}`, role: 'alert' },
      head(level === 'danger' ? 'alarmed' : 'worried', 44, null, texts[0][0]),
      ...content,
      el('div', { class: 'row' }, ...buttons),
      // Serious warnings can't be swept away with ×; ordinary ones can (for now only).
      level === 'danger'
        ? null
        : el('button', { class: 'close', type: 'button', 'aria-label': t('btnClose'), title: t('btnClose'), text: '×', onclick: actions.onClose })
    );
    root.append(bannerEl);
  }

  CG.ui = { showPasswordAlert, showLinkAlert, showToast, showBanner, hideBanner, destroy, isAlive };
})();
