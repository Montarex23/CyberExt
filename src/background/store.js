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

  function serial(fn) {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  }

  async function read(keys) {
    const result = await chrome.storage.local.get(keys);
    for (const key of [].concat(keys)) {
      if (result[key] === undefined && DEFAULTS[key] !== undefined) result[key] = structuredClone(DEFAULTS[key]);
    }
    return result;
  }

  async function get(keys) {
    await queue;
    return read(keys);
  }

  function update(keys, fn) {
    return serial(async () => {
      const state = await read(keys);
      const out = (await fn(state)) || {};
      if (out.patch && Object.keys(out.patch).length) await chrome.storage.local.set(out.patch);
      return out.result;
    });
  }

  function migrate() {
    return serial(async () => {
      const all = await chrome.storage.local.get(null);
      const patch = {};

      if (all.schemaVersion !== SCHEMA_VERSION) {
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
