/**
 * ============================================================================
 * CyberGuard — Content Script (content.js)
 * ============================================================================
 *
 * Injected into every page (all_frames: true).
 * Responsibilities:
 *   1. Monitor <input type="password"> fields for user input.
 *   2. When the user types >= MIN_PASSWORD_LENGTH chars, hash the value
 *      with SHA-256 (Web Crypto API — no plain text ever stored).
 *   3. Store a mapping of  hash → [domains]  in chrome.storage.local.
 *   4. If the hash already exists but the current domain is NOT in the list,
 *      intercept form submission and inject a visible red warning banner.
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

  /** CSS class used for the injected warning banner (scoped to avoid collisions). */
  const BANNER_CLASS = 'cyberguard-reuse-warning';

  /** Current page's hostname (normalized to lowercase). */
  const CURRENT_DOMAIN = window.location.hostname.toLowerCase();

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

  // -------------------------------------------------------------------------
  // Core: Handle password input
  // -------------------------------------------------------------------------

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

        // Inject the warning banner immediately so the user sees it.
        injectWarningBanner(knownDomains);

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

  // -------------------------------------------------------------------------
  // Core: Inject DOM warning banner
  // -------------------------------------------------------------------------

  /**
   * Injects a prominent, full-width red banner at the top of the page
   * warning the user about credential reuse.
   *
   * @param {string[]} knownDomains  Domains where this password was previously used.
   */
  function injectWarningBanner(knownDomains) {
    // Don't inject more than one banner.
    if (document.querySelector(`.${BANNER_CLASS}`)) return;

    const banner = document.createElement('div');
    banner.className = BANNER_CLASS;

    // Inline styles to guarantee visibility regardless of page CSS.
    Object.assign(banner.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      zIndex: '2147483647', // Max z-index — always on top.
      backgroundColor: '#dc2626',
      color: '#ffffff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '15px',
      fontWeight: '600',
      padding: '16px 24px',
      boxShadow: '0 4px 24px rgba(220, 38, 38, 0.45)',
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
    textSpan.innerHTML =
      `🛡️ <strong>CyberGuard Alert:</strong> You are reusing a password on an <u>unknown domain</u>! ` +
      `This password was previously used on: <strong>${knownDomains.join(', ')}</strong>. ` +
      `Submitting this form has been blocked for your safety.`;
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
  }

  // -------------------------------------------------------------------------
  // Core: Intercept form submissions when reuse is detected
  // -------------------------------------------------------------------------

  /**
   * Attaches a capturing-phase 'submit' listener to the document.
   * If credential reuse has been flagged, the submission is blocked.
   */
  document.addEventListener(
    'submit',
    (event) => {
      if (window.__cyberguardReuseDetected) {
        event.preventDefault();
        event.stopImmediatePropagation();

        console.warn('[CyberGuard] Form submission BLOCKED due to credential reuse.');

        // Re-inject the banner in case the user dismissed it and tried again.
        if (window.__cyberguardKnownDomains) {
          injectWarningBanner(window.__cyberguardKnownDomains);
        }
      }
    },
    true // ← Capturing phase: runs BEFORE any page-level handlers.
  );

  // -------------------------------------------------------------------------
  // Wiring: Attach listeners to password fields (including dynamic ones)
  // -------------------------------------------------------------------------

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

  /** Scan the DOM for all current password fields and wire them up. */
  function scanAndAttach() {
    const fields = document.querySelectorAll('input[type="password"]');
    fields.forEach(attachToField);
  }

  // Initial scan.
  scanAndAttach();

  // Watch for dynamically-added password fields (e.g., SPAs).
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // Check if the added node itself is a password input.
        if (node.matches && node.matches('input[type="password"]')) {
          attachToField(node);
        }

        // Check children of the added node.
        if (node.querySelectorAll) {
          node.querySelectorAll('input[type="password"]').forEach(attachToField);
        }
      }
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
      }
    },
    true
  );

  console.log('[CyberGuard] Content script loaded for:', CURRENT_DOMAIN);
})();
