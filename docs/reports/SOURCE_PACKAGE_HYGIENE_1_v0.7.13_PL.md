# SOURCE-PACKAGE-HYGIENE-1

**Projekt:** AI RV Harness v0.7.13
**Data:** 18 września 2026
**Baza:** zaakceptowany i zielony `VIEWER-LEARNING-3-R1`
**Status:** `CANDIDATE — FULL GITHUB ACTIONS REQUIRED`

## Cel

Usunięcie pozostałości transferowych z drzewa źródłowego i rozszerzenie `verify:source`, aby podobne artefakty nie mogły ponownie zostać niezauważone.

## Wprowadzone zmiany

1. Usunięto 15 plików `*.openai-download-*` z `src/resources/training-targets-source`. Dwanaście miało 0 bajtów, a trzy zawierały robocze kopie treści. Żaden z nich nie był ładowany przez runtime; aktywny glob przyjmuje wyłącznie `*.md` i `*.txt`.
2. `verify-source-integrity.mjs` odrzuca teraz:
   - `*.openai-download-*`;
   - `*.tsbuildinfo`;
   - `*.db`, `*.db-shm`, `*.db-wal`;
   - `*.log`;
   - spakowane `node_modules/`, `dist/` i `src-tauri/target/`.
3. W prawdziwym checkout Git kontrolowane są śledzone ścieżki, dlatego zwykłe nieśledzone `node_modules` utworzone przez `npm ci` nie blokuje CI. W rozpakowanej paczce bez `.git` niedozwolone katalogi są traktowane jako błąd pakowania.
4. Dodano samosprawdzający test bramki, obejmujący wszystkie powyższe klasy artefaktów oraz prawidłowy checkout z nieśledzonym `node_modules`.
5. `src/resources/targets/target_1.md`–`target_10.md` pozostawiono na miejscu jako historyczny starter pack, ale dodano `README.md`, który jednoznacznie wyjaśnia, że runtime Training ładuje wyłącznie `training-targets-source`.
6. Status `factory-equivalent` pozostawiono w schema 024 jako świadomy, terminalny stan zgodności. Dokumentacja wyjaśnia, że nie jest to oczekująca ścieżka produkcyjna: bieżący kod tworzy `unresolved`, a jawne powiązanie przechodzi do `resolved`.
7. Raport `VIEWER-LEARNING-3-R1` został zsynchronizowany z wynikiem odbioru: niezależny audyt i pełne GitHub Actions przeszły, a Windows runtime smoke pozostaje odłożony.

## Czego nie zmieniono

- schematu SQLite 24 ani migracji;
- Field Guide, Viewer Notes, Research Lock lub Resume;
- providerów, credential routing, retry ani output recovery;
- targetów ładowanych przez runtime;
- promptów i protokołów.

Dalszy podział dużych plików pozostaje osobnym przyszłym refaktorem. Nie został ukryty w tej poprawce higienicznej.

## Walidacja lokalna

- `verify:source` wraz z nowymi self-testami — PASS;
- `verify:ux-data` — PASS;
- Vitest — PASS, 160/160 plików i 666/666 testów;
- TypeScript typecheck — PASS;
- `verify:architecture` — PASS, 209 plików produkcyjnych;
- Vite build — PASS;
- brak `*.openai-download-*` w finalnym drzewie — PASS.

Rust/Cargo/Clippy pozostają obowiązkową bramką GitHub Actions. Poprawka nie zmienia żadnego pliku Rust.
