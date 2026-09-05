# AI RV Harness v0.7.13 — ekstrakcja Workspaces i Conversations

**Data:** 5 września 2026  
**Zakres:** kolejny kontrolowany krok Etapu 4 modularizacji  
**Charakter zmiany:** refaktoryzacja bez celowej zmiany zachowania

## Punkt wyjścia

Zmianę wykonano na pełnym źródle po ekstrakcji Training i audycie provider transport/retry. Przed pracą ponownie odczytano aktywny plan modularizacji. Plan wskazywał Workspaces/Conversations jako następny kandydat i zalecał zachowanie małych, jawnych granic przed późniejszym blokiem RV Sessions/Monitor/Judge.

## Wykonane zmiany

- utworzono `src/features/workspaces/` z publicznym `index.ts`;
- przeniesiono `WorkspacesScreen`, filtrowany katalog Workspace i `WorkspaceSwitcherDialog`;
- wydzielono testowalne, uporządkowane operacje rename/archive w `workspaceOperations.ts`;
- utworzono `src/features/conversations/` z publicznym `index.ts`;
- przeniesiono `ChatPanel` wraz z istniejącą orkiestracją Conversation i Manual RV;
- pozostawiono silnik komunikatów, retry, kontekst, eksport i persistence u dotychczasowych właścicieli;
- pozostawiono w `App.tsx` nawigację, aktywny Profil/Workspace i powłokę wybierającą Chat albo RV Session;
- rozszerzono test granic architektonicznych o zakaz głębokich importów nowych modułów.

## Zachowane granice

- nie zmieniono formatu bazy ani kontraktu repository;
- nie zmieniono promptów Conversation ani Viewera;
- nie zmieniono logiki provider transport/retry;
- nie zmieniono Resume, tworzenia wiadomości, obsługi źródeł, obrazów ani eksportu;
- nie przenoszono jeszcze RV Sessions, Monitora ani Judge’a.

## Weryfikacja

- testy nowych modułów: renderowanie katalogu, switchera, Conversation/Manual RV oraz kolejność operacji rename/archive;
- testy architektury: publiczne entry pointy i brak implementacji w `App.tsx`;
- pełny zestaw: **98 plików testowych / 294 testy zaliczone**;
- typecheck: zaliczony;
- produkcyjny build Vite: zaliczony;
- `App.tsx`: zmniejszony z 2523 do 1923 linii.

Nowy stan jest kandydatem do standardowego potwierdzenia w GitHub Actions po wgraniu paczki do repozytorium.
