# AI RV Harness v0.7.13 — audyt zamykający provider transport/retry

**Data:** 4 września 2026  
**Zakres:** Etap 2 modularizacji  
**Status kandydata:** audyt kodu i testy frontendowe zakończone; końcowy GitHub Actions Rust/Tauri oczekuje na push

## Potwierdzony właściciel transport retry

- `src/providers/native.ts` wykonuje pojedynczą fizyczną próbę;
- `src/providers/requestExecutor.ts` pozostaje jedynym właścicielem transport retry, backoffu, jitteru, `Retry-After`, raportu prób i cancellation;
- test granicy architektonicznej nadal blokuje produkcyjne użycie `providerChatAttempt` poza warstwą providera;
- nie znaleziono dawnych helperów ani kontrolerowych pętli transport retry.

## Macierz rodzin inferencji

Nowy kontrakt `src/providers/inferenceContract.test.ts` sprawdza następujące rodziny:

- Conversation i Manual RV;
- AI Monitor;
- AI Judge;
- Viewer Notes oraz jego jawne recovery domenowe;
- Full RCP;
- RV Lite;
- Custom Protocol;
- Telepathic i jego Resume;
- Viewer/Monitor post-Reveal;
- Research;
- Training.

Każda rodzina korzysta bezpośrednio z centralnego executora albo z kontrolera, który korzysta z niego jako jedynego właściciela retry. Kontrakt sprawdza także propagację `AbortSignal` i ustawienia limitu retry.

## Cancellation i niezmienność próby

Dodano testy potwierdzające:

- cancellation podczas aktywnej fizycznej próby nie uruchamia retry;
- cancellation podczas backoffu zatrzymuje wykonanie przed kolejnym dispatch;
- `Retry-After` jest respektowane;
- każda fizyczna próba retry otrzymuje identyczny, świeżo sklonowany snapshot wiadomości i ustawień, odporny na mutację przez wywołującego lub adapter próby.

Research przekazuje teraz `AbortSignal` również do automatycznego przeglądu post-Reveal oraz oceny Judge. Training przekazuje ten sam sygnał do sesji, przeglądu, Viewer Notes i Judge.

## Brak podwójnych zapisów

Audyt zachowuje i ponownie uruchamia istniejące testy:

- Conversation retry nie dopisuje drugi raz pytania użytkownika;
- post-Reveal retry po błędzie body/read nie duplikuje ani pytania, ani odpowiedzi;
- session Resume odtwarza zapisane odpowiedzi i wywołuje provider dopiero dla brakującego żądania;
- nowy Training executor nie powtarza ukończonych targetów i zapisuje jeden checkpoint na ukończony target.

## Wyniki

- testy kontraktowe audytu i Training: 34/34 zaliczone;
- pełny zestaw: **94 pliki testowe / 283 testy zaliczone**;
- typecheck: zaliczony;
- build Vite: zaliczony;
- skan produkcyjnych importów niskopoziomowego transportu: zaliczony;
- lokalny Rust/Tauri: niewykonany — brak polecenia `cargo` w środowisku.

## Kryterium ostatecznego zamknięcia

Kod spełnia lokalne kryteria audytu zamykającego. Status Etapu 2 można zmienić na `COMPLETED` dopiero po zielonym przebiegu istniejącego GitHub Actions dla dokładnie tej paczki, obejmującym:

- `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --locked`;
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings`.

Do tego momentu obowiązuje status: `CLOSURE CANDIDATE — GITHUB CI PENDING`.
