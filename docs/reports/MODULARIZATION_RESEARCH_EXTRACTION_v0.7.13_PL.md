# AI RV Harness v0.7.13 — raport ekstrakcji modułu Research

> **Status:** wykonano i zweryfikowano lokalnie 4 września 2026  
> **Rodzaj zmiany:** refaktoryzacja frontendowa bez celowej zmiany zachowania  
> **Etap planu:** Etap 4 — stopniowe odchudzanie `App.tsx`

## 1. Cel i zakres

Kolejny mały krok modularizacji przenosi kompletną prezentacyjną powierzchnię Research za publiczną granicę `src/features/research/`. Zmiana nie przebudowuje silnika badań i nie modyfikuje metodologii, blindingu, Preflight, Experiment Lock, kolejności sesji, oceny ani unblindingu.

Zakres obejmuje:

- przeniesienie `ResearchScreen` z `src/App.tsx`;
- przeniesienie `ResearchBuilder` z ogólnego katalogu `src/components/`;
- utworzenie publicznego punktu wejścia `src/features/research/index.ts`;
- zachowanie `src/research/` jako właściciela reguł i wykonania badań;
- test renderowania modułu i test granicy importów;
- aktualizację mapy kodu oraz dokumentacji granic modułów.

## 2. Nowa granica Research

Moduł `src/features/research/` posiada obecnie:

- `ResearchScreen.tsx` — ekran, nagłówek i wskaźniki integralności;
- `ResearchBuilder.tsx` — konfigurację, Preflight, Lock, wykonanie, ocenę, unblinding i inicjowanie eksportu;
- `ResearchScreen.test.tsx` — kontrakt renderowania przez publiczne wejście;
- `index.ts` — jedyny publiczny punkt wejścia dla konsumentów.

`App.tsx` zachowuje wyłącznie top-level navigation i przekazuje do modułu `copy`, ustawienia, listę Profili, listę Workspace'ów oraz publiczny kontrakt `AppRepository`.

## 3. Zachowani właściciele domenowi

Nie przenoszono ani nie duplikowano reguł domenowych. Nadal obowiązują następujący właściciele:

- `src/research/engine.ts` — wykonanie i przejścia projektu;
- `src/research/planner.ts` — stabilny plan badania;
- `src/research/preflight.ts` — kontrola gotowości;
- `src/research/targetSelection.ts` — dobór celów;
- `src/research/studyControls.ts` — wspólne możliwości porównywanych warunków;
- `src/research/types.ts` — kontrakty domenowe;
- `src/exports/research.ts` — pakiet eksportowy Research;
- publiczny `AppRepository` — persistence.

Viewer Notes używane jako warunek badania pozostają odczytywane przez istniejący kontrakt `src/aiCenter/`; ekstrakcja nie rozszerza uprawnień Research do aktualizowania notatek.

## 4. Ochronione kontrakty

- Preflight nadal poprzedza Experiment Lock;
- konfiguracja po Lock pozostaje niezmienna;
- sesje i warunki pozostają ślepe aż do właściwego unblindingu;
- Judge otrzymuje dotychczasowe anonimowe pakiety;
- zamrożone oceny i wyniki zachowują dotychczasową kolejność;
- Resume przerwanego Research korzysta z istniejącego mechanizmu;
- eksport Research nie zmienia formatu ani zawartości;
- centralny provider transport/retry nie został dotknięty;
- nie zmieniono schematu danych, migracji ani numeru wersji.

## 5. Testy ochronne

Dodano test, który renderuje `ResearchScreen` przez `src/features/research/index.ts` bez repository i potwierdza obecność nagłówka oraz trzech komunikatów integralności.

Rozszerzono test granic architektonicznych. Test wymaga, aby:

- `App.tsx` importował Research wyłącznie z `./features/research`;
- `ResearchScreen` nie powrócił do `App.tsx`;
- `ResearchBuilder` nie powrócił do `src/components/`;
- kod produkcyjny poza modułem nie używał głębokich importów `features/research/...`.

## 6. Weryfikacja

- bezpośrednie testy Research i granic: **10 plików / 30 testów zaliczonych**;
- pełny zestaw Vitest: **90 plików / 259 testów zaliczonych**;
- TypeScript `tsc -b --pretty false`: zaliczony;
- produkcyjny build Vite: zaliczony;
- pozostało wcześniejsze, nieblokujące ostrzeżenie o głównym chunku większym niż 500 kB;
- kod Rust/Tauri nie został zmieniony w tym kroku.

## 7. Następny krok

Po zielonym GitHub Actions kolejnym kandydatem jest Training, ale jego ekstrakcja ma wyższe ryzyko niż Research. Przed przeniesieniem należy scharakteryzować testami: długotrwałe wykonanie, checkpoint/Resume, cancellation, zapis postępu oraz zasadę jednej aktualizacji Viewer Notes po ukończonym celu. Workspace i RV Sessions pozostają na później ze względu na jeszcze większą powierzchnię stanu i przejść.
