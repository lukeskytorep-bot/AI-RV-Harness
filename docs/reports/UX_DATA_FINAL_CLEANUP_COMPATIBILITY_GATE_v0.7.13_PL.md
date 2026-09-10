# AI RV Harness v0.7.13 — UX-DATA-9: final cleanup, documentation and compatibility gate

**Data:** 10 września 2026  
**Etap:** post-Etap-5 UX/data campaign — krok 9  
**Baza:** wyłącznie skorygowany UX-DATA-8 `_AUDITED`, source-tree `c983844449717b1a453adda36de06d231901705e974219c74daab4769f1027f7`  
**Status kandydata:** poprawiony po niezależnym audycie; frontend i SQLite przyjęte lokalnie, promocja do `COMPLETED` wymaga zielonych GitHub Actions Rust/Tauri + Clippy dla dokładnego kandydata oraz potwierdzonej zielonej bazy UX-DATA-8

## Cel

Zamknąć kampanię UX-DATA bez wprowadzania kolejnej funkcji produktu. Krok 9 usuwa rzeczywiste pozostałości po migracji modelu, synchronizuje living architecture i zamienia najważniejsze rezultaty UX-DATA-1–8 w stałą bramkę kompatybilności.

## Cleanup

Usunięto globalny produktowy interfejs `ChatThreadGroup` z `src/types.ts`. Nie był już używany przez produkt po UX-DATA-5; pozostawał jedynie dla fixture starej hierarchii. Fixture otrzymał lokalny `LegacyThreadGroupRecord`.

Celowo **nie** usunięto:

- tabeli SQLite `chat_thread_groups`;
- kolumny `chat_threads.thread_group_id`;
- historycznych wartości `thread_group_id` w starych rekordach.

Są to dane kompatybilności, nie martwy kod produktu. Nowe Conversation / Manual RV nadal zapisują `thread_group_id = NULL`.

## Stały gate `verify:ux-data`

Dodano `scripts/verify-ux-data-compatibility.mjs` oraz skrypt npm:

```text
npm run verify:ux-data
```

Gate sprawdza:

- ciągłość i rejestrację migracji 001–023;
- brak powrotu browser-native dialogów poza wspólny `AppDialogProvider`;
- brak powrotu `ChatThreadGroup` i jego lifecycle do produkcji;
- zachowanie odczytu legacy `thread_group_id` oraz płaskiego zapisu nowych Conversation;
- obecność kanonicznego `modelRoutes.ts` i `ModelRouteSelect` w migrowanych ekranach;
- komplet głównych Archive/Restore/Permanent Delete use cases;
- obecność Deletion Preview i silnego confirmation w Archive and recovery;
- zachowanie markerów migracji 022 Viewer Notes source preservation;
- zachowanie target snapshots i controlled purge z migracji 023;
- obecność natywnego testu upgrade starej bazy.

Gate został dodany do:

- `.github/workflows/ci.yml`;
- `.github/workflows/release-linux.yml`;
- `.github/workflows/release-windows.yml`.

## Natywny compatibility test starej bazy

Dodano `src-tauri/src/ux_data_compatibility.rs`, uruchamiany przez standardowe `cargo test --all-targets --locked`.

Test tworzy SQLite in-memory, aplikuje migracje 001–020, a następnie zapisuje reprezentatywny rekord starej bazy:

- Profile + Workspace;
- legacy Thread group;
- Conversation + Message;
- użyty My Target;
- completed RV Session;
- Training zawierający Session;
- Locked Research assignment;
- AI identity + Viewer Notes reflection/version/activation.

Następnie aplikuje 021, 022 i 023 i potwierdza:

- brak utraty Conversation i Message;
- zachowanie historycznego `thread_group_id`;
- `target_id_snapshot` w RV Session i Research assignment;
- immutable Viewer Notes source snapshot z Training Run ID/number/name;
- zachowanie live source references, jeśli źródło nadal istnieje;
- pusty `controlled_purge_context` po migracji;
- `PRAGMA foreign_key_check = 0`.

Ten test jest celowo silniejszy od samego sprawdzania obecności tekstu migracji: wykonuje realny upgrade reprezentatywnej starej bazy.

## Dokumentacja

Zsynchronizowano living architecture:

- `README.md`;
- `docs/README.md`;
- `docs/architecture/README.md`;
- `SYSTEM_OVERVIEW.md`;
- `AI_CENTER_AND_VIEWER_NOTES.md`;
- `ENGINEERING_DESIGN_AND_INTEGRITY_SAFEGUARDS.md`;
- `CODE_MAP.md`;
- `ADR-0003-STORAGE_FACADE.md`;
- nowy `UX_DATA_COMPATIBILITY_GATE.md`.

Usunięto m.in. nieaktualne stwierdzenia, że code map albo controlled purge są dopiero przyszłą pracą. Publiczne v0.7.12 nadal jest wyraźnie odróżnione od prywatnego baseline v0.7.13.

## Walidacja lokalna przygotowanego kandydata

W środowisku przygotowania wykonano:

- `node scripts/verify-source-integrity.mjs .` — **PASS**;
- `node scripts/verify-ux-data-compatibility.mjs .` — **PASS**;
- rzeczywisty SQLite smoke upgrade reprezentatywnej bazy v20 przez migracje 021–023 — **PASS**;
- `PRAGMA foreign_key_check` po upgrade — **0 naruszeń**;
- zachowanie legacy Conversation + Message + `thread_group_id` — **PASS**;
- backfill `target_id_snapshot` dla RV Session i Research assignment — **PASS**;
- Viewer Notes immutable source snapshot z Training Run ID/number/name — **PASS**;
- parse zmienionych workflow YAML i `package.json` — **PASS**;
- bezpośredni TypeScript syntax/type smoke dla zmienionych typów/fixture — **PASS**.

### Niezależny audyt i korekta

Pierwotny kandydat nie przechodził deklarowanego pełnego Vitest: test graniczny UX-DATA-5 nadal wymagał usuniętego komentarza globalnego `ChatThreadGroup` w `src/types.ts`. Audyt poprawił test tak, aby wymagał braku globalnego typu oraz obecności lokalnego `LegacyThreadGroupRecord` w fixture kompatybilności. Zakres nakładki wzrósł z 19 do **20 plików repozytorium**: 4 nowe + 16 zmienionych.

Po korekcie wykonano `npm ci`, pełny Vitest **135/135 plików i 482/482 testy**, TypeScript typecheck, produkcyjny Vite build, `verify:source` oraz `verify:ux-data` — wszystkie zakończone **PASS**. Niezależny real SQLite smoke v20 → v23 potwierdził zachowanie danych i `PRAGMA foreign_key_check = 0`. Gate poddano również testom negatywnym: wykrył brak rejestracji migracji, powrót produktu `ChatThreadGroup` i usunięcie współdzielonego `ModelRouteSelect`.

Lokalnie nadal nie ma toolchainu `cargo`, więc kompilacja i wykonanie nowego testu Rust oraz Clippy `-D warnings` pozostają obowiązkową bramką GitHub Actions.

## Nienaruszone granice

UX-DATA-9 nie zmienia:

- protokołów RV;
- blind boundary, Reveal ani sealed evidence;
- Monitor/Judge promptów i scoringu;
- provider transport/retry;
- Research Lock/Blinding/Unblind;
- semantyki Archive/Restore/Purge z UX-DATA-6/8;
- Viewer Notes content/reflection policy;
- schematu SQLite ani numeru migracji;
- fizycznej legacy warstwy `chat_thread_groups/thread_group_id`.

## Kryterium odbioru

Kandydat można oznaczyć `COMPLETED`, gdy dokładnie ta paczka przejdzie:

- `npm ci`;
- `npm run verify:source`;
- `npm run verify:ux-data`;
- pełny Vitest;
- TypeScript typecheck;
- produkcyjny Vite build;
- Rust/Tauri tests, w tym nowy legacy-upgrade compatibility test;
- Clippy `-D warnings`;
- czystość complete source oraz zgodność changed-files overlay → complete source.

Po tym kroku kampania **UX-DATA-0–9** jest zamknięta. Następnym głównym etapem architektonicznym pozostaje **Etap 6 — porządkowanie providerów Rust**.
