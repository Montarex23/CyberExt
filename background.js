/**
 * ============================================================================
 * CyberGuard — Service Worker (background.js)
 * ============================================================================
 *
 * Manifest V3 uses a service worker instead of a persistent background page.
 * This file handles:
 *   1. Extension installation / update lifecycle events.
 *   2. Logging the active declarativeNetRequest rule count for debugging.
 *   3. Listening for messages from the content script (credential-reuse alerts).
 *   4. Dynamic whitelisting — adding "allow" rules to override static blocklist
 *      entries when the user clicks "Proceed Anyway" on the warning page.
 *
 * No data ever leaves the browser — everything is processed locally.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Dynamic rule IDs for whitelisted domains start at this offset to avoid
 * collisions with static rule IDs (which start at 1). Chrome requires
 * every rule ID to be a unique positive integer.
 */
const DYNAMIC_RULE_ID_OFFSET = 100000;

// ---------------------------------------------------------------------------
// 1. Installation & Update lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[CyberGuard] Extension ${details.reason}. Version: ${chrome.runtime.getManifest().version}`);

  // Log how many declarativeNetRequest rules are currently loaded.
  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    const sessionRules = await chrome.declarativeNetRequest.getSessionRules();
    console.log(`[CyberGuard] Dynamic rules loaded: ${rules.length}`);
    console.log(`[CyberGuard] Session rules loaded: ${sessionRules.length}`);
  } catch (err) {
    console.warn('[CyberGuard] Could not query dynamic/session rules:', err);
  }

  // Initialize storage with empty structures if they don't exist yet.
  const store = await chrome.storage.local.get(['credentialMap', 'whitelistedDomains']);

  if (!store.credentialMap) {
    await chrome.storage.local.set({ credentialMap: {} });
    console.log('[CyberGuard] Initialized empty credential map in storage.');
  }

  // whitelistedDomains: tracks which domains the user has manually allowed,
  // along with the dynamic rule ID assigned to each.
  if (!store.whitelistedDomains) {
    await chrome.storage.local.set({ whitelistedDomains: {} });
    console.log('[CyberGuard] Initialized empty whitelist in storage.');
  }
});

// ---------------------------------------------------------------------------
// 2. Message handling from content script & warning page
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // -----------------------------------------------------------------------
  // A. Credential-reuse event (from content.js — for logging only)
  // -----------------------------------------------------------------------
  if (message.type === 'CREDENTIAL_REUSE_DETECTED') {
    console.warn(
      `[CyberGuard] ⚠ Credential reuse detected on "${message.domain}".`,
      `Hash prefix: ${message.hashPrefix}`
    );
    // We intentionally do NOT send this data anywhere — privacy first.
    sendResponse({ ack: true });
    return false; // Synchronous response.
  }

  // -----------------------------------------------------------------------
  // B. Warning page URL request (from content.js)
  // -----------------------------------------------------------------------
  if (message.type === 'GET_WARNING_URL') {
    sendResponse({ url: chrome.runtime.getURL('warning.html') });
    return false; // Synchronous response.
  }

  // -----------------------------------------------------------------------
  // C. WHITELIST_DOMAIN — Dynamic whitelisting (from warning.js)
  // -----------------------------------------------------------------------
  // When the user clicks "Proceed Anyway" on the warning page, warning.js
  // sends this message with the domain to whitelist. We:
  //   1. Generate a unique rule ID for this domain.
  //   2. Use chrome.declarativeNetRequest.updateDynamicRules to add an
  //      "allow" rule with a higher priority than the static "redirect" rules.
  //   3. Persist the whitelist entry in chrome.storage.local.
  //   4. Respond with success so warning.js can navigate the user.
  // -----------------------------------------------------------------------
  if (message.type === 'WHITELIST_DOMAIN') {
    const domain = message.domain;

    if (!domain) {
      sendResponse({ success: false, error: 'No domain provided.' });
      return false;
    }

    // Handle asynchronously — the dynamic rule API is Promise-based.
    (async () => {
      try {
        // 1. Load the current whitelist to determine the next rule ID.
        const store = await chrome.storage.local.get('whitelistedDomains');
        const whitelist = store.whitelistedDomains || {};

        // Check if this domain is already whitelisted.
        if (whitelist[domain]) {
          console.log(`[CyberGuard] Domain "${domain}" is already whitelisted (rule ID: ${whitelist[domain]}).`);
          sendResponse({ success: true, ruleId: whitelist[domain] });
          return;
        }

        // 2. Generate a unique rule ID by counting existing whitelist entries.
        const ruleId = DYNAMIC_RULE_ID_OFFSET + Object.keys(whitelist).length + 1;

        // 3. Create the "allow" rule. The key is setting a HIGHER priority
        //    than the static "redirect" rules (which use priority: 1).
        //    Priority 2 ensures the dynamic "allow" overrides the static "redirect".
        const allowRule = {
          id: ruleId,
          priority: 2, // Higher than static rules (priority: 1).
          action: {
            type: 'allow',
          },
          condition: {
            urlFilter: `||${domain}`,
            resourceTypes: ['main_frame'],
          },
        };

        // 4. Add the dynamic rule via declarativeNetRequest.
        await chrome.declarativeNetRequest.updateDynamicRules({
          addRules: [allowRule],
          removeRuleIds: [], // Not removing anything.
        });

        // 5. Persist the whitelist entry.
        whitelist[domain] = ruleId;
        await chrome.storage.local.set({ whitelistedDomains: whitelist });

        console.log(
          `[CyberGuard] ✔ Domain "${domain}" whitelisted with dynamic rule ID: ${ruleId}.`
        );

        sendResponse({ success: true, ruleId });
      } catch (err) {
        console.error(`[CyberGuard] ✖ Failed to whitelist domain "${domain}":`, err);
        sendResponse({ success: false, error: err.message });
      }
    })();

    // Return true to indicate we will call sendResponse asynchronously.
    return true;
  }

  // Fallback: unknown message type.
  return false;
});

// ---------------------------------------------------------------------------
// 3. Service-worker keep-alive heartbeat (optional, for debugging)
// ---------------------------------------------------------------------------

console.log('[CyberGuard] Service worker loaded successfully.');
