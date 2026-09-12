# STAGE-7B — Shared Components Cleanup

**Data:** 12 września 2026  
**Status:** `STAGE-7B CANDIDATE — INDEPENDENT AUDIT AND FULL GITHUB ACTIONS REQUIRED`  
**Zakres:** wyłącznie brakująca część Etapu 7 dotycząca małych, rzeczywiście współdzielonych komponentów. Etap 8 nie został rozpoczęty.

## Baza

Pracę wykonano na poprawionym Stage 7-R1 wskazanym przez użytkownika jako zielona baza GitHub Actions:

- complete ZIP SHA-256: `679325818b5f8b801be357ee27e7db83bd574c9ed68215eb0b87fad1932cee50`;
- changed-files ZIP SHA-256: `69111ae3cb2c1abac9d736d96a997ad483a1a0273e63d736a8c746d8079c8795`;
- source-tree zapisany w manifeście bazy: `09b9ec645dc5406c5f06c14b54dbfeea3148fc8ceaa55696958949c00aca6d15`;
- baza przed STAGE-7B: 143/143 pliki testowe, 509/509 testów według zaakceptowanego raportu Stage 7-R1.

Dostarczony complete ZIP zachowuje trzy historycznie znane nazwy zasobów DOCX jako `#U...`. Przed lokalną walidacją nazwy zostały wyłącznie znormalizowane do dokładnych nazw oczekiwanych przez `src-tauri/src/documents.rs`; bajty dokumentów i kod Rust pozostały niezmienione. Po tej normalizacji `verify:source` przechodzi.

## Wykonane zmiany

### PageHeader

- `src/features/settings/SettingsScreen.tsx` nie definiuje już lokalnego `PageHeader` i importuje kanoniczny `src/components/PageHeader.tsx`.
- `src/features/training/TrainingScreen.tsx` zastępuje prosty ręczny `<header className="page-header">` tym samym kanonicznym komponentem.
- Tytuły, podtytuły, klasy CSS i wynikowa struktura DOM pozostają równoważne.
- Specjalny nagłówek AI Center pozostawiono bez zmian. Nadal posiada `ai-center-header`, eyebrow, opis i selektor aktywnego Profilu.

### EmptyState

Przeprowadzono ograniczony audyt wszystkich ręcznych `className="empty-state"`.

Nie migrowano dwóch pozostałych przypadków:

1. `EmptyCard` w `src/App.tsx` renderuje arbitralne `children` i nie spełnia obecnego kontraktu wymagającego `icon` + `title`;
2. fallback AI Center dla braku Workspace ma specjalny kontekst kompozycyjny i również nie posiada semantyki `icon` + `title`.

Nie rozszerzono interfejsu `EmptyState`, nie zmieniono fallbacków lazy loadingu ani error boundary.

### Dialogi zasobów

Dodano małą powłokę `src/components/ResourceViewerDialogShell.tsx`. Odpowiada wyłącznie za:

- backdrop;
- `role="dialog"` i `aria-modal="true"`;
- zatrzymanie propagacji kliknięcia wewnątrz modala;
- nagłówek i przycisk zamknięcia;
- miejsce na treść;
- kontener akcji.

Powłokę wykorzystują wyłącznie trzy zgodne read-only resource viewers:

- `ProtocolDialog`;
- `BuiltinDocumentDialog` w Settings;
- `PromptResourceDialog` w Settings.

Logika zapisu, nazwy plików, hashe, licencje, typy zasobów i treść pozostają u dotychczasowych właścicieli.

Nie scalono:

- formularzy providera;
- `FormDialog`;
- Custom Protocol dialogu RV Sessions;
- Workspace switchera;
- `AppDialogProvider`.

Mają inne kontrakty danych, zachowanie albo layout i ich unifikacja byłaby sztuczna.

### Pozostałe komponenty wspólne

Sprawdzono `FormDialog`, `ModelRouteSelect`, `JudgeResults`, `ProtocolDialog`, `EmptyState`, `PageHeader` i `SafeMarkdown`. Po zmianie nie znaleziono oczywistych lokalnych reimplementacji tych komponentów poza `src/components`.

## Test granicy

Dodano `src/sharedComponentsBoundary.test.ts` z 5 przypadkami, które:

1. wymagają kanonicznego `PageHeader` w Settings i blokują lokalną definicję;
2. wymagają kanonicznego `PageHeader` w Training;
3. jawnie pozwalają AI Center zachować wyspecjalizowany nagłówek;
4. wymagają lokalizacji współdzielonych komponentów w `src/components`;
5. pilnują ograniczonego użycia `ResourceViewerDialogShell` przez zgodne resource viewers.

Test opiera się na kontraktach importów i charakterystycznych elementach semantycznych, a nie na numerach linii ani pełnym formatowaniu JSX.

## Strefy chronione

Kontrola SHA-256 względem bazy po normalizacji nazw DOCX potwierdziła brak zmian bajtów w:

- i18n, w tym istniejących modułach PL/EN;
- wszystkich modułach CSS i kolejności importów;
- `src/storage`;
- `src/providers`;
- `src/research`;
- `src/features/judge`;
- `src/sessions`;
- `src/targets`;
- `src-tauri`.

Nie dodano migracji 024. Nie zmieniono SECURITY-IPC-1A/1B/1C-R1, controlled purge, credential routing, provider transport/retry, Viewer Notes, Research, Judge, protokołów RV, `chat_thread_groups/thread_group_id` ani PERF-UI-1 lazy loadingu.

## Walidacja wykonana w tym środowisku

PASS:

- SHA-256 dostarczonego complete Stage 7-R1 ZIP zgodny z wymaganą bazą;
- syntaktyczna kompilacja pięciu zmienionych/dodanych plików TS/TSX przez TypeScript 7 compiler API;
- lustrzane uruchomienie pięciu asercji nowego testu granicy: 5/5 PASS;
- `node scripts/verify-source-integrity.mjs .`: PASS po opisanej normalizacji trzech nazw DOCX;
- `node scripts/verify-ux-data-compatibility.mjs .`: PASS;
- byte identity i18n: PASS;
- byte identity wszystkich 9 plików CSS: PASS;
- byte identity chronionych obszarów storage/providers/research/judge/sessions/targets/src-tauri: PASS.

Nie można było uczciwie wykonać pełnego `npm ci`, ponieważ sandbox nie rozwiązuje `registry.npmjs.org` (`EAI_AGAIN`) i nie posiada kompletnego cache npm. W konsekwencji w tym środowisku nie uruchomiono pełnego Vitest, projektowego `npm run typecheck` ani Vite build. `cargo` i `rustc` również nie są zainstalowane. Tych bramek nie oznaczono jako PASS i muszą zostać wykonane w niezależnym audycie / GitHub Actions.

Kandydat zawiera dokładnie jeden nowy plik Vitest z 5 nowymi przypadkami testowymi. Rzeczywista liczba uruchomionych testów ma zostać zapisana dopiero przez środowisko, które faktycznie wykona pełny runner.

## Decyzja

STAGE-7B pozostaje kandydatem do odbioru. Cały Etap 7 nie otrzymuje jeszcze statusu `COMPLETED`.

Po niezależnym audycie i pełnym zielonym GitHub Actions można formalnie zamknąć:

`STAGE 7 — COMPLETED`

i dopiero wtedy przejść do:

`ETAP 8 — EGZEKWOWANIE GRANIC ARCHITEKTONICZNYCH`

Końcowy runtime smoke całej modularizacji pozostaje odroczony do końcowej bramki.
