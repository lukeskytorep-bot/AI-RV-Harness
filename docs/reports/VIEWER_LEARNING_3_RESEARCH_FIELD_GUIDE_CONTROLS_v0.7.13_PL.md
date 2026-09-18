# VIEWER-LEARNING-3 — RESEARCH FIELD GUIDE CONTROLS

**Projekt:** AI RV Harness v0.7.13
**Data:** 18 września 2026
**Status:** `CANDIDATE — INDEPENDENT AUDIT, FULL GITHUB ACTIONS AND WINDOWS RUNTIME SMOKE REQUIRED`

## 1. Baza

Implementacja została wykonana wyłącznie na dokładnym pakiecie `VIEWER-LEARNING-2-R1 — TRAINING FIELD GUIDE UPDATE`.

- baza source-tree: `203b4396b0df6e2e9002c4d0c386e8d98877d7a954b85d871071d39c4530280a`;
- pliki bazy: 772;
- SQLite schema: 24;
- data epoch: `v0.7.13`;
- brak migracji 025;
- dostarczony complete-source nie zawiera `.git`, dlatego upstream branch, pełny commit SHA i rzeczywisty `git status` muszą zostać potwierdzone w zielonym checkout przed zastosowaniem patcha.

## 2. Cel kroku

`VIEWER-LEARNING-3` dodaje kontrolowane, zamrażane użycie Field Guide w Research bez zmiany sposobu uczenia Field Guide i Viewer Notes. Research jest konsumentem read-only: nie tworzy ani nie aktualizuje wersji Field Guide i nie uruchamia Viewer Notes Reflection.

## 3. Zwykły Research

Research ma dwa niezależne ustawienia:

- Viewer Notes: `OFF` / `CURRENT`;
- Field Guide: `OFF` / `CURRENT`.

Obsługiwane są wszystkie cztery kombinacje. Przy `Experiment Lock` bieżące włączone warstwy są zamrażane do pełnych snapshotów. Field Guide snapshot zapisuje dokładną wersję, hash treści, pełną treść, identity, język, capacity, route i provenance.

`Field Guide OFF` usuwa wyłącznie trenowaną część. Locked Core Identity, Locked Base Vocabulary i zasady protokołu pozostają aktywne.

## 4. Prompt Research

Dotychczasowy ręczny eksperyment Prompt Research pozostaje dostępny i zachowuje dotychczasowe znaczenie pełnego ręcznego promptu. Nie jest zapisywany jako Field Guide.

Dodano drugi jawny typ źródła:

- `MANUAL` — ręczne warianty promptu;
- `HISTORY` — historia trenowanego Field Guide.

W `HISTORY`:

- pokazywane jest do sześciu ostatnich wersji dokładnej identity i języka;
- operator wybiera ręcznie 2–4 wersje;
- nie istnieje automatyczne „latest three”;
- wersja obcej identity lub innego języka jest odrzucana;
- każda wybrana wersja jest zamrażana przy Lock;
- wykonanie i Resume korzystają wyłącznie z frozen snapshotów;
- wynik i eksport zapisują dokładny Field Guide version ID, numer wersji i SHA-256.

Porównanie HISTORY zmienia tylko wersjonowaną trainable część Field Guide. Ten sam frozen Locked Core Identity i Locked Base Vocabulary są składane podczas wykonania z każdą wybraną wersją.

## 5. Viewer Notes Impact

Istniejący eksperyment `No Notes` / `Frozen Current Notes` nie został zmieniony. Dodano możliwość zamrożenia jednego wspólnego ustawienia Field Guide dla obu warunków, aby Field Guide nie został przypadkowo drugą zmienną.

Nie dodano historycznego wyboru Viewer Notes.

## 6. Research Lock i Resume

Frozen config przechowuje:

- Field Guide mode i source;
- version ID, version number i content SHA-256;
- exact content snapshot;
- exact Viewer identity i język;
- capacity i source provenance;
- Locked Core Identity version;
- Locked Base Vocabulary version;
- Viewer Notes mode/snapshot;
- istniejące generation settings i pozostałą konfigurację Research.

Zmiana aktywnego Field Guide po Lock nie aktualizuje projektu i nie blokuje Resume. Resume nie pobiera nowej aktywnej wersji z Viewer Learning. Niezgodność wewnątrz samego frozen snapshotu pozostaje błędem integralności.

## 7. Read-only storage boundary

Istniejące `getFieldGuideBundle()` może bootstrapować brakujące settings, dlatego Research nie używa tej ścieżki. Dodano jawne `getExistingFieldGuideBundle()` w kontrakcie i implementacjach Browser/SQLite. Metoda wyłącznie odczytuje istniejący bundle i zwraca brak danych bez tworzenia settings, aktywacji lub wersji.

Ta granica chroni zasadę: **Research nigdy nie uczy Field Guide ani Viewer Notes**.

## 8. UI

Research Builder pokazuje jawnie:

- Viewer Notes: `OFF` / `CURRENT`;
- Field Guide: `OFF` / `CURRENT`;
- Prompt Research: `MANUAL` / `HISTORY`;
- listę wybranych historycznych wersji z numerem, datą, źródłowym Training/provenance i skróconym hashem;
- frozen status po Lock.

Termin „System Prompt” nie jest używany jako nazwa samego Field Guide. UI wyjaśnia, że Core Identity i Base Vocabulary pozostają zablokowane.

## 9. Granice pozostawione bez zmian

Krok nie zmienia:

- sposobu tworzenia Field Guide po Training;
- promptu Field Guide Update;
- Viewer Notes Reflection;
- Post-Reveal Review;
- Monitorów;
- Judge;
- scoringu i frozen scores;
- provider retry;
- credential routing;
- controlled purge;
- targetów i protokołów;
- Research lifecycle poza koniecznym frozen snapshotem.

## 10. Testy i zabezpieczenia

Dodano lub rozszerzono pokrycie dla:

1. czterech kombinacji Notes/Field Guide;
2. freeze aktualnego Field Guide;
3. OFF bez usunięcia locked blocks;
4. listy sześciu wersji;
5. wyboru 2–4 wersji;
6. odrzucenia obcej identity;
7. separacji języka;
8. zachowania manual variants;
9. Field Guide history jako jedynej zmiennej;
10. Research Lock;
11. driftu po Lock;
12. Resume z frozen snapshotu;
13. braku aktualizacji Field Guide przez Research;
14. braku aktualizacji Viewer Notes przez Research;
15. Viewer Notes Impact ze wspólnym Field Guide;
16. Browser/SQLite persistence kontraktów;
17. controlled purge/provenance boundary;
18. kosztu/context preflight;
19. kompatybilności legacy Research config.

Boundary tests dodatkowo blokują podłączenie Research do Field Guide Update/Viewer Notes Reflection i chronią istniejące pliki controlled purge przed przypadkową zmianą.

## 11. Lokalne bramki wykonane w środowisku przygotowującym kandydata

- `npm run verify:source`: **PASS**;
- `npm run verify:ux-data`: **PASS**;
- SQLite fresh `001→024`: **PASS**, `integrity_check=ok`, `foreign_key_check=0`;
- SQLite green `v23→v24`: **PASS**, istniejące rekordy/tabele zachowane, `integrity_check=ok`, `foreign_key_check=0`;
- kontrola składni zmienionych plików TS/TSX przez TypeScript parser: **PASS**;
- whitespace/diff check na syntetycznym lokalnym repo: **PASS**;
- alternatywny statyczny audit runtime dependency graph: **0 runtime cycles / 0 wykrytych nowych boundary violations**;
- overlay reconstruction na dokładny VIEWER-LEARNING-2-R1: **PASS**;
- ZIP integrity i source-tree reconstruction: **PASS**.

### Bramki, których nie można uczciwie oznaczyć lokalnie jako PASS

Dostarczony complete-source nie zawiera `node_modules`, a środowisko przygotowujące pakiet nie miało działającego dostępu DNS do rejestru npm. Nie było także `cargo` / `rustc`. Dlatego oficjalne:

- pełny Vitest;
- `npm run typecheck`;
- Vite production build;
- kanoniczny `npm run verify:architecture` oparty o `@babel/parser`;
- `cargo test`;
- `cargo clippy`

pozostają obowiązkowymi bramkami pełnego GitHub Actions. Windows runtime smoke również pozostaje obowiązkowy.

Nie są one w tym raporcie przedstawiane jako wykonane.

## 12. Finalny audyt zakresu VIEWER-LEARNING-1–3

Kod i dokumentacja zostały przejrzane pod kątem wspólnej ścieżki:

- Viewer Learning UI i version history;
- exact identity i PL/EN;
- kompozycji Locked Core + Locked Base Vocabulary + trainable Field Guide;
- kolejności Training i per-target snapshots z VL2-R1;
- capacity retry;
- Resume/idempotency;
- Research Lock/frozen snapshots;
- legacy database gate i schema 24;
- świeżej bazy oraz `v23→v24`;
- backup/restore i controlled purge boundary;
- zachowania ścieżek Windows w istniejącej architekturze.

Ostateczny odbiór pozostaje zależny od niezależnego audytu, pełnego GitHub Actions i Windows runtime smoke.

## 13. Tożsamość kandydata

- baza: 772 pliki, source-tree `203b4396b0df6e2e9002c4d0c386e8d98877d7a954b85d871071d39c4530280a`;
- wynik: `776` plików;
- zakres: `4` nowe + `23` zmodyfikowane + 0 usuniętych;
- SQLite schema: 24;
- data epoch: `v0.7.13`;
- source-tree finalnego drzewa jest zapisany w zewnętrznym manifeście i SHA256SUMS, aby raport znajdujący się wewnątrz drzewa nie tworzył samoodwołującego hasha.

**Status końcowy:** `CANDIDATE — INDEPENDENT AUDIT, FULL GITHUB ACTIONS AND WINDOWS RUNTIME SMOKE REQUIRED`
