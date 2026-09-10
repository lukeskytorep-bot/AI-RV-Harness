# AI RV Harness v0.7.13 — Etap 6: porządkowanie providerów Rust

**Data:** 10 września 2026  
**Status:** poprawiony po niezależnym audycie — pełny frontend 136/484 zaliczony; Rust/Tauri/Clippy wymagają GitHub Actions  
**Baza:** UX-DATA-9 `_AUDITED`, pełny GitHub Actions GREEN  
**Wymagany source-tree bazy:** `6eb314db6651713a1c4c54f254f398c963f20c3327399be55a94fbba8a2df5db`

## Cel

Etap 6 realizuje zapisany w głównym planie bezbehawioralny refaktor natywnej warstwy providerów. Dotychczasowy `src-tauri/src/providers.rs` skupiał w jednym pliku komendy Tauri, routing providerów, authentication, request builders, transport/cancellation, response parsers, reasoning normalization oraz testy kontraktowe.

Celem nie jest zmiana transportu ani retry. Centralny transport retry pozostaje wyłącznie w `src/providers/requestExecutor.ts`. Warstwa Rust nadal wykonuje pojedynczą fizyczną próbę HTTP dla jednego wywołania natywnego.

## Wykonany podział

`src-tauri/src/providers.rs` pozostaje fasadą komend Tauri i właścicielem publicznych DTO oraz koordynacji redakcji debug payloadu. Kod wykonawczy został rozdzielony na:

- `src-tauri/src/providers/adapters.rs` — rodzina providera, fixed/custom base URL, walidacja URL, authentication headers i nagłówki OpenRouter;
- `src-tauri/src/providers/request_builders.rs` — request payload/endpoint dla OpenAI-compatible, Google i Anthropic;
- `src-tauri/src/providers/response_parsers.rs` — parsery odpowiedzi OpenAI-compatible, Google i Anthropic do wspólnego `ProviderChatResponse`;
- `src-tauri/src/providers/reasoning.rs` — rozdzielenie final content od native/tagged reasoning oraz diagnostyka reasoning-only response;
- `src-tauri/src/providers/errors.rs` — request error classification, redakcja HTTP error text i strukturalne provider error metadata;
- `src-tauri/src/providers/validation.rs` — walidacja request ID, wiadomości, obrazów, reasoning controls i timeout;
- `src-tauri/src/providers/transport.rs` — współdzielony `reqwest::Client`, dokładnie jedna fizyczna próba send, body/HTTP error handling i cancellation registry;
- `src-tauri/src/providers/tests.rs` — istniejące natywne testy kontraktowe przeniesione z fasady bez zmiany ich zakresu, plus jeden test klasyfikacji rodzin wire-format.

`providers.rs` zmniejszył się z około 1503 do około 255 linii. Testy nie są liczone jako odpowiedzialność produkcyjnej fasady.

## Rodziny providerów

Podział nie tworzy osobnego modułu dla każdej marki. Różnice są grupowane według rzeczywistego kontraktu API:

- `Google` → Google wire format;
- `Anthropic` → Anthropic wire format;
- `OpenRouter`, `OpenAI`, `ZAI`, `DeepSeek`, `Mistral`, `Blackbox`, `Custom OpenAI` → OpenAI-compatible wire format.

To ogranicza duplikację i zachowuje dotychczasowe zachowanie. Fixed base URLs oraz szczególne authentication headers nadal zależą od dokładnego `ProviderKind`, więc wspólna rodzina wire-format nie scala credential policy ani endpoint identity.

## Zachowane publiczne granice

Bez zmian pozostają nazwy komend Tauri:

- `provider_discover_models`;
- `provider_chat`;
- `cancel_provider_request`.

Bez zmian pozostają także:

- format `ProviderChatRequest` i `ProviderChatResponse`;
- serializacja `ProviderCallError`;
- OpenRouter `HTTP-Referer` i `X-OpenRouter-Title`;
- fixed base URLs providerów;
- localhost-only wyjątek dla HTTP custom endpoint;
- limity timeout/request id/image payload;
- Google system instruction/thinking config;
- Anthropic system/messages/max_tokens behavior;
- OpenAI-compatible reasoning transport;
- parsowanie usage, actual model, request ID i finish reason;
- redakcja sekretu i danych binarnych w diagnostics;
- rozdzielanie reasoning od final answer;
- cancellation before start i cancellation aktywnego requestu.

## Dowód bezbehawioralnego przeniesienia

Porównanie niezależnego audytora potwierdziło identyczne ciała 62 współdzielonych funkcji. Trzy świadome różnice są architektoniczne: routing buildera i parsera deleguje przez `ProviderFamily`, a publiczna komenda anulowania deleguje do semantycznie identycznego helpera transportu.

Publiczne ciała `provider_discover_models` oraz `provider_chat` pozostają identyczne. `cancel_provider_request` jest teraz cienką komendą delegującą do przeniesionego, semantycznie identycznego cancellation helpera.

Jedyną nową abstrakcją wykonawczą jest `ProviderFamily`, używana do wyboru request buildera i response parsera. Mapowanie jest kompletne dla wszystkich wariantów `ProviderKind` i ma test regresyjny.

## Test granicy architektonicznej

Dodano `src/providerRustModuleBoundary.test.ts`.

Po korekcie niezależnego audytu test wymaga:

- istnienia siedmiu fokusowych modułów Rust;
- pozostawienia trzech publicznych komend w `providers.rs`;
- braku builderów, parserów, reasoning normalization i transport send w fasadzie;
- obecności tych funkcji w ich docelowych modułach;
- zachowania rejestracji wszystkich trzech komend w `src-tauri/src/lib.rs`.
- jednego właściciela `HTTP_CLIENT` w `transport.rs`;
- obecności wersjonowanego User-Agent w `transport.rs`;
- braku przypadkowej kopii klienta HTTP w `adapters.rs`.

Po dodaniu testu źródło zawiera 136 plików Vitest, czyli o jeden więcej niż zielony baseline UX-DATA-9. Dwa nowe przypadki testowe w tym pliku dają pełny, niezależnie wykonany wynik **136/136 plików i 484/484 testy**.

## Chronione obszary poza zakresem

Etap 6 nie zmienia:

- `src/providers/requestExecutor.ts`, `providerError.ts` ani `retry.ts`;
- transport-retry ownership;
- żadnego protokołu RV;
- Viewer/Monitor/Judge selection ani ModelRouteSelect;
- Judge prompt/rubric/scoring;
- Training/Research Resume;
- persistence contracts ani SQLite repository;
- controlled purge;
- legacy `chat_thread_groups` / `thread_group_id`;
- migracji `021`, `022`, `023` ani żadnej innej migracji.

Nie dodano migracji `024`.

## Dokumentacja

Zaktualizowano living architecture:

- `docs/architecture/CODE_MAP.md`;
- `docs/architecture/MODULE_BOUNDARIES.md`;
- `docs/architecture/SYSTEM_OVERVIEW.md`;
- `docs/architecture/README.md`;
- `docs/README.md`.

Historycznych raportów/release records nie przepisano.

## Niezależny audyt i korekty

Pierwotny kandydat nie został przyjęty. Pełny Vitest wykrył nieaktualny test `versionConsistency.test.ts`, który po przeniesieniu klienta HTTP nadal szukał `env!("CARGO_PKG_VERSION")` w fasadzie `providers.rs`. Inspekcja Rust wykryła ponadto dwie blokujące kompilację pozostałości ekstrakcji:

- przypadkową, drugą funkcję `client()` w `adapters.rs`, odwołującą się do niedostępnych tam `Client` i `HTTP_CLIENT`;
- testy wywołujące prywatne funkcje request builderów z modułu siostrzanego.

Usunięto przypadkowy duplikat, przeniesiono oczekiwanie wersji do `providers/transport.rs`, a helpery builderów otrzymały wyłącznie widoczność `pub(super)` wraz z jawnym importem testowym. Nie zmienia to publicznego API Tauri ani zachowania wywołań providerów.

## Walidacja

W środowisku przygotowania wykonano:

- identyfikację bazy UX-DATA-9: **672 pliki**, source-tree `6eb314db…2df5db` — PASS;
- `node scripts/verify-source-integrity.mjs .` — **PASS**;
- `node scripts/verify-ux-data-compatibility.mjs .` — **PASS**;
- statyczny test granicy modułów Rust równoważny nowemu testowi Vitest — **PASS**;
- pełny Vitest — **PASS, 136/136 plików i 484/484 testy**;
- TypeScript typecheck — **PASS**;
- produkcyjny build Vite — **PASS**; pozostaje znane nieblokujące ostrzeżenie o głównym chunku, przeznaczone dla późniejszego `PERF-UI-1`;
- porównanie ciał przeniesionych funkcji z bazą — **PASS**, 62 identyczne funkcje i trzy świadome delegacje architektoniczne;
- kontrolę, że TypeScript retry i chronione migracje/data-lifecycle nie zostały zmienione — **PASS**.

Środowisko nie posiada również `cargo`/`rustc`, dlatego Rust/Tauri tests i Clippy pozostają obowiązkową bramką GitHub Actions.

## Kryterium odbioru Etapu 6

Etap 6 można oznaczyć `COMPLETED`, gdy dokładnie ten kandydat przejdzie niezależnie:

1. pełny Vitest, oczekiwany **136/136 plików i 484/484 testy**;
2. TypeScript typecheck;
3. produkcyjny Vite build;
4. `verify:source`;
5. `verify:ux-data`;
6. Rust/Tauri tests, w tym wszystkie przeniesione provider tests;
7. Clippy z `-D warnings`;
8. kontrolę, że native provider command/API serialization pozostaje kompatybilne;
9. kontrolę, że Rust nadal nie implementuje transport retry.

Po zielonym niezależnym odbiorze i GitHub Actions Etap 6 może zostać formalnie zamknięty. Następnym, osobnym krokiem z planu jest `PERF-UI-1`; `SECURITY-IPC-0` pozostaje po nim. Żaden z tych kroków nie należy do paczki Etapu 6.
