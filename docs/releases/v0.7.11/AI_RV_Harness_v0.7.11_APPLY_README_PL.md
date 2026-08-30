# AI RV Harness v0.7.11 — instrukcja nałożenia zmian

## Baza

Paczka została przygotowana na pełnych, publicznych źródłach `v0.7.10` z commitu:

`95e25c8b3a89e399c796264db46a874be758418b`

## Co wgrać do repozytorium

1. Rozpakuj ZIP.
2. Skopiuj **zawartość katalogu `changed_files`** do katalogu głównego repozytorium, zachowując strukturę podkatalogów.
3. Zatwierdź nadpisanie plików o tych samych nazwach.
4. Nie dodawaj do repozytorium dokumentów raportowych, list kontrolnych ani samego ZIP-a.

`src-tauri/Cargo.lock` jest tym razem częścią poprawki celowo. Pochodzi z publicznego `v0.7.10`; zmieniono w nim wyłącznie wersję głównego pakietu z `0.7.10` na `0.7.11`, aby odpowiadał `Cargo.toml` i działał z CI używającym `--locked`.

## Zalecana kontrola po wgraniu

```bash
npm ci
npm run typecheck
npm test -- --run
npm run build
npm audit
```

Następnie poczekaj na GitHub CI:

- Rust `cargo test --all-targets --locked`;
- Rust `cargo clippy --all-targets --locked -- -D warnings`;
- CodeQL.

## Test praktyczny przed publikacją

Sprawdź co najmniej:

- ZAI Viewer + DeepSeek Monitor;
- ZAI Viewer + NVIDIA/Nemotron Monitor;
- ZAI Viewer + Google Gemini Monitor;
- sesję kontrolną z Gemma lub Mistral;
- poprawność nagłówków kroków 7 i 8;
- brak reasoning Monitora w transkrypcie i poleceniu wysłanym Viewerowi;
- przycisk **Kontynuuj** po celowo wywołanym błędzie providera.

Release Notes najlepiej przygotować dopiero po tych testach.
