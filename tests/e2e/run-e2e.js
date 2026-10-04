#!/usr/bin/env node
/**
 * CyberGuard — End-to-end test in a real Chrome / Edge.
 *
 * Starts a local web server that pretends to be many websites (Chrome is told
 * to resolve every hostname to 127.0.0.1), loads the extension from src/ and
 * walks through the real user flows. Screenshots go to tmp/e2e/.
 *
 * Usage:
 *   npm run build            (rules + translations must exist)
 *   npm run test:e2e
 *   CHROME_PATH="C:\...\msedge.exe" npm run test:e2e     (other browser)
 *   E2E_HEADFUL=1 npm run test:e2e                         (watch it run)
 *
 * Safety: blocked domains are redirected by the extension BEFORE any request,
 * and every hostname resolves to this computer, so no real phishing site is contacted.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert/strict');
const puppeteer = require('puppeteer-core');
const { bitbPage } = require('../fixtures/bitb-page.js');
const { linksPage, inboxPage, emailBody } = require('../fixtures/links-page.js');

const ROOT = path.resolve(__dirname, '..', '..');
const EXTENSION = path.join(ROOT, 'src');
const SHOTS = path.join(ROOT, 'tmp', 'e2e');

const BANK_PASSWORD = 'MojeBankoweHaslo#2026';
const FORUM_PASSWORD = 'ZwykleForumHaslo77';

// ---------------------------------------------------------------------------
// Fake websites
// ---------------------------------------------------------------------------

const posts = []; // { host, path }
const visits = []; // { host, path }

function loginPage(title, action = '/submit') {
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:sans-serif;padding:300px 40px 40px">
  <!-- Form placed below the area where CyberGuard's top banner may appear. -->
  <h1>${title}</h1>
  <form method="post" action="${action}">
    <p><label>Login <input name="user" value="jan"></label></p>
    <p><label>Hasło <input type="password" name="pass" id="pass"></label></p>
    <p><button type="submit" id="submit">Zaloguj</button></p>
  </form>
</body></html>`;
}

function startServer() {
  const server = http.createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST') {
      posts.push({ host, path: url.pathname });
      req.resume();
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<h1>Zalogowano</h1>');
      return;
    }
    visits.push({ host, path: url.pathname });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (url.pathname === '/login') return res.end(loginPage(`Logowanie – ${host}`));
    if (url.pathname === '/bitb') return res.end(bitbPage(host));
    if (url.pathname === '/links') return res.end(linksPage(server.address().port));
    if (url.pathname === '/inbox') return res.end(inboxPage(server.address().port));
    if (url.pathname === '/email') return res.end(emailBody(server.address().port));
    if (url.pathname === '/xform') {
      return res.end(loginPage(`Sklep – ${host}`, `http://collector.evil-site.ru:${server.address().port}/steal`));
    }
    if (url.pathname === '/frame') {
      return res.end(`<!doctype html><html><body style="font-family:sans-serif;padding:40px">
        <h1>Portal z ramką logowania</h1>
        <iframe src="http://login-widget.com:${server.address().port}/login" width="600" height="320"></iframe>
      </body></html>`);
    }
    res.end(`<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${host}</title></head><body><h1>Strona ${host}</h1></body></html>`);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('No Chrome/Edge found — set CHROME_PATH.');
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls an async condition (e.g. a storage write that happens in the background). */
async function waitFor(condition, what, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await condition()) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for: ${what}`);
}

/** All text on the page INCLUDING closed shadow roots (our warnings live there). */
async function pageText(page) {
  const client = await page.createCDPSession();
  const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true });
  await client.detach();
  const parts = [];
  const walk = (node) => {
    if (node.nodeName === 'STYLE' || node.nodeName === 'SCRIPT') return;
    if (node.nodeType === 3 && node.nodeValue.trim()) parts.push(node.nodeValue.trim());
    for (const child of [...(node.children || []), ...(node.shadowRoots || []), ...(node.contentDocument ? [node.contentDocument] : [])]) {
      walk(child);
    }
  };
  walk(root);
  return parts.join(' | ');
}

/** Clicks a <button> with the given text, even inside a closed shadow root. */
async function clickShadowButton(page, label) {
  const client = await page.createCDPSession();
  try {
    const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true });
    let target = null;
    const textOf = (node) => (node.nodeType === 3 ? node.nodeValue : (node.children || []).map(textOf).join(''));
    const walk = (node) => {
      if (target) return;
      if (node.nodeName === 'BUTTON' && textOf(node).trim() === label) target = node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) walk(child);
    };
    walk(root);
    if (!target) throw new Error(`Button "${label}" not found`);
    const { model } = await client.send('DOM.getBoxModel', { backendNodeId: target.backendNodeId });
    const [x1, y1, , , x3, y3] = model.content;
    await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
  } finally {
    await client.detach();
  }
}

async function waitForText(page, text, timeout = 6000) {
  const end = Date.now() + timeout;
  let last = '';
  while (Date.now() < end) {
    last = await pageText(page);
    if (last.includes(text)) return last;
    await sleep(200);
  }
  throw new Error(`Text not found: "${text}"\nPage text: ${last.slice(0, 600)}`);
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await sleep(400); // Let fade-in animations finish.
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

function firstRule(file) {
  const rules = JSON.parse(fs.readFileSync(path.join(EXTENSION, 'rules', file), 'utf-8'));
  return rules[0];
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

const results = [];
async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✔ ${name} (${Date.now() - started} ms)`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✖ ${name}\n      ${String(err.message).split('\n').join('\n      ')}`);
  }
}

async function main() {
  for (const f of ['main.json', 'archive.json', 'meta.json']) {
    if (!fs.existsSync(path.join(EXTENSION, 'rules', f))) throw new Error(`src/rules/${f} missing — run "npm run build" first.`);
  }

  const server = await startServer();
  const port = server.address().port;
  const at = (host, p = '/') => `http://${host}:${port}${p}`;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cyberguard-e2e-'));

  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: !process.env.E2E_HEADFUL,
    pipe: true,
    enableExtensions: true,
    userDataDir,
    defaultViewport: { width: 1200, height: 860 },
    args: [
      '--lang=pl',
      `--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost, EXCLUDE hole.cert.pl`,
      '--no-first-run',
      '--no-default-browser-check',
      ...(process.env.CI ? ['--no-sandbox'] : []), // GitHub's Linux runners restrict the Chrome sandbox.
    ],
    env: { ...process.env, LANG: 'pl_PL.UTF-8', LANGUAGE: 'pl' },
  });

  let extId;
  let worker;
  let swTarget;
  try {
    extId = await browser.installExtension(EXTENSION);
    swTarget = await browser.waitForTarget(
      (t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${extId}/`),
      { timeout: 15000 }
    );
    worker = await swTarget.worker();
    const extUrl = (p) => `chrome-extension://${extId}/${p}`;
    console.log(`\nCyberGuard E2E — extension ${extId}, server port ${port}\n`);

    // Close the welcome tab opened on install, keep one working page.
    await sleep(1000);
    for (const p of await browser.pages()) {
      if (p.url().includes('options.html?welcome=1')) {
        await p.bringToFront();
        await shot(p, '00-welcome');
        await p.close();
      }
    }
    const page = (await browser.pages())[0] || (await browser.newPage());
    const storage = (key) => worker.evaluate((k) => chrome.storage.local.get(k).then((r) => r[k]), key);

    await step('Storage initialised (schema v2, salt, settings)', async () => {
      const all = await worker.evaluate(() => chrome.storage.local.get(null));
      assert.equal(all.schemaVersion, 2);
      assert.ok(all.salt && all.salt.length >= 20);
      assert.equal(all.settings.autoUpdate, true);
    });

    // --- 1. Blocklist ---------------------------------------------------
    const mainRule = firstRule('main.json');
    const blockedHost = mainRule.condition.requestDomains[0];

    await step('Blocked domain → warning page, no request reaches the site', async () => {
      await page.goto(at(blockedHost), { waitUntil: 'domcontentloaded' });
      assert.ok(page.url().startsWith(extUrl('pages/warning/warning.html')), page.url());
      assert.ok(page.url().includes(`domain=${encodeURIComponent(blockedHost)}`));
      await waitForText(page, 'Stop! Ta strona może Cię oszukać');
      await waitForText(page, blockedHost);
      assert.equal(visits.filter((v) => v.host === blockedHost).length, 0, 'request reached the blocked host');
      await shot(page, '01-warning-blocked');
    });

    await step('"Wejdź mimo to" needs checkbox + 5 s, then unblocks for this session only', async () => {
      await page.click('#proceed summary');
      const btn = await page.$('#btn-proceed');
      assert.equal(await btn.evaluate((b) => b.disabled), true);
      await page.click('#risk-ack');
      await sleep(1500);
      assert.equal(await btn.evaluate((b) => b.disabled), true, 'should still be counting down');
      await shot(page, '02-warning-proceed-countdown');
      await page.waitForFunction(() => !document.getElementById('btn-proceed').disabled, { timeout: 8000 });
      // The extension opens http://<domain>/ (port 80). Our fake server runs on another
      // port, so that load fails — what matters is that it is no longer redirected.
      await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), btn.click()]);
      assert.ok(!page.url().includes('warning.html'), page.url());
      await page.goto(at(blockedHost), { waitUntil: 'domcontentloaded' });
      assert.ok(page.url().startsWith(`http://${blockedHost}`), page.url());
      assert.ok(visits.some((v) => v.host === blockedHost));
      const rules = await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
      assert.ok(rules.some((r) => r.action.type === 'allow' && r.condition.requestDomains[0] === blockedHost));
      const dynamic = await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
      assert.ok(!dynamic.some((r) => r.action.type === 'allow' && r.priority === 100), 'exception must not be permanent');
    });

    await step('Unblocked dangerous page still shows a red banner', async () => {
      await waitForText(page, 'Ta strona jest na liście niebezpiecznych');
      await shot(page, '03-banner-blocklisted');
    });

    await step('Warning page refuses to unblock a public suffix (e.g. "com")', async () => {
      await page.goto(extUrl('pages/warning/warning.html?domain=com&src=cert_pl'));
      const res = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'ALLOW_SESSION', domain: 'com' }));
      assert.ok(res.error, JSON.stringify(res));
    });

    await step('Archive domain (packed rule) → warning page without address/proceed', async () => {
      const archiveHost = firstRule('archive.json').condition.requestDomains[0];
      await page.goto(at(archiveHost), { waitUntil: 'domcontentloaded' });
      assert.ok(page.url().startsWith(extUrl('pages/warning/warning.html?src=')), page.url());
      assert.equal(await page.$eval('#domain-box', (e) => e.hidden), true);
      assert.equal(await page.$eval('#proceed', (e) => e.hidden), true);
    });

    // --- 2. Passwords ---------------------------------------------------
    await step('Bank login is learned on submit (plain-HTTP fallback hashing)', async () => {
      await page.goto(at('online.mbank.pl', '/login'));
      await page.type('#pass', BANK_PASSWORD);
      await sleep(600);
      await Promise.all([page.waitForNavigation(), page.click('#submit')]);
      assert.ok(posts.some((p) => p.host === 'online.mbank.pl'), 'login POST should go through');
      // The fingerprint is saved asynchronously by the service worker — wait for it.
      await waitFor(async () => Object.keys(await storage('passwords')).length === 1, 'password remembered');
      const passwords = await storage('passwords');
      const entries = Object.values(passwords);
      assert.equal(entries.length, 1);
      assert.deepEqual(entries[0].sites, ['mbank.pl']);
      assert.ok(!JSON.stringify(passwords).includes(BANK_PASSWORD), 'plain password must never be stored');
    });

    await step('Same password on a foreign site → blocking dialog, form NOT sent', async () => {
      const before = posts.length;
      await page.goto(at('super-promocje24.com', '/login'));
      await page.type('#pass', BANK_PASSWORD);
      await waitForText(page, 'Stop! To może być oszustwo');
      await waitForText(page, 'mBank');
      await shot(page, '04-password-danger-dialog');
      // Try to send anyway with Enter and a click on the page's button.
      await page.evaluate(() => document.getElementById('submit').click());
      await page.keyboard.press('Enter'); // Focus is on our "Zabierz mnie stąd" button → leaves the page.
      await page.waitForFunction(() => location.href.includes('mode=left'), { timeout: 5000 }).catch(() => {});
      assert.equal(posts.length, before, 'password must not be submitted');
      assert.ok(page.url().includes('pages/warning/warning.html?mode=left&domain=super-promocje24.com'), page.url());
      await waitForText(page, 'Dobrze! Podejrzana strona jest zamknięta');
      await shot(page, '05-left-safely');
    });

    await step('"To jest moja zaufana strona" (2 steps) lets the login through and remembers it', async () => {
      await page.goto(at('moj-nowy-sklep.pl', '/login'));
      await page.type('#pass', BANK_PASSWORD);
      await waitForText(page, 'Stop! To może być oszustwo');
      await page.keyboard.press('Tab'); // → "To jest moja zaufana strona"
      await page.keyboard.press('Enter');
      await waitForText(page, 'Na pewno?');
      await shot(page, '06-password-confirm-step');
      await page.keyboard.press('Tab'); // → "Tak, ufam tej stronie"
      await page.keyboard.press('Enter');
      await sleep(500);
      await Promise.all([page.waitForNavigation(), page.click('#submit')]);
      assert.ok(posts.some((p) => p.host === 'moj-nowy-sklep.pl'));
      await waitFor(
        async () => Object.values(await storage('passwords')).some((e) => e.sites.includes('moj-nowy-sklep.pl')),
        'trusted site remembered'
      );
    });

    await step('Fast typist: Enter right after typing is held until checked, then sent', async () => {
      const before = posts.length;
      await page.goto(at('online.mbank.pl', '/login'));
      await page.type('#pass', BANK_PASSWORD, { delay: 0 });
      await Promise.all([page.waitForNavigation({ timeout: 8000 }), page.keyboard.press('Enter')]);
      assert.equal(posts.length, before + 1);
    });

    await step('Ordinary password reused → gentle tip, nothing blocked', async () => {
      await page.goto(at('forum-wedkarskie.pl', '/login'));
      await page.type('#pass', FORUM_PASSWORD);
      await sleep(600);
      await Promise.all([page.waitForNavigation(), page.click('#submit')]);
      await page.goto(at('przepisy-babci.pl', '/login'));
      await page.type('#pass', FORUM_PASSWORD);
      await waitForText(page, 'Wskazówka bezpieczeństwa');
      await waitForText(page, 'forum-wedkarskie.pl');
      await shot(page, '07-reuse-tip');
      await Promise.all([page.waitForNavigation(), page.click('#submit')]);
      assert.ok(posts.some((p) => p.host === 'przepisy-babci.pl'));
    });

    await step('Short passwords (4 characters) are protected too', async () => {
      await page.goto(at('forum-krotkie.pl', '/login'));
      await page.type('#pass', 'xdxd');
      await sleep(600);
      await Promise.all([page.waitForNavigation(), page.click('#submit')]);
      await page.goto(at('inne-forum.pl', '/login'));
      await page.type('#pass', 'xdxd');
      await waitForText(page, 'Wskazówka bezpieczeństwa');
      await waitForText(page, 'forum-krotkie.pl');
    });

    await step('Bank password typed inside a login iframe → dialog shown by the top page', async () => {
      await page.goto(at('portal-x.com', '/frame'));
      const frame = await (await page.waitForSelector('iframe')).contentFrame();
      await frame.waitForSelector('#pass');
      await frame.type('#pass', BANK_PASSWORD);
      await waitForText(page, 'Stop! To może być oszustwo');
      await shot(page, '08-iframe-danger');
    });

    await step('Browser-in-the-Browser: fake bank window with fake address bar → dialog names the REAL site', async () => {
      const before = posts.length;
      await page.goto(at('wygraj-nagrode.pl', '/bitb'));
      await page.click('#open-bitb');
      await page.type('#bitb-pass', BANK_PASSWORD);
      const text = await waitForText(page, 'Stop! To może być oszustwo');
      // The fake address bar says online.mbank.pl — the warning must name the real page.
      assert.ok(text.includes('wygraj-nagrode.pl'), 'dialog should name the real site');
      assert.ok(text.includes('mBank'));
      await shot(page, '08b-bitb-danger');
      await page.evaluate(() => document.getElementById('bitb-submit').click());
      await sleep(500);
      assert.equal(posts.length, before, 'password must not be sent from the fake window');
    });

    // --- Deceptive links ------------------------------------------------
    const LINK_ALERT = 'Uwaga: ten link prowadzi gdzie indziej';
    const linksUrl = at('linki-testowe.pl', '/links');
    const visitsTo = (host) => visits.filter((v) => v.host === host).length;

    await step('Deceptive link (text www.mbank.pl, goes elsewhere) → warning; "Nie otwieraj" keeps you on the page', async () => {
      await page.goto(linksUrl);
      const before = visitsTo('mbank-weryfikacja.xyz');
      await page.click('#l-deceptive');
      const text = await waitForText(page, LINK_ALERT);
      assert.ok(text.includes('mbank.pl') && text.includes('mbank-weryfikacja.xyz'), 'dialog shows both addresses');
      await shot(page, '16-deceptive-link');
      await page.keyboard.press('Enter'); // Focus is on "Nie otwieraj tego linku"
      await sleep(800);
      assert.equal(page.url(), linksUrl);
      assert.equal(visitsTo('mbank-weryfikacja.xyz'), before, 'the deceptive target must not be opened');
    });

    await step('Deceptive link → "Otwórz mimo to" opens it (same tab and new tab)', async () => {
      await page.goto(linksUrl);
      await page.click('#l-deceptive');
      await waitForText(page, LINK_ALERT);
      await page.keyboard.press('Tab'); // → "Otwórz mimo to"
      await Promise.all([page.waitForNavigation({ timeout: 5000 }), page.keyboard.press('Enter')]);
      assert.ok(page.url().startsWith('http://mbank-weryfikacja.xyz'), page.url());

      await page.goto(linksUrl);
      await page.click('#l-blank');
      await waitForText(page, LINK_ALERT);
      const newTab = browser.waitForTarget((t) => t.url().startsWith('http://mbank-weryfikacja.xyz'), { timeout: 5000 });
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      const target = await newTab;
      const tab = await target.page();
      if (tab) await tab.close();
    });

    await step('Honest links, same-company links, plain text and Outlook Safe Links open without a warning', async () => {
      for (const [id, expectedHost] of [
        ['#l-honest', 'online.mbank.pl'],
        ['#l-samebrand', 'www.ipko.pl'],
        ['#l-safe-ok', 'eur01.safelinks.protection.outlook.com'],
        ['#l-text', 'mbank-weryfikacja.xyz'],
      ]) {
        await page.goto(linksUrl);
        await Promise.all([page.waitForNavigation({ timeout: 5000 }), page.click(id)]);
        assert.ok(page.url().startsWith(`http://${expectedHost}`), `${id} → ${page.url()}`);
        assert.ok(!(await pageText(page)).includes(LINK_ALERT), `${id} must not warn`);
      }
    });

    await step('Outlook Safe Links hiding a deceptive target → warning names the REAL target', async () => {
      await page.goto(linksUrl);
      await page.click('#l-safe-bad');
      const text = await waitForText(page, LINK_ALERT);
      assert.ok(text.includes('mbank-weryfikacja.xyz'));
      assert.ok(!text.includes('Link naprawdę prowadzi do: | eur01'), 'should not show the redirector');
    });

    await step('Deceptive link inside an e-mail shown in an iframe → warning on the whole page', async () => {
      await page.goto(at('poczta-testowa.pl', '/inbox'));
      const frame = await (await page.waitForSelector('#mail-body')).contentFrame();
      await frame.waitForSelector('#mail-link');
      const before = visitsTo('mbank-weryfikacja.xyz');
      await frame.click('#mail-link');
      await waitForText(page, LINK_ALERT);
      await shot(page, '17-deceptive-link-in-email');
      await page.keyboard.press('Escape'); // Escape = don't open
      await sleep(800);
      assert.equal(visitsTo('mbank-weryfikacja.xyz'), before);
    });

    // --- 3. Page checks -------------------------------------------------
    await step('Lookalike address → orange banner naming the real site', async () => {
      await page.goto(at('mbank-logowanie.com', '/'));
      await waitForText(page, 'może podszywać się pod mBank');
      await waitForText(page, 'mbank.pl');
      await shot(page, '09-lookalike-banner');
    });

    await step('"Ufam tej stronie" hides the banner and is remembered', async () => {
      await page.goto(at('allegro-okazje.pl', '/'));
      await waitForText(page, 'może podszywać się pod Allegro');
      await clickShadowButton(page, 'Ufam tej stronie');
      await sleep(500);
      assert.ok(!(await pageText(page)).includes('podszywać się pod Allegro'), 'banner should close');
      const trusted = await storage('trustedSites');
      assert.ok(trusted['allegro-okazje.pl'], JSON.stringify(trusted));
      await page.reload();
      await sleep(1200);
      const text = await pageText(page);
      assert.ok(!text.includes('podszywać się pod Allegro'), 'banner should be gone on a trusted site');
    });

    await step('Login form sending password to another site → warning', async () => {
      await page.goto(at('sklep-testowy.pl', '/xform'));
      await waitForText(page, 'Hasło trafi na inną stronę'); // Most important finding = title
      await waitForText(page, 'evil-site.ru');
      await waitForText(page, 'Ta strona nie jest zabezpieczona'); // Second finding, bold prefix
      await shot(page, '10-cross-form-banner');
    });

    await step('Password field on plain HTTP → "not secure" warning (not on local router)', async () => {
      await page.goto(at('forum-wedkarskie.pl', '/login'));
      await waitForText(page, 'Ta strona nie jest zabezpieczona');
      await page.goto(`http://localhost:${port}/login`);
      await sleep(1200);
      assert.ok(!(await pageText(page)).includes('nie jest zabezpieczona'));
    });

    await step('"Rozumiem, nie pokazuj więcej" is remembered per site; settings can bring it back', async () => {
      await page.goto(at('stare-forum.pl', '/login'));
      await waitForText(page, 'Ta strona nie jest zabezpieczona');
      await clickShadowButton(page, 'Rozumiem, nie pokazuj więcej na tej stronie');
      await sleep(400);
      await page.reload();
      await sleep(1200);
      assert.ok(!(await pageText(page)).includes('nie jest zabezpieczona'), 'should stay hidden after reload');
      // Other sites still warn.
      await page.goto(at('inne-forum.pl', '/login'));
      await waitForText(page, 'Ta strona nie jest zabezpieczona');
      // Settings list it; "Pokazuj znowu" restores the warning.
      await page.goto(extUrl('pages/options/options.html'));
      await waitForText(page, 'stare-forum.pl');
      await waitForText(page, 'ukryte ostrzeżenie: brak zabezpieczenia (kłódki)');
      await shot(page, '14-options-hidden-warnings');
      await page.evaluate(() => chrome.runtime.sendMessage({ type: 'UNDISMISS_SITE', site: 'stare-forum.pl' }));
      await page.goto(at('stare-forum.pl', '/login'));
      await waitForText(page, 'Ta strona nie jest zabezpieczona');
    });

    await step('× closes the banner only for now', async () => {
      await page.goto(at('jeszcze-inne-forum.pl', '/login'));
      await waitForText(page, 'Ta strona nie jest zabezpieczona');
      await clickShadowButton(page, '×');
      await sleep(400);
      assert.ok(!(await pageText(page)).includes('nie jest zabezpieczona'));
      await page.reload();
      await waitForText(page, 'Ta strona nie jest zabezpieczona');
    });

    await step('After an extension reload/update, already-open tabs keep working (no page refresh)', async () => {
      await page.goto(at('otwarta-karta.pl', '/login'));
      await waitForText(page, 'Ta strona nie jest zabezpieczona');
      // Simulates an automatic update: the extension is installed again over itself
      // while the tab stays open (same ID, onInstalled reason "update").
      const oldTarget = swTarget;
      assert.equal(await browser.installExtension(EXTENSION), extId);
      swTarget = await browser.waitForTarget(
        (t) => t !== oldTarget && t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${extId}/`),
        { timeout: 15000 }
      );
      worker = await swTarget.worker();
      await sleep(1500);
      // Exactly one banner (the old copy removed its own), and its button works.
      const text = await pageText(page);
      assert.equal(text.split('Ta strona nie jest zabezpieczona').length - 1, 1, 'expected exactly one banner');
      await clickShadowButton(page, 'Rozumiem, nie pokazuj więcej na tej stronie');
      await sleep(500);
      const dismissed = await storage('dismissedFindings');
      assert.deepEqual(dismissed['otwarta-karta.pl'], ['insecure']);
      await page.reload();
      await sleep(1200);
      assert.ok(!(await pageText(page)).includes('nie jest zabezpieczona'));
    });

    // --- 4. Extension pages ---------------------------------------------
    await step('Popup, settings and help pages render in Polish', async () => {
      await page.goto(extUrl('pages/popup/popup.html'));
      await waitForText(page, 'Ochrona włączona');
      await waitForText(page, 'Zatrzymane niebezpieczne strony');
      await page.setViewport({ width: 420, height: 520 });
      await shot(page, '11-popup');
      await page.setViewport({ width: 1200, height: 860 });

      await page.goto(extUrl('pages/options/options.html'));
      await waitForText(page, 'Zapamiętane hasła');
      await waitForText(page, 'mbank.pl');
      await waitForText(page, 'chronione');
      await shot(page, '12-options');

      await page.goto(extUrl('pages/help/help.html'));
      await waitForText(page, 'Oszust może mieć moje dane');
      await shot(page, '13-help');
    });

    await step('Popup status for a known bank and for a lookalike', async () => {
      const status = (url) => page.evaluate((u) => chrome.runtime.sendMessage({ type: 'GET_TAB_STATUS', url: u }), url);
      assert.equal((await status('https://online.mbank.pl/')).kind, 'official');
      assert.equal((await status('https://moj-nowy-sklep.pl/')).kind, 'known');
      assert.equal((await status('https://mbank-logowanie.com/')).kind, 'warning');
      assert.equal((await status('https://jakas-strona.pl/')).kind, 'unknown');
    });

    await step('Live CERT Polska update adds dynamic rules (downloads the public list)', async () => {
      const r = await worker.evaluate(() => self.CyberGuard.rules.updateLiveFeed({ force: true }));
      assert.ok(!r.error, `update failed: ${r.error}`);
      const dynamic = await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
      console.log(`      live list: +${r.added} new domains, ${r.removed} withdrawn, ${dynamic.length} dynamic rules`);

      // The total shown to the user = built-in list + live additions − withdrawn.
      await page.goto(extUrl('pages/options/options.html'));
      const overview = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_OVERVIEW' }));
      const p = overview.protection;
      assert.equal(p.total, p.builtIn + r.added - r.removed);
      const total = p.total.toLocaleString('pl');
      await waitForText(page, r.added || r.removed ? `Razem chronimy przed ${total}` : `Chronimy przed ${total}`);
      await shot(page, '15-options-live-total');
    });
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${path.relative(ROOT, SHOTS)}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('E2E fatal:', err);
  process.exit(1);
});
