# AI RV Harness v0.7.13 — nakładka Profiles

## Właściwa baza

Nakładkę stosuje się wyłącznie na prywatną bazę:

`AI_RV_Harness_v0.7.13_MODULARIZATION_SETTINGS_MODULE_COMPLETE_SOURCE`

Nie należy jej nakładać bezpośrednio na publiczne v0.7.12 ani na wcześniejszy pakiet Home. Nakładka zawiera tylko pliki zmienione w kolejnym kroku modularizacji.

## Sposób użycia

1. Zamknij aplikację i wykonaj kopię katalogu źródłowego.
2. Rozpakuj ZIP nakładki.
3. Skopiuj jego zawartość do katalogu głównego właściwej bazy, zachowując strukturę katalogów i zastępując wskazane pliki.
4. Nie usuwaj pozostałych plików projektu.
5. Uruchom `npm ci`, `npm run typecheck`, `npm test -- --run` oraz `npm run build`.
6. Po wysłaniu gałęzi sprawdź pełny GitHub Actions, w szczególności frontend, Rust/Clippy i CodeQL.

## Zakres

- wydzielenie `src/features/profiles/`;
- wydzielenie współdzielonych prymitywów UI;
- testy Profiles i granicy importów;
- aktualizacja mapy architektury i raportów;
- aktualizacja przypiętych `actions/checkout`, `actions/setup-node` i `Swatinem/rust-cache` do wydań z runtime Node.js 24.

Wersja aplikacji pozostaje prywatnym v0.7.13. Ten pakiet nie tworzy publicznego wydania.
