/**
 * CyberGuard — Warning page.
 *
 *   ?domain=evil.pl&src=cert_pl   page blocked by the phishing list
 *   ?src=cert_pl                  blocked by the archive part of the list (domain unknown)
 *   ?mode=left&domain=evil.pl     user pressed "Zabierz mnie stąd" in an on-page warning
 *
 * "Wejdź mimo to" is deliberately small and slow: checkbox + 5 s countdown,
 * and the exception lasts only until the browser is closed.
 */
(() => {
  'use strict';

  const { t, rich } = self.CyberGuardI18n;
  const $ = (id) => document.getElementById(id);

  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') === 'left' ? 'left' : 'blocked';
  const rawDomain = (params.get('domain') || '').toLowerCase();
  const domain = /^[a-z0-9.-]{1,253}$/.test(rawDomain) ? rawDomain : '';
  const src = params.get('src') || '';

  document.body.dataset.mode = mode;
  document.title = t(mode === 'left' ? 'leftPageTitle' : 'warnPageTitle');
  $('btn-leave-text').textContent = t(mode === 'left' ? 'btnHome' : 'btnLeaveSafe');

  // -------------------------------------------------------------------------
  // Content
  // -------------------------------------------------------------------------

  if (mode === 'left') {
    $('left-lead').append(domain ? rich('leftLead', [domain]) : t('leftLeadNoDomain'));
  } else {
    if (domain) $('blocked-domain').textContent = domain;
    else $('domain-box').hidden = true;

    const sourceKey = { cert_pl: 'srcCert', cert_pl_live: 'srcCert', openphish: 'srcOpenphish' }[src];
    if (sourceKey) $('source').textContent = t(sourceKey);
    else $('source').hidden = true;

    // Without a domain there is nothing to unblock.
    if (!domain) $('proceed').hidden = true;

    countBlockedOnce();
  }

  function countBlockedOnce() {
    const key = `cyberguard-counted:${location.search}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      /* Storage blocked — count anyway. */
    }
    chrome.runtime.sendMessage({ type: 'BLOCKED_PAGE_SHOWN' }).catch(() => {});
  }

  // -------------------------------------------------------------------------
  // "Take me somewhere safe" — opens the browser's start page in this tab
  // -------------------------------------------------------------------------

  async function goToSafety() {
    const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
    const isEdge = brands.some((b) => /edge/i.test(b.brand));
    const url = isEdge ? 'edge://newtab/' : 'chrome://newtab/';
    try {
      const tab = await chrome.tabs.getCurrent();
      await chrome.tabs.update(tab.id, { url });
    } catch {
      location.replace('about:blank');
    }
  }

  $('btn-leave').addEventListener('click', goToSafety);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') goToSafety();
  });
  $('btn-leave').focus();

  // -------------------------------------------------------------------------
  // "I know what I'm doing" — session-only exception
  // -------------------------------------------------------------------------

  const COUNTDOWN_SECONDS = 5;
  const ack = $('risk-ack');
  const btnProceed = $('btn-proceed');
  const errorEl = $('proceed-error');
  let countdownTimer = null;

  btnProceed.textContent = t('proceedBtn');

  ack.addEventListener('change', () => {
    clearInterval(countdownTimer);
    btnProceed.disabled = true;
    if (!ack.checked) {
      btnProceed.textContent = t('proceedBtn');
      return;
    }
    let left = COUNTDOWN_SECONDS;
    btnProceed.textContent = t('proceedWait', [String(left)]);
    countdownTimer = setInterval(() => {
      left -= 1;
      if (left > 0) {
        btnProceed.textContent = t('proceedWait', [String(left)]);
        return;
      }
      clearInterval(countdownTimer);
      btnProceed.textContent = t('proceedBtn');
      btnProceed.disabled = false;
    }, 1000);
  });

  btnProceed.addEventListener('click', async () => {
    if (!domain || !ack.checked) return;
    btnProceed.disabled = true;
    errorEl.hidden = true;
    let response = null;
    try {
      response = await chrome.runtime.sendMessage({ type: 'ALLOW_SESSION', domain });
    } catch {
      response = null;
    }
    if (response && response.ok) {
      location.replace(`http://${domain}/`);
    } else {
      errorEl.textContent = t('proceedError');
      errorEl.hidden = false;
      btnProceed.disabled = false;
    }
  });
})();
