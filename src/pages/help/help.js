/**
 * CyberGuard — "I gave my data to a scammer" help page.
 *
 * The optional clean-up removes the last hour of history, cookies and form
 * data. It needs the "browsingData" permission, which is requested only when
 * the user presses the button (so installing the extension doesn't ask for it).
 */
(() => {
  'use strict';

  const { t } = self.CyberGuardI18n;
  const $ = (id) => document.getElementById(id);
  const ONE_HOUR_MS = 60 * 60 * 1000;

  $('help-mascot').innerHTML = self.CyberGuard.mascot.svg('calm', 80); // Static SVG.

  function showResult(key, ok) {
    const el = $('clean-result');
    el.textContent = t(key);
    el.style.color = ok ? 'var(--ok-text)' : 'var(--danger-text)';
    el.hidden = false;
  }

  $('btn-clean').addEventListener('click', () => {
    $('clean-start').hidden = true;
    $('clean-confirm').hidden = false;
    $('btn-clean-no').focus();
  });

  $('btn-clean-no').addEventListener('click', () => {
    $('clean-confirm').hidden = true;
    $('clean-start').hidden = false;
  });

  $('btn-clean-yes').addEventListener('click', async () => {
    $('clean-confirm').hidden = true;
    $('clean-start').hidden = false;
    try {
      const granted = await chrome.permissions.request({ permissions: ['browsingData'] });
      if (!granted) {
        showResult('helpCleanDenied', false);
        return;
      }
      await chrome.browsingData.remove(
        { since: Date.now() - ONE_HOUR_MS },
        { history: true, cookies: true, cache: true, formData: true, downloads: false, passwords: false }
      );
      showResult('helpCleanDone', true);
    } catch {
      showResult('helpCleanFailed', false);
    }
  });
})();
