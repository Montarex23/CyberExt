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

  const CG = self.CyberGuard;
  $('mascot').innerHTML = CG.mascot.svg(mode === 'left' ? 'happy' : 'alarmed', 96);

  function renderDomain(diff) {
    const rows = diff
      ? [
          { label: t('compareRealBrand', [diff.brandName]), value: diff.realSite },
          { label: t('warnDomainLabel'), parts: diff.parts, bad: true },
        ]
      : [{ label: t('warnDomainLabel'), parts: [{ t: domain, m: true }], bad: true }];
    $('domain-box').replaceChildren(CG.compareView.render(document, { rows, note: diff ? diff.note : null }, t));
  }

  if (mode === 'left') {
    $('title').textContent = t('leftTitle');
    $('lead').append(domain ? rich('leftLead', [domain]) : t('leftLeadNoDomain'));
    $('domain-box').hidden = true;
    $('source').hidden = true;
  } else {
    $('kicker').textContent = t('warnKicker');
    $('title').textContent = t('warnTitle');
    $('lead').textContent = t('warnLead');

    if (domain) {
      renderDomain(null);
      chrome.runtime
        .sendMessage({ type: 'GET_DOMAIN_INFO', domain })
        .then((info) => {
          if (!info || !info.diff) return;
          $('title').textContent = t('warnTitleBrand', [info.diff.brandName]);
          renderDomain(info.diff);
        })
        .catch(() => {});
    } else {
      $('domain-box').hidden = true;
    }

    const sourceKey = { cert_pl: 'srcCert', cert_pl_live: 'srcCert', openphish: 'srcOpenphish' }[src];
    if (sourceKey) $('source').textContent = t(sourceKey);
    else $('source').hidden = true;

    if (!domain) $('proceed').hidden = true;

    countBlockedOnce();
  }

  function countBlockedOnce() {
    const key = `cyberguard-counted:${location.search}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {}
    chrome.runtime.sendMessage({ type: 'BLOCKED_PAGE_SHOWN' }).catch(() => {});
  }

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
