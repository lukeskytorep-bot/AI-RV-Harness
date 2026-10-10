# TRAINING HISTORY UX — STEP 1: termination foundation

Data: 2026-10-10.

## Baza

Implementacja została przygotowana na dostarczonej przez użytkownika zaakceptowanej bazie `AI-RV-Harness-ai-rv-2(1).zip`, zawierającej zieloną linię Viewer Output Safety przez STEP C AUDIT FIX 4. Schema pozostaje 031; żadna migracja SQL nie została zmieniona ani dodana.

## Zakres etapu 1

Ten etap celowo nie przebudowuje jeszcze karty historii Training ani CSS. Dostarcza fundament domenowy i trwałość, na których w następnym etapie oprze się przycisk `Zakończ trening` i nowy układ historii.

### 1. Trwały marker zakończenia

Do `TrainingRunRecord` i `UpdateTrainingRunInput` dodano opcjonalne pole:

```ts
termination?: {
  reason: "user_finished";
  endedAt: string;
};
```

Nowe treningi nie mogą otrzymać `termination` przez `CreateTrainingRunInput`. `Completed` pozostaje zarezerwowane dla rzeczywiście ukończonego treningu.

Dodano wspólne helpery domenowe `isTrainingRunUserFinished`, `isTrainingRunIncomplete` i `canResumeOrEndTrainingRun`.

### 2. Operacja zakończenia bez fałszowania postępu

Dodano `endTrainingRun()`. Operacja zapisuje `status: "Interrupted"` i `termination`, bez zmiany `currentIndex`, `completedTargetIds`, `sessionIds`, `activeTargetCheckpoint`, snapshotów ani dowodów recovery/uncertain dispatch. Powtórne zakończenie jest bezpiecznym no-op i zachowuje pierwotny `endedAt`.

Eksport treningu pokazuje `Zakończony przez użytkownika / Ended by user` oraz czas zakończenia, bez przedstawiania runu jako `Completed`.

### 3. Ochrona Resume i execute

`prepareTrainingRunResume()` odrzuca terminalny trening przed analizą checkpointu, ponownie po oczekiwaniu na decyzję użytkownika pod lease oraz przed zwróceniem finalnego rekordu.

`executeTrainingRun()` na wejściu pobiera świeży rekord repozytorium. Jeśli ma `termination`, nie ustawia `Running` i nie uruchamia zależności/modeli. W przypadku wyścigu podczas wykonania catch ponownie odczytuje rekord i nie próbuje nadpisać terminalnego runu stanem `Interrupted`.

### 4. Wspólny guard Start / Resume / przyszłe End

Dotychczasowy `resumeGuard` w `TrainingScreen` został zastąpiony jednym `trainingOperationGuard`. Start i Resume zajmują go synchronicznie, przed pierwszym `await`. Dzięki temu kliknięcie Start podczas przygotowywania Resume nie może rozpocząć równoległego treningu. Następny etap UI podłączy do tego samego guardu `Zakończ trening`.

### 5. Atomowa ochrona SQLite

Zwykłe aktywne aktualizacje Training używają warunkowego UPDATE, który działa tylko wtedy, gdy aktualny JSON nie ma `termination.reason`.

Dla zakończenia użytkownika dodano osobny dozwolony kształt zapisu SQLite oparty na `json_set(record_json, ...)`. Zmienia on atomowo tylko `status`, `termination` i `updatedAt` na aktualnym rekordzie w bazie. Dzięki temu zakończenie nie nadpisuje świeższego checkpointu/progressu, jeśli zmienił się pomiędzy wcześniejszym odczytem i zapisem.

Po zapisaniu termination wcześniejszy, opóźniony UPDATE próbujący zapisać `Running` dostaje `rowsAffected = 0`; repozytorium ponownie odczytuje rekord i zgłasza terminalność zamiast ją cofać.

Dodano operacje allowlist `training_update_training_runs_04` i `training_update_training_runs_05` w frontendowym registry oraz natywnym `database.rs`. Istniejące operacje i migracje pozostają bez zmian.

## Testy dodane / rozszerzone

- repository contract: trwałość `termination`, blokada późniejszego `Running`, idempotentne ponowne zakończenie;
- wymuszony wyścig SQLite: stary update odczytuje rekord → termination zostaje zapisane → stary update próbuje `Running`; terminalność pozostaje;
- `executeTrainingRun`: terminalny run nie uruchamia zależności/modelu i nie zapisuje `Running`;
- `prepareTrainingRunResume`: terminalny run jest odrzucany przed checkpointem/dialogiem;
- `endTrainingRun`: zachowuje checkpoint, sesje, completed targets i currentIndex; nie tworzy `Completed`; powtórzenie zachowuje pierwszy `endedAt`.

## Weryfikacja lokalna

- `verify:ux-data`: PASS, 31 migracji.
- `verify-source-integrity-selftest`: PASS.
- składnia wszystkich zmienionych TS/TSX przez TypeScript `transpileModule`: PASS, 0 błędów składni.
- ręczny test SQLite z rzeczywistym JSON1 i warunkowym UPDATE: PASS; termination zachowuje checkpoint, a późniejszy stale `Running` ma `rowcount = 0`.
- pełny `verify:source`: FAIL również na niezmienionej bazie wejściowej z powodu istniejących w ZIP-ie nazw zapisanych jako `#U....` i brakujących dokumentów wskazywanych przez `src-tauri/src/documents.rs`; nie jest to regresja tego etapu.
- pełny Vitest / typecheck / build: NIE POTWIERDZONE. `npm ci --ignore-scripts` przekroczył limit środowiska; globalny `tsc` nie ma lokalnych `vite/client` i `@types/node`.
- Rust `cargo check`: NIE WYKONANO, `cargo` nie jest dostępne w środowisku.
- UI visual smoke: poza zakresem etapu 1; nie wykonano.

## Następny etap

Po audycie STEP 1: implementacja UI historii Training: tekstowy `Zakończ trening` obok `Wznów`, podłączenie go do tego samego `trainingOperationGuard`, trzy ikony w nagłówku karty, zwijanie całej historii, typografia RV Sessions oraz testy PL/EN i realnego layoutu.
