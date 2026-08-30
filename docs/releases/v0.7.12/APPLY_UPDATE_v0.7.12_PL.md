# Nakładanie AI RV Harness v0.7.12

## Końcowa korekta nieopublikowanego kandydata v0.7.12

Paczka `AI_RV_Harness_v0.7.12_FINAL_CORRECTIONS_changed_files.zip` jest nakładką na przygotowane wcześniej, nieopublikowane źródło v0.7.12. Należy rozpakować ją w katalogu głównym repozytorium i zezwolić na zastąpienie istniejących plików.

Nakładka:

- nie usuwa żadnego pliku;
- nie zawiera `node_modules`, `dist`, `target` ani `*.tsbuildinfo`;
- nie zmienia zależności Rust ani `src-tauri/Cargo.lock`;
- dodaje testy regresyjne oraz aktualizuje raport i spis plików v0.7.12.

Po nałożeniu uruchom `npm run typecheck`, `npm test` i `npm run build`. Kontrole `cargo test --locked` i `cargo clippy --locked --all-targets -- -D warnings` powinny zostać wykonane przez GitHub Actions albo lokalnie w środowisku z zainstalowanym Rust/Cargo.

1. Zacznij od kompletnego źródła v0.7.11.
2. Zrób kopię katalogu repozytorium albo pracuj na osobnej gałęzi.
3. Rozpakuj `changed_files` do katalogu głównego repozytorium, zachowując ścieżki i pozwalając zastąpić istniejące pliki.
4. Pliki niewystępujące w paczce zmian pozostaw bez zmian. Nie usuwaj całego repozytorium.
5. Uruchom `npm install`, `npm run typecheck`, `npm test` i `npm run build`.
6. Sprawdź `cargo test --locked`, `cargo clippy --locked -- -D warnings` oraz aktualność `src-tauri/Cargo.lock` w GitHub CI. Lokalny pakiet zawiera wersję root package `0.7.12`, ale środowisko przygotowujące tę paczkę nie miało Rust/Cargo.
7. Przed wydaniem wykonaj test istniejącej bazy v0.7.11, nowej instalacji, Notes ON/OFF, sesji monitorowanej, Training, Research No Notes/Frozen Notes i restartu aplikacji.

Nie kopiuj do repozytorium `node_modules`, `dist`, `target`, plików `*.tsbuildinfo` ani samego ZIP-a.
