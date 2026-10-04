/**
 * CyberGuard — Page risk assessment.
 *
 * Combines several weak signals into a short list of findings that the
 * content script shows in ONE banner (instead of a pile of separate ones):
 *
 *   lookalike / homograph — address pretends to be a known site
 *   mixedScripts          — address mixes alphabets (possible homograph)
 *   insecure              — password field on plain HTTP (not local network)
 *   crossForm             — login form sends the password to another company's site
 *
 * Plain IDN domains (e.g. Polish "żabka.pl") are NOT reported on their own.
 */
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

  /**
   * @param {object} page
   * @param {string} page.url            Page URL (from the browser, not from the page).
   * @param {boolean} [page.hasPassword] Page contains a password field.
   * @param {string[]} [page.formActions] Absolute URLs of forms that contain a password field.
   * @param {object} [trustedSites]      { siteKey: timestamp } — sites the user said are fine.
   * @returns {{ site: string, findings: object[] }}
   */
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

    // Order within the same level = importance: where the password goes matters
    // more than how it travels.
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
      break; // One is enough to warn.
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
