/**
 * CyberGuard — Storage helpers for the service worker.
 *
 * chrome.storage.local layout (schema v2):
 *   schemaVersion  2
 *   salt           base64, random per installation (PBKDF2 salt)
 *   passwords      { [fingerprint]: { sites: [...], created, lastUsed } }
 *   trustedSites   { [siteKey]: timestamp }   — "Ufam tej stronie" on a warning banner
 *   dismissedFindings { [siteKey]: ["insecure", …] } — "Rozumiem" on a banner (that warning only)
 *   stats          { blocked: number }        — how many dangerous pages were stopped
 *   settings       { autoUpdate: boolean }    — download fresh CERT Polska list
 *   feed           { lastUpdate, added, removed, error, lastAttempt }
 *
 * All writes go through one queue so parallel messages can't overwrite each other.
 */
(function (CG) {
  'use strict';

  const SCHEMA_VERSION = 2;
  const DEFAULTS = {
    passwords: {},
    trustedSites: {},
    dismissedFindings: {},
    stats: { blocked: 0 },
    settings: { autoUpdate: true },
    feed: {},
  };

  let queue = Promise.resolve();

  /** Runs fn after all previously queued work. Use for every read-modify-write. */
  function serial(fn) {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  }

  /** Reads keys, filling in defaults. Does NOT wait for the queue. */
  async function read(keys) {
    const result = await chrome.storage.local.get(keys);
    for (const key of [].concat(keys)) {
      if (result[key] === undefined && DEFAULTS[key] !== undefined) result[key] = structuredClone(DEFAULTS[key]);
    }
    return result;
  }

  /** Reads after pending writes have finished. Never call this inside serial()/update(). */
  async function get(keys) {
    await queue;
    return read(keys);
  }

  /** Read-modify-write: fn receives the current values and returns a patch (or nothing). */
  function update(keys, fn) {
    return serial(async () => {
      const state = await read(keys);
      const out = (await fn(state)) || {};
      if (out.patch && Object.keys(out.patch).length) await chrome.storage.local.set(out.patch);
      return out.result;
    });
  }

  /** Brings storage from v1.x (or nothing) to schema v2. Safe to call on every start. */
  function migrate() {
    return serial(async () => {
      const all = await chrome.storage.local.get(null);
      const patch = {};

      if (all.schemaVersion !== SCHEMA_VERSION) {
        // v1.0/v1.1 kept unsalted SHA-256 hashes ("credentialMap") and PERMANENT
        // allow rules for the blocklist ("whitelistedDomains"). Both are dropped:
        // the hashes can't be converted, and exceptions are per-session now.
        await chrome.storage.local.remove(['credentialMap', 'whitelistedDomains']);
        const dynamic = await chrome.declarativeNetRequest.getDynamicRules();
        if (dynamic.length) {
          await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: dynamic.map((r) => r.id) });
        }
        patch.schemaVersion = SCHEMA_VERSION;
      }

      for (const [key, value] of Object.entries(DEFAULTS)) {
        if (all[key] === undefined) patch[key] = structuredClone(value);
      }
      if (all.settings) patch.settings = { ...DEFAULTS.settings, ...all.settings };
      if (!all.salt) patch.salt = CG.crypto.newSaltBase64();

      if (Object.keys(patch).length) await chrome.storage.local.set(patch);
    });
  }

  async function getSalt() {
    const { salt } = await get('salt');
    if (salt) return salt;
    await migrate();
    return (await get('salt')).salt;
  }

  CG.store = { get, update, serial, migrate, getSalt, SCHEMA_VERSION };
})(self.CyberGuard);
