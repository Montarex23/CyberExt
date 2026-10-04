(function (root, factory) {
  'use strict';
  const CG = (root.CyberGuard = root.CyberGuard || {});
  if (typeof require === 'function') {
    if (!CG.domain) require('./domain.js');
    if (!CG.knownSites) require('./known-sites.js');
    if (!CG.lookalike) require('./lookalike.js');
    if (!CG.addressDiff) require('./address-diff.js');
  }
  const api = (CG.pageRisk = factory(CG));
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function (CG) {
  'use strict';

  const LEVEL_ORDER = { danger: 0, warn: 1, info: 2 };
  const MAX_FORM_ACTIONS = 10;

  function analyzePage(page, trustedSites = {}) {
    let url;
    try {
      url = new URL(page.url);
    } catch {
      return { site: '', findings: [] };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { site: '', findings: [] };

    const host = CG.domain.normalizeHost(url.hostname);
    const site = CG.domain.siteKeyForTrust(host);
    const findings = [];
    if (trustedSites[site]) return { site, findings };

    const look = CG.lookalike.analyzeHost(host);
    if (look) {
      findings.push({
        id: look.kind,
        level: look.level,
        host,
        brandName: look.brand ? look.brand.name : '',
        brandSite: look.brand ? look.brand.site : '',
        diff: look.brand ? CG.addressDiff.describe(host, look) : null,
      });
    }

    const actions = Array.isArray(page.formActions) ? page.formActions.slice(0, MAX_FORM_ACTIONS) : [];
    for (const action of actions) {
      let target;
      try {
        target = new URL(action);
      } catch {
        continue;
      }
      if (target.protocol !== 'http:' && target.protocol !== 'https:') continue;
      const targetHost = CG.domain.normalizeHost(target.hostname);
      if (CG.knownSites.sameOwnerHost(host, targetHost)) continue;
      if (trustedSites[CG.domain.siteKeyForTrust(targetHost)]) continue;
      findings.push({ id: 'crossForm', level: 'warn', host, target: CG.domain.siteKeyForTrust(targetHost) });
      break;
    }

    if (page.hasPassword && url.protocol === 'http:' && !CG.domain.isLocalHost(host)) {
      findings.push({ id: 'insecure', level: 'warn', host });
    }

    findings.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
    return { site, findings };
  }

  function worstLevel(findings) {
    return findings.length ? findings[0].level : null;
  }

  return { analyzePage, worstLevel };
});
