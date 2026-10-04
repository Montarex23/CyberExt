importScripts(
  '../shared/psl-data.js',
  '../shared/punycode.js',
  '../shared/domain.js',
  '../shared/known-sites.js',
  '../shared/lookalike.js',
  '../shared/address-diff.js',
  '../shared/page-risk.js',
  '../shared/password-logic.js',
  '../shared/crypto.js',
  '../shared/blocklist-filter.js',
  '../shared/link-text.js',
  '../shared/link-check.js',
  '../shared/compare-view.js',
  'store.js',
  'rules.js'
);

const CG = self.CyberGuard;
const EXT_ORIGIN = chrome.runtime.getURL('');
const WARNING_PAGE = chrome.runtime.getURL('pages/warning/warning.html');
const FEED_ALARM = 'cyberguard-live-feed';
const FEED_PERIOD_MINUTES = 12 * 60;

const DISMISSABLE_FINDINGS = new Set(['insecure', 'crossForm', 'lookalike', 'homograph', 'mixedScripts']);

try {
  const p = chrome.storage.local.setAccessLevel && chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  if (p && p.catch) p.catch(() => {});
} catch {}

async function ensureAlarm() {
  if (!(await chrome.alarms.get(FEED_ALARM))) {
    await chrome.alarms.create(FEED_ALARM, { delayInMinutes: 1, periodInMinutes: FEED_PERIOD_MINUTES });
  }
}

async function injectIntoOpenTabs() {
  const files = chrome.runtime.getManifest().content_scripts[0].js;
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.all(
    tabs.map((tab) =>
      chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files }).catch(() => {})
    )
  );
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await CG.store.migrate();
  await ensureAlarm();
  await injectIntoOpenTabs();
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/options/options.html?welcome=1') });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await CG.store.migrate();
  await ensureAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FEED_ALARM) CG.rules.updateLiveFeed();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') setBadge(tabId, null);
});

function setBadge(tabId, level) {
  if (typeof tabId !== 'number' || tabId < 0) return;
  const text = level === 'danger' || level === 'warn' ? '!' : '';
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (text) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: level === 'danger' ? '#B00020' : '#B45309' }).catch(() => {});
  }
}

function httpHost(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? CG.domain.normalizeHost(u.hostname) : '';
  } catch {
    return '';
  }
}

function senderHost(sender) {
  return httpHost(sender.url || '');
}

function tabHost(sender) {
  return httpHost((sender.tab && sender.tab.url) || '');
}

function requireHash(msg) {
  if (!CG.passwordLogic.isValidHash(msg.hash)) throw new Error('invalid-hash');
  return msg.hash;
}

function shortText(value, max = 200) {
  return String(value == null ? '' : value).slice(0, max);
}

function sanitizeDiff(diff) {
  if (!diff || !Array.isArray(diff.parts)) return null;
  const note = diff.note && CG.compareView.NOTE_KEYS.has(diff.note.key)
    ? { key: diff.note.key, params: (Array.isArray(diff.note.params) ? diff.note.params : []).slice(0, 3).map((p) => shortText(p, 100)) }
    : null;
  return {
    brandName: shortText(diff.brandName),
    realSite: shortText(diff.realSite),
    parts: diff.parts.slice(0, 80).map((p) => ({ t: shortText(p && p.t, 64), m: !!(p && p.m), gap: !!(p && p.gap) })),
    note,
  };
}

async function looksFake(host) {
  const look = CG.lookalike.analyzeHost(host);
  return (look && look.kind !== 'mixedScripts') || (await CG.rules.isSessionAllowed(host));
}

const contentHandlers = {
  async GET_SALT() {
    return { salt: await CG.store.getSalt() };
  },

  async HASH_PASSWORD(msg) {
    if (typeof msg.password !== 'string' || !msg.password || msg.password.length > 1024) throw new Error('invalid-password');
    return { hash: await CG.crypto.fingerprint(msg.password, await CG.store.getSalt()) };
  },

  async CHECK_PASSWORD(msg, sender) {
    const hash = requireHash(msg);
    const host = senderHost(sender);
    if (!host) return { level: 'none' };
    const { passwords } = await CG.store.get('passwords');
    const verdict = CG.passwordLogic.evaluate(passwords, hash, host);
    if (verdict.level === 'danger') verdict.diff = CG.addressDiff.describe(host);
    return verdict;
  },

  async REMEMBER_PASSWORD(msg, sender) {
    const hash = requireHash(msg);
    const host = senderHost(sender);
    if (!host || (await looksFake(host))) return { stored: false };
    return CG.store.update(['passwords'], ({ passwords }) => {
      if (CG.passwordLogic.evaluate(passwords, hash, host).level === 'danger') return { result: { stored: false } };
      CG.passwordLogic.remember(passwords, hash, host);
      return { patch: { passwords }, result: { stored: true } };
    });
  },

  async TRUST_PASSWORD_HERE(msg, sender) {
    const hash = requireHash(msg);
    const host = senderHost(sender);
    if (!host) return { stored: false };
    return CG.store.update(['passwords'], ({ passwords }) => {
      CG.passwordLogic.remember(passwords, hash, host);
      return { patch: { passwords }, result: { stored: true } };
    });
  },

  async IS_SITE_TRUSTED(msg, sender) {
    const host = (msg && msg.host) || senderHost(sender) || tabHost(sender);
    if (!host) return { isTrusted: false };
    const site = CG.domain.siteKeyForTrust(host);
    const { trustedSites } = await CG.store.get(['trustedSites']);
    const isUserTrusted = !!(site && trustedSites && trustedSites[site]);
    const isOfficial = !!(CG.knownSites && CG.knownSites.brandForHost(host));
    return { isTrusted: isUserTrusted || isOfficial, site };
  },

  async OPEN_HELP(msg) {
    const topic = msg && msg.topic ? encodeURIComponent(msg.topic) : '';
    const url = chrome.runtime.getURL('pages/help/help.html' + (topic ? `?topic=${topic}` : ''));
    await chrome.tabs.create({ url });
    return { ok: true };
  },

  async ANALYZE_PAGE(msg, sender) {
    if (sender.frameId !== 0 || !sender.tab) return { findings: [] };
    const { trustedSites, dismissedFindings } = await CG.store.get(['trustedSites', 'dismissedFindings']);
    const formActions = Array.isArray(msg.formActions) ? msg.formActions.filter((a) => typeof a === 'string').map((a) => shortText(a, 2048)) : [];
    const analysis = CG.pageRisk.analyzePage({ url: sender.url, hasPassword: !!msg.hasPassword, formActions }, trustedSites);

    const hidden = new Set(dismissedFindings[analysis.site] || []);
    const findings = analysis.findings.filter((f) => !hidden.has(f.id));

    const host = senderHost(sender);
    if (host && (await CG.rules.isSessionAllowed(host))) {
      findings.unshift({ id: 'blocklisted', level: 'danger', host });
    }
    setBadge(sender.tab.id, CG.pageRisk.worstLevel(findings));
    return { site: analysis.site, findings };
  },

  async DISMISS_FINDINGS(msg, sender) {
    const host = tabHost(sender);
    if (!host) return { ok: false };
    const site = CG.domain.siteKeyForTrust(host);
    const ids = (Array.isArray(msg.ids) ? msg.ids : []).filter((id) => DISMISSABLE_FINDINGS.has(id));
    if (!ids.length) return { ok: false };
    await CG.store.update(['dismissedFindings'], ({ dismissedFindings }) => {
      dismissedFindings[site] = [...new Set([...(dismissedFindings[site] || []), ...ids])];
      return { patch: { dismissedFindings } };
    });
    setBadge(sender.tab.id, null);
    return { ok: true };
  },

  async TRUST_SITE(msg, sender) {
    const host = tabHost(sender);
    if (!host) return { ok: false };
    const site = CG.domain.siteKeyForTrust(host);
    await CG.store.update(['trustedSites'], ({ trustedSites }) => {
      trustedSites[site] = Date.now();
      return { patch: { trustedSites } };
    });
    setBadge(sender.tab.id, null);
    return { ok: true };
  },

  async LEAVE_PAGE(msg, sender) {
    if (!sender.tab) return { ok: false };
    const site = CG.domain.siteKeyForTrust(tabHost(sender));
    const url = `${WARNING_PAGE}?mode=left${site ? `&domain=${encodeURIComponent(site)}` : ''}`;
    await chrome.tabs.update(sender.tab.id, { url });
    return { ok: true };
  },

  async CHECK_LINK(msg) {
    if (typeof msg.text !== 'string' || typeof msg.href !== 'string') return { ok: true };
    return CG.linkCheck.checkLink(shortText(msg.text, 300), shortText(msg.href, 4096));
  },

  async RELAY_ALERT(msg, sender) {
    const a = msg.alert || {};
    const isLink = a.kind === 'link-mismatch';
    const safeChoice = isLink ? 'stay' : 'leave';
    if (!sender.tab) return { choice: safeChoice };
    const alert = isLink
      ? { kind: 'link-mismatch', shown: shortText(a.shown), real: shortText(a.real), diff: sanitizeDiff(a.diff) }
      : {
          kind: 'password-danger',
          brandName: shortText(a.brandName),
          brandSite: shortText(a.brandSite),
          site: shortText(a.site),
          diff: sanitizeDiff(a.diff),
        };
    try {
      const response = await chrome.tabs.sendMessage(sender.tab.id, { type: 'SHOW_ALERT', alert }, { frameId: 0 });
      return response && response.choice ? { choice: response.choice } : { choice: safeChoice };
    } catch {
      return { choice: safeChoice };
    }
  },

  async RELAY_TOAST(msg, sender) {
    if (!sender.tab) return { ok: false };
    const sites = Array.isArray(msg.sites) ? msg.sites.slice(0, 3).map((s) => shortText(s, 100)) : [];
    chrome.tabs.sendMessage(sender.tab.id, { type: 'SHOW_TOAST', sites }, { frameId: 0 }).catch(() => {});
    return { ok: true };
  },
};

const pageHandlers = {
  async ALLOW_SESSION(msg, sender) {
    if (!sender.url.startsWith(WARNING_PAGE)) throw new Error('not-allowed');
    await CG.rules.allowForSession(msg.domain);
    return { ok: true };
  },

  async GET_DOMAIN_INFO(msg) {
    const host = CG.domain.normalizeHost(shortText(msg.domain, 253));
    if (!/^[a-z0-9.-]+$/.test(host)) return { diff: null };
    return { diff: CG.addressDiff.describe(host) };
  },

  async BLOCKED_PAGE_SHOWN() {
    await CG.store.update(['stats'], ({ stats }) => {
      stats.blocked = (stats.blocked || 0) + 1;
      return { patch: { stats } };
    });
    return { ok: true };
  },

  async GET_TAB_STATUS(msg) {
    const url = typeof msg.url === 'string' ? msg.url : '';
    if (url.startsWith(WARNING_PAGE)) return { kind: 'blocked' };
    const host = httpHost(url);
    if (!host) return { kind: 'internal' };

    const site = CG.domain.siteKeyForTrust(host);
    const { passwords, trustedSites } = await CG.store.get(['passwords', 'trustedSites']);
    if (await CG.rules.isSessionAllowed(host)) return { kind: 'allowedBlocked', site };

    const { findings } = CG.pageRisk.analyzePage({ url }, trustedSites);
    if (findings.length) return { kind: 'warning', site, finding: findings[0] };

    const brand = CG.knownSites.brandForSite(site);
    if (brand) return { kind: 'official', site, brandName: brand.name };
    if (CG.passwordLogic.isUsedOnSite(passwords, host)) return { kind: 'known', site };
    return { kind: 'unknown', site, insecure: url.startsWith('http:') && !CG.domain.isLocalHost(host) };
  },

  async GET_OVERVIEW() {
    const state = await CG.store.get(['passwords', 'trustedSites', 'dismissedFindings', 'stats', 'settings', 'feed']);
    const meta = await CG.rules.loadMeta();
    const builtIn = (meta && meta.totalDomains) || 0;
    const live = state.feed.lastUpdate ? state.feed.added || 0 : 0;
    const removed = state.feed.lastUpdate ? state.feed.removed || 0 : 0;
    return {
      stats: state.stats,
      settings: state.settings,
      feed: state.feed,
      meta,
      protection: {
        total: builtIn + live - removed,
        builtIn,
        builtAt: meta ? meta.generatedAt : null,
        live,
        removed,
        updatedAt: state.feed.lastUpdate || (meta ? Date.parse(meta.generatedAt) : null),
      },
      passwords: CG.passwordLogic.summarize(state.passwords),
      trustedSites: Object.keys(state.trustedSites).sort(),
      dismissedFindings: Object.entries(state.dismissedFindings)
        .filter(([, ids]) => ids.length)
        .map(([site, ids]) => ({ site, ids }))
        .sort((a, b) => a.site.localeCompare(b.site)),
      sessionAllowed: await CG.rules.listSessionAllowed(),
    };
  },

  async SET_SETTINGS(msg) {
    const autoUpdate = !!(msg.settings && msg.settings.autoUpdate);
    await CG.store.update(['settings'], ({ settings }) => ({ patch: { settings: { ...settings, autoUpdate } } }));
    if (autoUpdate) CG.rules.updateLiveFeed();
    return { ok: true };
  },

  async UPDATE_FEED_NOW() {
    return CG.rules.updateLiveFeed({ force: true });
  },

  async FORGET_PASSWORD(msg) {
    return CG.store.update(['passwords'], ({ passwords }) => {
      const removed = CG.passwordLogic.forget(passwords, shortText(msg.id, 16));
      return { patch: removed ? { passwords } : {}, result: { ok: removed } };
    });
  },

  async FORGET_ALL_PASSWORDS() {
    await CG.store.update(['passwords'], () => ({ patch: { passwords: {} } }));
    return { ok: true };
  },

  async UNTRUST_SITE(msg) {
    await CG.store.update(['trustedSites'], ({ trustedSites }) => {
      delete trustedSites[shortText(msg.site)];
      return { patch: { trustedSites } };
    });
    return { ok: true };
  },

  async UNDISMISS_SITE(msg) {
    await CG.store.update(['dismissedFindings'], ({ dismissedFindings }) => {
      delete dismissedFindings[shortText(msg.site)];
      return { patch: { dismissedFindings } };
    });
    return { ok: true };
  },

  async REMOVE_SESSION_ALLOW(msg) {
    await CG.rules.removeSessionAllowed(CG.domain.normalizeHost(shortText(msg.domain, 253)));
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string' || sender.id !== chrome.runtime.id) return false;

  const fromExtensionPage = typeof sender.url === 'string' && sender.url.startsWith(EXT_ORIGIN);
  const table = fromExtensionPage ? pageHandlers : contentHandlers;
  if (!Object.prototype.hasOwnProperty.call(table, msg.type)) return false;

  Promise.resolve()
    .then(() => table[msg.type](msg, sender))
    .then(sendResponse, (err) => {
      console.warn(`[CyberGuard] ${msg.type} failed:`, err);
      sendResponse({ error: String((err && err.message) || err) });
    });
  return true;
});
