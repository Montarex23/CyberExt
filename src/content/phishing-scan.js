/**
 * CyberGuard – Phishing Content Scanner
 *
 * Scans page content and form inputs for common social-engineering & phishing patterns:
 * 1. Urgency / Time pressure (e.g. "pilne", "w ciągu 24 godzin", "natychmiast", "urgent")
 * 2. Threats / Suspicious activity warnings (e.g. "nietypowa aktywność", "dostęp ograniczony", "konto zablokowane")
 * 3. Demanded verification / Action lures (e.g. "wymagane potwierdzenie", "wymaga ponownej weryfikacji", "potwierdź tożsamość")
 * 4. Password and credential harvesting inputs (<input type="password">, "hasło", login forms)
 *
 * OPTIMIZATION: Verified legitimate sites (official banks, gov portals, trusted platforms)
 * and user-trusted sites are completely bypassed — their content is never scanned.
 */
(function () {
  'use strict';

  const CG = (self.CyberGuard = self.CyberGuard || {});
  const IS_TOP = window === window.top;
  if (!IS_TOP) return;

  let bannerShown = false;
  let scanCount = 0;
  const MAX_SCANS = 5;
  let isTrustedSiteCached = null;

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          resolve(chrome.runtime.lastError || !response || response.error ? null : response);
        });
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Checks whether the current site is an official legitimate site or user-trusted.
   * If yes, we skip scanning content entirely for performance and privacy.
   */
  async function isSiteTrustedOrOfficial() {
    if (isTrustedSiteCached !== null) return isTrustedSiteCached;

    const host = location.hostname;
    if (!host) {
      isTrustedSiteCached = false;
      return false;
    }

    // 1. Check verified official brands/sites list (banks, gov.pl, allegro, google, etc.)
    if (CG.knownSites && typeof CG.knownSites.brandForHost === 'function') {
      const brand = CG.knownSites.brandForHost(host);
      if (brand) {
        isTrustedSiteCached = true;
        return true;
      }
    }

    // 2. Check user-trusted sites from extension storage
    try {
      const res = await send({ type: 'IS_SITE_TRUSTED', host });
      if (res && res.isTrusted) {
        isTrustedSiteCached = true;
        return true;
      }
    } catch {}

    isTrustedSiteCached = false;
    return false;
  }

  /* ─── Pattern Definitions (Polish & English, Unicode-safe) ─── */

  // Category 1: Urgency / Time pressure
  const URGENCY_PATTERNS = [
    /\b(pilne|pilnie|natychmiast|niezwłocznie|niezwlocznie)\b/i,
    /\b(urgent|urgently|immediately|act now|last chance|ostatnia szansa)\b/i,
    /\b(w ci[aą]gu|w ciagu)\s*\d+\s*(godzin|h|minut|dni)\b/i,
    /\b(za|przez)\s*\d+\s*(godzin|h|minut|dni)\b/i,
    /\b(within|in)\s*\d+\s*(hours|hrs|minutes|days)\b/i,
    /\b(sesja wygas[a-z\u0080-\uFFFF]*|session expired)\b/i,
  ];

  // Category 2: Threat / Block / Suspicious Activity
  const THREAT_PATTERNS = [
    /nietypow[a-z\u0080-\uFFFF]*\s+aktywno[sś][cć]/i,
    /podejrzan[a-z\u0080-\uFFFF]*\s+aktywno[sś][cć]/i,
    /suspicious\s+activity/i,
    /unusual\s+activity/i,
    /unauthorized\s+(login|access|attempt)/i,
    /dost[eę]p.*(mo[zż]e.*zosta[cć].*)?ograniczon/i,
    /access.*restricted/i,
    /\b(zablokow[a-z\u0080-\uFFFF]*|zawieszon[a-z\u0080-\uFFFF]*|blokad[a-z\u0080-\uFFFF]*)\b/i,
    /\b(blocked|suspended|deactivated)\b/i,
    /konto.*(zagro[zż]on|przej[eę]te|naruszon)/i,
    /account.*(compromised|at risk)/i,
  ];

  // Category 3: Action / Demanded Verification / Credential Lure
  const ACTION_PATTERNS = [
    /potwierdz[a-z\u0080-\uFFFF]*\s+(konta|konto|to[zż]samo[sś][cć]|dane|profil)/i,
    /wymaga[a-z\u0080-\uFFFF]*\s+(ponownej\s+|natychmiastowej\s+)?(weryfikacji|potwierdzenia)/i,
    /zaloguj\s+si[eę].*potwierdzi/i,
    /log\s*in\s+to\s+(confirm|verify)/i,
    /verify\s+(your\s+)?(account|identity|details)/i,
    /confirm\s+(your\s+)?(account|identity|details)/i,
    /verification\s+(is\s+)?required/i,
    /dop[lł]a[cć]\s+do\s+(paczki|przesy[lł]ki)/i,
    /dop[lł]ata\s+do\s+(paczki|przesy[lł]ki)/i,
    /\b(kod blik|numer blik|kod weryfikacyjny)\b/i,
    /kliknij.*(aby|zeby)\s*odblokowa[cć]/i,
  ];

  function extractPageText() {
    try {
      const clone = document.body ? document.body.cloneNode(true) : null;
      if (!clone) return '';
      const removeTags = clone.querySelectorAll('script, style, noscript, svg, template');
      removeTags.forEach((el) => el.remove());
      return (clone.innerText || clone.textContent || '').toLowerCase();
    } catch {
      return '';
    }
  }

  function matchesAny(patterns, text) {
    return patterns.some((rx) => rx.test(text));
  }

  async function runScan() {
    if (bannerShown) return;

    const proto = location.protocol;
    // Allow http, https, and file (for offline / test files)
    if (proto !== 'http:' && proto !== 'https:' && proto !== 'file:') return;

    // Do not scan the extension's own pages
    if (location.origin === chrome.runtime.getURL('').replace(/\/$/, '')) return;

    // Bypass verified legitimate sites and user-trusted sites completely
    if (await isSiteTrustedOrOfficial()) {
      if (observer) observer.disconnect();
      return;
    }

    const text = extractPageText();
    if (!text || text.length < 30) return;

    scanCount++;

    const hasPasswordInput = !!document.querySelector('input[type="password"]');
    const hasEmailOrUser = !!document.querySelector('input[type="email"], input[type="text"], input[name*="user" i], input[name*="login" i], input[name*="email" i]');
    const hasPasswordText = /\b(hasło|haslo|password)\b/i.test(text);

    const hasUrgency = matchesAny(URGENCY_PATTERNS, text);
    const hasThreat = matchesAny(THREAT_PATTERNS, text);
    const hasAction = matchesAny(ACTION_PATTERNS, text);

    // Scoring logic:
    // 1. Password input + any social-engineering indicator (urgency, threat, or verification demand)
    // 2. High social-engineering indicator (Urgency + Threat, Urgency + Action, or Threat + Action)
    // 3. Password text on page + Urgency + (Threat or Action)
    const credentialRisk = hasPasswordInput || (hasPasswordText && hasEmailOrUser);
    const socialRiskScore = (hasUrgency ? 1 : 0) + (hasThreat ? 1 : 0) + (hasAction ? 1 : 0);

    let isPhishing = false;
    if (credentialRisk && socialRiskScore >= 1) {
      isPhishing = true;
    } else if (socialRiskScore >= 2) {
      isPhishing = true;
    }

    if (isPhishing) {
      triggerBanner();
    }
  }

  function triggerBanner() {
    if (bannerShown) return;
    bannerShown = true;

    CG.contentFindings = [{ id: 'phishingContent', level: 'danger' }];

    if (CG.ui && typeof CG.ui.showBanner === 'function') {
      CG.ui.showBanner(
        CG.contentFindings,
        {
          onLeave: () => {
            try {
              location.replace('about:blank');
            } catch {}
          },
          onTrust: () => {
            CG.contentFindings = [];
            CG.ui.hideBanner(true);
          },
          onUnderstood: () => {
            CG.contentFindings = [];
            CG.ui.hideBanner(true);
          },
          onClose: () => {
            CG.contentFindings = [];
            CG.ui.hideBanner(true);
          },
        }
      );
    }
  }

  // Initial runs
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(runScan, 200), { once: true });
  } else {
    setTimeout(runScan, 200);
  }

  window.addEventListener('load', () => setTimeout(runScan, 400), { once: true });

  // Observe DOM changes (for SPAs, dynamic test pages)
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    if (bannerShown || scanCount >= MAX_SCANS) {
      observer.disconnect();
      return;
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runScan, 500);
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    }, { once: true });
  }

  // Early bypass: if site is already known as legit, disconnect observer immediately
  isSiteTrustedOrOfficial().then((trusted) => {
    if (trusted && observer) {
      observer.disconnect();
    }
  });
})();
