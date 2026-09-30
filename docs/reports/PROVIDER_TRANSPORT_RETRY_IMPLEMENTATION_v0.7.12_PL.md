# Implementacja jednolitego retry providera — hotfix v0.7.12

## Status

Zaimplementowano projekt opisany w `docs/architecture/PROVIDER_RETRY_ARCHITECTURE_FINAL_PL.md`.

## Co zostało zmienione

- dodano jeden wspólny executor `src/providers/requestExecutor.ts`, który jako jedyny podejmuje decyzję o ponowieniu fizycznego żądania inferencji;
- dodano ustrukturyzowany model błędów w `src/providers/providerError.ts`;
- warstwa Rust wykonuje jedną próbę HTTP i zwraca kod błędu, fazę, HTTP status, `Retry-After`, typ błędu providera i request ID, gdy dane są dostępne;
- body read/decode, uszkodzony JSON całej odpowiedzi providera i pusta odpowiedź mają najwyżej jedno ponowienie;
- connect/timeout/send oraz HTTP 408, 425, 429, 500, 502, 503 i 504 respektują `maxRetries`;
- zastosowano exponential backoff z full jitter, limitem 8 sekund i pierwszeństwem `Retry-After` do 30 sekund;
- anulowanie przerywa aktywne żądanie oraz oczekiwanie przed kolejną próbą;
- każda logiczna operacja ma `logicalRequestId`, liczbę fizycznych prób i informację o niejednoznacznych kosztowo błędach body;
- executor przechwytuje niezmienny snapshot wiadomości i ustawień, więc retry wysyła ten sam payload;
- przypadkowe opakowanie jednego executora drugim jest wykrywane i odrzucane;
- output recovery, Judge JSON repair oraz Viewer Notes JSON/capacity retry pozostają osobnymi operacjami domenowymi;
- przepięto Conversation, Manual RV, Full RCP, RV Lite, Custom, Telepathic, resume, Monitor, post-Reveal Viewer i Monitor, Judge oraz Viewer Notes;
- Monitor retry nie uruchamia ponownie Viewera, a post-Reveal retry nie zapisuje drugi raz pytania użytkownika;
- nie dodano automatycznej zmiany modelu.

## Diagnostyka i rozliczanie

Odpowiedź zakończona sukcesem zawiera raport executora. Błąd po wyczerpaniu prób zawiera ten sam raport w `ProviderExecutionError`. Kontrolery sesji zapisują techniczne zdarzenie `PROVIDER_ATTEMPT_FAILED` z numerem próby, `logicalRequestId` i kodem błędu. Próby po błędzie odczytu/dekodowania body są oznaczane jako kosztowo niejednoznaczne.

## Weryfikacja

- TypeScript project build: poprawny;
- pełny zestaw Vitest: 78 plików i 230 testów — wszystkie poprawne;
- produkcyjny build Vite: poprawny;
- dodano testy dokładnej liczby fizycznych prób, `maxRetries=0`, jednej próby body/decode, 503, 401, `Retry-After`, anulowania, audytu, zakazu zagnieżdżenia oraz współpracy transport retry z output recovery;
- lokalne środowisko przygotowujące paczkę nie zawiera binarnego toolchainu Rust, dlatego `cargo check --locked` należy uruchomić w GitHub Actions lub na komputerze deweloperskim przed publikacją instalatorów.

## Pliki centralne

- `src/providers/requestExecutor.ts`
- `src/providers/providerError.ts`
- `src/providers/retry.ts`
- `src/providers/native.ts`
- `src-tauri/src/providers.rs`

## Kryterium wydania

Przed publikacją instalatorów należy wykonać standardowy workflow CI obejmujący `cargo check --locked`, testy Rust, kompilację Tauri i test instalatora. Brak lokalnego `cargo` nie wpływa na wynik testów TypeScript, ale oznacza, że binarna część Rust musi zostać potwierdzona przez CI.
