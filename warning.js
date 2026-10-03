/**
 * ============================================================================
 * CyberGuard — Warning Page Logic (warning.js)
 * ============================================================================
 *
 * Runs on the warning.html page that users see when a phishing domain is
 * blocked by declarativeNetRequest. Responsibilities:
 *
 *   1. Parse the `?domain=...` query parameter to show which domain was blocked.
 *   2. Wire up the "Go Back" button.
 *   3. Wire up the "Proceed Anyway" button with dynamic whitelisting:
 *      - First click: show a confirmation prompt.
 *      - Second click: send a WHITELIST_DOMAIN message to the service worker,
 *        which adds a dynamic "allow" rule overriding the static blocklist.
 *        On success, navigate the user to the originally blocked URL.
 *   4. Provide keyboard accessibility (Escape key = go back).
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
  // 3. "Proceed Anyway" button — Dynamic Whitelisting
  // -------------------------------------------------------------------------
  //
  // Flow:
  //   Click 1 → Change button text to "Are you sure? Click again."
  //   Click 2 → Send WHITELIST_DOMAIN to background.js → background adds a
  //             dynamic "allow" rule via updateDynamicRules → on success,
  //             navigate to the unblocked URL.
  // -------------------------------------------------------------------------

  const btnProceed = document.getElementById('btn-proceed');
  if (btnProceed) {
    let confirmCount = 0;
    let isProcessing = false; // Prevents double-clicks during async work.

    btnProceed.addEventListener('click', async () => {
      // Guard against rapid clicks while the whitelist request is in-flight.
      if (isProcessing) return;

      confirmCount++;

      // ----- First click: show confirmation prompt -----
      if (confirmCount === 1) {
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

        return;
      }

      // ----- Second click: send whitelist request to service worker -----
      if (confirmCount >= 2) {
        isProcessing = true;

        // Show a loading state on the button.
        btnProceed.textContent = '⏳ Adding exception…';
        btnProceed.style.color = '#fbbf24'; // Amber.
        btnProceed.disabled = true;

        try {
          // Send the WHITELIST_DOMAIN message to background.js.
          // The service worker will:
          //   1. Create a dynamic "allow" rule with higher priority.
          //   2. Persist the whitelist entry in chrome.storage.local.
          //   3. Respond with { success: true, ruleId: ... }.
          const response = await chrome.runtime.sendMessage({
            type: 'WHITELIST_DOMAIN',
            domain: blockedDomain,
          });

          if (response && response.success) {
            console.log(
              `[CyberGuard] Domain "${blockedDomain}" whitelisted successfully (rule ID: ${response.ruleId}).`
            );

            // Update button to success state briefly before navigating.
            btnProceed.textContent = '✔ Exception added — redirecting…';
            btnProceed.style.color = '#34d399'; // Green.

            // Navigate to the originally blocked domain.
            // Use http:// — the site will redirect to HTTPS on its own if configured.
            // Small delay so the user sees the success state.
            setTimeout(() => {
              window.location.href = `http://${blockedDomain}`;
            }, 600);
          } else {
            // The service worker returned an error.
            console.error(
              '[CyberGuard] Whitelist request failed:',
              response ? response.error : 'No response received.'
            );

            btnProceed.textContent = '✖ Failed to add exception. Try again.';
            btnProceed.style.color = '#f87171';
            btnProceed.disabled = false;
            isProcessing = false;
            confirmCount = 0; // Reset so the user can retry.
          }
        } catch (err) {
          // Communication with the service worker failed entirely.
          console.error('[CyberGuard] Could not communicate with service worker:', err);

          btnProceed.textContent = '✖ Extension error. Try reloading.';
          btnProceed.style.color = '#f87171';
          btnProceed.disabled = false;
          isProcessing = false;
          confirmCount = 0;
        }
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
