/**
 * CyberGuard — declarativeNetRequest management.
 *
 *   1. Session exceptions: "Wejdź mimo to" on the warning page adds an "allow"
 *      rule that disappears when the browser is closed (updateSessionRules).
 *   2. Live CERT Polska list (optional, on by default, switch in settings):
 *      downloads https://hole.cert.pl/domains/v2/domains.txt every 12 h and
 *      adds domains that appeared after the extension was built as dynamic
 *      rules. Nothing about the user is ever sent — it is a plain download.
 *
 * Rule priorities: static/dynamic redirect = 1, "removed from CERT list" allow = 50,
 * user's session allow = 100 (highest wins).
 */
(function (CG) {
  'use strict';

  const SESSION_ALLOW_PRIORITY = 100;
  const REMOVED_ALLOW_PRIORITY = 50;
  const LIVE_FEED_URL = 'https://hole.cert.pl/domains/v2/domains.txt';
  const LIVE_CHUNK_SIZE = 1000;
  const MAX_LIVE_DOMAINS = 100000;
  const STATIC_RULE_FILES = ['rules/main.json', 'rules/archive.json'];

  const F = CG.blocklistFilter;

  // -------------------------------------------------------------------------
  // Session exceptions
  // -------------------------------------------------------------------------

  function isAllowRule(rule) {
    return rule.action.type === 'allow' && Array.isArray(rule.condition.requestDomains);
  }

  /** Validates a domain coming from the warning page URL (?domain=...). */
  function validateDomain(raw) {
    const host = CG.domain.normalizeHost(raw);
    const valid =
      /^[a-z0-9.-]+$/.test(host) &&
      host.includes('.') &&
      host.length <= 253 &&
      !CG.domain.isIp(host) &&
      !CG.domain.isPublicSuffix(host); // "?domain=com" must not unblock all of .com
    if (!valid) throw new Error('invalid-domain');
    return host;
  }

  function allowForSession(rawDomain) {
    const host = validateDomain(rawDomain);
    return CG.store.serial(async () => {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      if (rules.some((r) => isAllowRule(r) && r.condition.requestDomains[0] === host)) return;
      const id = rules.reduce((max, r) => Math.max(max, r.id), 0) + 1;
      await chrome.declarativeNetRequest.updateSessionRules({
        addRules: [
          {
            id,
            priority: SESSION_ALLOW_PRIORITY,
            action: { type: 'allow' },
            condition: { requestDomains: [host], resourceTypes: ['main_frame'] },
          },
        ],
      });
    });
  }

  async function listSessionAllowed() {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    return rules.filter(isAllowRule).map((r) => r.condition.requestDomains[0]);
  }

  function removeSessionAllowed(host) {
    return CG.store.serial(async () => {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      const ids = rules.filter((r) => isAllowRule(r) && r.condition.requestDomains[0] === host).map((r) => r.id);
      if (ids.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
    });
  }

  async function isSessionAllowed(host) {
    const allowed = await listSessionAllowed();
    return allowed.some((d) => host === d || host.endsWith(`.${d}`));
  }

  // -------------------------------------------------------------------------
  // Live CERT Polska list
  // -------------------------------------------------------------------------

  let staticDomainsCache = null;

  /** Domains already shipped in the static rulesets (built by scripts/build-rules.js). */
  async function loadStaticDomains() {
    if (staticDomainsCache) return staticDomainsCache;
    const all = new Set();
    const cert = new Set();
    for (const file of STATIC_RULE_FILES) {
      try {
        const rules = await (await fetch(chrome.runtime.getURL(file))).json();
        for (const rule of rules) {
          const query = (rule.action.redirect && rule.action.redirect.extensionPath.split('?')[1]) || '';
          const src = new URLSearchParams(query).get('src');
          for (const d of rule.condition.requestDomains || []) {
            all.add(d);
            if (src === 'cert_pl') cert.add(d);
          }
        }
      } catch (err) {
        console.warn(`[CyberGuard] Could not read ${file}:`, err);
      }
    }
    staticDomainsCache = { all, cert };
    return staticDomainsCache;
  }

  /** True if the host or one of its parent domains is already in the set. */
  function isCovered(host, set) {
    for (let h = host; h.includes('.'); h = h.slice(h.indexOf('.') + 1)) {
      if (set.has(h)) return true;
    }
    return false;
  }

  function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  async function updateLiveFeed({ force = false } = {}) {
    const { settings } = await CG.store.get('settings');
    if (!force && settings.autoUpdate === false) return { skipped: true };

    try {
      const response = await fetch(LIVE_FEED_URL, {
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();

      const feed = new Set();
      for (const line of text.split('\n')) {
        const host = F.normalizeFeedHost(line);
        if (host && F.blockDecision(host).ok) feed.add(host);
      }

      const shipped = await loadStaticDomains();
      // Sanity check: a broken download must not "un-block" half of the list.
      if (feed.size < Math.max(1000, shipped.cert.size * 0.5)) throw new Error('feed-too-small');

      const added = F.collapseSubdomains([...feed].filter((h) => !isCovered(h, shipped.all))).slice(0, MAX_LIVE_DOMAINS);
      const removed = [...shipped.cert].filter((h) => !feed.has(h));

      let id = 1;
      const addRules = [
        ...chunk(added, LIVE_CHUNK_SIZE).map((domains) => ({
          id: id++,
          priority: 1,
          action: { type: 'redirect', redirect: { extensionPath: '/pages/warning/warning.html?src=cert_pl_live' } },
          condition: { requestDomains: domains, resourceTypes: ['main_frame'] },
        })),
        ...chunk(removed, LIVE_CHUNK_SIZE).map((domains) => ({
          id: id++,
          priority: REMOVED_ALLOW_PRIORITY,
          action: { type: 'allow' },
          condition: { requestDomains: domains, resourceTypes: ['main_frame'] },
        })),
      ];

      const old = await chrome.declarativeNetRequest.getDynamicRules();
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.map((r) => r.id), addRules });

      const feedState = { lastUpdate: Date.now(), lastAttempt: Date.now(), added: added.length, removed: removed.length, error: null };
      await CG.store.update(['feed'], () => ({ patch: { feed: feedState } }));
      console.log(`[CyberGuard] Live CERT list: +${added.length} new, ${removed.length} withdrawn.`);
      return feedState;
    } catch (err) {
      const message = String((err && err.message) || err);
      console.warn('[CyberGuard] Live list update failed:', message);
      await CG.store.update(['feed'], ({ feed }) => ({ patch: { feed: { ...feed, lastAttempt: Date.now(), error: message } } }));
      return { error: message };
    }
  }

  async function loadMeta() {
    try {
      return await (await fetch(chrome.runtime.getURL('rules/meta.json'))).json();
    } catch {
      return null;
    }
  }

  CG.rules = {
    allowForSession,
    listSessionAllowed,
    removeSessionAllowed,
    isSessionAllowed,
    updateLiveFeed,
    loadMeta,
    validateDomain,
  };
})(self.CyberGuard);
