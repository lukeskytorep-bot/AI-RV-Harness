# AI RV Harness v0.7.14 — Training History UX STEP 1 AUDIT FIX

Data: 2026-10-10
Baza: zaakceptowana baza użytkownika `AI-RV-Harness-ai-rv-2(1).zip` + `TRAINING_HISTORY_UX_STEP_1_TERMINATION_FOUNDATION_CHANGED_FILES.zip`.
Schema: 031, bez migracji.

## Zakres poprawki

Poprawka odpowiada wyłącznie na audyt STEP 1. UI historii Training nie jest jeszcze przebudowywane.

### 1. Archiwizacja nie może zgubić `termination`

SQLite `archiveTrainingRun()` nie odczytuje już całego rekordu i nie zapisuje starej kopii JSON-u. Używa atomowego `json_set(record_json, ...)`, zmieniając tylko `archivedAt` i `updatedAt` na aktualnym rekordzie. Dzięki temu zakończenie zapisane tuż przed właściwym UPDATE archiwizacji pozostaje w `record_json` i po Restore trening nadal jest terminalny.

### 2. Zakończenie nie może cofnąć Completed

Warunek SQL zapisujący `termination` sprawdza atomowo:

- aktywny rekord, niearchiwizowany;
- status `Paused`, `Interrupted` albo zapisany `Running`;
- `currentIndex < targetIds.length`;
- brak istniejącego `termination`.

Jeśli UPDATE zmieni 0 wierszy, repozytorium ponownie odczytuje rekord. Istniejące `termination` daje bezpieczny no-op; stan `Completed` lub inny niekwalifikujący się stan kończy się błędem `This Training run cannot be ended in its current state.`. Browser repository wykonuje równoważną kontrolę na najświeższym rekordzie przed zapisem.

### 3. Test wymuszonego wyścigu archiwizacji

Dodano test, który zatrzymuje SQLite archive przed zapisem, zapisuje w tym czasie `termination`, następnie kończy archive i Restore. Marker musi istnieć przed i po Restore.

### 4. Test Completed race

Dodano test, w którym zapis zakończenia dochodzi do granicy UPDATE, po czym rekord zostaje ukończony. Warunkowy UPDATE musi zwrócić 0 i nie może zamienić `Completed` na `Interrupted`.

### 5. Training execution test harness

Mock repozytorium w `trainingExecution.test.ts` posiada teraz trwały, aktualizowany rekord zamiast stałego zwracania początkowego `initial`. Zachowane są wcześniejsze oczekiwania dotyczące wszystkich `completedTargetIds` i `sessionIds`.

### 6. SECURITY-IPC raw SQL registry

Licznik testowy został zaktualizowany z 122 do 124 operacji, zgodnie z rejestrem po STEP 1. Test dodatkowo potwierdza obecność dokładnie tych samych zapytań archiwizacji i zakończenia w frontendowym `databaseWriteOperations.ts` oraz Rust `database.rs`. Nie usunięto żadnej kontroli SECURITY-IPC.

## Lokalne kontrole w środowisku wykonawcy

- `npm run verify:ux-data`: PASS — 31 migracji.
- TypeScript `transpileModule` dla wszystkich 7 zmienionych plików TS/TSX: PASS — 0 błędów składniowych.
- Bezpośredni test SQLite JSON1 dla atomowego termination, blokady Completed i zachowania termination podczas archiwizacji: PASS.
- Sprawdzenie zgodności dwóch zmienionych zapytań Training pomiędzy frontendowym rejestrem i `database.rs`: PASS.
- Liczba frontendowych operacji write: 124; liczba wariantów Rust serde: 124.

Pełnego Vitest, typecheck i build nie oznaczono lokalnie jako PASS, ponieważ dostarczona kopia nie zawiera `node_modules` i nie wykonywano kompletnej instalacji zależności. Rust nie został lokalnie uruchomiony, ponieważ `cargo` nie jest dostępne w środowisku.

`verify:source` w tej rozpakowanej kopii zgłasza istniejące w dostarczonym ZIP-ie nazwy `#U...` oraz brakujące pliki dokumentów. Audytor zgłosił PASS integralności na swoim czystym źródle; ta poprawka nie zmienia żadnego z tych zasobów. Nie przedstawiam lokalnego wyniku jako regresji STEP 1.

## Pliki zmienione względem STEP 1

- `src/storage/sqlite/trainingRepository.ts`
- `src/storage/browser/trainingRepository.ts`
- `src/storage/databaseWriteOperations.ts`
- `src-tauri/src/database.rs`
- `src/storage/trainingRepository.contract.test.ts`
- `src/features/training/trainingTermination.test.ts`
- `src/features/training/trainingExecution.test.ts`
- `src/securityIpcRawSqlBoundary.test.ts`

## Warunek odbioru

Przed przejściem do STEP 2 należy uzyskać zielony pełny Vitest, typecheck, build, verify:architecture, verify:ux-data, verify:source oraz audyt dwóch wymuszonych wyścigów zapisu. UI przycisków i historii nie jest częścią tej poprawki.
