/**
 * ============================================================================
 * CyberGuard — Content Script (content.js)
 * ============================================================================
 *
 * Injected into every page (all_frames: true).
 * Responsibilities:
 *   1. PASSWORD ORIGIN BINDING — Monitor <input type="password"> fields,
 *      hash input with SHA-256, and detect credential reuse across domains.
 *   2. FORM ACTION VALIDATION — Detect cross-origin form submissions on
 *      forms containing password fields and block them.
 *   3. PUNYCODE DETECTION — Warn users if the current domain uses
 *      internationalized (xn--) encoding, indicating a potential homograph attack.
 *   4. INSECURE HTTP WARNING — Warn users if password fields exist on
 *      a page served over plain HTTP (credentials sent in clear text).
 *
 * Privacy guarantee: passwords are NEVER stored or transmitted in plain text.
 * ============================================================================
 */

(() => {
  'use strict';

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /** Minimum characters before we consider a password "entered". */
  const MIN_PASSWORD_LENGTH = 6;

  /** Debounce delay (ms) — avoids hashing on every single keystroke. */
  const DEBOUNCE_MS = 500;

  /** Current page's hostname (normalized to lowercase). */
  const CURRENT_DOMAIN = window.location.hostname.toLowerCase();

  /** Current page's protocol (e.g., "http:" or "https:"). */
  const CURRENT_PROTOCOL = window.location.protocol;

  // -------------------------------------------------------------------------
  // Banner System — supports multiple concurrent banners with unique IDs
  // -------------------------------------------------------------------------

  /**
   * Each banner type gets a unique ID so they don't overwrite each other
   * and we can avoid injecting the same banner twice.
   */
  const BANNER_IDS = {
    CREDENTIAL_REUSE: 'cyberguard-banner-credential-reuse',
    CROSS_ORIGIN:     'cyberguard-banner-cross-origin',
    PUNYCODE:         'cyberguard-banner-punycode',
    INSECURE_HTTP:    'cyberguard-banner-insecure-http',
  };

  /** Tracks how many banners are currently stacked so we can offset them. */
  let bannerStackCount = 0;

  /**
   * Creates and injects a warning banner at the top of the page.
   * Multiple banners stack vertically without overlapping.
   *
   * @param {object} options
   * @param {string} options.id           Unique DOM ID for the banner.
   * @param {string} options.htmlContent  Inner HTML for the banner text.
   * @param {string} [options.bgColor]    Background color (default: red).
   * @param {string} [options.shadowColor] Box-shadow color (default: red glow).
   * @returns {HTMLElement|null} The injected banner element, or null if already exists.
   */
  function injectBanner({ id, htmlContent, bgColor = '#dc2626', shadowColor = 'rgba(220, 38, 38, 0.45)' }) {
    // Don't inject the same banner twice.
    if (document.getElementById(id)) return null;

    const banner = document.createElement('div');
    banner.id = id;

    // Calculate vertical offset based on how many banners are already showing.
    const topOffset = bannerStackCount * 60; // ~60px per banner
    bannerStackCount++;

    // Inline styles to guarantee visibility regardless of page CSS.
    Object.assign(banner.style, {
      position: 'fixed',
      top: `${topOffset}px`,
      left: '0',
      width: '100%',
      zIndex: String(2147483647 - bannerStackCount), // High z-index, slight stagger.
      backgroundColor: bgColor,
      color: '#ffffff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '14px',
      fontWeight: '600',
      padding: '14px 24px',
      boxShadow: `0 4px 24px ${shadowColor}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      lineHeight: '1.5',
      boxSizing: 'border-box',
      animation: 'cyberguard-slide-in 0.35s ease-out',
    });

    // Warning text
    const textSpan = document.createElement('span');
    textSpan.innerHTML = htmlContent;
    banner.appendChild(textSpan);

    // Dismiss button
    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = '✕';
    Object.assign(dismissBtn.style, {
      background: 'rgba(255,255,255,0.2)',
      border: 'none',
      color: '#fff',
      fontSize: '18px',
      cursor: 'pointer',
      borderRadius: '6px',
      padding: '4px 12px',
      flexShrink: '0',
      transition: 'background 0.2s',
    });
    dismissBtn.addEventListener('mouseenter', () => {
      dismissBtn.style.background = 'rgba(255,255,255,0.35)';
    });
    dismissBtn.addEventListener('mouseleave', () => {
      dismissBtn.style.background = 'rgba(255,255,255,0.2)';
    });
    dismissBtn.addEventListener('click', () => {
      banner.remove();
      // Note: we don't decrement bannerStackCount to keep spacing stable.
    });
    banner.appendChild(dismissBtn);

    // Inject keyframe animation via a <style> tag (only once).
    if (!document.getElementById('cyberguard-banner-styles')) {
      const style = document.createElement('style');
      style.id = 'cyberguard-banner-styles';
      style.textContent = `
        @keyframes cyberguard-slide-in {
          from { transform: translateY(-100%); opacity: 0; }
          to   { transform: translateY(0);     opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.prepend(banner);
    return banner;
  }

  // -------------------------------------------------------------------------
  // Utility: SHA-256 hashing via Web Crypto API
  // -------------------------------------------------------------------------

  /**
   * Hashes a plain-text string with SHA-256 and returns the hex digest.
   * Uses the browser-native SubtleCrypto — no external libraries needed.
   *
   * @param {string} text  The plain-text password.
   * @returns {Promise<string>}  The lowercase hex-encoded SHA-256 hash.
   */
  async function sha256(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // -------------------------------------------------------------------------
  // Utility: Debounce wrapper
  // -------------------------------------------------------------------------

  /**
   * Returns a debounced version of `fn` that delays invocation until
   * `delay` ms have elapsed since the last call.
   */
  function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  // =========================================================================
  // FEATURE 1: Password Origin Binding (Credential Reuse Detection)
  // =========================================================================

  /**
   * Called (debounced) whenever the user types in a password field.
   * Hashes the password and checks for credential reuse across domains.
   *
   * @param {string} passwordValue  The current value of the password field.
   */
  async function handlePasswordInput(passwordValue) {
    // Ignore short inputs — the user hasn't finished typing.
    if (passwordValue.length < MIN_PASSWORD_LENGTH) return;

    // 1. Hash the password — plain text is discarded immediately.
    const hash = await sha256(passwordValue);

    // 2. Read the credential map from local storage.
    const store = await chrome.storage.local.get('credentialMap');
    const credentialMap = store.credentialMap || {};

    // 3. Check if this hash already exists.
    if (credentialMap[hash]) {
      const knownDomains = credentialMap[hash];

      if (!knownDomains.includes(CURRENT_DOMAIN)) {
        // ⚠ PASSWORD REUSE ON AN UNKNOWN DOMAIN DETECTED!
        console.warn(
          `[CyberGuard] ⚠ Credential reuse detected! Hash is associated with: [${knownDomains.join(', ')}] but current domain is "${CURRENT_DOMAIN}".`
        );

        // Mark this so the form-submission interceptor knows to act.
        window.__cyberguardReuseDetected = true;
        window.__cyberguardReuseHash = hash;
        window.__cyberguardKnownDomains = knownDomains;

        // Inject the credential-reuse warning banner.
        injectBanner({
          id: BANNER_IDS.CREDENTIAL_REUSE,
          htmlContent:
            `🛡️ <strong>CyberGuard Alert:</strong> You are reusing a password on an <u>unknown domain</u>! ` +
            `This password was previously used on: <strong>${knownDomains.join(', ')}</strong>. ` +
            `Submitting this form has been blocked for your safety.`,
        });

        // Notify the service worker (for logging — no data leaves the browser).
        try {
          chrome.runtime.sendMessage({
            type: 'CREDENTIAL_REUSE_DETECTED',
            domain: CURRENT_DOMAIN,
            hashPrefix: hash.substring(0, 8) + '…', // Only a prefix for privacy.
          });
        } catch (_) {
          // Extension context may be invalidated — fail silently.
        }
      }
      // If the domain IS already known, do nothing — this is expected reuse.
    } else {
      // First time seeing this hash: store it with the current domain.
      credentialMap[hash] = [CURRENT_DOMAIN];
      await chrome.storage.local.set({ credentialMap });
      console.log(`[CyberGuard] New credential registered for "${CURRENT_DOMAIN}".`);
    }
  }

  // =========================================================================
  // FEATURE 2: Form Action Validation (Cross-Origin Form Post Detection)
  // =========================================================================

  /**
   * Checks whether a <form> containing a password field submits to a
   * different domain than the current page. Cross-origin form posts are
   * a common phishing technique — the page looks legitimate but sends
   * credentials to an attacker-controlled server.
   *
   * @param {HTMLFormElement} form  The form element to validate.
   */
  function validateFormAction(form) {
    // Skip forms we've already checked.
    if (form.__cyberguardActionChecked) return;
    form.__cyberguardActionChecked = true;

    // Only care about forms that contain a password input.
    const hasPasswordField = form.querySelector('input[type="password"]');
    if (!hasPasswordField) return;

    // Resolve the form's action URL (falls back to current page if empty).
    const actionUrl = form.action || window.location.href;

    try {
      const actionHostname = new URL(actionUrl, window.location.href).hostname.toLowerCase();

      // Compare the form's target domain against the current page's domain.
      // We allow same-domain and subdomain matches (e.g., login.example.com → example.com).
      if (actionHostname !== CURRENT_DOMAIN && !actionHostname.endsWith('.' + CURRENT_DOMAIN) && !CURRENT_DOMAIN.endsWith('.' + actionHostname)) {
        console.warn(
          `[CyberGuard] ⚠ Cross-origin form detected! Page: "${CURRENT_DOMAIN}", Form action: "${actionHostname}"`
        );

        // Flag this form for submission blocking.
        form.__cyberguardCrossOriginBlocked = true;

        // Inject the cross-origin warning banner.
        injectBanner({
          id: BANNER_IDS.CROSS_ORIGIN,
          htmlContent:
            `⚠️ <strong>CyberGuard Alert:</strong> This page is attempting to send your password to a <u>different domain</u> ` +
            `(<strong>${actionHostname}</strong>). This is suspicious — the form submission has been blocked.`,
          bgColor: '#dc2626',
          shadowColor: 'rgba(220, 38, 38, 0.45)',
        });
      }
    } catch (e) {
      // Malformed action URL — treat as suspicious.
      console.warn('[CyberGuard] Could not parse form action URL:', actionUrl, e);
    }
  }

  /**
   * Scans all <form> elements on the page for cross-origin actions.
   * Called on initial load and whenever new DOM nodes are added.
   */
  function scanFormsForCrossOrigin() {
    document.querySelectorAll('form').forEach(validateFormAction);
  }

  // =========================================================================
  // FEATURE 3: Punycode (Homograph) Attack Detection
  // =========================================================================

  /**
   * Checks if the current domain uses internationalized domain name (IDN)
   * encoding (punycode). Domains starting with "xn--" are punycode-encoded,
   * which can be used for homograph attacks where characters from different
   * scripts (e.g., Cyrillic "а" vs Latin "a") make a domain look identical
   * to a legitimate one.
   *
   * This check runs once on page load.
   */
  function checkForPunycode() {
    // Check if any label in the hostname starts with "xn--".
    // A hostname like "xn--pple-43d.com" would render as "аpple.com" in some browsers.
    const domainLabels = CURRENT_DOMAIN.split('.');
    const hasPunycode = domainLabels.some((label) => label.startsWith('xn--'));

    if (hasPunycode) {
      console.warn(
        `[CyberGuard] ⚠ Punycode/homograph domain detected: "${CURRENT_DOMAIN}"`
      );

      injectBanner({
        id: BANNER_IDS.PUNYCODE,
        htmlContent:
          `🔤 <strong>CyberGuard Alert — Homograph Attack:</strong> This domain (<strong>${CURRENT_DOMAIN}</strong>) ` +
          `uses internationalized characters (punycode) that can disguise it as a well-known website. ` +
          `Verify the URL carefully before entering any credentials.`,
        bgColor: '#b91c1c', // Darker red — this is a serious threat.
        shadowColor: 'rgba(185, 28, 28, 0.5)',
      });
    }
  }

  // =========================================================================
  // FEATURE 4: Insecure HTTP Password Warning
  // =========================================================================

  /**
   * If the page is served over plain HTTP (not HTTPS) and contains a
   * password field, any credentials submitted will be sent over the
   * network in clear text — trivially interceptable by an attacker
   * on the same network (e.g., public Wi-Fi).
   *
   * This check runs when password fields are first detected.
   */
  let insecureHttpWarningShown = false;

  function checkInsecureHttp() {
    // Only warn once per page, and only on HTTP pages.
    if (insecureHttpWarningShown) return;
    if (CURRENT_PROTOCOL !== 'http:') return;

    // Check if there's at least one password field on the page.
    const hasPasswordField = document.querySelector('input[type="password"]');
    if (!hasPasswordField) return;

    insecureHttpWarningShown = true;

    console.warn(
      `[CyberGuard] ⚠ Password field detected on insecure HTTP page: "${CURRENT_DOMAIN}"`
    );

    injectBanner({
      id: BANNER_IDS.INSECURE_HTTP,
      htmlContent:
        `🔓 <strong>CyberGuard Alert — Insecure Connection:</strong> This page is served over <u>unencrypted HTTP</u>. ` +
        `Any password you enter will be transmitted in <strong>plain text</strong> and can be intercepted ` +
        `by attackers on your network. Do NOT enter sensitive credentials here.`,
      bgColor: '#d97706', // Amber — serious but not necessarily malicious.
      shadowColor: 'rgba(217, 119, 6, 0.45)',
    });
  }

  // =========================================================================
  // Core: Intercept form submissions (credential reuse + cross-origin)
  // =========================================================================

  /**
   * Attaches a capturing-phase 'submit' listener to the document.
   * Blocks form submissions when:
   *   - Credential reuse has been detected, OR
   *   - The form posts to a cross-origin domain.
   */
  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target;

      // Block 1: Credential reuse detected.
      if (window.__cyberguardReuseDetected) {
        event.preventDefault();
        event.stopImmediatePropagation();
        console.warn('[CyberGuard] Form submission BLOCKED due to credential reuse.');

        // Re-inject the banner in case the user dismissed it and tried again.
        if (window.__cyberguardKnownDomains) {
          injectBanner({
            id: BANNER_IDS.CREDENTIAL_REUSE,
            htmlContent:
              `🛡️ <strong>CyberGuard Alert:</strong> You are reusing a password on an <u>unknown domain</u>! ` +
              `This password was previously used on: <strong>${window.__cyberguardKnownDomains.join(', ')}</strong>. ` +
              `Submitting this form has been blocked for your safety.`,
          });
        }
        return;
      }

      // Block 2: Cross-origin form action detected.
      if (form.__cyberguardCrossOriginBlocked) {
        event.preventDefault();
        event.stopImmediatePropagation();
        console.warn('[CyberGuard] Form submission BLOCKED due to cross-origin action.');
        return;
      }
    },
    true // ← Capturing phase: runs BEFORE any page-level handlers.
  );

  // =========================================================================
  // Wiring: Attach listeners to password fields (including dynamic ones)
  // =========================================================================

  /** Attach the debounced input handler to a single password field. */
  function attachToField(input) {
    if (input.__cyberguardBound) return; // Already wired.
    input.__cyberguardBound = true;

    const debouncedHandler = debounce((e) => {
      handlePasswordInput(e.target.value);
    }, DEBOUNCE_MS);

    input.addEventListener('input', debouncedHandler);
    // Also listen for 'change' to catch auto-fill / paste events.
    input.addEventListener('change', (e) => handlePasswordInput(e.target.value));
  }

  /**
   * Scan the DOM for all current password fields and wire them up.
   * Also triggers the insecure HTTP check and cross-origin form scan
   * since password fields are a prerequisite for those features.
   */
  function scanAndAttach() {
    const fields = document.querySelectorAll('input[type="password"]');
    fields.forEach(attachToField);

    // If we found password fields, run the insecure HTTP check.
    if (fields.length > 0) {
      checkInsecureHttp();
    }

    // Scan forms for cross-origin actions.
    scanFormsForCrossOrigin();
  }

  // =========================================================================
  // Initialization — run all checks on page load
  // =========================================================================

  // FEATURE 3: Punycode check runs immediately (no DOM dependency).
  checkForPunycode();

  // Initial scan for password fields + form validation.
  scanAndAttach();

  // Watch for dynamically-added password fields and forms (e.g., SPAs).
  const observer = new MutationObserver((mutations) => {
    let needsRescan = false;

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // Check if the added node itself is a password input.
        if (node.matches && node.matches('input[type="password"]')) {
          attachToField(node);
          needsRescan = true;
        }

        // Check children of the added node for password inputs.
        if (node.querySelectorAll) {
          const pwFields = node.querySelectorAll('input[type="password"]');
          pwFields.forEach(attachToField);
          if (pwFields.length > 0) needsRescan = true;
        }

        // Check if the added node is a form or contains forms.
        if (node.matches && node.matches('form')) {
          validateFormAction(node);
        }
        if (node.querySelectorAll) {
          node.querySelectorAll('form').forEach(validateFormAction);
        }
      }
    }

    // Re-run insecure HTTP check if new password fields were found.
    if (needsRescan) {
      checkInsecureHttp();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Also handle fields whose type changes to "password" after initial render.
  document.addEventListener(
    'focus',
    (e) => {
      if (e.target && e.target.matches && e.target.matches('input[type="password"]')) {
        attachToField(e.target);
        checkInsecureHttp();

        // Also validate the parent form if there is one.
        const parentForm = e.target.closest('form');
        if (parentForm) {
          validateFormAction(parentForm);
        }
      }
    },
    true
  );

  console.log('[CyberGuard] Content script loaded for:', CURRENT_DOMAIN);
})();
