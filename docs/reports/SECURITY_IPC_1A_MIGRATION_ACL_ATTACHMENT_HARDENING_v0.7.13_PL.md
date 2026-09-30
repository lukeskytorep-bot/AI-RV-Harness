# AI RV Harness v0.7.13 — SECURITY-IPC-1A

## Migration version, Tauri ACL i atomowy import załączników

**Data:** 10 września 2026  
**Status:** `CANDIDATE — LOCAL STATIC/MIGRATION GATES PASS; FULL FRONTEND/RUST CI AND INDEPENDENT AUDIT REQUIRED`  
**Baza:** PERF-UI-1 `_AUDITED` po pełnym zielonym GitHub Actions  
**Wymagany source-tree bazy:** `1f6840ef52752b8bb626e2f102de0e2e533dc35700b190c5ee67d9a60780875b`

## Cel

SECURITY-IPC-1A jest małym, izolowanym hardeningiem po audycie SECURITY-IPC-0. Nie zamyka jeszcze całej powierzchni SQL IPC i nie implementuje credential routing. Kandydat naprawia rozjazd wersji migracji, usuwa nieużywane uprawnienia dialogowe WebView, wprowadza jawny manifest/ACL własnych komend Tauri oraz eliminuje przekazywanie ścieżek załączników przez WebView.

## 1. Jedno źródło prawdy dla migracji 001–023

Dodano `src-tauri/src/migrations.rs` jako kanoniczny, uporządkowany rejestr wszystkich 23 migracji. `src-tauri/src/lib.rs` przekazuje do `tauri-plugin-sql` wynik `migrations::registered_migrations()`, a `src-tauri/src/storage.rs` pobiera `CURRENT_MIGRATION_VERSION` z tego samego rejestru.

`CURRENT_MIGRATION_VERSION` nie jest już ręcznie wpisanym numerem. Jest wyprowadzany z ostatniej pozycji `MIGRATION_SPECS`, dzięki czemu rejestr wykonywanych migracji i walidator live/backup nie mają dwóch niezależnych liczb mogących się rozjechać.

Treść `021_soft_archive_lifecycle.sql`, `022_viewer_notes_source_preservation.sql` i `023_controlled_purge.sql` nie została zmieniona. Nie dodano migracji `024`.

Dodano natywne testy, które:

- wymagają ciągłego rejestru 001–023 i wersji bieżącej 23;
- tworzą realny plik SQLite, wykonują rzeczywiste SQL migracji 001–023, zapisują ledger `_sqlx_migrations` i wymagają przejścia `validate_current_database()`;
- tworzą bazę 001–020, otwierają ją ponownie, wykonują 021–023 i wymagają przejścia walidacji wersji 23;
- tworzą przenośny backup z bazą w wersji 23, wymagają przyjęcia go przez `inspect_portable_backup()` oraz przejścia tej samej walidacji SQLite używanej w restore preflight.

Istniejący natywny test zgodności UX-DATA został przełączony na ten sam centralny rejestr migracji, bez zmiany jego fixture ani chronionych danych.

## 2. Usunięcie nieużywanych uprawnień plugin-dialog

Statyczna inspekcja produkcyjnych plików `src/**/*.ts(x)` potwierdza brak bezpośredniego importu `@tauri-apps/plugin-dialog`. Z `src-tauri/capabilities/default.json` usunięto:

- `dialog:allow-open`;
- `dialog:allow-save`.

Plugin dialog pozostaje inicjalizowany w Rust, a `app.dialog().file()` nadal jest używany wewnątrz własnych komend/helperów natywnych. Zmiana odbiera jedynie bezpośrednie JS/WebView permission do plugin-dialog.

`sql:default` i `sql:allow-execute` pozostają bez zmian zgodnie z granicą SECURITY-IPC-1A.

## 3. Jawny AppManifest i ACL własnych komend

`src-tauri/build.rs` definiuje `APP_COMMANDS` i przekazuje go do `tauri_build::AppManifest::new().commands(APP_COMMANDS)`. Tauri generuje dzięki temu deklaracje allow/deny dla jawnie wymienionych komend aplikacji.

Dodano `src-tauri/permissions/main-window.toml` z permission `main-window-commands`. Capability `default` jest przypisana wyłącznie do okna `main` i zawiera tę permission.

Nowy test architektoniczny porównuje trzy zbiory:

1. komendy w `tauri::generate_handler![...]`;
2. `APP_COMMANDS` w build script;
3. `commands.allow` w `main-window.toml`.

Zbiory muszą być identyczne. Nowa komenda dodana tylko w jednym miejscu powoduje błąd testu.

Jest to defense-in-depth i zabezpieczenie przed przypadkowym rozszerzeniem uprawnień przyszłych okien/WebView. Nie jest to przedstawiane jako ochrona przed pełnym przejęciem już autoryzowanego głównego WebView.

## 4. Import załączników bez ścieżki w WebView

Poprzedni przepływ miał dwie komendy IPC:

`choose_attachments` → `Vec<String path>` → WebView → `import_attachment(path)`.

SECURITY-IPC-1A zastępuje je jedną komendą:

`choose_and_import_attachments(app, title) -> Vec<ParsedAttachment>`.

Wybór pliku odbywa się natywnie przez prywatny dla crate helper `dialogs::choose_attachment_paths()`. Zwrócone `PathBuf` są przekazywane bezpośrednio w Rust do `import_selected_attachment()`. Do WebView wracają dopiero sparsowane dokumenty/obrazy. Ścieżka systemowa nie przekracza IPC.

Nie zastosowano tokenów/grantów, ponieważ preferowany atomowy wariant usuwa potrzebę przechowywania ścieżki pomiędzy dwoma wywołaniami. Testy TTL/jednorazowości tokenu są więc nieapplicable. Negatywna kontrola bezpieczeństwa sprawdza zamiast tego, że:

- frontend nie wywołuje `choose_attachments` ani `import_attachment`;
- `invoke_handler` nie rejestruje żadnej z tych komend;
- `choose_attachment_paths` nie jest komendą Tauri;
- nie istnieje command `import_attachment(path: String)` dostępny przez IPC.

Parsery PDF/DOCX/text/image i ich limity nie zostały zmienione.

## 5. Świadomie poza zakresem

SECURITY-IPC-1A nie zmienia:

- treści migracji 021–023 i nie dodaje 024;
- `chat_thread_groups` ani `thread_group_id`;
- controlled purge ani jego triggerów/transakcji;
- Viewer Notes source snapshots;
- frozen/locked/immutable guards;
- TypeScriptowego provider retry;
- protokołów RV, Reveal, Resume ani Judge scoring;
- credential binding/routing;
- raw SQL write surface;
- `sql:allow-execute` ani raw `SELECT`.

Credential routing jest osobnym SECURITY-IPC-1B. Zamknięcie raw SQL write surface jest osobnym SECURITY-IPC-1C.

## 6. Walidacja wykonana przy przygotowaniu

W środowisku przygotowania wykonano:

- identyfikację dokładnej bazy PERF-UI-1 `_AUDITED`: **686 plików**, source-tree `1f6840ef…80875b` — PASS;
- `node scripts/verify-source-integrity.mjs .` — PASS;
- `node scripts/verify-ux-data-compatibility.mjs .` — PASS po dostosowaniu gate do centralnego rejestru migracji;
- rzeczywisty smoke SQLite w Pythonie na tych samych 23 plikach migracji: fresh 001–023 oraz upgrade 001–020 → 021–023, `integrity_check=ok`, `foreign_key_check=0`, version=23 — PASS;
- statyczną kontrolę braku bezpośredniego frontendowego `@tauri-apps/plugin-dialog` — PASS;
- statyczną zgodność `invoke_handler` ↔ AppManifest `APP_COMMANDS` ↔ permission `commands.allow` — PASS, 34/34/34;
- SHA-256 migracji 021–023 względem bazy — PASS, byte-for-byte bez zmian;
- SHA-256 `requestExecutor.ts`, `providerError.ts`, `retry.ts` względem bazy — PASS, byte-for-byte bez zmian;
- kontrolę braku migracji 024 — PASS.

Pełny `npm ci` nie zakończył się w środowisku przygotowania z powodu niedostępności warstwy sieciowej, a środowisko nie posiada lokalnego `cargo/rustc`. Z tego powodu pełny Vitest, TypeScript typecheck, Vite build, `cargo test --all-targets --locked` oraz `cargo clippy --all-targets --all-features -- -D warnings` pozostają obowiązkowymi bramkami niezależnego audytu/GitHub Actions dokładnego pakietu.

Po dodaniu jednego pliku Vitest z czterema przypadkami oczekiwany pełny frontend, przy niezmienionej pozostałej bazie, to **138 plików testowych / 491 testów**. Jest to oczekiwanie do potwierdzenia, nie wynik lokalnego uruchomienia.

## 7. Kryterium odbioru

Status pozostaje `CANDIDATE` do czasu:

1. niezależnego audytu paczki i rekonstrukcji overlay → complete source;
2. `verify:source` i `verify:ux-data`;
3. pełnego Vitest;
4. TypeScript typecheck;
5. Vite production build wraz z utrzymaniem PERF-UI-1;
6. `cargo test --all-targets --locked`, obejmującego realne testy bazy 23 i backup/restore preflight;
7. `cargo clippy --all-targets --all-features -- -D warnings`;
8. potwierdzenia, że migracje 021–023 są niezmienione i 024 nie istnieje;
9. zielonego GitHub Actions dokładnej tożsamości paczki.

Po odbiorze 1A następny ma być osobny **SECURITY-IPC-1B — credential routing**. Dopiero po jego odbiorze należy wykonać osobny **SECURITY-IPC-1C — zamknięcie raw SQL write surface**. Etap 7 pozostaje zablokowany do zakończenia tej sekwencji.

Końcowy runtime smoke całej modularizacji pozostaje obowiązkowy i ma obejmować co najmniej: start na bazie po migracji 23, lazy routes PERF-UI-1, import załącznika, provider connection, backup/restore i controlled purge.
