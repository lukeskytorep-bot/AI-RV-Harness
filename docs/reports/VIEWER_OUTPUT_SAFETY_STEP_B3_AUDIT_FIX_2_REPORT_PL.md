# VIEWER OUTPUT SAFETY — STEP B3 AUDIT FIX 2

## Zakres

Poprawka odpowiada na audyt B3 AUDIT FIX dotyczący inicjalizacji Research przy rzeczywistych ograniczeniach SQLite oraz kolizji identyfikatora po jawnym restarcie. Nie zmienia migracji ani polityki Viewer Output zamrożonej przy Experiment Lock.

## 1. Atomowa inicjalizacja zgodna z SQLite FK

Dodano `AppRepository.initializeResearchSession(assignmentId, session)`.

W produkcyjnym `SqliteRepository` operacja wykonuje jedną transakcję w kolejności:

1. `INSERT INTO rv_sessions`;
2. trwały `SESSION_CREATED`;
3. `UPDATE research_assignments SET session_id=?, status='Initializing'`.

Assignment nie wskazuje więc nigdy w zatwierdzonej transakcji na nieistniejącą sesję. Użyto istniejących, zatwierdzonych kształtów SQL z `databaseWriteOperations.ts`; nie rozszerzano raw-SQL allowlisty.

Po transakcji kontroler otrzymuje sesję przez `initializationExistingSession`, więc nie wykonuje drugiego `INSERT`. Session Snapshot nadal jest zapisywany przez kontroler przed `onSessionCreated`, a callback promuje assignment do `Running`.

Jeżeli proces zakończy się po atomowej inicjalizacji, lecz przed snapshotem, assignment pozostaje `Initializing` z istniejącą sesją. Następne uruchomienie dokańcza snapshot pod tym samym sessionId. Jeśli snapshot istnieje, ale callback nie zdążył przejść, Research promuje assignment do `Running` i kontynuuje przez replay.

## 2. Nowy sessionId dla każdego jawnego restartu

Usunięto deterministyczne `session_research_${assignment.id}`. Każde nowe podejście tworzy identyfikator przez `createId("session_research")`.

- Resume zachowuje już zapisany `assignment.sessionId`.
- Explicit Restart pozostawia starą sesję jako Interrupted, odłącza ją od assignmentu, a następne uruchomienie tworzy nowy sessionId.
- Kolejny restart tworzy kolejny identyfikator, więc porzucone sesje nie kolidują z `UNIQUE rv_sessions.id`.

## 3. TypeScript

Gałęzie inicjalizacji zostały uporządkowane tak, aby nie dereferencjonować nullable `session`. Lokalny `tsc --noEmit -p tsconfig.json` przechodzi bez błędów.

## 4. Testy

Zaktualizowano testy Research do nowego kontraktu `initializeResearchSession` i dynamicznego sessionId.

Dodano `src/storage/researchInitializationBoundary.test.ts`, który chroni:

- transakcyjne użycie `executeTransaction`;
- kolejność `rv_sessions` przed assignment FK;
- status `Initializing`;
- generowanie nowego sessionId przez `createId("session_research")`;
- brak powrotu do identyfikatora wyliczanego wyłącznie z assignment.id.

Dodatkowo ręcznie odtworzono minimalny przypadek SQLite z `PRAGMA foreign_keys=ON`; nowa kolejność transakcji przechodzi.

## 5. Kontrole lokalne

- `tsc --noEmit -p tsconfig.json`: PASS.
- `verify:ux-data`: PASS, 31 migracji.
- Minimalny SQLite FK smoke z `foreign_keys=ON`: PASS.
- `verify:architecture`: nie oznaczono jako PASS lokalnie, ponieważ kopia zależności nie zawiera `@babel/parser`.
- Pełny Vitest/build: nie oznaczono jako PASS lokalnie z powodu niepełnego lokalnego `node_modules`; właściwą bramą pozostają audyt i CI.

## 6. Niezmienione granice

- schema 031, bez migracji;
- migracje i SQLite FK pozostają bez zmian;
- nowa vs legacy polityka Research 16K→32K z poprzedniego B3 AUDIT FIX pozostaje bez zmian;
- Resume i explicit Restart zachowują odrębną semantykę;
- Training i zwykłe RV nie są zmieniane w tej poprawce.
