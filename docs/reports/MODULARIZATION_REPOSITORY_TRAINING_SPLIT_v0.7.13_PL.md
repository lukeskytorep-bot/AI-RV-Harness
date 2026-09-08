# AI RV Harness v0.7.13 — podział repository Training

**Data:** 8 września 2026  
**Etap:** 5, krok 6 z 8  
**Status:** wykonano lokalnie i niezależnie odebrano frontend; baza Sessions potwierdzona zielonym GitHub Actions; Training oczekuje na własny GitHub Actions

## Cel

Wydzielić persistence Training Run z szerokich fasad Browser/SQLite do jednego wewnętrznego kontraktu domenowego, bez zmiany publicznego `AppRepository`, schematu, migracji, browser storage, `TrainingRunRecord` ani zachowania Training/Resume.

## Zakres wykonany

Dodano:

- `src/storage/contracts/trainingRepository.ts`;
- `src/storage/browser/trainingRepository.ts`;
- `src/storage/sqlite/trainingRepository.ts`;
- `src/storage/trainingRepository.contract.test.ts`;
- `src/storage/trainingRepositoryBoundary.test.ts`.

`BrowserRepository` i `SqliteRepository` delegują teraz pełny istniejący zakres Training persistence:

- tworzenie Training Run;
- monotoniczne numerowanie runów zgodnie z dotychczasową implementacją;
- durable update `TrainingRunRecord`;
- completed target IDs i odpowiadające im session IDs;
- `currentIndex`;
- frozen `executionSnapshot`;
- durable `activeTargetCheckpoint`;
- ścieżkę eksportu i koszt rzeczywisty;
- append-only akumulację błędów w polu `errors`;
- listowanie runów od najwyższego `runNumber`;
- kompatybilność legacy dla rekordów bez `sessionIds` przez normalizację do `[]` przy odczycie.

Publiczny `AppRepository` pozostaje niezmieniony.

## Świadomie zachowane granice

Ten krok nie przenosi wraz z Training:

- wykonania Training i logiki Resume z `src/features/training/trainingExecution.ts`;
- RV Sessions persistence;
- Judge persistence;
- Viewer Notes / AI Center persistence;
- Research persistence;
- target persistence;
- eksportu Training.

`TrainingRunRecord` przechowuje identyfikatory sesji i checkpointy, ale nie wykonuje cross-domain writes. Nie jest więc potrzebny dodatkowy callback fasady ani nowa jednostka transakcyjna w tym kroku.

## Zachowane formaty danych

### Browser

Pozostaje dokładnie ten sam klucz:

`rvh.dev.training_runs`

Tworzenie runu nadal inicjalizuje:

- `completedTargetIds: []`;
- `sessionIds: []`;
- `currentIndex: 0`;
- `errors: []`;
- `createdAt` i `updatedAt` tym samym timestampem.

Aktualizacja nadal dopisuje `input.error` do istniejącej tablicy `errors` zamiast ją zastępować.

### SQLite

Pozostaje istniejąca tabela `training_runs` z migracji `016_training_runs.sql`:

- `id`;
- `run_number`;
- `status`;
- `record_json`;
- `created_at`;
- `updated_at`.

Kanoniczny pełny rekord Training nadal jest zapisany jako `TrainingRunRecord` w `record_json`, przy równoległym utrzymaniu `run_number` i `status` dla istniejącego indeksowania i zapytań.

Nie dodano migracji ani triggerów.

## Testy dodane

Nowy zestaw testów obejmuje obie implementacje i sprawdza:

- tworzenie runu z kolejnym numerem;
- inicjalizację durable fields;
- round-trip checkpointu i execution snapshotu;
- dopisywanie nowego błędu bez utraty wcześniejszych błędów;
- zapis `completedTargetIds`, `sessionIds` i `currentIndex`;
- sortowanie malejąco po `runNumber`;
- legacy normalization braku `sessionIds`;
- niezmieniony browser key `rvh.dev.training_runs`;
- niezmienioną sekwencję SQLite `MAX(run_number) → INSERT`;
- niezmienioną sekwencję update `SELECT record_json → UPDATE`;
- zachowany błąd SQLite `Training run not found.`;
- pełną delegację trzech metod przez publiczne fasady;
- usunięcie surowej implementacji Training z szerokich fasad;
- pozostawienie Sessions, Judge i Viewer Notes poza tym podziałem.

Dodano **2 pliki testowe / 12 testów** do zielonego baseline'u Sessions **113 plików / 361 testów**. Kandydat Training zawiera **115 plików testowych**, a niezależny odbiór potwierdził pełny wynik **373/373 testy**.

## Weryfikacja wykonana lokalnie

Zaliczone:

- `npm run verify:source`;
- ścisła kompilacja TypeScript nowych produkcyjnych modułów;
- ścisła kompilacja obu nowych plików testowych z minimalnymi deklaracjami wyłącznie dla niedostępnego runtime Vitest/Vite;
- runtime smoke test Browser Training adaptera;
- runtime smoke test SQLite Training adaptera;
- wszystkie migracje SQLite `001–020` na świeżej bazie;
- rzeczywisty INSERT/UPDATE/SELECT tabeli `training_runs` po pełnym łańcuchu migracji;
- potwierdzenie, że `src/storage/repository.ts`, `src/types.ts`, schema/migrations i wersje aplikacji nie zostały zmienione.

Niezależny odbiór dokładnego pełnego ZIP-a, wykonany po przygotowaniu kandydata z dostępnymi zależnościami, potwierdził dodatkowo:

- **115/115 plików testowych i 373/373 testy**;
- pełny project TypeScript typecheck;
- produkcyjny build Vite;
- `verify:source` na czystym źródle;
- brak `node_modules`, `dist` i `*.tsbuildinfo` w paczce;
- bajtową zgodność pełnego snapshotu z zielonym baseline'em Sessions po nałożeniu nakładki;
- niezmieniony publiczny `AppRepository` i migracje `001–020`.

Rust/Tauri, Clippy i końcowy GitHub Actions dla dokładnego kandydata Training pozostają obowiązkową bramką przed uznaniem kroku 6/8 za zakończony.

## Świadomie niewykonane

Ten krok nie implementuje jeszcze:

- Archive / Restore / Permanent Delete dla Training;
- ograniczonej/przewijanej listy Training w UI;
- zmian Viewer Notes lifecycle;
- zmian Resume lub checkpoint semantics;
- zmian w Training export;
- zmian schematu `training_runs`;
- zmian w Sessions/Judge/Research.

Te funkcje należą do późniejszego planu UX/data lifecycle albo kolejnych kroków Etapu 5.

## Następny krok

Po zielonym GitHub Actions dokładnego kandydata Training należy kontynuować Etap 5 przez wydzielenie **AI Center persistence** (krok 7 z 8).

Wydzielony `TrainingRepository` stanie się później naturalnym punktem wejścia dla zaplanowanego `Archive → Restore → Permanent Delete`, ale nie należy mieszać tej zmiany funkcjonalnej z obecną refaktoryzacją strukturalną.
