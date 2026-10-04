# CyberGuard 2.0

Rozszerzenie do Chrome i Edge (Manifest V3), które chroni przed stronami wyłudzającymi dane i kradzieżą haseł. Projektowane z myślą o osobach mniej obeznanych z technologią: nic nie trzeba konfigurować, komunikaty są proste, a bezpieczny wybór jest zawsze największym przyciskiem.

**Prywatność:** wszystko dzieje się na komputerze użytkownika. Hasła nie są nigdzie zapisywane ani wysyłane (przechowywany jest tylko ich „odcisk” PBKDF2 z losową solą). Jedyne połączenie sieciowe to pobieranie publicznej listy CERT Polska, które można wyłączyć w ustawieniach.

## Co robi

| Funkcja | Jak działa |
|---|---|
| Blokada stron phishingowych | Ok. 109 tys. domen z list **CERT Polska** i **OpenPhish**. Zamiast strony pojawia się czytelne ostrzeżenie. |
| Świeże ostrzeżenia | Co 12 h pobierana jest aktualna lista CERT Polska (wyłącznik w ustawieniach). Nowe domeny trafiają do reguł dynamicznych, a domeny wycofane przez CERT są odblokowywane. |
| Ochrona haseł | Hasło użyte na znanym serwisie (bank, poczta, gov.pl, Allegro, InPost…) jest chronione automatycznie. Wpisanie go na obcej stronie pokazuje **blokujące ostrzeżenie**, zanim formularz zostanie wysłany. Powtórzenie zwykłego hasła daje tylko delikatną wskazówkę. |
| Podróbki adresów | `mbank-logowanie.com`, `allegro.pl-oferta.xyz`, literówki (`alegro.pl`), znaki z innych alfabetów (`pаypal.com` z cyrylicą). |
| Linki z fałszywym napisem | Link z napisem `www.mbank.pl`, który naprawdę prowadzi gdzie indziej, jest zatrzymywany po kliknięciu, a okno pokazuje oba adresy. Działa też w treści maili i przy linkach opakowanych przez Outlook Safe Links. |
| Formularz wysyłający hasło gdzie indziej | Ostrzeżenie, gdy formularz logowania wysyła hasło do innej firmy. |
| Brak HTTPS | Ostrzeżenie przy polu hasła na stronie `http://` (z pominięciem routerów i sieci lokalnej). |
| Popup | Status strony: „Prawdziwa strona: mBank” / „Znana strona” / „Nieznana strona” / „Uwaga”, oraz przycisk **„Oszust może mieć moje dane – co robić?”**. |
| Pomoc po oszustwie | Lista kroków: bank, hasła, zastrzeżenie PESEL, zgłoszenie do CERT (incydent.cert.pl, SMS 8080), policja. Opcjonalnie czyszczenie ostatniej godziny. |

Wyjątek „Wejdź mimo to” na stronie ostrzeżenia działa tylko do zamknięcia przeglądarki. Wymaga zaznaczenia pola i odczekania 5 s. Ostrzeżenia na stronach można trwale wyłączyć przyciskiem „Ufam tej stronie” lub „Rozumiem, nie pokazuj więcej” i przywrócić w ustawieniach.

## Uruchomienie (deweloperzy)

Wymagany Node.js 22+.

```bash
npm install
npm run build        # tłumaczenia + listy phishingowe (pobiera CERT PL i OpenPhish)
```

Następnie w Chrome otwórz `chrome://extensions` (w Edge: `edge://extensions`), włącz **Tryb dewelopera**, kliknij **Załaduj rozpakowane** i wskaż folder **`src/`**.

> Listy reguł (`src/rules/*.json`, kilka MB) nie są w repozytorium. Generuje je `npm run build:rules`. Bez nich rozszerzenie się nie załaduje.

## Dokumentacja

- **[docs/opis-wtyczki.md](docs/opis-wtyczki.md)**: po co jest wtyczka, co widzi użytkownik, jak działa technicznie, przed czym chroni (także Browser-in-the-Browser i przejęcie sesji), a przed czym nie, prywatność, uprawnienia, ograniczenia.
- **[docs/testowanie.md](docs/testowanie.md)**: testy automatyczne, ręczne scenariusze (T01–T54, L1–L6), testy na prawdziwych stronach, test z użytkownikiem, lista kontrolna przed wydaniem.

## Testy

```bash
npm test                    # 53 testy jednostkowe (domeny, podróbki, hasła, linki, builder, tłumaczenia)
npm run test:e2e            # 29 scenariuszy w prawdziwym Chrome, zrzuty ekranu w tmp/e2e/
npm run measure:lookalike   # skuteczność wykrywania podróbek na liście CERT Polska
npm run test:manual         # fałszywe strony + osobne okno Chrome do testów ręcznych
```

Test E2E uruchamia Chrome z rozszerzeniem i lokalny serwer, który udaje dowolne strony (np. `online.mbank.pl`, `mbank-logowanie.com`). Żadna prawdziwa strona phishingowa nie jest odwiedzana. Szczegóły w [docs/testowanie.md](docs/testowanie.md).

> Windows/PowerShell: jeśli `npm` zgłasza „running scripts is disabled”, używaj `npm.cmd`.

## Struktura

```
src/                      ← to ładujesz w przeglądarce
├── manifest.json
├── background/           service worker: decyzje, storage, reguły DNR, aktualizacja listy CERT
├── content/              ui.js (ostrzeżenia w zamkniętym Shadow DOM) + content.js (pola haseł, formularze, linki)
├── shared/               logika współdzielona z testami i builderem (PSL, podróbki, hasła, linki, filtr list)
├── pages/                warning / popup / options / help
├── _locales/{pl,en}/     generowane z locales/*.json
└── rules/                generowane przez scripts/build-rules.js
locales/                  teksty PL/EN do edycji
scripts/                  build-rules, build-locales, build-psl, package
tests/unit, tests/e2e
```

## Częste zadania

- **Dodanie znanego serwisu** (np. nowego banku): wpis w `src/shared/known-sites.js` (nazwa, oficjalne domeny, słowa-klucze), potem test w `tests/unit/lookalike.test.js`.
- **Zmiana tekstu:** edytuj `locales/pl.json` i `locales/en.json`, a potem uruchom `npm run build:locales`.
- **Paczka do sklepu:** `npm run build && npm run package` tworzy `dist/cyberguard-<wersja>.zip`.
- **Aktualizacja Public Suffix List** (rzadko): `npm run build:psl`.

## Znane ograniczenia

- Strona phishingowa może przechwytywać naciśnięcia klawiszy własnym skryptem, zanim formularz zostanie wysłany. Dlatego ostrzeżenie pojawia się już w trakcie wpisywania hasła, a nie dopiero przy wysyłce.
- Ochrona haseł uczy się od momentu instalacji: hasło jest „znane” dopiero po pierwszym logowaniu na prawdziwej stronie.
- Starsze domeny CERT (w paczkach `archive.json`) blokują się bez podawania adresu na stronie ostrzeżenia i bez opcji „wejdź mimo to”.
