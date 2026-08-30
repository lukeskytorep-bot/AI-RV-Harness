# Nakładanie AI RV Harness v0.7.12

1. Zacznij od kompletnego źródła v0.7.11.
2. Zrób kopię katalogu repozytorium albo pracuj na osobnej gałęzi.
3. Rozpakuj `changed_files` do katalogu głównego repozytorium, zachowując ścieżki i pozwalając zastąpić istniejące pliki.
4. Pliki niewystępujące w paczce zmian pozostaw bez zmian. Nie usuwaj całego repozytorium.
5. Uruchom `npm install`, `npm run typecheck`, `npm test` i `npm run build`.
6. Sprawdź `cargo test --locked`, `cargo clippy --locked -- -D warnings` oraz aktualność `src-tauri/Cargo.lock` w GitHub CI. Lokalny pakiet zawiera wersję root package `0.7.12`, ale środowisko przygotowujące tę paczkę nie miało Rust/Cargo.
7. Przed wydaniem wykonaj test istniejącej bazy v0.7.11, nowej instalacji, Notes ON/OFF, sesji monitorowanej, Training, Research No Notes/Frozen Notes i restartu aplikacji.

Nie kopiuj do repozytorium `node_modules`, `dist`, `target`, plików `*.tsbuildinfo` ani samego ZIP-a.

