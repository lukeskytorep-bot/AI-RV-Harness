# VIEWER OUTPUT SAFETY — STEP B1 AUDIT FIX 2

Data: 2026-10-10

## Zakres

Poprawka odpowiada na drugi audyt B1. Nie rozszerza zakresu na Training blind checkpoint ani Research Resume.
Schema pozostaje 031; brak migracji.

## Naprawione problemy

1. Generic `AbortError` nie jest już traktowany jako dowód, że request nie został wysłany. `not_dispatched` wymaga jawnego provider failure phase `before_dispatch`.
2. Klasyfikator rozpakowuje także błędy executora przez `causeError`/`cause`, więc potwierdzony `before_dispatch` nie jest błędnie klasyfikowany jako unknown.
3. Ledger rozlicza fizyczne retry po trwałym `attemptId`, niezależnie od braku `stepId` na `PROVIDER_ATTEMPT_FAILED`. Jeśli choć jedna fizyczna próba tego samego logicznego attempt ma dispatch `unknown`, późniejsze `not_dispatched` nie może odblokować Resume.
4. Naprawiono kontrakt callbacku `callViewerWithOutputRecovery`: również gałąź poza recovery przekazuje trzeci argument `ViewerOutputDispatchAttempt`.
5. Usunięto przestarzałe `onAttemptStart` z testu recovery.
6. Usunięto przestarzałe `maxSessionCostUsd` z testów Training, zgodnie z decyzją o usunięciu aktywnej blokady kosztowej.
7. Test granicy replay używa pełnej tożsamości kroku i `attemptId`.
8. Zaktualizowano hash `postRevealContextBoundary` po sprawdzeniu zmian telepathic B1; osobny hash kontraktu promptu Monitora pozostaje niezmieniony.

## Nowe przypadki regresyjne

- AbortError po potencjalnym dispatch => `unknown`.
- ProviderExecutionError/causeError z `before_dispatch` => `not_dispatched`.
- wcześniejsza fizyczna próba `unknown` + późniejsza `not_dispatched` dla tego samego `attemptId` => ledger `uncertain`.
- istniejący przypadek starszego terminala i nowego attemptId nadal blokuje błędne rozliczenie.

## Kontrole lokalne

- `verify:ux-data`: PASS, 31 migracji.
- syntaktyczna transpilacja TypeScript 8 zmienionych TS/TSX: PASS.
- sprawdzono brak przestarzałego `onAttemptStart` w teście recovery oraz brak `maxSessionCostUsd` w dwóch poprawianych testach Training.
- pełny typecheck/Vitest/build nie zostały oznaczone jako PASS w tym środowisku: lokalne `node_modules` jest niekompletne, a ponowne `npm ci` zakończyło się timeoutem. `verify:architecture` również nie mógł wystartować z powodu brakującego `@babel/parser`; poprzedni audyt potwierdzał architecture PASS przed tym fixem.

## Oczekiwany odbiór

Audyt powinien ponownie uruchomić pełny Vitest, typecheck, build, verify:architecture i trzy niezależne przypadki dispatchu opisane w drugim audycie. Następnie GitHub Actions pozostaje bramką przed zamknięciem B1.
