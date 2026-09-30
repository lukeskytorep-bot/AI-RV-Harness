# AI RV Harness v0.7.13 — podział repository RV Sessions

**Data:** 8 września 2026  
**Etap:** 5, krok 5 z 8  
**Status:** implementacja wykonana; walidacja strukturalna i integralnościowa zakończona; pełny Vitest/GitHub Actions wymagają środowiska z zależnościami

## Cel

Wydzielić persistence RV Sessions z szerokich fasad Browser/SQLite do jednego wewnętrznego kontraktu domenowego, bez zmiany publicznego `AppRepository`, schematu bazy, kluczy browser storage, serializowanych rekordów ani reguł blind/seal/Reveal.

## Zakres wykonany

Dodano:

- `src/storage/contracts/sessionsRepository.ts`;
- `src/storage/browser/sessionsRepository.ts`;
- `src/storage/sqlite/sessionsRepository.ts`;
- `src/storage/sessionsRepository.contract.test.ts`;
- `src/storage/sessionsRepositoryBoundary.test.ts`.

`BrowserRepository` i `SqliteRepository` delegują teraz pełny podstawowy zakres RV Session persistence:

- tworzenie sesji i aktualizację stanu;
- ordered session events;
- pre-Reveal transcript;
- immutable Session Snapshot;
- sealing pre-Reveal evidence;
- Reveal;
- odczyt sealed Viewer evidence;
- post-Reveal transcript;
- listowanie RV Sessions;
- target clarifications.

Publiczny `AppRepository` pozostaje niezmieniony.

## Chronione granice

Nie przeniesiono wraz z Sessions:

- Monitor persistence;
- Judge persistence;
- Research project persistence;
- Training persistence;
- AI Center / Viewer Notes persistence;
- Custom Protocol persistence.

Są to kolejne lub osobne granice Etapu 5.

Cross-domain reguła Research pozostaje jawna. Browser Sessions adapter otrzymuje z fasady predykat informujący, czy wyniki Research zostały zamrożone. SQLite adapter otrzymuje analogiczny lookup używany przez preflight post-Reveal, a właściwa integralność danych nadal jest dodatkowo chroniona przez istniejące triggery bazy.

## Zachowane reguły integralności

Nie zmieniono migracji ani triggerów. W szczególności zachowano:

- `session_snapshots` jako immutable;
- atomic Reveal przez istniejący trigger `mark_session_revealed_atomically`;
- zakaz Reveal przed sealed pre-Reveal state;
- append-only post-Reveal transcript;
- Research post-Reveal dopiero po frozen scores;
- target clarification dopiero po Reveal;
- Research target clarification dopiero po frozen Judge scores;
- immutable target clarifications;
- dotychczasowe powiązania z Monitor, Judge, Training, Research i Viewer Notes.

Browser preview zachowuje odpowiadające reguły aplikacyjne i te same klucze local storage.

## Dodatkowe uporządkowanie fasady

Po przeniesieniu `rvh.dev.rv_sessions` do Browser Sessions adaptera:

- browserowy used-target guard korzysta z jawnego `sessionsRepository.hasRecordedTargetUse(...)` zamiast ponownie czytać surowy klucz sesji;
- `listMonitorRuns(workspaceId)` korzysta z `sessionsRepository.listRvSessions(workspaceId)` do mapowania session code, dzięki czemu szeroka fasada nie musi zachowywać drugiej kopii wiedzy o browserowym kluczu RV Sessions.

Nie zmienia to publicznego zachowania Monitora ani Targets.

## Testy dodane

Nowe testy chronią m.in.:

- niezmienione browser storage keys;
- tworzenie, listowanie i stan sesji;
- sealed evidence i Reveal;
- immutable browser snapshot;
- kolejność eventów;
- Research frozen-score guards w browser preview;
- mapowanie SQLite i istniejące INSERT/UPDATE paths;
- zachowanie atomic Reveal jako pojedynczego INSERT do `reveals`, bez konkurencyjnej aktualizacji stanu w adapterze;
- sekwencję post-Reveal transcript + session event;
- pozostawienie ochrony target clarifications triggerom SQLite;
- pełną delegację publicznej powierzchni Sessions;
- pozostawienie Monitor/Judge/Research/Custom Protocol poza tym podziałem;
- jawny cross-domain lookup frozen Research scores.

Kandydat zawiera **113 plików testowych**. Dodano **10 nowych testów** do poprzedniego baseline'u 111 plików / 351 testów, więc oczekiwany pełny zestaw wynosi **361 testów**.

## Weryfikacja wykonana w tym środowisku

Zaliczone:

- `npm run verify:source`;
- ścisła kompilacja zmienionych produkcyjnych modułów i nowych testów przez dostępny lokalny TypeScript compiler, z minimalnymi deklaracjami wyłącznie dla niedostępnych pakietów zewnętrznych;
- runtime smoke test obu nowych adapterów po lokalnej transpiliacji: create/seal/Reveal/evidence, event sequencing, Research frozen-score guard oraz SQLite write sequencing;
- wszystkie migracje SQLite `001–020` na świeżej bazie;
- rzeczywiste sprawdzenie triggerów: atomic Reveal, immutable snapshot, append-only post-Reveal, Research frozen-score guard i target-clarification guard;
- potwierdzenie, że `src/storage/repository.ts`, `src/types.ts`, `package.json`, `package-lock.json`, konfiguracja Tauri/Cargo oraz wszystkie migracje są bajt w bajt niezmienione względem wymaganego baseline'u.

Nie udało się wykonać pełnego `npm ci` / Vitest / Vite build w tym sandboxie, ponieważ środowisko nie ma dostępu DNS do npm registry (`EAI_AGAIN`) i wymaganych zależności nie ma w cache. Z tego powodu pełny **361-testowy Vitest, project typecheck, Vite build oraz Rust/Tauri/Clippy pozostają obowiązkową bramką GitHub Actions** dla dokładnego kandydata.

## Świadomie niewykonane

Ten krok nie dodaje jeszcze:

- Archive / Restore / Permanent Delete dla RV Sessions;
- `listRecentRvSessions(limit)` dla Home;
- zmian UI;
- zmian protokołów lub controller state machines;
- zmian Monitor/Judge;
- zmian Research/Training;
- migracji związanych z późniejszym Unified Data Lifecycle.

Te elementy należą do późniejszego planu UX/data lifecycle albo kolejnych kroków Etapu 5.

## Następny krok

Po zielonym GitHub Actions należy kontynuować Etap 5 przez wydzielenie **Training persistence** (krok 6 z 8).

Sessions repository stanie się później właściwym punktem wejścia dla zaplanowanego Archive → Restore → Permanent Delete oraz ewentualnej optymalizacji Home `listRecentRvSessions(limit)`, ale nie należy mieszać tych zmian funkcjonalnych z obecną refaktoryzacją strukturalną.
