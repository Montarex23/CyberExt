(function () {
  'use strict';

  const CG = self.CyberGuard;
  if (!CG || !CG.ui || CG.contentLoaded) return;
  CG.contentLoaded = true;

  const MIN_LENGTH = 4;
  const CHECK_DELAY_MS = 300;
  const IS_TOP = window === window.top;
  const PASSWORD_SELECTOR = 'input[type="password"]';

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
        resolve(null);
      }
    });
  }

  let saltPromise = null;
  const hashCache = new Map();

  function fingerprint(value) {
    if (hashCache.has(value)) return hashCache.get(value);
    const promise = (async () => {
      if (CG.crypto.isAvailable()) {
        if (!saltPromise) saltPromise = send({ type: 'GET_SALT' }).then((r) => (r ? r.salt : null));
        const salt = await saltPromise;
        if (!salt) return null;
        return CG.crypto.fingerprint(value, salt);
      }
      const r = await send({ type: 'HASH_PASSWORD', password: value });
      return r ? r.hash : null;
    })().catch(() => null);
    hashCache.set(value, promise);
    if (hashCache.size > 20) hashCache.delete(hashCache.keys().next().value);
    return promise;
  }

  const fieldState = new WeakMap();
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

  let dangerPromise = null;

  function presentDanger(state) {
    const alert = {
      kind: 'password-danger',
      brandName: state.verdict.brandName,
      brandSite: state.verdict.brandSite,
      site: state.verdict.site,
      diff: state.verdict.diff || null,
    };
    if (IS_TOP) return CG.ui.showPasswordAlert(alert);
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

  let bypass = false;

  function block(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

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
      } catch {}
    }
  }

  let linkBypass = false;

  function presentLinkAlert(verdict) {
    const alert = { kind: 'link-mismatch', shown: verdict.shown, real: verdict.real, diff: verdict.diff || null };
    if (IS_TOP) return CG.ui.showLinkAlert(alert);
    return send({ type: 'RELAY_ALERT', alert }).then((r) => (r && r.choice) || 'stay');
  }

  function replayLinkClick(anchor, event, href) {
    const newTab = event.type === 'auxclick' || event.ctrlKey || event.metaKey || event.shiftKey || anchor.target === '_blank';
    if (newTab) {
      window.open(href, '_blank', 'noopener');
      return;
    }
    linkBypass = true;
    try {
      anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window }));
    } finally {
      linkBypass = false;
    }
  }

  function onLinkActivate(event) {
    if (linkBypass || isRetired()) return;
    if (event.type === 'click' && event.button !== 0) return;
    if (event.type === 'auxclick' && event.button !== 1) return;

    const start = eventTarget(event);
    const anchor = start instanceof Element ? start.closest('a[href]') : null;
    if (!anchor || typeof anchor.href !== 'string') return;
    let target;
    try {
      target = new URL(anchor.href);
    } catch {
      return;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return;

    const text = anchor.innerText || anchor.textContent || '';
    const shownHost = CG.linkText.hostFromLinkText(text);
    if (!shownHost || CG.linkText.looseSameHost(shownHost, target.hostname.toLowerCase())) return;

    block(event);
    send({ type: 'CHECK_LINK', text, href: target.href }).then(async (verdict) => {
      if (!verdict || verdict.ok) {
        replayLinkClick(anchor, event, target.href);
        return;
      }
      const choice = await presentLinkAlert(verdict);
      if (choice === 'open') replayLinkClick(anchor, event, target.href);
    });
  }

  window.addEventListener('click', onLinkActivate, true);
  window.addEventListener('auxclick', onLinkActivate, true);

  if (IS_TOP) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id || !msg) return false;
      if (msg.type === 'SHOW_ALERT') {
        const show = msg.alert && msg.alert.kind === 'link-mismatch' ? CG.ui.showLinkAlert : CG.ui.showPasswordAlert;
        show(msg.alert).then((choice) => sendResponse({ choice }));
        return true;
      }
      if (msg.type === 'SHOW_TOAST') {
        CG.ui.showToast(Array.isArray(msg.sites) ? msg.sites : []);
      }
      return false;
    });
  }

  let lastFactsKey = '';
  let analysisTimer = null;
  let dismissedKey = '';

  function collectFacts() {
    const fields = new Set([...document.querySelectorAll(PASSWORD_SELECTOR), ...seenFields]);
    const formActions = new Set();
    for (const field of fields) {
      const form = field.form;
      if (!form) continue;
      const action = form.getAttribute('action');
      if (!action) continue;
      try {
        formActions.add(new URL(action, document.baseURI).href);
      } catch {}
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
    const domainFindings = (result && result.findings) || [];
    const contentFindings = (CG.contentFindings) || [];
    const findings = [...domainFindings, ...contentFindings];
    const findingsKey = findings.map((f) => f.id).join(',');
    if (!findings.length || findingsKey === dismissedKey) {
      if (!contentFindings.length) {
        CG.ui.hideBanner();
      }
      return;
    }
    CG.ui.showBanner(findings, {
      onLeave: () => send({ type: 'LEAVE_PAGE' }),
      onTrust: async () => {
        CG.contentFindings = [];
        CG.ui.hideBanner(true);
        await send({ type: 'TRUST_SITE' });
      },
      onUnderstood: async () => {
        dismissedKey = findingsKey;
        CG.contentFindings = [];
        CG.ui.hideBanner(true);
        await send({ type: 'DISMISS_FINDINGS', ids: findings.map((f) => f.id) });
      },
      onClose: () => {
        dismissedKey = findingsKey;
        CG.contentFindings = [];
        CG.ui.hideBanner(true);
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
