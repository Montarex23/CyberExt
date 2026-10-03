/**
 * CyberGuard — Toolbar popup: "is this page OK?" in one glance.
 *
 * Wording is careful: green means "the real site of a company we know" or
 * "you logged in here before" — never a blanket "this page is safe",
 * because offline we can't know that.
 */
(async () => {
  'use strict';

  const { t } = self.CyberGuardI18n;
  const $ = (id) => document.getElementById(id);

  $('btn-help').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/help/help.html') });
    window.close();
  });
  $('btn-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  function render(tone, icon, title, text) {
    $('status').dataset.tone = tone;
    $('status-icon').textContent = icon;
    $('status-title').textContent = title;
    $('status-text').textContent = text;
  }

  const FINDING_TITLES = {
    lookalike: (f) => t('findLookalikeTitle', [f.brandName]),
    homograph: () => t('findHomographTitle'),
    mixedScripts: () => t('findMixedTitle'),
  };

  // --- Current tab ---
  let tab = null;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    tab = null;
  }
  const status = (tab && tab.url && (await chrome.runtime.sendMessage({ type: 'GET_TAB_STATUS', url: tab.url }))) || { kind: 'internal' };

  switch (status.kind) {
    case 'official':
      render('ok', '✓', t('statusOfficialTitle', [status.brandName]), t('statusOfficialText', [status.site]));
      break;
    case 'known':
      render('ok', '✓', t('statusKnownTitle'), t('statusKnownText', [status.site]));
      break;
    case 'warning': {
      const f = status.finding;
      const title = (FINDING_TITLES[f.id] || (() => t('statusWarningTitle')))(f);
      render(f.level === 'danger' ? 'danger' : 'warn', '!', title, t('statusWarningText', [status.site]));
      break;
    }
    case 'allowedBlocked':
      render('danger', '!', t('statusAllowedTitle'), t('statusAllowedText', [status.site]));
      break;
    case 'blocked':
      render('ok', '✓', t('statusBlockedTitle'), t('statusBlockedText'));
      break;
    case 'unknown':
      render(
        status.insecure ? 'warn' : 'neutral',
        status.insecure ? '!' : '?',
        t(status.insecure ? 'statusInsecureTitle' : 'statusUnknownTitle'),
        t(status.insecure ? 'statusInsecureText' : 'statusUnknownText', [status.site])
      );
      break;
    default:
      render('neutral', 'i', t('statusInternalTitle'), t('statusInternalText'));
  }

  // --- Stats ---
  const overview = await chrome.runtime.sendMessage({ type: 'GET_OVERVIEW' });
  if (overview && !overview.error) {
    $('stat-blocked').textContent = t('popupBlockedCount', [String(overview.stats.blocked || 0)]);
    const p = overview.protection;
    if (p && p.total) {
      const date = new Date(p.updatedAt).toLocaleDateString(t('langCode'));
      $('stat-db').textContent = t('popupDatabase', [p.total.toLocaleString(t('langCode')), date]);
    }
  }
})();
