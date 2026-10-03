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
 *
 * No data ever leaves the browser — everything is processed locally.
 * ============================================================================
 */

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

  // Initialize storage with an empty credential map if it doesn't exist yet.
  const store = await chrome.storage.local.get('credentialMap');
  if (!store.credentialMap) {
    await chrome.storage.local.set({ credentialMap: {} });
    console.log('[CyberGuard] Initialized empty credential map in storage.');
  }
});

// ---------------------------------------------------------------------------
// 2. Message handling from content script
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Content script sends credential-reuse events for optional telemetry / logging.
  if (message.type === 'CREDENTIAL_REUSE_DETECTED') {
    console.warn(
      `[CyberGuard] ⚠ Credential reuse detected on "${message.domain}".`,
      `Hash prefix: ${message.hashPrefix}`
    );
    // We intentionally do NOT send this data anywhere — privacy first.
    sendResponse({ ack: true });
  }

  // Content script may request the warning page URL (since it cannot use
  // chrome.runtime.getURL from the isolated world in some edge cases).
  if (message.type === 'GET_WARNING_URL') {
    sendResponse({ url: chrome.runtime.getURL('warning.html') });
  }

  // Return true to indicate we will respond asynchronously if needed.
  return true;
});

// ---------------------------------------------------------------------------
// 3. Service-worker keep-alive heartbeat (optional, for debugging)
// ---------------------------------------------------------------------------

console.log('[CyberGuard] Service worker loaded successfully.');
