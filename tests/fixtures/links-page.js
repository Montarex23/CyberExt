'use strict';

const LINK_HOSTS = [
  'linki-testowe.pl', 'mbank-weryfikacja.xyz', 'online.mbank.pl', 'www.ipko.pl',
  'eur01.safelinks.protection.outlook.com', 'poczta-testowa.pl', 'tresc-maila.pl',
];

function shell(title, body) {
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:860px;margin:0 auto;padding:40px 24px;font-size:18px;line-height:1.6}
li{margin:14px 0} small{color:#555}</style></head><body>${body}</body></html>`;
}

function linksPage(port) {
  const u = (host, p = '/') => `http://${host}:${port}${p}`;
  const safelinks = (target) =>
    `${u('eur01.safelinks.protection.outlook.com', '/')}?url=${encodeURIComponent(target)}&data=test`;
  return shell('Linki – test', `<h1>Linki testowe</h1>
<p><em>Fałszywa strona testowa CyberGuard. Najedź myszką na link i spójrz na lewy dolny róg przeglądarki – tam widać, dokąd link naprawdę prowadzi.</em></p>
<ol>
  <li><b>Oszukańczy:</b> <a id="l-deceptive" href="${u('mbank-weryfikacja.xyz')}">https://www.mbank.pl/logowanie</a><br>
      <small>Napis: mbank.pl, naprawdę: mbank-weryfikacja.xyz → ostrzeżenie</small></li>
  <li><b>Uczciwy:</b> <a id="l-honest" href="${u('online.mbank.pl', '/login')}">online.mbank.pl</a><br>
      <small>Napis i cel zgodne → otwiera się bez pytania</small></li>
  <li><b>Ta sama firma, inna domena:</b> <a id="l-samebrand" href="${u('www.ipko.pl')}">www.pkobp.pl</a><br>
      <small>PKO BP ma domeny pkobp.pl i ipko.pl → bez ostrzeżenia</small></li>
  <li><b>Uczciwy link w poczcie Outlook (Safe Links):</b> <a id="l-safe-ok" href="${safelinks(u('online.mbank.pl', '/login'))}">online.mbank.pl</a><br>
      <small>Outlook opakowuje linki; CyberGuard sprawdza prawdziwy cel → bez ostrzeżenia</small></li>
  <li><b>Oszukańczy link w poczcie Outlook:</b> <a id="l-safe-bad" href="${safelinks(u('mbank-weryfikacja.xyz'))}">www.mbank.pl</a><br>
      <small>Ostrzeżenie pokazuje prawdziwy cel (mbank-weryfikacja.xyz), a nie outlook.com</small></li>
  <li><b>Oszukańczy, otwierany w nowej karcie:</b> <a id="l-blank" target="_blank" href="${u('mbank-weryfikacja.xyz')}">allegro.pl</a><br>
      <small>Ostrzeżenie; „Otwórz mimo to” otwiera nową kartę</small></li>
  <li><b>Zwykły tekst:</b> <a id="l-text" href="${u('mbank-weryfikacja.xyz')}">Kliknij tutaj, aby odebrać nagrodę</a><br>
      <small>Napis nie udaje adresu → bez tego ostrzeżenia (strona docelowa i tak dostanie baner podróbki)</small></li>
  <li><b>Link w treści e-maila wyświetlanej w ramce:</b> <a href="${u('poczta-testowa.pl', '/inbox')}">otwórz skrzynkę testową</a></li>
</ol>`);
}

function inboxPage(port) {
  return shell('Poczta – test', `<h1>📧 Poczta testowa</h1>
<p><b>Od:</b> mBank &lt;powiadomienia@mbank-info.com&gt;<br><b>Temat:</b> Twoje konto zostało zablokowane</p>
<iframe id="mail-body" src="http://tresc-maila.pl:${port}/email" width="760" height="260" style="border:1px solid #bbb"></iframe>`);
}

function emailBody(port) {
  return shell('Treść', `<p>Szanowny Kliencie, wykryliśmy podejrzane logowanie. Aby odblokować konto, zaloguj się:</p>
<p><a id="mail-link" href="http://mbank-weryfikacja.xyz:${port}/">https://www.mbank.pl/odblokuj</a></p>`);
}

module.exports = { LINK_HOSTS, linksPage, inboxPage, emailBody };
