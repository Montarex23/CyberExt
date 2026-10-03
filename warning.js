/**
 * ============================================================================
 * CyberGuard — Warning Page Logic (warning.js)
 * ============================================================================
 *
 * Runs on the warning.html page that users see when a phishing domain is
 * blocked by declarativeNetRequest. Responsibilities:
 *
 *   1. Parse the `?domain=...` query parameter to show which domain was blocked.
 *   2. Wire up the "Go Back" and "Proceed Anyway" buttons.
 *   3. Provide keyboard accessibility (Escape key = go back).
 *
 * This file has zero external dependencies.
 * ============================================================================
 */

(() => {
  'use strict';

  // -------------------------------------------------------------------------
  // 1. Parse the blocked domain from URL parameters
  // -------------------------------------------------------------------------

  const params = new URLSearchParams(window.location.search);
  const blockedDomain = params.get('domain') || 'Unknown Domain';

  // Display the blocked domain in the UI.
  const domainEl = document.getElementById('blocked-domain');
  if (domainEl) {
    domainEl.textContent = blockedDomain;
  }

  // Update the page title dynamically.
  document.title = `⚠ Blocked: ${blockedDomain} — CyberGuard`;

  // -------------------------------------------------------------------------
  // 2. "Go Back to Safety" button
  // -------------------------------------------------------------------------

  const btnGoBack = document.getElementById('btn-go-back');
  if (btnGoBack) {
    btnGoBack.addEventListener('click', () => {
      // Try navigating back in history; if there's no history, open a new tab page.
      if (window.history.length > 1) {
        window.history.back();
      } else {
        // Chrome's new tab page.
        window.location.href = 'chrome://newtab';
      }
    });
  }

  // -------------------------------------------------------------------------
  // 3. "Proceed Anyway" button (risky — user takes full responsibility)
  // -------------------------------------------------------------------------

  const btnProceed = document.getElementById('btn-proceed');
  if (btnProceed) {
    let confirmCount = 0;

    btnProceed.addEventListener('click', () => {
      confirmCount++;

      if (confirmCount === 1) {
        // First click: change button text to a confirmation prompt.
        btnProceed.textContent = '⚠ Are you sure? Click again to confirm.';
        btnProceed.style.color = '#f87171';
        btnProceed.style.borderColor = 'rgba(248, 113, 113, 0.4)';

        // Reset after 5 seconds if the user doesn't confirm.
        setTimeout(() => {
          if (confirmCount === 1) {
            confirmCount = 0;
            btnProceed.textContent = 'I understand the risk — proceed anyway';
            btnProceed.style.color = '';
            btnProceed.style.borderColor = '';
          }
        }, 5000);
      } else if (confirmCount >= 2) {
        // Second click: actually navigate to the domain (the user accepts the risk).
        // We navigate to the HTTP version; the site may redirect to HTTPS on its own.
        window.location.href = `http://${blockedDomain}`;
      }
    });
  }

  // -------------------------------------------------------------------------
  // 4. Keyboard shortcut: Escape = go back
  // -------------------------------------------------------------------------

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (btnGoBack) btnGoBack.click();
    }
  });

  // -------------------------------------------------------------------------
  // 5. Log for debugging
  // -------------------------------------------------------------------------

  console.log(`[CyberGuard] Warning page loaded. Blocked domain: "${blockedDomain}"`);
})();
