# AI RV Harness v0.7.13 — UX/Data Foundation: bounded Recent RV Sessions

**Data:** 8 września 2026  
**Etap:** post-Etap-5 UX/data campaign — krok 1  
**Status:** implementacja lokalna zakończona; pełny GitHub Actions wymagany

## Cel

Rozpocząć zapisany etap uproszczeń UX/data od małej, bezpiecznej optymalizacji Home po zakończonym Etapie 5 repository split. Dotychczas `App.tsx` pobierał pełną listę RV Sessions osobno dla każdego aktywnego Workspace, scalał ją, sortował po `updatedAt` i dopiero potem zatrzymywał kilka rekordów dla Home.

Nowy kontrakt publiczny:

`listRecentRvSessions(limit)`

ukrywa strategię storage przed `App.tsx` i wykonuje bounded read przez wydzielony `SessionsRepository`.

## Zakres wykonany

- dodano `AppRepository.listRecentRvSessions(limit)`;
- dodano wewnętrzne `SessionsRepository.listRecentRvSessions(workspaceIds, limit)`;
- `BrowserRepository` i `SqliteRepository` pobierają aktywną kolejność Workspace przez `WorkspacesConversationsRepository` i delegują bounded read do Sessions;
- Browser adapter czyta wspólny zbiór `rvh.dev.rv_sessions` jeden raz, filtruje do aktywnych Workspace, zachowuje dotychczasową semantykę sortowania i stosuje limit;
- SQLite adapter wykonuje jedno zapytanie `WHERE workspace_id IN (...) ORDER BY updated_at DESC ... LIMIT`;
- `App.tsx` używa `await repo.listRecentRvSessions(8)` zamiast N wywołań `listRvSessions(workspace.id)`;
- istniejące Workspace-local consumers nadal korzystają z `listRvSessions(workspaceId)` bez zmian.

## Zachowana semantyka

Nowy read zachowuje:

- wyłącznie aktywne Workspace, tak jak dotychczasowy bootstrap oparty na `listWorkspaces()`;
- globalne sortowanie po `updatedAt DESC`;
- przy remisie `updatedAt` kolejność aktywnych Workspace i wewnętrzne `createdAt DESC`, odpowiadające stabilnemu zachowaniu poprzedniego merge/sort;
- pełne rekordy `RvSession`, bez zmiany serializacji;
- brak specjalnego filtrowania Research/Training, ponieważ poprzedni Home również agregował wszystkie `listRvSessions()` aktywnych Workspace.

## Świadomie niewykonane

Ten krok nie zmienia:

- Thread/Conversation model;
- Profile/Workspace lifecycle;
- Archive/Restore/Delete;
- ModelRoute/credential selection;
- dialogów Confirm/Prompt;
- Training list UX;
- Viewer Notes;
- schematu i migracji SQLite;
- protokołów, Reveal, Judge ani Research.

## Testy i walidacja

Dodano jeden nowy plik testowy oraz trzy nowe przypadki testowe względem zielonego baseline'u 123/419:

- Browser bounded recent read, aktywny Workspace scope i tie ordering;
- SQLite single-query shape, Workspace ordering i limit;
- architektoniczny test `App.tsx`, który blokuje powrót `Promise.all(storedWorkspaces.map(...listRvSessions))`.

Kandydat zawiera **124 pliki testowe**; oczekiwany pełny wynik to **422 testy**.

Lokalnie zaliczono:

- `npm run verify:source`;
- ścisłą kompilację TypeScript zmienionych repozytoriów/fasad/testów z minimalnymi deklaracjami wyłącznie dla niedostępnych pakietów Tauri/Vitest;
- rzeczywiste wykonanie nowego SQLite `IN + CASE + LIMIT` query na in-memory SQLite z oczekiwaną kolejnością.

Pełne `npm ci` w środowisku przygotowawczym zakończyło się `TransportTimeoutError`, dlatego pełny Vitest/project typecheck/Vite oraz Rust/Tauri/Clippy pozostają bramką GitHub Actions.

## Kryterium odbioru

Po zielonym GitHub Actions dokładnego kandydata można oznaczyć krok `UX-DATA-1 — Home recent sessions` jako zakończony i przejść do kolejnego fundamentu: **ModelRouteSelect / credential isolation**.
