# CyberGuard: jak testować

> Opis działania wtyczki: [opis-wtyczki.md](opis-wtyczki.md)

## Spis treści

1. [Poziomy testów w skrócie](#1-poziomy-testów-w-skrócie)
2. [Przygotowanie](#2-przygotowanie)
3. [Testy automatyczne](#3-testy-automatyczne)
4. [Testy ręczne na fałszywych stronach](#4-testy-ręczne-na-fałszywych-stronach)
5. [Testy na prawdziwych stronach](#5-testy-na-prawdziwych-stronach)
6. [Test z prawdziwym użytkownikiem](#6-test-z-prawdziwym-użytkownikiem)
7. [Lista kontrolna przed wydaniem](#7-lista-kontrolna-przed-wydaniem)
8. [Rozwiązywanie problemów](#8-rozwiązywanie-problemów)

---

## 1. Poziomy testów w skrócie

| Poziom | Komenda | Czas | Co sprawdza |
|---|---|---|---|
| Testy jednostkowe | `npm test` | ~1 s | 60 testów logiki: domeny, podróbki adresów, różnice adresów, maskotka, hasła, linki, builder list, tłumaczenia, manifest, ikony, kodowanie plików |
| Test end-to-end | `npm run test:e2e` | ~1,5 min | 30 scenariuszy w prawdziwym Chrome z wtyczką, ze zrzutami ekranu (także jasny i ciemny motyw) |
| Pomiar wykrywania podróbek | `npm run measure:lookalike` | ~5 s | skuteczność na 126 tys. prawdziwych domen z CERT Polska i fałszywe alarmy na legalnych domenach |
| Testy ręczne (fałszywe strony) | `npm run test:manual` | ~20 min | wszystkie funkcje oczami użytkownika, bez ryzyka |
| Testy na prawdziwych stronach | — | ~10 min | zachowanie w prawdziwym internecie |
| Test z użytkownikiem | — | ~30 min | czy osoba nietechniczna rozumie komunikaty |

**Zasada bezpieczeństwa dla wszystkich testów:** nigdy nie wpisuj prawdziwego hasła na obcej stronie i nie wchodź na prawdziwe strony oszustów w przeglądarce bez włączonego CyberGuard.

## 2. Przygotowanie

**Wymagania:** Node.js 22 lub nowszy, Google Chrome (albo Microsoft Edge), Windows / macOS / Linux.

```powershell
npm install
npm run build
```

`npm run build` generuje tłumaczenia i pobiera listy CERT Polska oraz OpenPhish do `src/rules/`. Bez tego rozszerzenie się nie załaduje. Wynik powinien wyglądać mniej więcej tak:

```
[build-rules] Unique domains: 108901
[build-rules] main.json:      25000 rules (5,825 KB)
[build-rules] archive.json:   84 rules / 83901 domains (1,712 KB)
```

> **Windows / PowerShell:** jeśli pojawi się błąd `npm.ps1 cannot be loaded because running scripts is disabled`, używaj `npm.cmd` zamiast `npm` (np. `npm.cmd run build`). Można też jednorazowo zezwolić na skrypty: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## 3. Testy automatyczne

### 3.1 Testy jednostkowe

```powershell
npm test
```

Oczekiwany wynik: `ℹ pass 60`, `ℹ fail 0`. Testy są w `tests/unit/`:

| Plik | Zakres |
|---|---|
| `domain.test.js` | domena rejestrowalna (`login.mbank.pl` → `mbank.pl`), końcówki publiczne, adresy lokalne, punycode |
| `lookalike.test.js` | podróbki (`mbank-logowanie.com`, `alegro.pl`, `pаypal.com`), brak alarmu na legalnych domenach z `legit-domains.js` |
| `page-risk.test.js` | baner: brak HTTPS, formularz na inną stronę, kolejność ostrzeżeń, zaufane strony |
| `password-logic.test.js` | werdykty haseł (`none`/`ok`/`reuse`/`danger`), limity pamięci, odciski PBKDF2 |
| `build-rules.test.js` | parsowanie list, pomijanie platform (`docs.google.com`), budowa reguł |
| `address-diff.test.js` | podświetlanie różnicy: brakująca/dodatkowa/podmieniona/zamieniona litera, obcy alfabet, prawdziwy właściciel adresu, inna końcówka; maskotka we wszystkich nastrojach |
| `link-check.test.js` | rozpoznawanie adresu w napisie linku, porównanie z celem, ta sama firma, rozpakowanie Outlook Safe Links / Google / Facebook |
| `extension.test.js` | pliki z manifestu istnieją, ikony to prawdziwe PNG, pliki w kodowaniu akceptowanym przez Chrome, minimalne uprawnienia, każdy tekst istnieje po polsku i angielsku, brak `innerHTML` z danymi |

### 3.2 Test end-to-end w prawdziwym Chrome

```powershell
npm run test:e2e
```

Skrypt `tests/e2e/run-e2e.js`:
- uruchamia osobny, tymczasowy profil Chrome z załadowanym `src/`,
- stawia lokalny serwer udający dowolne strony (`online.mbank.pl`, `mbank-logowanie.com`…). Przeglądarka kieruje wszystkie adresy na Twój komputer, więc **żadna prawdziwa strona oszusta nie jest odwiedzana**,
- sprawdza, czy formularze zostały, czy nie zostały wysłane, oraz co jest zapisane w pamięci rozszerzenia.

Oczekiwany wynik: `30/30 passed`. Scenariusze:

| # | Scenariusz |
|---|---|
| 1 | Pamięć zainicjowana (schemat v2, sól, ustawienia) |
| 2 | Domena z listy → strona ostrzeżenia; żadne żądanie nie trafia do strony |
| 3 | „Wejdź mimo to” wymaga zaznaczenia i 5 s; wyjątek tylko na sesję, nie stały |
| 4 | Odblokowana strona z listy ma czerwony baner |
| 5 | Nie da się odblokować całej końcówki (`?domain=com`) |
| 6 | Domena z archiwum → ostrzeżenie bez adresu i bez „wejdź mimo to” |
| 7 | Logowanie w „banku” zapamiętuje odcisk przy wysłaniu; hasło nie trafia do pamięci |
| 8 | To samo hasło na obcej stronie → okno „Stop!”, formularz **nie** wysłany, „Zabierz mnie stąd” działa |
| 9 | „To jest moja zaufana strona” (2 kroki) przepuszcza logowanie i zapamiętuje stronę |
| 10 | Szybkie pisanie + Enter: wysyłka wstrzymana do sprawdzenia, potem wysłana |
| 11 | Zwykłe hasło na drugim forum → wskazówka, nic nie blokuje |
| 12 | Hasła 4-znakowe też są chronione |
| 13 | Hasło bankowe w ramce logowania → okno na całej stronie |
| 13a | Browser-in-the-Browser: fałszywe okno banku z podrobionym paskiem adresu → okno „Stop!” podaje prawdziwy adres, hasło nie zostaje wysłane |
| 13b | Link z napisem `https://www.mbank.pl/…` prowadzący gdzie indziej → okno z porównaniem; „Nie otwieraj” zostawia na stronie, cel nie jest odwiedzany |
| 13c | „Otwórz mimo to” otwiera link w tej samej karcie, a dla `target=_blank` w nowej |
| 13d | Uczciwy link, link tej samej firmy (`pkobp.pl` → `ipko.pl`), zwykły napis i uczciwy link Outlook Safe Links → bez ostrzeżenia |
| 13e | Outlook Safe Links ukrywający oszukańczy cel → okno pokazuje prawdziwy cel |
| 13f | Oszukańczy link w treści e-maila wyświetlanej w ramce → okno na całej stronie, Esc = nie otwieraj |
| 14 | Podróbka adresu → baner z nazwą prawdziwej strony |
| 15 | „Ufam tej stronie” ukrywa baner trwale |
| 16 | Formularz wysyłający hasło do innej firmy → ostrzeżenie |
| 17 | Pole hasła na HTTP → ostrzeżenie (ale nie na adresie lokalnym) |
| 18 | „Rozumiem, nie pokazuj więcej” zapamiętane dla strony; ustawienia przywracają |
| 19 | „×” zamyka tylko na teraz |
| 20 | Po aktualizacji rozszerzenia otwarte karty działają bez odświeżania |
| 21 | Popup, ustawienia i pomoc po polsku |
| 21a | Zrzuty wyglądu w jasnym i ciemnym motywie: strona ostrzeżenia (z porównaniem adresów), „dobrze, że wyszedłeś”, ekran powitalny, pomoc, popup (`tmp/e2e/design-*-light.png` / `-dark.png`) |
| 22 | Stan w popupie: prawdziwy bank / znana / podróbka / nieznana |
| 23 | Pobranie listy CERT Polska na żywo (wymaga internetu) |

**Zrzuty ekranu** każdego kroku trafiają do `tmp/e2e/` (np. `04-password-danger-dialog.png`, `09-lookalike-banner.png`) i warto je przejrzeć po zmianach w wyglądzie.

**Opcje:**

| Zmienna | Działanie |
|---|---|
| `E2E_HEADFUL=1` | widoczne okno, można oglądać przebieg |
| `CHROME_PATH=...` | inna przeglądarka, np. Edge: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` |

```powershell
$env:E2E_HEADFUL=1; npm run test:e2e
```

### 3.3 Pomiar wykrywania podróbek

```powershell
npm run measure:lookalike
```

Wymaga wcześniejszego `npm run build:rules` (korzysta z `.cache/cert_pl.json`). Wynik z 3.10.2026:

```
CERT domains mentioning a known brand: 11546
  flagged: 11471 (99.4%)
False positives on 49 legitimate domains: 0
```

Uruchamiaj po każdej zmianie w `known-sites.js` lub `lookalike.js`. Wykrywanie nie powinno spaść, a fałszywe alarmy powinny zostać na 0.

### 3.4 CI

`.github/workflows/ci.yml` przy każdym pushu, PR oraz co poniedziałek uruchamia kolejno: kontrolę tłumaczeń, testy jednostkowe, budowę list, test end-to-end i budowę paczki `.zip`. Paczka i zrzuty ekranu są dostępne jako artefakty przebiegu.

## 4. Testy ręczne na fałszywych stronach

To główny test ręczny. Fałszywe strony działają na Twoim komputerze, w osobnym profilu przeglądarki, więc Twoje prawdziwe konta i przeglądarka nie są w nic angażowane.

### 4.1 Uruchomienie środowiska

```powershell
npm run test:manual
```

1. Otworzy się **nowe, osobne okno** Chrome z dwiema kartami: `chrome://extensions` i listą testów. **Wszystkie testy rób w tym oknie.**
2. Na karcie `chrome://extensions` włącz **Tryb dewelopera** (prawy górny róg), kliknij **Załaduj rozpakowane** i wskaż folder `src`. Otworzy się karta powitalna „CyberGuard już Cię chroni”.
3. Przypnij ikonę CyberGuard do paska (ikona puzzla → pinezka).
4. Przejdź na kartę `http://localhost:8080/` i odśwież ją. Na górze musi być zielone **„✔ To jest okno testowe”**.
5. Terminal z serwerem zostaw otwarty. Za każdym razem, gdy jakiś formularz zostanie wysłany, pojawi się tam linia `⚠ FORMULARZ WYSŁANY do <adres>`. Tak sprawdzasz, czy CyberGuard zablokował wysłanie hasła.

**Hasło testowe:** wymyślone, min. 4 znaki, np. `TestoweHaslo123!`. W całym rozdziale „hasło bankowe” oznacza hasło wpisane w kroku T05.

> Po każdej zmianie w kodzie: na `chrome://extensions` kliknij ikonę odświeżenia przy CyberGuard. Otwarte karty zostaną podłączone automatycznie.

### 4.2 Scenariusze

Każdy scenariusz ma oczekiwany wynik. Zaznaczaj ✅/❌.

#### Blokada stron z listy

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T01 | Kliknij link „Strona z listy oszustw” | Karta z czerwonym paskiem i zaniepokojoną maskotką: „Spokojnie – zatrzymaliśmy tę stronę, zanim się otworzyła”, „Stop! Ta strona może Cię oszukać”, zdanie o oszuście „na wnuczka”, podświetlony adres zablokowanej strony, źródło (OpenPhish / CERT Polska). Duży turkusowy przycisk „Zabierz mnie w bezpieczne miejsce”, niżej trzy piktogramy „Jak działa takie oszustwo?”. |
| T01a | W pasku adresu wpisz `chrome-extension://<ID wtyczki>/pages/warning/warning.html?domain=allegro.pl-oferta24.xyz&src=cert_pl` (ID jest na `chrome://extensions`) | Tytuł „Stop! Ta strona udaje Allegro”, porównanie: „Prawdziwa strona Allegro: allegro.pl” / „Adres zablokowanej strony: allegro.**pl-oferta24.xyz**” (podświetlone) i zdanie „Liczy się końcówka adresu: …”. |
| T02 | Kliknij „Zabierz mnie w bezpieczne miejsce” | Otwiera się strona startowa przeglądarki. Klawisz Esc działa tak samo. |
| T03 | Wróć do T01. Kliknij mały link „Wiem, co robię…” | Rozwija się ramka z ostrzeżeniem. Przycisk „Wejdź na stronę” jest nieaktywny. |
| T04 | Zaznacz „Rozumiem, że ta strona może ukraść…” | Przycisk odlicza „Poczekaj 5 s… 4 s…”, potem staje się aktywny. Odznaczenie wyłącza go z powrotem. |
| T05 | Kliknij „Wejdź na stronę” | Pojawia się błąd połączenia. To normalne w środowisku testowym (strona testowa działa na porcie 8080). Kliknij link z T01 jeszcze raz: strona się otwiera, z **czerwonym** banerem „Ta strona jest na liście niebezpiecznych”. Ikona ma „!”. |
| T06 | Ustawienia → „Strony odblokowane do zamknięcia przeglądarki” | Domena z T01 jest na liście. „Zablokuj ponownie” → link z T01 znowu pokazuje czerwoną stronę. |
| T07 | Odblokuj jak w T05. Zamknij **całe** testowe okno, w terminalu wciśnij Ctrl+C, uruchom `npm run test:manual` ponownie i kliknij link z T01 | Strona jest znowu zablokowana (wyjątek działał tylko do zamknięcia przeglądarki). |

#### Ochrona haseł

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T10 | `online.mbank.pl` → wpisz hasło testowe → „Zaloguj” | Formularz wysłany (linia w terminalu). Baner „Ta strona nie jest zabezpieczona” jest poprawny, bo strona testowa działa na HTTP. |
| T11 | Ustawienia → „Zapamiętane hasła” | „Hasło 1 — używane na: mbank.pl” z plakietką **chronione**. Samego hasła nigdzie nie widać. |
| T12 | `super-promocje24.com` → **zacznij wpisywać** to samo hasło | Zaraz po wpisaniu: tło strony rozmywa się i pojawia się okno z zaniepokojoną maskotką: „Spokojnie – zatrzymaliśmy wysyłanie tego hasła”, „Stop! To może być oszustwo”, porównanie „To hasło jest Twoim hasłem do: **mBank – mbank.pl**” / „A ta strona to: **super-promocje24.com**” (podświetlone). Fokus jest na „Zabierz mnie stąd”. |
| T13 | Spróbuj wysłać: Enter / kliknięcie „Zaloguj” | **Nic nie zostaje wysłane** (brak nowej linii w terminalu). |
| T14 | Kliknij „Zabierz mnie stąd” | Zielona strona „Dobrze! Podejrzana strona jest zamknięta”, z adresem i linkiem do pomocy. |
| T15 | `moj-nowy-sklep.pl` → to samo hasło → „To jest moja zaufana strona” | Drugi krok „Na pewno?” z podpowiedzią o nowym koncie. Domyślnie zaznaczony jest bezpieczny przycisk „Nie, zabierz mnie stąd”. |
| T16 | Kliknij „Tak, ufam tej stronie” → „Zaloguj” | Formularz wysłany. W ustawieniach: „używane na: mbank.pl, moj-nowy-sklep.pl”. Ponowne wejście = brak okna. |
| T17 | `portal-x.com` (ramka) → wpisz hasło bankowe **w ramce** | Okno „Stop!” przykrywa całą stronę, nie tylko ramkę. |
| T18 | `forum-wedkarskie.pl` → **inne** hasło (np. `ForumHaslo99`) → „Zaloguj”; potem `przepisy-babci.pl` → to samo hasło | Niebieska „Wskazówka bezpieczeństwa” w prawym dolnym rogu: „To samo hasło jest używane także na: forum-wedkarskie.pl”. Formularz da się wysłać. |
| T19 | Wpisz w pasek adresu `http://portal-x.com:8080/login`, hasło `xdxd` → „Zaloguj”; potem `http://login-widget.com:8080/login` → `xdxd` | Wskazówka też się pojawia (hasła od 4 znaków są chronione, krótsze są ignorowane). |
| T20 | `online.mbank.pl` → hasło bankowe → **od razu Enter** (bez pauzy) | Formularz zostaje wysłany. Krótkie wstrzymanie jest niewidoczne dla użytkownika. |

#### Linki z fałszywym napisem

Na liście testów: „Linki, których napis udaje inny adres” (`linki-testowe.pl`). **Zanim klikniesz, najedź myszką na link i spójrz w lewy dolny róg przeglądarki:** tam widać, dokąd link naprawdę prowadzi. Tak samo można to sprawdzać w prawdziwej poczcie.

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| L1 | Link 1 „Oszukańczy” (`https://www.mbank.pl/logowanie`) | Okno z bursztynowym paskiem i zmartwioną maskotką: „Spokojnie – ten link nie został otwarty”, „Uwaga: ten link prowadzi gdzie indziej”, napis **mbank.pl**, naprawdę mbank**-weryfikacja.xyz** (podświetlona różnica) i zdanie „Liczy się końcówka adresu…”. Fokus jest na „Nie otwieraj tego linku”. Ten przycisk albo Esc zostawia Cię na stronie. |
| L2 | Link 1 → „Otwórz mimo to” | Otwiera się `mbank-weryfikacja.xyz` (z pomarańczowym banerem podróbki adresu). Link 6 (nowa karta) po „Otwórz mimo to” otwiera nową kartę. To samo kliknięciem środkowym przyciskiem myszy na link 1: najpierw okno. |
| L3 | Linki 2, 3, 4, 7 | Otwierają się **bez** okna: uczciwy, ta sama firma (PKO: `pkobp.pl` → `ipko.pl`), uczciwy w Outlook Safe Links, zwykły napis „Kliknij tutaj…”. |
| L4 | Link 5 (Outlook Safe Links z oszukańczym celem) | Okno pokazuje **mbank-weryfikacja.xyz**, a nie adres `outlook.com`. |
| L5 | Link 8 → skrzynka testowa → link w treści maila (w ramce) | Okno na całej stronie, a nie w małej ramce. |
| L6 | Na dowolnej prawdziwej stronie kliknij kilka zwykłych linków (menu, artykuły) | Brak okien i brak zauważalnego opóźnienia. |

#### Ataki zaawansowane: Browser-in-the-Browser i przejęcie sesji

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T21 | **BitB.** Na liście testów: „Atak Browser-in-the-Browser” (`wygraj-nagrode.pl`) → „Zaloguj przez mBank”. Przyjrzyj się okienku. | Wygląda jak osobne okno Chrome: pasek tytułu „Logowanie – mBank – Google Chrome”, kłódka i adres `https://online.mbank.pl/logowanie`. **To tylko obrazek na stronie.** Spróbuj przeciągnąć okienko poza okno przeglądarki: nie da się, co jest typowym sposobem rozpoznania BitB. |
| T22 | W fałszywym okienku wpisz hasło bankowe z T10 | Okno „Stop!…” z porównaniem: „Twoim hasłem do: **mBank**” / „A ta strona to: **wygraj-nagrode.pl**”. Wtyczka podaje **prawdziwy** adres, a nie ten z fałszywego paska. „Zaloguj” nic nie wysyła (brak linii w terminalu). |
| T23 | Kliknij ikonę CyberGuard na tej stronie | Stan dotyczy `wygraj-nagrode.pl`, a nie `mbank.pl`. Pasek adresu przeglądarki i okienko CyberGuard zawsze pokazują prawdę. |
| T24 | **Przejęcie sesji przez phishing-pośrednik (AiTM).** Nie da się go bezpiecznie odtworzyć lokalnie. Z punktu widzenia wtyczki wygląda jak T12: prawdziwa strona banku jest przekazywana, ale pod adresem oszusta. | Wystarczy zaliczony T12 (i T30 dla adresów podobnych do marki). Ochrona działa na etapie wpisywania hasła, zanim oszust dostanie sesję. |
| T25 | **Po przejęciu sesji.** Okienko CyberGuard → „Oszust może mieć moje dane – co robić?” | W kroku 2 jest „**Wyloguj się ze wszystkich urządzeń**…”, a przy czyszczeniu ostatniej godziny dopisek, że to **nie** wylogowuje oszusta. |

> Kradzieży ciasteczek przez złośliwe oprogramowanie, XSS czy inne rozszerzenia **nie testujemy**, bo wtyczka przed tym nie chroni i nie ma takiej możliwości (zob. [opis-wtyczki.md, rozdz. 7](opis-wtyczki.md#7-przed-czym-chroni-a-przed-czym-nie)).

#### Podróbki adresów i baner na stronie

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T30 | `mbank-logowanie.com` | Pomarańczowy baner „Uwaga: ta strona może podszywać się pod mBank… Prawdziwy adres to mbank.pl”. Przyciski „Zabierz mnie stąd” i „Ufam tej stronie”. Ikona ma „!”. |
| T31 | Link „pаypal.com (cyrylica)” | **Czerwony** baner „Uwaga: podrobiony adres strony”. |
| T32 | `allegro-okazje.pl` → „Ufam tej stronie” → odśwież | Baner znika i nie wraca. Ustawienia → „Strony z wyłączonymi ostrzeżeniami”: „allegro-okazje.pl — zaufana strona”. |
| T33 | `sklep-testowy.pl` (formularz) | Baner „Hasło trafi na inną stronę: **evil-site.ru**” oraz drugi punkt „**Ta strona nie jest zabezpieczona.** …”. |
| T34 | `forum-wedkarskie.pl` → baner „Ta strona nie jest zabezpieczona” → **„Rozumiem, nie pokazuj więcej na tej stronie”** → odśwież | Baner nie wraca. Na `przepisy-babci.pl` (inna strona) nadal jest. |
| T35 | Ustawienia → „Strony z wyłączonymi ostrzeżeniami” | „forum-wedkarskie.pl — ukryte ostrzeżenie: brak zabezpieczenia (kłódki)”. „Pokazuj znowu” → baner wraca. |
| T36 | Na dowolnym banerze kliknij **×** → odśwież | Baner znika, a po odświeżeniu wraca. |
| T37 | `http://localhost:8080/login` | **Brak** banera o braku zabezpieczenia (adresy lokalne, np. router, są pomijane). |
| T38 | Otwórz `przepisy-babci.pl` (baner o braku zabezpieczenia). Na `chrome://extensions` odśwież CyberGuard. Wróć do tej karty **bez odświeżania** → „Rozumiem, nie pokazuj więcej” → teraz odśwież kartę | Po przeładowaniu wtyczki na stronie jest **dokładnie jeden** baner. Przycisk działa: po odświeżeniu baner nie wraca (symulacja automatycznej aktualizacji wtyczki). |

#### Popup, pomoc, ustawienia

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T40 | Kliknij ikonę na `online.mbank.pl` | Turkusowa karta z **zadowoloną** maskotką: „Prawdziwa strona: mBank”. U góry granatowy pasek z logo i „Ochrona włączona”. |
| T41 | … na `moj-nowy-sklep.pl` | Zadowolona maskotka: „Znana strona”. |
| T42 | … na `mbank-logowanie.com` | Bursztynowa karta ze **zmartwioną** maskotką: „Uwaga: ta strona może podszywać się pod mBank”. |
| T43 | … na `sklep-testowy.pl` (nigdzie tam się nie logowano) | Zmartwiona maskotka: „Strona bez zabezpieczenia”. Na `forum-wedkarskie.pl` po T18 będzie zadowolona maskotka i „Znana strona”, bo tam się logowano. Na dowolnej prawdziwej stronie HTTPS: **spokojna** maskotka i „Nieznana strona”. |
| T44 | … na stronie ostrzeżenia z T01 | Zadowolona maskotka: „Niebezpieczna strona zatrzymana”. Licznik „Zatrzymane niebezpieczne strony” rośnie z każdą blokadą (odświeżenie tej samej strony się nie liczy). |
| T45 | „Oszust może mieć moje dane – co robić?” | Otwiera się strona pomocy z 6 ponumerowanymi krokami. Link do incydent.cert.pl działa. |
| T46 | Pomoc → „Wyczyść ostatnią godzinę” → „Tak, wyczyść” | Przeglądarka pyta o zgodę na „usuwanie danych przeglądania”. Po zgodzie: „Gotowe…”. Po odmowie: „Bez zgody przeglądarki…”. „Anuluj” wraca bez pytania. |
| T47 | Ustawienia → „Sprawdź teraz” (wymaga internetu) | Po kilku sekundach: „Ostatnia aktualizacja: … Razem chronimy przed X niebezpiecznymi stronami: Y z listy wbudowanej (z dnia …) i N nowych…”. X = Y + N − wycofane. Kolejne „Sprawdź teraz” może zmienić N, bo CERT dodaje domeny na bieżąco. N to zawsze różnica względem listy wbudowanej, a nie suma z poprzednich aktualizacji. Ta sama łączna liczba jest w okienku pod ikoną. |
| T48 | Ustawienia → wyłącz „Pobieraj nowe ostrzeżenia…” → odśwież stronę ustawień | Włącznik zostaje wyłączony. |
| T49 | Ustawienia → „Zapomnij” przy haśle bankowym → wróć do T12 | Okno „Stop!” się nie pojawia, bo hasło zostało zapomniane. „Zapomnij wszystkie hasła” wymaga potwierdzenia. |

#### Język, wygląd, klawiatura

| ID | Kroki | Oczekiwany wynik |
|---|---|---|
| T50 | Zamknij testowe okno, Ctrl+C w terminalu, potem: `$env:TEST_LANG='en'; npm run test:manual` | Wszystkie teksty wtyczki po angielsku, bez surowych kluczy typu `pwAlertTitle`. (Strony testowe zostają po polsku.) |
| T51 | Przełącz system na tryb ciemny | Strona ostrzeżenia, popup, ustawienia i pomoc są czytelne w trybie ciemnym. Ostrzeżenia na stronach zostają jasne (celowo, dla kontrastu). |
| T52 | Okno „Stop!” obsłuż samą klawiaturą (Tab, Shift+Tab, Enter) | Fokus krąży tylko w oknie i jest wyraźnie widoczny (niebieska obwódka). |
| T53 | Powiększenie przeglądarki 200% (Ctrl +) | Okno „Stop!”, baner i strona ostrzeżenia mieszczą się i dają się przewinąć. |
| T54 | Wąskie okno (ok. 400 px) | Brak poziomego przewijania, przyciski w całości widoczne. |

### 4.3 Sprzątanie

Zamknij testowe okno i serwer (Ctrl+C). Profil testowy to folder `%TEMP%\cyberguard-test-profile` i można go usunąć.

## 5. Testy na prawdziwych stronach

Wszystko w **testowym oknie** z włączonym CyberGuard.

| ID | Strona | Kroki | Oczekiwany wynik |
|---|---|---|---|
| R01 | `allegro.pl`, `mbank.pl`, `pkobp.pl`, `inpost.pl`, `www.gov.pl` | Kliknij ikonę | Zadowolona maskotka i „Prawdziwa strona: …” z nazwą firmy. Brak banerów. |
| R02 | `mbank.cz`, `santander.de`, `allegro.tech` | Otwórz | **Brak** ostrzeżeń (legalne domeny tych firm). |
| R03 | `wikipedia.org` | Kliknij ikonę | Spokojna maskotka i „Nieznana strona”. Brak banerów. |
| R04 | `http://http-password.badssl.com/` (projekt testowy programistów Chrome) | Otwórz | Baner „Ta strona nie jest zabezpieczona”. |
| R05 | Ta sama strona | „Rozumiem, nie pokazuj więcej” → odśwież; otwórz `http://http-login.badssl.com/` | Baner nie wraca na żadnej z nich, bo to ta sama witryna `badssl.com`. W ustawieniach: „badssl.com — ukryte ostrzeżenie…”. |
| R06 | `https://hole.cert.pl/domains/v2/domains.txt` | Skopiuj dowolny adres z listy, wklej w pasek adresu, Enter | Czerwona strona „Stop!” z tym adresem lub bez adresu (starsze domeny z archiwum). Licznik w popupie rośnie. **Nie klikaj „Wejdź mimo to”.** |
| R07 | Twoja prawdziwa poczta (np. Gmail) | Zaloguj się normalnie w testowym oknie | Ustawienia: nowe hasło „używane na: google.com” z plakietką **chronione**. |
| R08 | `http://localhost:8080/` → dowolna strona logowania (lokalna) | Zacznij wpisywać hasło z R07, **nie wysyłaj** | Okno „Stop!…” z porównaniem „Twoim hasłem do: Google…”. Kliknij „Zabierz mnie stąd”. |

**Zasady przy R06–R08:**
- Adresy z listy CERT otwieraj **tylko** w oknie z włączonym CyberGuard. Wtyczka zatrzymuje stronę, zanim przeglądarka cokolwiek z niej pobierze, ale bez wtyczki byłaby to prawdziwa strona oszusta.
- Prawdziwego hasła **nie wpisuj na żadnej obcej stronie w internecie**, także na badssl. Do R08 używaj tylko fałszywych stron lokalnych.
- Po testach usuń profil testowy (`%TEMP%\cyberguard-test-profile`), bo jest w nim odcisk Twojego hasła.
- Podróbek adresów (`mbank-logowanie.com` itp.) nie testujemy na prawdziwych stronach. To prawdziwe oszustwa. Skuteczność na nich mierzy `npm run measure:lookalike` (rozdział 3.3).

## 6. Test z prawdziwym użytkownikiem

Najważniejszy test dla tej wtyczki: czy osoba nietechniczna zrozumie komunikaty i wybierze bezpieczną opcję.

**Przygotowanie:** środowisko z rozdziału 4 i wcześniej wykonany T10 (bank „zna” hasło testowe). Hasło testowe zapisz na kartce dla uczestnika.

**Przebieg** (nie podpowiadaj, tylko obserwuj i notuj):

1. „Wyobraź sobie, że dostał(a) Pan/Pani SMS o dopłacie do paczki. Proszę kliknąć ten link.” → link z T01. Obserwuj: czy rozumie, że to oszustwo? Czy klika duży zielony przycisk?
2. „Bank prosi o zalogowanie się na tej stronie.” → `super-promocje24.com`, hasło z kartki. Obserwuj: czy czyta okno „Stop!”? Co wybiera? Czy „To jest moja zaufana strona” kusi?
3. „Proszę wejść na tę stronę banku.” → `mbank-logowanie.com`. Czy zauważa baner? Czy rozumie „podszywać się”?
4. „Proszę sprawdzić, czy ta strona jest bezpieczna.” → `online.mbank.pl`. Czy znajduje ikonę? Jak rozumie „Prawdziwa strona”?
5. „Załóżmy, że podał(a) Pan/Pani dane karty oszustowi. Co teraz?” Czy znajduje przycisk w okienku pod ikoną? Czy kroki pomocy są jasne?

**Po teście zapytaj:** Co było niejasne? Które słowo było trudne? Czy coś przestraszyło bardziej, niż powinno?

**Sukces:** we wszystkich zadaniach wybrana bezpieczna opcja, bez pomocy, i z rozumieniem, dlaczego.

## 7. Lista kontrolna przed wydaniem

- [ ] `npm test`: 60/60
- [ ] `npm run build`: liczba domen podobna do poprzedniej wersji (nagły spadek = problem ze źródłem)
- [ ] `npm run measure:lookalike`: wykrywanie ≥ 99%, 0 fałszywych alarmów
- [ ] `npm run test:e2e`: 30/30, przejrzane zrzuty w `tmp/e2e/` (także `design-*-light/dark.png`)
- [ ] Testy ręczne T01–T54 i L1–L6 w Chrome
- [ ] Wybrane testy (T01, T12–T14, T30, T45) w Edge
- [ ] Aktualizacja z poprzedniej wersji: zainstaluj starą wersję, potem nową na jej miejsce → zapamiętane hasła i ustawienia zostają, otwarte karty działają (T38)
- [ ] `version` w `src/manifest.json` i `package.json` podbite
- [ ] `npm run package` → `dist/cyberguard-<wersja>.zip`; po rozpakowaniu i załadowaniu działa T01 i T12

## 8. Rozwiązywanie problemów

| Objaw | Przyczyna | Rozwiązanie |
|---|---|---|
| `npm.ps1 cannot be loaded…` | PowerShell blokuje skrypty | `npm.cmd …` zamiast `npm …` |
| Fałszywe strony: „Witryna jest nieosiągalna”, `DNS_PROBE_FINISHED_NXDOMAIN` | Test w **zwykłym** oknie Chrome zamiast testowego (np. po kliknięciu linku w terminalu) | Używaj okna otwartego przez `npm run test:manual`. Lista testów musi pokazywać zielone „✔ To jest okno testowe”. |
| Po „Wejdź mimo to” błąd połączenia | Wtyczka otwiera stronę bez portu 8080 | Normalne w środowisku testowym. Kliknij link z listy jeszcze raz. |
| Brak okna „Stop!” przy haśle | Hasło nie zostało zapamiętane: nie kliknięto „Zaloguj” w T10 albo hasło ma mniej niż 4 znaki | Powtórz T10 i sprawdź „Zapamiętane hasła” w ustawieniach. |
| Brak banera „brak zabezpieczenia” na stronie HTTP | Na stronie nie ma pola hasła, adres jest lokalny, ostrzeżenie było wcześniej ukryte „Rozumiem” albo pole jest tylko w ramce | Celowe. Sprawdź „Strony z wyłączonymi ostrzeżeniami” w ustawieniach. |
| Wtyczka nie ładuje się: „Could not load … rules/main.json” | Brak zbudowanych list | `npm run build` |
| Ostrzeżenie wraca mimo „Rozumiem” | Karta otwarta z bardzo starą kopią wtyczki | Odśwież wtyczkę na `chrome://extensions` i kartę. Od wersji 2.0 dzieje się to samo. |
| Błędy w działaniu | — | `chrome://extensions` → „service worker” przy CyberGuard (konsola rozszerzenia); F12 na stronie (konsola content scriptu) |
| Przycisk „Błędy” przy CyberGuard na `chrome://extensions` ze starymi wpisami | Chrome pamięta błędy do wyczyszczenia, także te sprzed poprawki. Typowa przyczyna w trakcie pracy nad kodem: pliki zmienione, ale wtyczka nieprzeładowana. Strony ustawień/popupu biorą wtedy nowy kod z dysku, a service worker działa jeszcze w starej wersji. | Kliknij „Wyczyść wszystko”, potem odśwież wtyczkę. Jeśli błąd wróci po przeładowaniu, to prawdziwy błąd i trzeba go zgłosić. |
| Szare „C” zamiast ikony na `chrome://extensions` | Ikona nie jest prawidłowym PNG (tak było w wersji 1.x) | `scripts/build-icons.ps1`; test `icons are real PNG files…` pilnuje tego automatycznie |
| Fałszywy alarm na legalnej stronie | Heurystyka podróbek | Dopisz domenę do `tests/unit/legit-domains.js`, popraw `known-sites.js` lub `lookalike.js`, uruchom `npm test` i `npm run measure:lookalike`. |
