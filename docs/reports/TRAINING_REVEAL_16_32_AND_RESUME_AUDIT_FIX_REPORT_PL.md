# Training Reveal 16/32 + Resume — poprawki po audycie

Data: 2026-10-09

## Zakres

Poprawiono dwa błędy potwierdzone w audycie bez zmiany budżetów 16/32, schematu danych ani podstawowego mechanizmu Resume.

### 1. Zgoda Resume jest związana z konkretną próbą Viewer Review

Przed otwarciem dialogu zapamiętywany jest numer konkretnej nierozstrzygniętej próby Viewer Review.
Po potwierdzeniu i wejściu pod istniejący post-Reveal lease stan jest odczytywany ponownie.

- Jeśli Review zdążył się zakończyć, wynik jest odzyskiwany bez rozstrzygnięcia i bez dodatkowego wywołania.
- Jeśli nadal chodzi o tę samą próbę, istniejący mechanizm domenowy może oznaczyć ją jako failed.
- Jeśli pojawiła się nowsza niepewna próba, stara zgoda nie jest do niej stosowana. Nie powstaje checkpoint failed i użytkownik otrzymuje czytelny komunikat PL/EN, aby użyć Resume ponownie.

Dodano testy dla:
- nowszej próby powstałej podczas dialogu,
- ukończenia Review podczas dialogu,
- istniejącego anulowania bez mutacji.

### 2. Field Guide attemptCount jest monotoniczny

Usunięto wyliczanie attemptCount przez `attemptNumber + analyticalAttempt` i późniejsze nadpisania, które mogły obniżyć licznik.

Nowa semantyka:
- jedna logiczna generacja Field Guide jest liczona raz przy pierwszym fizycznym dispatch danej operacji `executeProviderChat`;
- wewnętrzne transport retry tej samej logicznej generacji nie zwiększają licznika;
- analytical recovery po `length` jest kolejną logiczną generacją;
- capacity retry i jego ewentualne analytical recovery są kolejnymi logicznymi generacjami;
- local stop przed dispatch nie zwiększa licznika;
- JSON repair pozostaje odrębnym mechanizmem formatowania i nie jest liczony jako próba generacji Field Guide.

Usunięto sztywne `attemptCount: 2` w ścieżkach capacity retry.

Dodano test odtwarzający przypadek z audytu:
1. podstawowa generacja zwraca poprawny UPDATE z przekroczoną pojemnością,
2. capacity retry kończy się `length`,
3. analytical recovery capacity retry zwraca NO_CHANGE,
4. trwały audit kończy z `attemptCount = 3`.

## Pliki

- `src/features/training/trainingResumeRecovery.ts`
- `src/features/training/trainingResumeRecovery.test.ts`
- `src/aiCenter/fieldGuideUpdate.ts`
- `src/aiCenter/fieldGuideUpdate.test.ts`

## Kontrole lokalne

- `verify:ux-data`: PASS, 31 migracji.
- kontrola składni/transpilacji czterech zmienionych TS/TSX: PASS.
- pełny typecheck/Vitest/build: nie oznaczono jako PASS lokalnie, ponieważ dostępny `node_modules` jest niekompletny (`vite/client` i typy `node` nie są dostępne). Autorytatywnym gate pozostaje GitHub Actions.

Schema nadal `031`. Brak migracji.
