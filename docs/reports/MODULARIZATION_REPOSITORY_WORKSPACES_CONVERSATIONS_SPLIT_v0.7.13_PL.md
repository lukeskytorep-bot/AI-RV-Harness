# AI RV Harness v0.7.13 — podział repository Workspaces i Conversations

**Data:** 8 września 2026  
**Etap:** 5, krok 4 z 8  
**Status:** wykonano lokalnie; GitHub Actions oczekuje na potwierdzenie

## Cel

Wydzielić persistence Workspaces i Conversations z szerokich fasad browser/SQLite do jednego wewnętrznego kontraktu domenowego, bez zmiany publicznego `AppRepository`, schematu, formatów danych ani zachowania produktu.

## Zakres wykonany

- dodano `src/storage/contracts/workspacesConversationsRepository.ts`;
- dodano `src/storage/browser/workspacesConversationsRepository.ts`;
- dodano `src/storage/sqlite/workspacesConversationsRepository.ts`;
- `BrowserRepository` i `SqliteRepository` delegują pełny zakres:
  - listowanie, tworzenie, zmianę nazwy, archiwizację, przywracanie i touch Workspace;
  - lifecycle `ChatThreadGroup`;
  - lifecycle `ChatThread` dla Conversation i Manual RV;
  - listowanie i dopisywanie wiadomości;
- zachowano publiczny kontrakt i wszystkie dotychczasowe wywołania aplikacji;
- zachowano istniejącą hierarchię `Workspace → ChatThreadGroup → ChatThread`;
- zachowano lazy migrację browserowych rozmów bez `threadGroupId`;
- zachowano regułę, że przywrócenie Conversation wymaga aktywnego Workspace i aktywnego rodzica Thread;
- zachowano sprzężenie timestampu archiwizacji grupy z dziećmi, dzięki któremu restore nie przywraca rozmów zarchiwizowanych wcześniej;
- zachowano transakcje SQLite dla archive/restore grupy;
- Workspace Sources pozostały w fasadach, ponieważ nie należą do tego ograniczonego kroku.

## Obowiązkowe utwardzenie Settings

Przed ekstrakcją dodano brakujące testy semantyczne dla:

- `updateProviderConnectionStatus()`;
- `updateProviderCredentialMetadata()`;
- `setProviderModelFavorite()`;
- `clearProviderModelCache()`.

Testy sprawdzają rezultat browser storage oraz dokładne zapisy i transakcje SQLite, a nie wyłącznie obecność delegacji.

## Świadomie niewykonane

Ten krok nie realizuje późniejszego planu UX i organizacji danych. W szczególności:

- nie usuwa `ChatThreadGroup`/Thread z produktu;
- nie zmienia nazw tabel ani typów;
- nie dodaje automatycznego pierwszego Workspace;
- nie zmienia archive/delete;
- nie modyfikuje UI;
- nie zmienia Workspace Sources.

Usunięcie `ChatThreadGroup` jako poziomu produktu wymaga osobnej migracji po zakończeniu Etapu 5. `ChatThread` pozostaje właściwym rekordem Conversation/Manual RV wraz z wiadomościami.

## Testy

Dodano:

- `src/storage/workspacesConversationsRepository.contract.test.ts`;
- `src/storage/workspacesConversationsRepositoryBoundary.test.ts`;
- rozszerzenie `src/storage/settingsModelsRepository.contract.test.ts`.

Testy obejmują:

- niezmienione klucze browser storage;
- filtrowanie i kolejność Workspace;
- normalizację pól i ochronę zduplikowanych nazw;
- zachowanie rozmów i wiadomości;
- cascade archive/restore grupy bez przywrócenia dziecka zarchiwizowanego wcześniej;
- lazy migrację legacy Conversation bez grupy;
- mapowanie wierszy Workspace w SQLite;
- transakcyjne archive/restore Thread group;
- zapis wiadomości i aktualizację timestampu rozmowy;
- pełną delegację publicznej fasady;
- pozostawienie Workspace Sources poza wydzielonym kontraktem.

## Wynik lokalnej walidacji

- testy ukierunkowane: **5 plików / 24 testy — zaliczone**;
- pełny Vitest: **111 plików / 351 testów — zaliczone**;
- TypeScript typecheck — zaliczony;
- produkcyjny build Vite — zaliczony;
- `verify:source` — zaliczony;
- Rust/Tauri oraz Clippy — do potwierdzenia przez GitHub Actions.

Ostrzeżenie Vite o rozmiarze głównego chunku pozostaje zachowaniem zastanym i nie jest błędem tego kroku.

## Następny krok

Po zielonym GitHub Actions należy kontynuować Etap 5 przez wydzielenie **Sessions persistence**. Zmiany UX i migracja usuwająca `ChatThreadGroup` pozostają zaplanowane po zakończeniu Etapu 5.
