# Modularizacja v0.7.13 — raport wykonania Kroku 1

**Data:** 2 września 2026  
**Status:** wykonano  
**Charakter zmiany:** dokumentacja granic i techniczne zabezpieczenia bez celowej zmiany zachowania produktu

## Zakres

Pierwszy krok przygotowuje kod do stopniowej modularizacji. Nie przenosi jeszcze ekranów i nie zmienia sesji, Training, Research, bazy danych, AI Center ani Viewer Notes.

Wykonano:

1. mapę właścicieli kodu w `docs/architecture/CODE_MAP.md`;
2. początkowe reguły zależności w `docs/architecture/MODULE_BOUNDARIES.md`;
3. decyzję architektoniczną `docs/architecture/decisions/ADR-0001-MODULAR_MONOLITH.md`;
4. test granicy `src/architecture/importBoundaries.test.ts`;
5. usunięcie nieużywanych helperów `shouldRetryProviderError` i `waitBeforeProviderRetry`;
6. usunięcie nieskutecznego `activeLogicalRequests`;
7. zachowanie i ponowne potwierdzenie ochrony brandowanego executora przed zagnieżdżeniem retry.

## Dlaczego usunięto `activeLogicalRequests`

Mechanizm tworzył nowy `logicalRequestId`, a następnie sprawdzał, czy ten właśnie nowy UUID znajduje się już w zbiorze. Taka kontrola nie wykrywała realnego zagnieżdżenia. Działająca ochrona znajduje się przy `createProviderChatExecutor`: brandowany executor nie może zostać przekazany jako transport pojedynczej próby do drugiego executora.

## Automatyczna granica providera

Nowy test skanuje produkcyjne pliki TypeScript. Jeżeli przyszły moduł użyje `providerChatAttempt` poza `src/providers/native.ts` albo `src/providers/requestExecutor.ts`, test zakończy się błędem. Dzięki temu nowe funkcje muszą korzystać z centralnego właściciela transport retry.

Test wykorzystuje mechanizm surowych importów Vite. Nie wymaga typów Node ani nowej zależności.

## Weryfikacja

- `npm run typecheck` — poprawny;
- Vitest — 79 plików testowych i 231 testów, wszystkie poprawne;
- `npm run build` — poprawny;
- brak produkcyjnych odniesień do usuniętych helperów;
- brak niedozwolonego użycia `providerChatAttempt`.

Build nadal zgłasza istniejące ostrzeżenie o dużym głównym pliku JavaScript. Nie jest to błąd Kroku 1; późniejsze wyodrębnianie ekranów może umożliwić kontrolowany code splitting.

## Poza zakresem

Lokalne środowisko nie zawierało toolchainu Cargo. `cargo check --locked`, testy Rust, clippy i Tauri build pozostają obowiązkowym etapem GitHub Actions.

## Następny zalecany krok

Wyodrębnić `HomeScreen` z `src/App.tsx` do `src/features/home/` wraz z testami pustego stanu, ostatniego profilu, Workspace, ostatnich sesji i callbacków nawigacji. Nie przenosić jeszcze globalnego stanu, repository ani krytycznych kontrolerów sesji.
