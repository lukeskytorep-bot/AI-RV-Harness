# TRAINING HISTORY UX — STEP 1 AUDIT FIX 2

Data: 2026-10-10.
Zakres: wyłącznie natywna korekta rejestru SQL po STEP 1 AUDIT FIX. Kod UI i semantyka Training nie zostały zmienione.

## Poprawki

1. `TrainingUpdateTrainingRuns02` ma SQL z parametrami `$1` i `$2`; `expected_values()` zmieniono z `3` na `2`.
2. Natywny test `every_named_write_has_static_sql_and_expected_arity` obejmuje teraz także `TrainingUpdateTrainingRuns04` i `TrainingUpdateTrainingRuns05`; oczekiwana liczba operacji wynosi 124.
3. Ten sam test wylicza najwyższy placeholder `$N` w SQL każdej zarejestrowanej operacji i wymaga równości z `expected_values()`. Chroni to przed ponownym rozjazdem liczby wartości i parametrów SQL.

## Kontrole lokalne

- `rustfmt --check src-tauri/src/database.rs` — PASS.
- Migracje: bez zmian; schema 031.
- Nie wykonano lokalnie pełnego `cargo test`; środowisko odbiorcze/CI powinno uruchomić testy Rust oraz pełne bramki projektu.

## Pliki produkcyjne

- `src-tauri/src/database.rs`

Nie zmieniono zapytań SQL, migracji ani rejestru frontendowego w tym fixie. Poprawiono wyłącznie natywną walidację arity i jej test kompletności.
