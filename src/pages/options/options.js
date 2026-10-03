/**
 * CyberGuard — Settings page. Also shown once after installation (?welcome=1).
 */
(async () => {
  'use strict';

  const { t } = self.CyberGuardI18n;
  const $ = (id) => document.getElementById(id);
  const lang = t('langCode');

  if (new URLSearchParams(location.search).get('welcome') === '1') {
    $('welcome').hidden = false;
    $('settings-title').hidden = true;
  }
  $('version').textContent = t('optVersion', [chrome.runtime.getManifest().version]);

  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

  function formatDate(ms) {
    return new Date(ms).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function item(textNode, buttonLabel, onRemove) {
    const li = document.createElement('li');
    li.className = 'item';
    const span = document.createElement('span');
    span.className = 'item-text';
    span.append(textNode);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary';
    btn.textContent = buttonLabel;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await onRemove();
      await refresh();
    });
    li.append(span, btn);
    return li;
  }

  const FINDING_SHORT = {
    insecure: 'findShortInsecure',
    crossForm: 'findShortCrossForm',
    lookalike: 'findShortLookalike',
    homograph: 'findShortLookalike',
    mixedScripts: 'findShortMixed',
  };

  /** "<strong>site</strong> — description" */
  function siteLabel(site, description) {
    const frag = document.createDocumentFragment();
    const strong = document.createElement('strong');
    strong.textContent = site;
    frag.append(strong, ` — ${description}`);
    return frag;
  }

  function renderList(listId, emptyId, entries) {
    $(listId).replaceChildren(...entries);
    $(emptyId).hidden = entries.length > 0;
  }

  async function refresh() {
    const data = await send({ type: 'GET_OVERVIEW' });
    if (!data || data.error) return;

    // --- Live list ---
    $('auto-update').checked = data.settings.autoUpdate !== false;
    const feed = data.feed || {};
    let status = '';
    if (feed.lastUpdate) status = t('optFeedLast', [formatDate(feed.lastUpdate), String(feed.added || 0)]);
    else status = t('optFeedNever');
    if (feed.error && feed.lastAttempt && (!feed.lastUpdate || feed.lastAttempt > feed.lastUpdate)) {
      status += ` ${t('optFeedError')}`;
    }
    if (data.meta && data.meta.generatedAt) {
      status += ` ${t('optFeedBuilt', [new Date(data.meta.generatedAt).toLocaleDateString(lang), (data.meta.totalDomains || 0).toLocaleString(lang)])}`;
    }
    $('feed-status').textContent = status;

    // --- Remembered passwords (fingerprints) ---
    renderList(
      'pw-list',
      'pw-empty',
      data.passwords.map((p, i) => {
        const frag = document.createDocumentFragment();
        const label = document.createElement('strong');
        label.textContent = t('optPasswordN', [String(i + 1)]);
        frag.append(label, ` — ${t('optUsedOn', [p.sites.join(', ')])}`);
        if (p.important) {
          const badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = t('optProtectedBadge');
          frag.append(badge);
        }
        return item(frag, t('optForget'), () => send({ type: 'FORGET_PASSWORD', id: p.id }));
      })
    );
    $('btn-forget-all').disabled = data.passwords.length === 0;

    // --- Trusted sites ("Ufam tej stronie") and acknowledged warnings ("Rozumiem") ---
    const trusted = data.trustedSites.map((site) =>
      item(siteLabel(site, t('optTrustedWhole')), t('optShowAgain'), () => send({ type: 'UNTRUST_SITE', site }))
    );
    const dismissed = data.dismissedFindings.map(({ site, ids }) =>
      item(
        siteLabel(site, t('optHiddenWarnings', [ids.map((id) => t(FINDING_SHORT[id] || 'findShortOther')).join(', ')])),
        t('optShowAgain'),
        () => send({ type: 'UNDISMISS_SITE', site })
      )
    );
    renderList('trusted-list', 'trusted-empty', [...trusted, ...dismissed]);

    // --- Session exceptions ---
    renderList(
      'allowed-list',
      'allowed-empty',
      data.sessionAllowed.map((domain) =>
        item(document.createTextNode(domain), t('optBlockAgain'), () => send({ type: 'REMOVE_SESSION_ALLOW', domain }))
      )
    );
  }

  $('auto-update').addEventListener('change', async (e) => {
    await send({ type: 'SET_SETTINGS', settings: { autoUpdate: e.target.checked } });
    await refresh();
  });

  $('btn-update').addEventListener('click', async () => {
    const btn = $('btn-update');
    btn.disabled = true;
    btn.textContent = t('optFeedUpdating');
    await send({ type: 'UPDATE_FEED_NOW' });
    btn.textContent = t('optFeedUpdateNow');
    btn.disabled = false;
    await refresh();
  });

  $('btn-forget-all').addEventListener('click', () => {
    $('pw-clear-start').hidden = true;
    $('pw-clear-confirm').hidden = false;
    $('btn-forget-all-no').focus();
  });
  $('btn-forget-all-no').addEventListener('click', () => {
    $('pw-clear-confirm').hidden = true;
    $('pw-clear-start').hidden = false;
  });
  $('btn-forget-all-yes').addEventListener('click', async () => {
    await send({ type: 'FORGET_ALL_PASSWORDS' });
    $('pw-clear-confirm').hidden = true;
    $('pw-clear-start').hidden = false;
    await refresh();
  });

  await refresh();
})();
