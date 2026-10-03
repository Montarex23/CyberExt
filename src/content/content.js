/**
 * CyberGuard — Content script (part 2 of 2). Runs in every page and frame.
 *
 * 1. PASSWORD PROTECTION
 *    While the user types a password we compute its fingerprint (PBKDF2, see
 *    shared/crypto.js) and ask the service worker what it means here:
 *      danger → blocking dialog right away + login is held back
 *      reuse  → gentle tip, nothing is blocked
 *    A password is remembered for a site only when the form is really sent
 *    (submit, Enter, or a click on a button), never while typing.
 *
 * 2. PAGE CHECKS (top frame only)
 *    Facts about the page (has a password field? where do forms send it?) go
 *    to the service worker, which answers with findings shown in ONE banner.
 *
 * The plain password never leaves this script; nothing is ever sent online.
 */
(function () {
  'use strict';

  const CG = self.CyberGuard;
  if (!CG || !CG.ui || CG.contentLoaded) return;
  CG.contentLoaded = true;

  // Short passwords ("1234", "ola1") are common among less technical users — protect them too.
  const MIN_LENGTH = 4;
  const CHECK_DELAY_MS = 300;
  const IS_TOP = window === window.top;
  const PASSWORD_SELECTOR = 'input[type="password"]';

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  /**
   * After the extension is reloaded or updated, this copy of the script keeps running
   * in already-open tabs but can no longer reach the extension. It then removes its
   * warnings and stops reacting; the service worker injects a fresh copy.
   */
  let retired = false;
  function isRetired() {
    if (!retired && !CG.ui.isAlive()) {
      retired = true;
      CG.ui.destroy();
    }
    return retired;
  }

  function send(message) {
    return new Promise((resolve) => {
      if (isRetired()) {
        resolve(null);
        return;
      }
      try {
        chrome.runtime.sendMessage(message, (response) => {
          resolve(chrome.runtime.lastError || !response || response.error ? null : response);
        });
      } catch {
        resolve(null); // Extension was reloaded — this old script is orphaned.
      }
    });
  }

  // -------------------------------------------------------------------------
  // Fingerprints
  // -------------------------------------------------------------------------

  let saltPromise = null;
  const hashCache = new Map(); // password → Promise<hash>, in memory only, for this page.

  function fingerprint(value) {
    if (hashCache.has(value)) return hashCache.get(value);
    const promise = (async () => {
      if (CG.crypto.isAvailable()) {
        if (!saltPromise) saltPromise = send({ type: 'GET_SALT' }).then((r) => (r ? r.salt : null));
        const salt = await saltPromise;
        if (!salt) return null;
        return CG.crypto.fingerprint(value, salt);
      }
      // Plain-HTTP pages have no WebCrypto: let the service worker compute it.
      const r = await send({ type: 'HASH_PASSWORD', password: value });
      return r ? r.hash : null;
    })().catch(() => null);
    hashCache.set(value, promise);
    if (hashCache.size > 20) hashCache.delete(hashCache.keys().next().value);
    return promise;
  }

  // -------------------------------------------------------------------------
  // Password field state
  // -------------------------------------------------------------------------

  /** field → { value, promise, hash, verdict } for the value last checked. */
  const fieldState = new WeakMap();
  /** Password fields we've seen (also inside shadow DOM, which querySelector can't reach). */
  const seenFields = new Set();
  const remembered = new Set();
  let reuseTipShown = false;

  function isPasswordField(node) {
    return node instanceof HTMLInputElement && node.type === 'password';
  }

  function isFilled(field) {
    return field.isConnected && typeof field.value === 'string' && field.value.length >= MIN_LENGTH;
  }

  function filledFieldsIn(scope) {
    const found = new Set(scope.querySelectorAll(PASSWORD_SELECTOR));
    if (scope === document) seenFields.forEach((f) => found.add(f));
    else seenFields.forEach((f) => scope.contains(f) && found.add(f));
    return [...found].filter(isFilled);
  }

  /** Password fields that a submit/Enter/click on `target` may send. */
  function relevantFields(target) {
    const form = target && target.closest ? target.closest('form') : null;
    const inForm = form ? filledFieldsIn(form) : [];
    return inForm.length ? inForm : filledFieldsIn(document);
  }

  function check(field) {
    const value = field.value;
    const current = fieldState.get(field);
    if (current && current.value === value) return current.promise;

    const state = { value, hash: null, verdict: null, promise: null };
    fieldState.set(field, state);
    state.promise = (async () => {
      const hash = await fingerprint(value);
      const verdict = hash ? (await send({ type: 'CHECK_PASSWORD', hash })) || { level: 'none' } : { level: 'none' };
      state.hash = hash;
      state.verdict = verdict;
      return verdict;
    })();
    return state.promise;
  }

  /** State for the field's CURRENT value, if it has already been checked. */
  function freshState(field) {
    const state = fieldState.get(field);
    return state && state.verdict && state.value === field.value ? state : null;
  }

  function rememberFields(fields) {
    for (const field of fields) {
      const state = freshState(field);
      if (!state || !state.hash || state.verdict.level === 'danger' || remembered.has(state.hash)) continue;
      remembered.add(state.hash);
      send({ type: 'REMEMBER_PASSWORD', hash: state.hash });
    }
  }

  // -------------------------------------------------------------------------
  // Reacting to verdicts
  // -------------------------------------------------------------------------

  let dangerPromise = null;

  function presentDanger(state) {
    const alert = {
      kind: 'password-danger',
      brandName: state.verdict.brandName,
      brandSite: state.verdict.brandSite,
      site: state.verdict.site,
    };
    if (IS_TOP) return CG.ui.showPasswordAlert(alert);
    // In a login iframe: the top page shows the dialog (a tiny frame can't).
    return send({ type: 'RELAY_ALERT', alert }).then((r) => (r && r.choice) || 'leave');
  }

  function showDanger(field) {
    if (dangerPromise) return dangerPromise;
    const state = freshState(field);
    if (!state) return Promise.resolve();
    dangerPromise = presentDanger(state).then(async (choice) => {
      dangerPromise = null;
      if (choice === 'trust') {
        await send({ type: 'TRUST_PASSWORD_HERE', hash: state.hash });
        state.verdict = { level: 'ok' };
        remembered.add(state.hash);
      } else {
        clearPasswordFields();
        send({ type: 'LEAVE_PAGE' });
      }
    });
    return dangerPromise;
  }

  function showReuseTip(verdict) {
    if (reuseTipShown) return;
    reuseTipShown = true;
    const sites = verdict.sites || [];
    if (IS_TOP) CG.ui.showToast(sites);
    else send({ type: 'RELAY_TOAST', sites });
  }

  function handleVerdict(field, verdict) {
    if (verdict.level === 'danger') showDanger(field);
    else if (verdict.level === 'reuse') showReuseTip(verdict);
  }

  function clearPasswordFields() {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const fields = new Set([...document.querySelectorAll(PASSWORD_SELECTOR), ...seenFields]);
    for (const field of fields) {
      setter.call(field, '');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // -------------------------------------------------------------------------
  // Typing: check (but never store) after a short pause
  // -------------------------------------------------------------------------

  const timers = new WeakMap();

  function eventTarget(event) {
    return event.composedPath ? event.composedPath()[0] : event.target;
  }

  async function runCheck(field) {
    if (!isFilled(field)) return;
    const verdict = await check(field);
    const state = freshState(field);
    if (state && state.verdict === verdict) handleVerdict(field, verdict);
  }

  function onPasswordActivity(event, immediate) {
    const field = eventTarget(event);
    if (!isPasswordField(field) || isRetired()) return;
    if (!seenFields.has(field)) {
      seenFields.add(field);
      schedulePageAnalysis();
    }
    clearTimeout(timers.get(field));
    timers.set(field, setTimeout(() => runCheck(field), immediate ? 0 : CHECK_DELAY_MS));
  }

  window.addEventListener('input', (e) => onPasswordActivity(e, false), true);
  window.addEventListener('change', (e) => onPasswordActivity(e, true), true);

  // -------------------------------------------------------------------------
  // Sending: hold the login back until the password has been checked
  // -------------------------------------------------------------------------

  let bypass = false; // True while we replay an event we held back.

  function block(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  /**
   * Lets the event through if all passwords are checked and safe; otherwise
   * blocks it, checks, and replays the action when it turns out to be safe.
   */
  function gate(event, fields, replay) {
    if (bypass || !fields.length || isRetired()) return;

    const dangerous = fields.find((f) => {
      const s = freshState(f);
      return s && s.verdict.level === 'danger';
    });
    if (dangerous) {
      block(event);
      showDanger(dangerous);
      return;
    }

    const pending = fields.filter((f) => !freshState(f));
    if (!pending.length) {
      rememberFields(fields);
      return;
    }

    block(event);
    Promise.all(pending.map((f) => check(f))).then(() => {
      const bad = fields.find((f) => {
        const s = freshState(f);
        return s && s.verdict.level === 'danger';
      });
      if (bad) {
        showDanger(bad);
        return;
      }
      rememberFields(fields);
      bypass = true;
      try {
        replay();
      } finally {
        bypass = false;
      }
    });
  }

  window.addEventListener(
    'submit',
    (event) => {
      const form = eventTarget(event);
      if (!(form instanceof HTMLFormElement)) return;
      gate(event, filledFieldsIn(form), () => {
        try {
          form.requestSubmit(event.submitter || undefined);
        } catch {
          form.requestSubmit();
        }
      });
    },
    true
  );

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      const target = eventTarget(event);
      if (!(target instanceof HTMLInputElement)) return;
      const inLoginForm = isPasswordField(target) || (target.form && filledFieldsIn(target.form).length > 0);
      if (!inLoginForm) return;
      gate(event, relevantFields(target), () => replayEnter(target));
    },
    true
  );

  window.addEventListener(
    'click',
    (event) => {
      const start = eventTarget(event);
      const target = start instanceof Element ? start.closest('button, input[type="submit"], input[type="image"], [role="button"], a') : null;
      if (!target) return;
      gate(event, relevantFields(target), () => target.click());
    },
    true
  );

  function replayEnter(target) {
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
    const notCancelled = target.dispatchEvent(new KeyboardEvent('keydown', init));
    target.dispatchEvent(new KeyboardEvent('keypress', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
    if (notCancelled && target.form) {
      try {
        target.form.requestSubmit();
      } catch {
        /* Form without a submit button — the page handles Enter itself. */
      }
    }
  }

  // -------------------------------------------------------------------------
  // Messages from the service worker (relayed from login iframes)
  // -------------------------------------------------------------------------

  if (IS_TOP) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id || !msg) return false;
      if (msg.type === 'SHOW_ALERT') {
        CG.ui.showPasswordAlert(msg.alert).then((choice) => sendResponse({ choice }));
        return true;
      }
      if (msg.type === 'SHOW_TOAST') {
        CG.ui.showToast(Array.isArray(msg.sites) ? msg.sites : []);
      }
      return false;
    });
  }

  // -------------------------------------------------------------------------
  // Page checks (top frame only)
  // -------------------------------------------------------------------------

  let lastFactsKey = '';
  let analysisTimer = null;
  let dismissedKey = '';

  function collectFacts() {
    const fields = new Set([...document.querySelectorAll(PASSWORD_SELECTOR), ...seenFields]);
    const formActions = new Set();
    for (const field of fields) {
      const form = field.form;
      if (!form) continue;
      // getAttribute: form.action can be "clobbered" by an <input name="action">.
      const action = form.getAttribute('action');
      if (!action) continue;
      try {
        formActions.add(new URL(action, document.baseURI).href);
      } catch {
        /* Ignore malformed actions. */
      }
    }
    return { hasPassword: fields.size > 0, formActions: [...formActions] };
  }

  async function analyzePage() {
    analysisTimer = null;
    const facts = collectFacts();
    const key = JSON.stringify(facts);
    if (key === lastFactsKey) return;
    lastFactsKey = key;

    const result = await send({ type: 'ANALYZE_PAGE', ...facts });
    const findings = (result && result.findings) || [];
    const findingsKey = findings.map((f) => f.id).join(',');
    if (!findings.length || findingsKey === dismissedKey) {
      CG.ui.hideBanner();
      return;
    }
    CG.ui.showBanner(findings, {
      onLeave: () => send({ type: 'LEAVE_PAGE' }),
      onTrust: async () => {
        CG.ui.hideBanner();
        await send({ type: 'TRUST_SITE' });
      },
      onUnderstood: async () => {
        dismissedKey = findingsKey;
        CG.ui.hideBanner();
        await send({ type: 'DISMISS_FINDINGS', ids: findings.map((f) => f.id) });
      },
      onClose: () => {
        dismissedKey = findingsKey;
        CG.ui.hideBanner();
      },
    });
  }

  function schedulePageAnalysis() {
    if (!IS_TOP || analysisTimer) return;
    analysisTimer = setTimeout(analyzePage, 400);
  }

  if (IS_TOP) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', schedulePageAnalysis, { once: true });
    } else {
      schedulePageAnalysis();
    }

    // Login forms added later by single-page apps.
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (isPasswordField(node) || (node.querySelector && node.querySelector(PASSWORD_SELECTOR))) {
            schedulePageAnalysis();
            return;
          }
        }
      }
    });
    observer.observe(document.documentElement || document, { childList: true, subtree: true });

    // Fields whose type is switched to "password" later.
    window.addEventListener(
      'focusin',
      (e) => {
        const field = eventTarget(e);
        if (isPasswordField(field) && !seenFields.has(field)) {
          seenFields.add(field);
          schedulePageAnalysis();
        }
      },
      true
    );
  }
})();
