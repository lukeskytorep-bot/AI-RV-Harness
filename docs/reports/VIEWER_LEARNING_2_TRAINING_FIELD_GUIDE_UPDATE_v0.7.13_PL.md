# AI RV Harness v0.7.13 — VIEWER-LEARNING-2-R1 — Training Field Guide Update

**Data:** 18 września 2026  
**Status:** `CANDIDATE — INDEPENDENT AUDIT, FULL GITHUB ACTIONS AND WINDOWS RUNTIME SMOKE REQUIRED`

## Baza

Kandydat został zbudowany wyłącznie na dostarczonym `VIEWER-LEARNING-1-R3 — FIELD GUIDE FOUNDATION` complete-source.

- complete-source ZIP SHA-256: `1b25f208520bae8736c910d57f97caf2bba8095205e83d4f9ff30c567ddfcf96`;
- autorytatywny source-tree zapisany w manifeście R3: `57dcb382cf80856f975eb55e979947cf49f2f413fbb8e8652c7fb1f41cff6015`;
- SQLite schema: `24`;
- data epoch: `v0.7.13`;
- pliki bazy: `764`.

Dostarczony complete-source nie zawiera `.git`. Nazwa gałęzi, pełny SHA commita i rzeczywisty `git status` nie mogą zostać odzyskane z archiwum i nie zostały zgadnięte. Przed nałożeniem changed-files należy potwierdzić te trzy dane w rzeczywistym zielonym checkoutcie VIEWER-LEARNING-1-R3 oraz zgodność z autorytatywną bazą R3.

## Zakres

Training wykonuje po Reveal dokładnie trzy kolejne operacje:

1. wspólny `Post-Reveal Review` Viewera;
2. osobny `Field Guide Update`, który wykorzystuje gotowy Review i zwraca `UPDATE` albo `NO_CHANGE`;
3. dotychczasowy `Viewer Notes Reflection`.

Nie dodano drugiego Field Guide Reflection. Research nie uruchamia Field Guide Update.

Przewodnik Pola jest zamrażany osobno przy rozpoczęciu każdej nowej sesji celu. Dlatego zaakceptowany `UPDATE` po celu N jest używany przez cel N+1 tego samego Training Run. Resume rozpoczętej sesji nadal korzysta wyłącznie z jej niezmiennego Session Snapshot i nie podmienia Przewodnika w trakcie sesji.

## Rozszerzenie Post-Reveal Review

Do polskiej i angielskiej kanonicznej instrukcji Review dodano wyłącznie wymagany akapit dotyczący własnego doświadczenia percepcyjnego. Leksykon nie jest przekazywany do Review. Nie dodano zdania zakazującego tworzenia nowej wersji Field Guide.

Resume rozpoznaje exact-match bieżącego requestu oraz wszystkie wcześniejsze kanoniczne requesty obecne w bazie. Ukończony historyczny Review jest ponownie używany i nie powoduje nowego wywołania providera.

## Kanoniczne leksykony TXT

Źródłem są wyłącznie dostarczone TXT. Nie wykonywano ekstrakcji z DOCX i nie redagowano ich treści.

### Polski

- plik: `src/resources/field-lexicon/AI_Field_Perception_Lexicon.pl.txt`;
- ID: `ai-field-perception-lexicon.pl`;
- wersja: `1.0.0`;
- język: `pl`;
- SHA-256: `60608e0eb91a434292a4c3cb65fea779af962d4d0be36d33717d9bfd4d1b51c5`.

### Angielski

- plik: `src/resources/field-lexicon/AI_Field_Perception_Lexicon.en.txt`;
- ID: `ai-field-perception-lexicon.en`;
- wersja: `1.0.0`;
- język: `en`;
- SHA-256: `dc4595a66270f89a9e77a6cb39f2833195fff3d3edb74d7c2cf8a774a80a67f5`.

Rola obu zasobów jest jawna: `reference-only-perceptual-naming-aid`. Polski Training otrzymuje wyłącznie PL, angielski wyłącznie EN. `.gitattributes` chroni kanoniczne bajty TXT przed normalizacją EOL.

## Field Guide Update

Pakiet wejściowy zawiera:

- exact Viewer identity;
- język zamrożony w Session Snapshot;
- Field Guide zamrożony na starcie sesji wraz z version ID i SHA-256;
- sealed blind evidence;
- Reveal i dozwolone artefakty obrazu;
- ukończony Post-Reveal Review;
- właściwy językowo leksykon wraz z ID, wersją i SHA-256;
- capacity;
- provenance Training Run + Session.

Pakiet nie zawiera opinii Monitora, AI Judge ani późniejszej rozmowy użytkownika.

Prompt PL/EN odpowiada dokładnemu kontraktowi zadania. Wszystkie dynamiczne dane są umieszczone w delimitowanych blokach `BEGIN DATA` / `END DATA`, a systemowa instrukcja traktuje je jako niezaufane dane. JSON ma ścieżkę repair analogiczną do Viewer Notes.

Przykład `NO_CHANGE` w obu wersjach językowych jest poprawnym JSON-em i jawnie zawiera `"fieldGuide": null`.

## UPDATE / NO_CHANGE i pamięć wersjonowana

`NO_CHANGE` zapisuje trwały audit decyzji bez tworzenia nowej wersji.

`UPDATE`:

- waliduje capacity oraz reserved delimiters;
- sprawdza stale-base przed zapisem;
- tworzy pełną nową wersję Field Guide;
- zachowuje `previousVersionId`;
- zapisuje Training/Session provenance, exact identity snapshot, lexicon ID/version/SHA i packet SHA;
- nie zmienia Field Guide snapshotu użytego w zakończonej sesji.

Awaria po utworzeniu wersji, ale przed zapisaniem końcowego audytu, jest odzyskiwana przez lookup `sourceSessionId + fieldGuideUpdatePacketSha256`, bez tworzenia drugiej wersji.

## Capacity retry

Przy pierwszym przekroczeniu limitu propozycja nie jest aktywowana. Wykonywana jest dokładnie jedna dodatkowa próba zawierająca ponownie pełny pierwotny kontekst oraz:

- limit;
- szacowany rozmiar aktualnej wersji;
- szacowany rozmiar odrzuconej propozycji.

Druga próba może skrócić/scalić/usunąć mniej użyteczne opisy albo wybrać `NO_CHANGE`. Drugie przekroczenie kończy się `FAILED_CAPACITY`; poprzednia wersja pozostaje aktywna i Training może przejść do Viewer Notes.

## Resume i idempotencja

Training Target Checkpoint ma osobne trwałe etapy:

- `session_revealed`;
- `review_completed`;
- `field_guide_update_completed`;
- `viewer_notes_reflection_completed`;
- `judging_completed`.

Zapisywane są osobne hashe pakietów Review, Field Guide Update i Viewer Notes Reflection. Hash Review obejmuje immutable Viewer route snapshot, sealed blind evidence, Reveal i exact request.

`UPDATE`, `NO_CHANGE`, `FAILED_CAPACITY` i `STALE_BASE` kończą etap Field Guide Update. Błędy providera/parsing/schema/output-preflight pozostawiają etap nieukończony, aby Resume wrócił do Field Guide Update zamiast przejść dalej.

## Ochrona istniejących obszarów

Byte-hash porównany z dokładną bazą R3 potwierdza brak zmian w:

- Viewer Notes production mechanics;
- Research;
- Monitorze;
- Judge;
- protokołach;
- provider transport/retry.

Schema pozostaje `24`; nie dodano migracji 025.

## Testy dodane

Dodano testy obejmujące:

- PL/EN;
- `UPDATE` i `NO_CHANGE`;
- exact lexicon language assignment i SHA-256;
- capacity retry i drugie przekroczenie;
- JSON repair;
- prompt injection / reserved delimiters;
- exact identity / route;
- frozen Field Guide snapshot;
- provenance;
- Research exclusion;
- Resume i idempotencję;
- ponowienie nieukończonego Field Guide Update po błędzie providera;
- brak ponownego Review dla wcześniejszych kanonicznych requestów;
- boundary hashe Viewer Notes, Research, Monitor, Judge, protocols i provider retry.
- pobranie aktualnego Przewodnika osobno dla kolejnych celów Training Run;
- deterministyczne, niezależne od locale sortowanie plików w testach boundary.

## Lokalna walidacja

W niezależnym audycie kandydata R1 wykonano:

- `verify:source`: PASS na rekonstrukcji Unicode-safe wykonanej przez Python `zipfile`;
- `verify:ux-data`: PASS, 24 migracje;
- oba TXT: byte-for-byte zgodne z dostarczonymi plikami i zgodne z deklarowanymi SHA-256;
- TypeScript syntax/transpile dla wszystkich zmienionych TS: PASS;
- TypeScript semantic screen dla wszystkich zmienionych plików produkcyjnych: 0 diagnostyk;
- boundary byte-hash dla Viewer Notes, Research, Monitor, Judge, protocols i provider retry: PASS;
- końcowy zakres zmian względem R3: 8 nowych + 7 zmodyfikowanych + 0 usuniętych plików; complete-source: 772 pliki.
- pełny Vitest: PASS, 158/158 plików i 641/641 testów;
- projektowy typecheck: PASS;
- `verify:architecture`: PASS, 208 plików produkcyjnych, 0 wyjątków;
- Vite production build: PASS.

Rust/Cargo i Clippy nie są dostępne lokalnie. Te bramki pozostają obowiązkowe w GitHub Actions.

## Wymagany Windows runtime smoke

Po zielonych Actions sprawdzić co najmniej:

1. Training PL używa wyłącznie PL lexicon;
2. Training EN używa wyłącznie EN lexicon;
3. kolejność Review → Field Guide Update → Viewer Notes Reflection;
4. `NO_CHANGE` bez nowej wersji;
5. `UPDATE` tworzący jedną nową aktywną wersję;
6. capacity retry i `FAILED_CAPACITY` bez aktywacji propozycji;
7. Resume po przerwaniu między każdym z trzech etapów;
8. historyczny Review nie jest wywoływany ponownie;
9. frozen session Field Guide pozostaje niezmieniony po UPDATE;
10. Research nie mutuje Field Guide;
11. Viewer Notes działa jak w bazie;
12. brak regresji provider retry, Monitor, Judge i protokołów.
13. po `UPDATE` dla pierwszego celu kolejny cel tego samego Training Run otrzymuje nową aktywną wersję, natomiast Resume rozpoczętej sesji zachowuje jej frozen snapshot.

## Status odbiorowy

`CANDIDATE — INDEPENDENT AUDIT, FULL GITHUB ACTIONS AND WINDOWS RUNTIME SMOKE REQUIRED`
