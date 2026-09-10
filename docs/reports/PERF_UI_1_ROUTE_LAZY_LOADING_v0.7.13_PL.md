# AI RV Harness v0.7.13 — PERF-UI-1: mierzony route-level lazy loading

**Data:** 10 września 2026  
**Status:** `INDEPENDENT AUDIT CORRECTED — LOCAL FRONTEND PASS; GITHUB ACTIONS PENDING`  
**Baza:** Etap 6 Rust Providers `_AUDITED`, po pełnym zielonym GitHub Actions  
**Source-tree bazy:** `f386846a26fc87fe05e14f8e62cda12838a377e5d272291e2de6de0dcc873817`  
**GitHub Actions bazy:** CI #136, commit `1be0ae6`, status SUCCESS

## Cel

PERF-UI-1 jest małym etapem wydajnościowym. Nie zmienia danych, migracji, providerów, protokołów RV ani logiki sesji. Jego jedynym celem jest zmniejszenie kodu potrzebnego przy pierwszym uruchomieniu aplikacji przez selektywne odroczenie rzadziej używanych ekranów.

## Punkt odniesienia przed zmianą

Aktywny plan Etapu 6 zapisuje ostatni produkcyjny bundle jako pojedynczy główny chunk około **1 742 kB po minifikacji / 501 kB gzip** oraz istniejące ostrzeżenie Vite o chunku przekraczającym 500 kB. Jest to obowiązujący punkt odniesienia Vite do porównania po zastosowaniu PERF-UI-1.

Dodatkowo wykonano niezależny pomiar statycznego grafu importów TypeScript na dokładnym source-tree Etapu 6. Pomiar nie zastępuje Vite/Rollup, ale pokazuje ile własnego kodu źródłowego znajduje się na synchronicznej ścieżce `src/main.tsx` przed bundlowaniem:

| Pomiar | Etap 6 przed zmianą | PERF-UI-1 kandydat | Różnica |
| --- | ---: | ---: | ---: |
| synchroniczne moduły TS/TSX na ścieżce startowej | 166 | 147 | -19 |
| suma bajtów tych modułów | 1 313 935 B | 1 086 836 B | **-227 099 B (-17,28%)** |

Największe moduły źródłowe obecne wcześniej na ścieżce startowej obejmowały m.in. `RvSessionPanel.tsx` (91 021 B), `ResearchBuilder.tsx` (68 474 B), `i18n.ts` (64 975 B), `telepathicController.ts` (50 079 B) oraz `SettingsScreen.tsx` (44 906 B). Po zmianie `ResearchBuilder.tsx` i `SettingsScreen.tsx` nie należą już do synchronicznej ścieżki startowej.

## Decyzja o zakresie

Leniwie ładowane są wyłącznie:

- `Research`;
- `Settings`;
- `AI Center`, razem z jego Workspace-specific panelem Monitora przez cienki `AiCenterRoute`.

Pozostają eager:

- `Home`;
- `Profiles`;
- `Workspaces`;
- `Targets`;
- `Training`;
- Conversation / Manual RV;
- `RV Sessions`.

Training i RV Sessions nie zostały odroczone mimo ich rozmiaru, ponieważ są częstymi ścieżkami pracy i w tym etapie nie ma pomiaru uzasadniającego dodatkową latencję. Nie dodano także prefetchingu.

## Implementacja

`src/App.tsx` używa trzech dynamicznych importów przez `React.lazy`: publicznego entry pointu Research, Settings i AI Center. Jeden wspólny `Suspense` otacza obszar treści, nie Sidebar ani TopBar. Dzięki temu podczas pierwszego pobrania chunka nie znika globalny layout ani nawigacja.

Dodano `LazyRouteErrorBoundary`. Błąd dynamicznego importu nie pozostawia pustego ekranu: użytkownik widzi komunikat PL/EN, szczegóły techniczne i przycisk ponownego załadowania interfejsu. Zmiana strony przez Sidebar remountuje boundary dla nowego route.

`src/features/aiCenter/AiCenterRoute.tsx` zachowuje dotychczasową kompozycję AI Center + Monitor, ale przesuwa ją do deferred route. Nie przenosi domeny Monitora ani jego persistence.

## Pomiar po zmianie

Dodano `scripts/report-vite-bundle.mjs`. `npm run build` po produkcyjnym buildzie Vite automatycznie raportuje:

- entry chunk i jego rozmiar;
- gzip entry chunku;
- pełny początkowy JavaScript: entry oraz wszystkie statyczne `modulepreload` z `index.html`;
- liczbę emitowanych assetów JS/CSS;
- 12 największych chunków/assetów z gzip;
- 12 największych runtime modułów TypeScript według rozmiaru źródła;
- maszynowo czytelny `dist/bundle-report.json`.

Niezależny build wykazał:

| Pomiar produkcyjny | Etap 6 | PERF-UI-1 | Różnica |
| --- | ---: | ---: | ---: |
| pojedynczy entry JS, minified | 1 742 296 B | 1 368 307 B | -373 989 B (-21,47%) |
| pojedynczy entry JS, gzip-9 reportera | 494 728 B | 405 712 B | -89 016 B (-17,99%) |
| pełny początkowy JS, minified | 1 742 296 B | 1 591 224 B | **-151 072 B (-8,67%)** |
| pełny początkowy JS, gzip-9 reportera | 494 728 B | 457 844 B | **-36 884 B (-7,46%)** |

Pierwszy reporter błędnie eksponował tylko entry i pomijał statyczny chunk `modulepreload` (222 917 B / 52 132 B gzip-9). Audyt poprawił reporter: log i deterministyczny `bundle-report.json` pokazują teraz zarówno entry, jak i rzeczywisty początkowy JavaScript. Mierzona poprawa jest realna, lecz jej właściwą miarą startową jest 8,67% minified / 7,46% gzip-9. Wyświetlane przez Vite wartości zaokrąglone pozostają dodatkowym logiem; tabela używa jednego, spójnego algorytmu gzip-9 reportera dla obu wariantów.

## Nawigacja i zachowanie aplikacji

Obecna aplikacja nie używa URL routera ani URL-based deep linków. Top-level `Page` pozostaje lokalnym stanem `App.tsx`; PERF-UI-1 nie zmienia tego modelu ani istniejącego zachowania powrotu do Home/Workspace. Zmiana dotyczy wyłącznie momentu pobrania modułu.

Pierwszy start nadal inicjalizuje repository, ustawienia, Profile, Workspace, starter targets i recent sessions przed renderowaniem Home. Home pozostaje eager. Po kliknięciu Research, Settings lub AI Center zawartość route może na krótko pokazać wspólny fallback, podczas gdy Sidebar i TopBar pozostają zamontowane.

## Testy i bramki

Dodano `src/perfUiLazyRoutes.test.ts`, który chroni:

- dokładnie trzy wybrane dynamiczne entry pointy;
- brak lazy loadingu Home/Profiles/Workspaces/Training/RV Sessions;
- wspólny `Suspense`;
- widoczny error boundary;
- pozostawienie Monitora wewnątrz lazy AI Center route;
- obecność automatycznego raportera bundle.

Zaktualizowano istniejący `src/architecture/importBoundaries.test.ts`, aby dynamiczne importy publicznych feature entry pointów były traktowane jako prawidłowa granica modułu.

Lokalnie wykonano:

- identyfikację source-tree Etapu 6 przed zmianą: **682 pliki / `f386846a…73817` — PASS**;
- `npm run verify:source` — **PASS**;
- `npm run verify:ux-data` — **PASS**;
- parser/transpilację składni wszystkich plików TS/TSX przez TypeScript compiler API — **PASS**;
- kontrolę zmian obszarów chronionych — **PASS**, brak różnic w `src-tauri/`, `src/storage/`, `src/providers/`, `src/sessions/`, `src/research/`, `src/judge/` i `src/training/`;
- kontrolę import graph przed/po — **PASS**, synchroniczna ścieżka źródłowa zmniejszona o 227 099 B.
- pełny Vitest — **PASS, 137/137 plików i 487/487 testów**;
- TypeScript typecheck — **PASS**;
- produkcyjny Vite dla bazy i kandydata — **PASS**;
- skorygowany pomiar pełnego początkowego JavaScript — **PASS**, -8,67% minified / -7,46% gzip-9.

Rust/Tauri i Clippy oraz powtórzenie frontendowych bramek pozostają obowiązkową bramką dokładnego pakietu w GitHub Actions. Rust nie został zmieniony, ale jego bramki nadal są wymagane zgodnie z planem.

## Obszary chronione

Bez zmian pozostają:

- wszystkie pliki Rust Etapu 6 i publiczne provider command/API;
- TypeScriptowy właściciel retry;
- request/response formats providerów;
- migracje `021–023` i brak migracji `024`;
- legacy `chat_thread_groups` / `thread_group_id`;
- controlled purge;
- Viewer Notes source snapshots i frozen/locked guards;
- Research Lock, Blinding, Reveal i Unblind;
- protokoły RV;
- Judge scoring/freeze;
- Resume i persistence.

## Kryterium odbioru

Kandydat może zostać oznaczony `COMPLETED` dopiero po niezależnym audycie i pełnym zielonym GitHub Actions obejmującym `verify:source`, `verify:ux-data`, typecheck, pełny Vitest, produkcyjny Vite wraz z raportem bundle, Rust/Tauri tests i Clippy `-D warnings`. Należy dodatkowo ręcznie sprawdzić czysty start oraz wejście kolejno do Research, Settings i AI Center.

Jeżeli pomiar Vite pokaże brak istotnej poprawy lub wyraźne pogorszenie wejścia do tych ekranów, zmianę należy cofnąć albo ograniczyć. Następny etap `SECURITY-IPC-0` wolno rozpocząć dopiero po takim odbiorze PERF-UI-1.
