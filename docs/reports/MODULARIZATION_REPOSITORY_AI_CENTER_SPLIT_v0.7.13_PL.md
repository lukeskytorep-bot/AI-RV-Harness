# AI RV Harness v0.7.13 — podział repository AI Center i AI Monitor

**Data:** 8 września 2026  
**Etap:** 5, krok 7 z 8  
**Status:** wykonano i niezależnie zweryfikowano frontend; Training potwierdzone zielonym GitHub Actions; AI Center/Monitor oczekuje na własny GitHub Actions

## Cel

Wydzielić z szerokich fasad Browser/SQLite persistence AI Center bez zmiany publicznego `AppRepository`, schematu, migracji, browser storage ani zasad Viewer Notes. Ponieważ plan Etapu 5 nie posiada osobnego numeru dla Monitora, a AI Monitor jest prezentowany w AI Center, w tym samym kandydacie wydzielono jego persistence do **osobnego** `MonitorRepository`, bez łączenia Monitora z Viewer Notes w jednym kontrakcie.

## Zakres wykonany

Dodano:

- `src/storage/contracts/aiCenterRepository.ts`;
- `src/storage/browser/aiCenterRepository.ts`;
- `src/storage/sqlite/aiCenterRepository.ts`;
- `src/storage/contracts/monitorRepository.ts`;
- `src/storage/browser/monitorRepository.ts`;
- `src/storage/sqlite/monitorRepository.ts`;
- `src/storage/aiCenterRepository.contract.test.ts`;
- `src/storage/aiCenterRepositoryBoundary.test.ts`;
- `src/storage/monitorRepository.contract.test.ts`;
- `src/storage/monitorRepositoryBoundary.test.ts`.

`AiCenterRepository` przejmuje pełny istniejący zakres:

- `ensureAiIdentity()` i listowanie identity;
- Viewer Notes bundle;
- settings capacity/default enabled;
- append-only versions i activation history;
- reflection runs: begin/fail/commit;
- idempotent `UPDATE` / `NO_CHANGE`;
- stale-base handling;
- `Restore Version` z zapisem `human_restore`.

`MonitorRepository` przejmuje:

- tworzenie Monitor Run;
- ordered Monitor interventions;
- listowanie runów w Workspace z session code i intervention count;
- listowanie interwencji.

## Zachowane granice i integralność

Nie zmieniono migracji `001–020`, w tym migration 020. Zachowane pozostają:

- identity uniqueness `(profile, credential fingerprint, provider, normalized base URL, model route, role)`;
- default Viewer Notes settings wyłącznie dla role `viewer`;
- append-only `ai_note_versions`;
- append-only `ai_note_activation_events`;
- cross-identity active-version guards;
- stale-base trigger `STALE_BASE`;
- capacity preflight przed zmniejszeniem limitu;
- idempotencja reflection run per identity/session;
- czteroelementowy SQLite commit `UPDATE`: version → activation → active settings → reflection run;
- transactional `human_restore`;
- `ON DELETE RESTRICT` źródeł Viewer Notes;
- istniejące tabele i klucze Monitora;
- SQL numerowania Monitor interventions przez `MAX(sequence_number)+1`.

Browser Monitor adapter otrzymuje jawnie `listRvSessions(workspaceId)` od składanego `SessionsRepository`; nie czyta ponownie surowego klucza RV Sessions.

## Świadomie niewykonane

Ten krok nie zmienia:

- Viewer Notes policy Training-only;
- reflection promptów ani model calls;
- AI Center UI;
- Monitor engine/promptów;
- Judge persistence;
- Research persistence;
- Archive/Restore/Permanent Delete;
- schematu/migracji;
- Profile/credential isolation selektorów UX.

Judge + Research pozostają ostatnim krokiem Etapu 5.

## Testy

Dodano 4 pliki testowe z **26 nowymi testami**. Kandydat zawiera **119 plików testowych**; oczekiwany pełny wynik to **399 testów**.

Testy obejmują m.in.:

- niezmienione browser keys AI Center i Monitor;
- normalizację base URL i identity upsert;
- brak Viewer Notes settings dla Monitor/Judge identity;
- first-version bootstrap;
- idempotent reflection begin/commit;
- `NO_CHANGE`, failed reflection i attempt count;
- stale-base bez utworzenia nowej wersji;
- capacity guard i `human_restore`;
- zachowanie czterostatementowej transakcji SQLite;
- Monitor intervention sequencing;
- Workspace/session-code mapping;
- pełną delegację obu nowych kontraktów;
- usunięcie surowego AI Center/Monitor persistence z szerokich fasad.

Zaktualizowano też historyczne boundary tests Sessions i Training tak, aby nadal potwierdzały oddzielenie domen po późniejszej ekstrakcji, zamiast wymagać starej inline implementacji w fasadzie.

## Walidacja wykonana lokalnie

Zaliczone:

- `npm run verify:source`;
- ścisła kompilacja TypeScript nowych kontraktów, adapterów, obu zmienionych fasad i nowych/zmienionych testów z minimalnymi deklaracjami wyłącznie dla niedostępnych zależności runtime;
- wszystkie migracje SQLite `001–020` na świeżej bazie;
- realne SQLite: identity + settings, reflection UPDATE, active version, append-only update/delete guards, activation-history delete guard, `STALE_BASE`, `human_restore`;
- realne SQLite Monitor: sequence `1,2` oraz Workspace/session-code join;
- brak zmian `src/storage/repository.ts`, `src/types.ts`, migracji i plików wersji.

Niezależny odbiór dokładnego pełnego ZIP-a potwierdził następnie:

- **119/119 plików testowych i 399/399 testów**;
- pełny project typecheck;
- produkcyjny build Vite;
- `verify:source` na czystym drzewie;
- brak `node_modules`, `dist` i `*.tsbuildinfo` w paczce;
- poprawne nazwy Unicode wszystkich zasobów używanych przez Rust;
- bajtową zgodność wyniku nałożenia nakładki na bazę Training z pełnym snapshotem AI Center/Monitor.

Lokalne środowisko niezależnego odbioru nie posiada `cargo`, dlatego Rust/Tauri, `cargo test` i Clippy pozostają bramką GitHub Actions dokładnego kandydata.

## Następny krok

Po zielonym GitHub Actions dokładnego kandydata AI Center/Monitor należy wykonać ostatni krok Etapu 5: **Judge + Research persistence (8/8)**.
