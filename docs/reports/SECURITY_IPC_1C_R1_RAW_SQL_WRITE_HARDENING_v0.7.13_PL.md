# AI RV Harness v0.7.13 — SECURITY-IPC-1C-R1

**Data:** 11 września 2026  
**Status:** `CANDIDATE — INDEPENDENT AUDIT, FULL GITHUB ACTIONS AND RUNTIME GATE REQUIRED`  
**Baza:** zaakceptowany SECURITY-IPC-1B, source-tree `d5c0a48e6a4a96cb5ff336e7330d84ca663996c25106b50c102988015a36f725`

## Cel

Pierwszy kandydat SECURITY-IPC-1C został odrzucony po niezależnym audycie, ponieważ pozostawione `sql:default` udostępniało pluginową komendę `select(query: String)`, która nie gwarantowała read-only i mogła wykonać modyfikujące instrukcje SQLite z `RETURNING`. Audyt wykrył również dwa nieaktualne testy regresyjne.

SECURITY-IPC-1C-R1 naprawia dokładnie te dwa blokery, zachowując wartościową część odrzuconego 1C: zamknięty rejestr 95 nazwanych zapisów, dedykowany snapshot, natywny restore safety oraz natywny controlled purge.

## 1. Brak pluginowego raw SQL read/write w głównym WebView

`src-tauri/capabilities/default.json` nie zawiera już:

- `sql:default`;
- `sql:allow-select`;
- `sql:allow-execute`.

Plugin SQL pozostaje dostępny dla WebView wyłącznie w minimalnym zakresie lifecycle:

- `sql:allow-load`;
- `sql:allow-close`.

Produkcja nie wywołuje pluginowych `db.select()` ani `db.execute()`. `Database.load()` pozostaje odpowiedzialny za otwarcie bazy i uruchomienie zarejestrowanych migracji, a `close()` jest używany przed restore.

## 2. Natywny kanał odczytu wymuszający SQLite read-only

Odczyty repository przechodzą przez `database_select_readonly`.

Rust:

1. rozwiązuje dokładną ścieżkę `rv_harness.db` w AppConfig;
2. otwiera świeże `SqliteConnection` z `read_only(true)` i `create_if_missing(false)`;
3. ustawia dodatkowo `PRAGMA query_only = ON` na tym połączeniu;
4. przyjmuje tylko jedną instrukcję rozpoczynającą się od `SELECT` albo `WITH`;
5. wykonuje query przez read-only connection i zamyka je po odczycie.

Walidacja kształtu SQL jest defense-in-depth. Granicą bezpieczeństwa nie jest regex ani nazwa komendy, lecz read-only na poziomie połączenia SQLite. Dlatego nawet `WITH ... DELETE/UPDATE` nie może zmodyfikować bazy, jeśli SQLite zaakceptowałoby taki kształt składniowo.

## 3. Zgodność parametrów i wyników z dotychczasowym pluginem

Binding parametrów odtwarza semantykę dotychczasowego `tauri-plugin-sql` dla SQLite:

- `null` → NULL;
- string → TEXT;
- number → `f64`, zgodnie z poprzednim wrapperem pluginu;
- pozostałe wartości JSON → JSON binding SQLx.

Dekoder zachowuje JSON używany przez istniejące repository dla typów występujących w schemacie Harnessa: INTEGER/NUMERIC, REAL, TEXT, BOOLEAN, BLOB i NULL. Schemat migracji 001–023 używa dla kolumn aplikacji INTEGER, REAL i TEXT; dodatkowy test Rust sprawdza integer, real, text, blob i null.

## 4. WAL poza WebView

`PRAGMA journal_mode = WAL` nie jest już wykonywane przez frontendowy `db.select`. Dedykowana komenda `database_initialize` ustawia WAL na istniejącym natywnym poolu po `Database.load()`.

## 5. Testy blokujące mutacje przez kanał odczytu

Dodano rzeczywiste testy Rust/SQLite:

- poprawny SELECT zwraca wiersz;
- kształty INTEGER/REAL/TEXT/BLOB/NULL zachowują oczekiwany JSON;
- `DELETE ... RETURNING` jest odrzucane i rekord pozostaje;
- `UPDATE ... RETURNING` jest odrzucane i rekord pozostaje;
- `INSERT ... RETURNING` jest odrzucane;
- `PRAGMA journal_mode = DELETE`, `ATTACH`, wielokrotne instrukcje i `VACUUM INTO` są odrzucane przez read boundary.

Niezależnie od wstępnego filtra, połączenie jest otwierane w trybie SQLite read-only.

## 6. Naprawione testy regresyjne z audytu

`src/storage/sqliteTransactionRegression.test.ts` zachowuje swoją funkcję regresyjną, ale odpowiada aktualnej architekturze:

- wymaga braku `this.db.execute`;
- wymaga braku `this.db.select`;
- wymaga jednej natywnej transakcji SQLx;
- sprawdza aktualny `execute(&mut **transaction)`.

`src/securityIpcRawSqlBoundary.test.ts` blokuje powrót `sql:default`, `sql:allow-select`, `sql:allow-execute`, produkcyjnego `db.select/db.execute` oraz wymaga read-only connection i testów adversarial.

## 7. Część 1C zachowana bez zmiany założeń

R1 nadal zawiera rozwiązania przygotowane w pierwszym 1C:

- 95 nazwanych operacji zapisu TypeScript ↔ Rust;
- wykonywalny SQL ustalony w Rust;
- dynamiczne tylko bind values;
- `database_execute_write_batch` dla transakcji wielostatementowych;
- `database_snapshot` dla `VACUUM INTO`;
- natywny safety backup restore;
- `database_controlled_purge(kind + id)` otwierający i zamykający `controlled_purge_context` wewnątrz jednej natywnej transakcji.

## 8. Obszary chronione

R1 nie zmienia:

- migracji `021–023` i nie dodaje `024`;
- SECURITY-IPC-1B credential binding;
- TypeScriptowego provider retry;
- Viewer Notes snapshots;
- frozen/locked/immutable guards;
- `chat_thread_groups/thread_group_id`;
- protokołów RV i Judge scoring.

## 9. Ryzyko rezydualne

Główne WebView zachowuje możliwość wykonywania arbitralnych **odczytów** `SELECT/WITH` przez własną komendę `database_select_readonly`. To jest jawna powierzchnia poufności przy pełnym przejęciu WebView, ale nie jest już powierzchnią zapisu: SQLite connection jest otwierane `read_only(true)` i dodatkowo ma `query_only=ON`.

Pełne usunięcie raw-read i zastąpienie wszystkich około kilkudziesięciu zapytań nazwanymi read operations byłoby osobnym, znacznie większym projektem i nie jest wymagane do zamknięcia potwierdzonej luki write-bypass z audytu 1C.

## 10. Walidacja przygotowania

W środowisku przygotowania wykonano:

- `verify:source` — PASS;
- `verify:ux-data` — PASS;
- statyczna zgodność invoke/AppManifest/ACL — **40/40/40 PASS**;
- brak `sql:default`, `sql:allow-select`, `sql:allow-execute` — PASS;
- brak produkcyjnego `db.select()` i `db.execute()` — PASS;
- TypeScript syntax/transpile zmienionych plików — PASS;
- kontrola SHA chronionych migracji 021–023, credential binding/provider facade oraz provider retry względem zaakceptowanego 1B — PASS;
- brak migracji 024 — PASS;
- niezależny smoke SQLite `mode=ro`: `DELETE/UPDATE/INSERT ... RETURNING` odrzucone jako próba zapisu do readonly database, rekord zachowany — PASS.

Środowisko przygotowania nie posiada kompletnego lokalnego Rust toolchainu ani pełnego cache npm. Dlatego pełny Vitest **141/504**, typecheck, Vite, `cargo test --all-targets --locked`, Clippy i właściwe testy Rust read-only pozostają obowiązkową bramką niezależnego audytu/GitHub Actions.

## 11. Kryterium odbioru

R1 może zostać przyjęty dopiero po:

1. niezależnym potwierdzeniu tożsamości ZIP/source/payload i rekonstrukcji overlay na dokładnym 1B;
2. pełnym frontendzie **141/141 plików i 504/504 testów**;
3. typecheck, Vite, `verify:source`, `verify:ux-data`;
4. `cargo test --all-targets --locked`;
5. `cargo clippy --all-targets --all-features --locked -- -D warnings`;
6. potwierdzeniu testami Rust, że mutujące `... RETURNING` nie zmieniają bazy przez read channel;
7. wymaganym runtime gate: start bazy v23, lazy routes, attachment import, provider/credential routing, normalne read/write repository, backup/restore z safety backup i controlled purge.

Dopiero po tym SECURITY-IPC-1 może zostać zamknięty i można przejść do Etapu 7.
