# AI RV Harness v0.7.13 — podział repository AI Judge, Research i eksportów

**Data:** 8 września 2026  
**Etap:** 5, krok 8 z 8  
**Status:** wykonano i niezależnie zweryfikowano po stronie frontendu; AI Center + Monitor potwierdzone zielonym GitHub Actions; kandydat Judge + Research oczekuje na własny GitHub Actions (Rust/Tauri i Clippy)

## Cel

Zamknąć Etap 5 przez wydzielenie persistence AI Judge i Research z szerokich fasad Browser/SQLite, bez zmiany publicznego `AppRepository`, schematu, migracji, browser storage, scoringu Judge, Research Lock, blindingu ani kolejności Unblind. W tym samym kandydacie wydzielono mały, cross-domain `ExportRepository`, ponieważ wspólny ledger eksportów jest używany przez Training, RV Sessions, Monitor i Research i nie powinien być sztucznie własnością Research.

## Zakres wykonany

Dodano:

- `src/storage/contracts/judgeRepository.ts`;
- `src/storage/browser/judgeRepository.ts`;
- `src/storage/sqlite/judgeRepository.ts`;
- `src/storage/contracts/researchRepository.ts`;
- `src/storage/browser/researchRepository.ts`;
- `src/storage/sqlite/researchRepository.ts`;
- `src/storage/contracts/exportRepository.ts`;
- `src/storage/browser/exportRepository.ts`;
- `src/storage/sqlite/exportRepository.ts`;
- `src/storage/judgeRepository.contract.test.ts`;
- `src/storage/researchRepository.contract.test.ts`;
- `src/storage/exportRepository.contract.test.ts`;
- `src/storage/judgeResearchRepositoryBoundary.test.ts`.

`JudgeRepository` przejmuje:

- zapis pojedynczego frozen Judge result;
- atomowy zapis grupy Judge runs + frozen scores;
- duplicate `(sessionId, judgeIndex)` guard w browser storage;
- obliczenie total przez istniejący `computeJudgeTotal()`;
- odczyt wyników w kolejności `judgeIndex`.

`ResearchRepository` przejmuje:

- tworzenie i odczyt Research Project;
- listowanie projektów;
- state transitions z trwałymi `scoresFrozenAt` i `unblindedAt`;
- Experiment Lock wraz z conditions, assignments i Blinding Key mappings;
- listowanie conditions, assignments i mappings;
- aktualizację wykonawczego `sessionId/status` assignmentu;
- immutable Research Results;
- dwa jawne helpery cross-domain: frozen-score lookup dla Sessions i target-use lookup dla Targets.

`ExportRepository` przejmuje wyłącznie wspólny audit ledger `recordExport()` bez zmiany formatu rekordów.

## Zachowane granice i integralność

Nie zmieniono migracji `001–020`. W szczególności zachowane pozostają:

- frozen Judge score update/delete guards z migration 003;
- frozen Judge run update/delete guards;
- locked Research methodology guard;
- locked conditions/assignments/Blinding Key immutability;
- zakaz Unblind przed frozen Judge scores;
- immutable Research Results;
- istniejące FK i cascade/set-null semantics;
- istniejący Judge scoring 3+3+2+2 i allowlisted packet;
- Research execution, randomization, judge ordering, unblinding i result computation poza persistence;
- publiczny `AppRepository` bez zmian;
- istniejące browser keys i serialized record formats.

Sessions nie czyta już surowej tabeli/klucza Research w szerokiej fasadzie. Frozen-score guard jest dostarczany przez `ResearchRepository.isScoresFrozen()`. Analogicznie browserowy Targets used-target guard korzysta z `ResearchRepository.hasRecordedTargetUse()` zamiast surowego `research_assignments` key w fasadzie.

## ExportRepository

`recordExport()` nie jest częścią Research persistence w sensie domenowym. Używają go także:

- Training export;
- complete Session export;
- Monitor export;
- Research export.

Dlatego finał Etapu 5 dodaje osobny `ExportRepository`, zgodny z docelową mapą storage z głównego planu. Nie zmienia to API `AppRepository` ani formatu tabeli/klucza eksportów.

## Świadomie pozostawione w compatibility facade

Zamknięcie ośmiu numerowanych domen persistence nie oznacza usunięcia każdej pomocniczej metody z fasad. Jawnie pozostają tam:

- Profile archive/restore, ponieważ operacja przekracza granicę Profile → Workspaces;
- Workspace Sources i chat-source activation;
- Custom Protocol version persistence;
- backup/restore primitives.

Nie są one częścią kroku Judge + Research i nie stanowią ukrytej implementacji Judge/Research. Ich ewentualne dalsze wydzielenie może być osobnym małym cleanupem, jeśli pojawi się realna korzyść.

## Testy

Dodano **4 pliki testowe / 20 przypadków**. Kandydat zawiera **123 pliki testowe / 419 testów**.

Nowe testy obejmują m.in.:

- niezmienione browser keys Judge/Research/export;
- total Judge i ordering po `judgeIndex`;
- duplicate Judge index guard;
- istniejący SQLite batch run+score transaction;
- mapowanie Judge narrative JSON;
- Research create/list/state timestamps;
- Experiment Lock i trzy grupy rekordów lock planu;
- target-use i frozen-score helpery;
- assignment update;
- immutable Research Results;
- SQLite lock transaction;
- incomplete locked assignment guard;
- cross-domain Export ledger;
- pełną delegację Judge/Research/export przez publiczne fasady;
- brak surowych Judge/Research/export kluczy i SQL w szerokich fasadach.

Zaktualizowano również historyczne boundary tests Sessions, Training i AI Center, aby po finałowej ekstrakcji wymagały delegacji do nowych repozytoriów zamiast starej inline implementacji Judge/Research.

## Walidacja wykonana lokalnie

Zaliczone:

- `npm run verify:source`;
- ścisła kompilacja TypeScript wszystkich nowych kontraktów/adapters, obu zmienionych fasad i nowych/zmienionych boundary tests z minimalnymi deklaracjami wyłącznie dla niedostępnych zależności runtime;
- wszystkie migracje SQLite `001–020` na świeżej bazie;
- realne SQLite: frozen Judge score update/delete blocked;
- realne SQLite: frozen Judge run update blocked;
- realne SQLite: locked Research methodology update blocked;
- realne SQLite: locked condition delete blocked;
- realne SQLite: Unblind przed ScoresFrozen blocked, po ScoresFrozen allowed;
- realne SQLite: Research Results update/delete blocked;
- `src/storage/repository.ts`, `src/types.ts`, pliki wersji i migracje pozostają niezmienione;
- `App.tsx` pozostaje 648 linii;
- factory Training target tree pozostaje dokładnie 84 plikami;
- brak `node_modules`, `dist` i `*.tsbuildinfo` w źródle pakowanym.

Niezależny odbiór wykrył jeden nieaktualny test granicy Sessions: po prawidłowym przeniesieniu helpera Research test nadal szukał dawnej implementacji inline. Oczekiwanie poprawiono tak, aby chroniło delegację `isResearchScoresFrozen()` do `ResearchRepository`, bez zmiany kodu produkcyjnego.

Po korekcie dokładny kandydat przeszedł:

- **123/123 pliki testowe i 419/419 testów**;
- pełny project TypeScript typecheck;
- produkcyjny build Vite;
- `npm run verify:source`;
- kontrolę czystości pełnego source oraz rekonstrukcję nakładka → pełny snapshot.

Środowisko niezależnego odbioru nie posiada `cargo`, dlatego Rust/Tauri i Clippy pozostają obowiązkową bramką GitHub Actions dokładnej poprawionej nakładki.

## Kryterium zamknięcia Etapu 5

Po zielonym GitHub Actions dokładnego kandydata Judge + Research można oznaczyć **Etap 5 — podział repository jako COMPLETED (8/8)**.

Następnie, zgodnie z głównym planem, kolejnym etapem architektonicznym jest **Etap 6 — porządkowanie providerów Rust**. Osobno zachowany plan UX/data-lifecycle może zostać wykonany po Etapie 5 w kontrolowanych fazach, bez mieszania go z tą refaktoryzacją persistence.
