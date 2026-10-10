# VIEWER OUTPUT SAFETY — STEP B2 AUDIT FIX 3

Data: 2026-10-10
Zakres: poprawka do `STEP_B2_AUDIT_FIX_2`, bez przechodzenia do Research.
Schema: 031. Brak migracji.

## Cel

Naprawić wznowienie Training blind w oknie awarii **po trwałym seal, ale przed Reveal**, zachowując trigger migracji 010 i istniejący transcript/hash/timestamp. Równocześnie dostosować testy do kontraktu `blind_initializing` / zarezerwowanego `sessionId` i nowej trwałej kontroli Reveal.

## Zmiana produkcyjna

`src/sessions/resumeReplay.ts`

Replay rozróżnia teraz dwa tryby przejścia do części live:

- `viewer` — brakujący krok Viewera; sesja wraca do `BlindRunning`;
- `finalization` — brakujące zamknięcie/finalizacja po odtworzeniu blind.

Jeśli sesja była już trwale zapieczętowana (`preRevealSealedAt`), wejście w finalizację utrzymuje stan `AwaitingReveal`. Nie cofa sesji do `BlindRunning`.

To jest konieczne dla istniejącego triggera migracji 010 `prevent_reveal_for_unsealed_session`, który dopuszcza insert Reveal wyłącznie przy `rv_sessions.state = 'AwaitingReveal'`. Migracja 010 nie została zmieniona ani osłabiona.

`REVEAL_TRANSITION`, `acceptReveal()` i `recordTargetUsage()` używają finalization mode, gdy replay kończy odtwarzanie i przechodzi do brakującej finalizacji.

## Testy

### `resumeReplay.test.ts`

Dodano przypadek zapieczętowanej sesji:

1. cztery odpowiedzi Viewera są odtwarzane;
2. seal już istnieje;
3. finalizacja nie ustawia `BlindRunning`;
4. stan przed `acceptReveal()` pozostaje `AwaitingReveal`;
5. model ograniczenia migracji 010 jest respektowany;
6. Resume zapisuje `resumeMode: finalization`.

Istniejący test FIX 2 nadal pokrywa okno po ostatniej odpowiedzi, ale przed seal.

### `trainingBlindResume.integration.test.ts`

Dodano pełniejszy przebieg `executeTrainingRun -> replay -> real runAutomaticRvLiteSession -> durable Reveal -> Training checkpoint` dla sesji przerwanej po seal. Repozytorium testowe egzekwuje tę samą regułę, co trigger 010: `acceptReveal()` odrzuca stan inny niż `AwaitingReveal`.

Test wymaga:

- braku powrotu do `BlindRunning`;
- trwałego Reveal;
- `REVEAL_ACCEPTED`;
- target usage;
- checkpointu `session_revealed` przed rozpoczęciem dalszej pracy post-Reveal.

### Testy Training

Dostosowano atrapy do nowego kontraktu:

- nowa sesja używa zarezerwowanego `sessionIdentity.id`, a nie własnego `session_${targetId}`;
- `onSessionCreated` jest wywoływany po utworzeniu trwałego stanu w harnessie;
- snapshot nie istnieje dla sesji w `blind_initializing`, dopóki nie powstanie sesja/snapshot;
- testy używają pełnych danych trwałego Reveal (`preRevealSealedAt`, Reveal, `REVEAL_ACCEPTED`, target usage);
- oczekiwania dla nowych sesji nie zakładają starych, sztucznych identyfikatorów `session_t1`.

`viewerLearningFieldGuideBoundary.test.ts` został dostosowany do obecnego sposobu zamrażania Field Guide w `blindInitialization` i `frozen.rvSystemPrompt`, bez osłabiania granicy read-only Research/Field Guide.

## Pokryte okna awarii

1. Ostatnia odpowiedź zapisana, ale brak seal — replay finalizuje seal i Reveal bez dublowania odpowiedzi.
2. Seal zapisany, brak Reveal — replay utrzymuje `AwaitingReveal` i finalizuje Reveal zgodnie z migracją 010.
3. Reveal zapisany, Training checkpoint jeszcze `blind_running` — istniejąca ścieżka B2 odzyskuje trwały Reveal i przechodzi do `session_revealed` bez powtarzania blind.

## Kontrole lokalne

- `tsc --noEmit -p tsconfig.json` — PASS, 0 błędów.
- `npm run verify:ux-data` — PASS, 31 migracji.
- `npm run verify:architecture` — nie oznaczono jako PASS lokalnie: kopia `node_modules` nie zawiera `@babel/parser`.
- Pełnego Vitest/build nie oznaczono jako PASS w tym środowisku z powodu niekompletnego `node_modules`. Audyt/CI powinny uruchomić pełny zestaw.

## Warunek odbioru

B2 można zamknąć dopiero po pełnym Vitest/typecheck/build oraz ponownym teście audytowym z rzeczywistym SQLite triggerem 010 dla scenariusza `sealed -> resume -> Reveal`.
