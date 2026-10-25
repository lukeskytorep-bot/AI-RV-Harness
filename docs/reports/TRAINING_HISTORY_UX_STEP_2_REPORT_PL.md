# TRAINING HISTORY UX — STEP 2 — raport implementacji

Data: 2026-10-10

## Baza

Podstawa: aktualna zaakceptowana baza `AI-RV-Harness-ai-rv-2(1).zip` z nałożonym i zaakceptowanym `TRAINING_HISTORY_UX STEP 1`, `STEP 1 AUDIT FIX` oraz `STEP 1 AUDIT FIX 2`.

Schema pozostaje 031. Brak migracji.

## Zakres wykonany

STEP 2 implementuje uzgodniony interfejs historii standardowego AI Training. Nie zmienia Telepathic Training, Viewer recovery B1/B2/B3 ani mechanizmu 16K/32K.

1. Dodano akcję `Zakończ trening / End training` obok istniejącego `Wznów / Resume`.
   - korzysta z trwałego `endTrainingRun()` z zaakceptowanego STEP 1;
   - Start, Resume i End korzystają z jednego `trainingOperationGuard` od wejścia do funkcji, przed pierwszym await;
   - dodano reaktywny `trainingOperationPending`, aby kontrolki były blokowane także podczas przygotowania Resume i zapisu zakończenia;
   - zakończony lub Completed run nie pokazuje Resume/End.

2. Historia runu ma nowy układ karty.
   - nagłówek: numer+nazwa po lewej, trzy akcje historii po prawej;
   - akcje to Lucide List, Download i Archive w istniejącym stylu `icon-button`;
   - Show/Hide sessions oraz Save pozostają dostępne wyłącznie przy istniejących `sessionIds`;
   - Archive zachowuje istniejący dialog i przebieg;
   - Resume/End pozostają tekstowymi przyciskami w osobnym wierszu poniżej metadanych;
   - lista sesji pozostaje pod tym wierszem.

3. Dodano zwijanie całego panelu historii.
   - lokalny `historyOpen` startuje jako `true`;
   - stan nie jest zapisywany w Profile/Settings/DB;
   - po zwinięciu grid używa wąskiego 32px toru z przełącznikiem;
   - `expandedRunId`, `selectedSession`, `activeRun` i wykonanie Training pozostają w komponencie i nie są resetowane;
   - SessionInspection pozostaje pod głównym layoutem.

4. Typografia.
   - nazwa/numer runu, nazwa aktywnego runu i identyfikatory sesji używają `11px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` oraz `font-weight: 400`;
   - statusy, przyciski i pozostały UI zachowują font interfejsu;
   - długie nazwy mogą się zawijać (`overflow-wrap:anywhere`) i nie wchodzą pod ikony dzięki grid `minmax(0,1fr) auto`.

5. Dostępność.
   - kontrolki ikonowe mają `type=button`, `title`, `aria-label`;
   - Show/Hide sessions ma `aria-expanded` i stabilne `aria-controls`;
   - przełącznik całej historii ma `aria-expanded`, `aria-controls` i PL/EN label;
   - ikony Lucide są dekoracyjne (`aria-hidden`).

6. Wydzielono `TrainingRunHistoryCard`, aby stany zakończone/Completed/expanded można było testować jako rzeczywisty render komponentu, a nie wyłącznie tekst źródła.

## Pliki produkcyjne

- `src/features/training/TrainingScreen.tsx`
- `src/styles/training-research.css`

## Testy

- `src/features/training/TrainingScreen.test.tsx`
  - historia domyślnie rozwinięta;
  - trzy ikony w nagłówku i osobny wiersz Resume/End;
  - user-finished: brak Resume/End, sesje i trzy akcje historii pozostają;
  - Completed: brak End;
  - klasy typografii RV Sessions;
  - grid/flex bez absolute positioning dla akcji karty.

## Kontrole wykonane lokalnie

- TypeScript `transpileModule` dla zmienionych TS/TSX: PASS, 0 błędów składni.
- `verify:ux-data`: PASS, 31 migracji.
- Potwierdzono, że aplikacja importuje aktywny `src/styles/training-research.css` przez `src/styles/app.css`.
- Zmiany względem zaakceptowanego STEP 1 dotyczą wyłącznie 3 plików źródłowych/testowych plus tego raportu.

## Kontrole niewykonane / ograniczenia

`npm ci` przekroczył limit środowiska i pozostawił niepełne `node_modules`, które następnie usunięto. Z tego powodu lokalnie nie deklaruję PASS dla pełnego Vitest, `typecheck`, build ani `verify:architecture`.

`verify:source` na dostarczonej bazie nadal zgłasza istniejące w ZIP-ie nazwy `#U...` i trzy dokumenty o nazwach Unicode. Nie przypisuję tego STEP 2. Audytor wcześniej potwierdzał czystą integralność swojej zrekonstruowanej bazy.

Nie wykonano rzeczywistego UI smoke na Windows/Tauri przy 330px, breakpoint, 125%/150% zoom i długich nazwach. CSS został przygotowany pod te warunki, ale odbiór wizualny powinien zostać wykonany w środowisku UI i nie jest oznaczony jako PASS.
