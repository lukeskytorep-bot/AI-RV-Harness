# AI RV Harness v0.7.13 — ekstrakcja AI Monitor i stabilizacja po audycie

> **Status:** wykonano i zweryfikowano lokalnie 5 września 2026  
> **Baza:** `AI_RV_Harness_v0.7.13_MODULARIZATION_AI_JUDGE_COMPLETE_SOURCE.zip`  
> **CI natywne:** wymaga potwierdzenia w GitHub Actions dla dokładnego kandydata

## Zakres modułu Monitor

- utworzono `src/features/monitor/MonitorPanel.tsx` i publiczny `index.ts`;
- przeniesiono historię przebiegów Monitora, edycję promptu, timeline interwencji i inicjowanie eksportu z `App.tsx`;
- zachowano `src/monitor/engine.ts` jako właściciela decyzji, a `src/resources/systemPrompts.ts` jako właściciela promptów;
- persistence, provider transport oraz wykonanie monitorowanej RV Session nie zostały przeniesione;
- dodano test renderowania i granicę blokującą głębokie importy;
- `App.tsx` zmniejszył się z 1680 do 1590 linii.

## Poprawki stabilizacyjne

### Training Resume

`TrainingRunRecord` przechowuje teraz trwały checkpoint bieżącego celu:

- `session_revealed`;
- `review_completed`;
- `judging_completed`.

Identyfikator sesji jest zapisywany natychmiast po Revealu, przed review, refleksją i oceną. Po awarii Judge’a Resume wykorzystuje tę samą sesję i nie powtarza wywołań Viewera, review ani Viewer Notes reflection.

Training zapisuje również zamrożony `executionSnapshot`: język sesji, ustawienia generowania, limity transportu oraz Viewer System Prompt. Starszy rekord bez snapshotu otrzymuje go podczas pierwszego wznowienia.

### AI Judge

- częściowo zakończone `BatchEvaluation` zachowuje wyniki i przycisk pozwalający kontynuować brakujące sesje;
- konfiguracja Judge’ów pozostaje zamrożona po pierwszym wyniku serii;
- każdy wynik serii można rozwinąć w kanoniczny `JudgeResults`;
- średnie eksportu Training są agregowane wyłącznie po `judgeIndex`; wspólna `modelRoute` nie łączy dwóch odrębnych ról Judge’a;
- dodano test regresji 2/10 i 8/10 dla dwóch Judge’ów na tej samej trasie.

### Prezentacja i eksport

- `SessionInspection` pobiera i pokazuje późniejsze doprecyzowania celu, tak jak wspólny eksport kompletnej sesji;
- ponowny eksport Training powstaje najpierw w katalogu tymczasowym; dopiero kompletny pakiet zastępuje poprzedni katalog;
- dodano test Rust zamiany katalogu staged → current.

### Integralność source i dokumentacja

- przywrócono prawidłowe nazwy Unicode trzech dokumentów DOCX wymaganych przez Rust `include_bytes!`;
- canonical complete-source nie zawiera `tsconfig.app.tsbuildinfo` ani `tsconfig.node.tsbuildinfo`;
- `scripts/verify-source-integrity.mjs` sprawdza ścieżki `include_bytes!`/`include_str!`, markery błędnie zakodowanego Unicode oraz artefakty kompilatora;
- poprawiono ścieżkę kontraktu repository w `CODE_MAP.md`;
- dokument retry otrzymał status `COMPLETED` i odsyłacz do closure audit;
- README i Wiki Viewer Notes wyjaśniają, że zwykłe sesje używają notatek read-only, a nowe wersje powstają tylko w Training;
- historyczne capability snapshots są walidowane runtime zamiast rzutowania przez `unknown`.

## Weryfikacja

- `npm test`: **102 pliki testowe / 307 testów — zaliczone**;
- `npm run typecheck`: zaliczone;
- `npm run build`: zaliczone;
- `npm run verify:source`: zaliczone po przygotowaniu czystego drzewa pakietu;
- `git diff --check`: zaliczone;
- lokalny `cargo test` i Clippy: niewykonane — środowisko nie posiada `cargo`.

## Następny krok

Po zielonym GitHub Actions dla tego kandydata jedynym niewydzielonym panelem bieżącego bloku Etapu 4 pozostaje RV Sessions. Jego ekstrakcja powinna zachować kontrolery protokołów, Resume, Reveal i blinding u dotychczasowych właścicieli.
