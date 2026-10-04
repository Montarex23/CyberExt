'use strict';

/**
 * A "Browser-in-the-Browser" (BitB) phishing page for testing — the classic
 * trick: a fake pop-up window drawn with HTML/CSS, including a fake address bar
 * that shows the bank's real address. To a person it looks like a genuine
 * browser window of online.mbank.pl; in reality every pixel belongs to the
 * page it is served from.
 *
 * Used by tests/manual/serve.js (/bitb) and tests/e2e/run-e2e.js.
 */
function bitbPage(host) {
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Promocja – ${host}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #f3f4f6; font-size: 18px; }
  .site { max-width: 760px; margin: 0 auto; padding: 280px 24px 40px; }
  .cta { font-size: 20px; padding: 14px 24px; background: #c00; color: #fff; border: 0; border-radius: 8px; cursor: pointer; }
  /* The fake browser window */
  #bitb { display: none; position: fixed; top: 120px; left: 50%; transform: translateX(-50%); width: 520px;
          background: #fff; border-radius: 8px; box-shadow: 0 20px 60px rgba(0,0,0,.45); overflow: hidden; z-index: 1000; }
  .titlebar { background: #dee1e6; padding: 8px 12px; font-size: 13px; display: flex; justify-content: space-between; }
  .addressbar { background: #fff; margin: 0 8px 8px; padding: 6px 10px; border-radius: 16px; font-size: 14px;
                border: 1px solid #ccc; color: #202124; }
  .addressbar .lock { color: #188038; }
  .chrome-top { background: #dee1e6; }
  .content { padding: 24px 32px 32px; }
  .content h2 { color: #c40e0e; margin-top: 0; }
  .content input { width: 100%; box-sizing: border-box; font-size: 18px; padding: 10px; margin: 6px 0 14px; }
  .content button { width: 100%; font-size: 18px; padding: 12px; background: #c40e0e; color: #fff; border: 0; border-radius: 6px; }
</style></head><body>
<div class="site">
  <h1>Wygraj 500 zł! (${host})</h1>
  <p><em>Fałszywa strona testowa CyberGuard: atak „Browser-in-the-Browser”.</em></p>
  <p>Aby odebrać nagrodę, potwierdź tożsamość w swoim banku.</p>
  <button class="cta" id="open-bitb" onclick="document.getElementById('bitb').style.display='block'">Zaloguj przez mBank</button>
</div>

<!-- Everything below is just HTML on ${host} — including the "address bar". -->
<div id="bitb" role="dialog" aria-label="Logowanie – mBank">
  <div class="chrome-top">
    <div class="titlebar"><span>🏦 Logowanie – mBank – Google Chrome</span><span>— ▢ ✕</span></div>
    <div class="addressbar"><span class="lock">🔒</span> https://online.mbank.pl/logowanie</div>
  </div>
  <div class="content">
    <h2>mBank – logowanie</h2>
    <form method="post" action="/zalogowano">
      <label>Identyfikator<input name="login" id="bitb-login" value="12345678"></label>
      <label>Hasło<input type="password" name="pass" id="bitb-pass"></label>
      <button type="submit" id="bitb-submit">Zaloguj</button>
    </form>
  </div>
</div>
</body></html>`;
}

module.exports = { bitbPage };
