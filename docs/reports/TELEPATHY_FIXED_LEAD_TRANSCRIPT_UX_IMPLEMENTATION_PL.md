# Telepatia: stały prowadzący, zapis rozmów i UX — raport kandydata

Data: 11 października 2026. **Stan: CANDIDATE — do audytu; odbiór końcowy pozostaje otwarty.**

## Podstawa

Źródłem zmian jest wyłącznie załączony przez użytkownika `AI-RV-Harness-ai-rv-2.zip`, wskazany jako ostatnia zielona baza gałęzi. SHA-256 ZIP: `534b7c96458895625fd969949a1dfe5ac12cbc6f9716b56474d1493f9c375f6e`. Wersja aplikacji pozostaje 0.7.13; schema 031. Nie użyto automatycznych main.zip ani WIKI_RELEASE_SYNC jako nakładek. Indeks Biblioteki v79 potwierdził aktualną linię po Training History UX oraz dokumentację w źródłach. Nie twierdzimy, że wykonano porównanie bajtowe tego ZIP-a z pełnym ZIP-em Biblioteki ani że ten kandydat ma już zielony GitHub Actions — użytkownik dopiero go wgra.

Wymagania: załączony plan v1.1 z 11 października, zachowany pod `docs/plans/`. Mapa odpowiedzialności: `docs/architecture/TELEPATHY_FIXED_LEAD_v0.7.14_EN.md`.

## Zrealizowane

- Nowe serie w obu trybach mają stałego prowadzącego, znacznik `fixed_lead_v1`, zamrożoną instrukcję i limit trzech cykli. Starsze serie zachowują poprzednią semantykę; Resume pozwala dokończyć ich końcowe refleksje.
- 48 stabilnych obszarów PL/EN, lokalne losowanie bez powtórzenia wpisu do wyczerpania puli, brak powtórzenia na granicy permutacji. Wszystkie przydziały zapisane przed wywołaniem. Każda runda ma osobny zamrożony cel.
- Własne Field Guide/Viewer Notes również w nowej Conversation, wyłącznie do odczytu. Instrukcja prowadzącego adaptuje neutralne wskazówki fabrycznego Monitora do roli znającej cel.
- 0–3 dodatkowe cykle; broadcast, osobne pytania, zakończenie odbiorcy; człowiek używa formularzy, nie JSON. Decyzje poprzedzają dispatch; osobne scopes pozwalają odzyskać odpowiedź A i dokończyć B.
- Automatyczne refleksje AI, podsumowanie prowadzącego po refleksjach odbiorców, osobna finalizacja. Człowiek pisze własną refleksję i wybiera zgodę; odmowa kończy wymianę.
- Metryki faktycznych prób: usage, request ID, czas, liczba fizycznych prób, pochodzenie kosztu. Brak kosztu oznacza niepełny koszt; nie doliczamy reasoning ponownie. Czas to suma czasów wywołań, bez przerw między uruchomieniami.
- Stop z sygnałem użytkownika i sygnałem lease. Zapisany sukces pozostaje sukcesem; wynik wysłanego przerwanego wywołania może pozostać uncertain.
- Rzeczywista walidacja pojemności na dispatch; widoczny kosztowy preflight usunięty. Opisowe etapy 16K→32K w granicach modelu; małe decyzje 4K. Wyniki length/error/empty/refusal nie stają się kompletnym zapisem; brak trzeciej automatycznej próby.
- Wersjonowane rozszerzenie `_runtime` w istniejącym fenced `plan_json`, odtworzenie w SQLite, zapis browser, archiwizacja i przywracanie. Predykat rewizji archiwum w obu rejestrach SQL zapobiega cofnięciu przez stary snapshot.
- Wspólna transkrypcja, SafeMarkdown dla pojedynczych wiadomości, prowadzący pierwszy, stabilne sekcje i nawigacja. Projekcja Conversation usuwa cel, geografię, ukrytą kategorię i cudze odpowiedzi przed Reveal; nie opiera się na CSS.
- Wspólna prawa historia domyślnie otwarta, trzy działające ikony, font monospace 11px/1.25, tooltip przez portal, archive/restore również w Settings. Eksport wszystkich rund i refleksji z tą samą projekcją; desktop kopiuje uprawnione załączniki.
- Pomoc PL/EN uaktualniona. Lokalizacja pomocy Training już istniała — nie przypisujemy sobie jej dodania. Zwykły Training korzysta z wyodrębnionego, niezmienionego mechanizmu tooltip; jego działanie i DOM regresja przeszły.

## Faktycznie wykonane kontrole

| Kontrola | Wynik |
| --- | --- |
| `npm ci` | PASS, 203 pakiety; końcowa czysta instalacja bez pomijania lifecycle scripts |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 1293 testy, 1 wcześniej pomijany; 237 plików PASS, 1 pomijany; bez unhandled errors |
| `npm run build` | PASS |
| `verify:architecture` | PASS — 279 produkcyjnych TS/TSX, zero wyjątków |
| `verify:ux-data` | PASS — 31 migracji |
| `verify:source` | PASS |
| `verify:v0.7.14-release-gate` | PASS strukturalny; to nie jest runtime acceptance |
| Porównanie migracji z ZIP-em wejściowym | PASS — wszystkie 001–031 byte-identical |
| Rzeczywisty SQLite (`node:sqlite`, ta sama wersja Node 24 co CI) | PASS — round-trip, lease/fence, archive/restore, starszy snapshot, integrity/FK, fizyczny backup i odczyt po ponownym otwarciu |
| Mounted DOM | PASS — trzy akcje, tooltip focus PL/EN, toggle, zachowanie rundy, izolacja fence, nawigacja/focus, przycisk Stop i abort bieżącej operacji |
| Nowy silnik | PASS — 0/1/2/3 cykle, selective A/B, człowiek jako prowadzący i odbiorca, automatyczna finalizacja, błędny JSON, length 16K→32K, Stop uncertain, restart po zapisanym sukcesie A, Resume samej finalizacji, brak podwójnych wywołań |
| Rust `cargo test --all-targets --locked` | NIEWYKONANE — `cargo` nie jest zainstalowane |
| `verify:openrouter-continuation-bridge` | ZABLOKOWANE — skrypt wymaga `cargo`; wykonanie zwróciło błąd środowiska |
| Wizualny smoke uruchomionego UI | NIEWYKONANE — brak przeglądarki; próba pobrania Chromium zakończyła się błędem niekompletnego archiwum |

Zestaw zachował testy wcześniejszej izolacji, retry, Resume i standardowego Training. Aktualizowano tylko oczekiwania, które plan celowo zmienia: rotacja/preflight i miejsce wspólnego tooltipu. Nowy gate wymaga walidacji właściwego pakietu, klasyfikatora kompletności, zapisu runtime i testów silnika/SQLite/DOM zamiast usuniętego przycisku preflight.

## Otwarte elementy odbioru i ograniczenia

1. Uruchomić GitHub Actions, w szczególności Rust i cross-language bridge. Zmiana native to predykat w jednej zarejestrowanej instrukcji SQL, zgodny z rejestrem TS; nie zastępuje to kompilacji native.
2. Uruchomić rzeczywisty smoke desktop: light/dark, 125%/150%, wąska historia ~330px, długie nazwy, 6 AI i wiele rund, przewijanie/sticky/tooltip, Stop, zamknięcie i ponowne otwarcie aplikacji, native eksport obrazów i backup/restore. Test SQLite backup nie jest dowodem kompletnego desktopowego procesu restore z safety backup.
3. Nie wykonano wywołań płatnych modeli ani smoke konkretnego providera. Testy silnika używają kontrolowanych odpowiedzi przez rzeczywisty gateway.
4. Walidacja guidance chroni adresatów, liczbę cykli i znane jawne przecieki pełnego tekstu celu/etykiet geografii. Nie wykrywa każdego przecieku semantycznego. Losowa geografia nie gwarantuje unikalności celów ani posłuszeństwa modelu; nie dodano automatycznego zastępowania zamrożonego celu. Syntaktycznie kompletny target nadal wymaga oceny, jeśli model zignoruje obszar.
5. Historyczne prompty, których poprzednia wersja nie przechowała, pozostają oznaczone jako brakujące. Browser eksportuje tekst; kopiowanie obrazów wymaga desktopu. Nie dodano telepatycznego Permanent Delete ani nowego zapisu learning.
6. Nie twierdzimy, że każda kombinacja z pełnej macierzy planu została wykonana wizualnie lub na native. Powyższa tabela jest dokładnym zakresem lokalnych dowodów.

## Wgranie i audyt

ZIP zawiera wyłącznie zmienione i nowe pliki, z właściwymi ścieżkami względem repo. Rozpakować na tej samej zaakceptowanej bazie `ai-rv-2`; nie stosować do starego main ani do Wiki ZIP. Zachować raport i manifest. Przed akceptacją porównać manifest, uruchomić wymagane CI/native i wykonać smoke. Nie publikowano, nie merge’owano ani nie zmieniano wersji aplikacji.


## Aktualizacja po niezależnym audycie

Ten raport dokumentuje pierwotnego kandydata. Stan poprawek A1–A8 i nowsze wyniki odbioru opisuje `TELEPATHY_FIXED_LEAD_POST_AUDIT_PL.md`. Zbiorcza paczka POST_AUDIT zastępuje wcześniejszą nakładkę.
