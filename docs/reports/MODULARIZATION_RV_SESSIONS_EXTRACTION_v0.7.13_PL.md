# AI RV Harness v0.7.13 — ekstrakcja modułu RV Sessions

**Data:** 6 września 2026  
**Status:** zaimplementowane i zweryfikowane lokalnie; GitHub Actions oczekują na potwierdzenie dokładnego kandydata

## Cel

Ostatni panel Etapu 4 został wydzielony z `App.tsx` bez celowej zmiany zachowania sesji. Zmiana porządkuje własność interfejsu i koordynacji ekranu, pozostawiając krytyczne maszyny stanów, blinding, Reveal, Resume, Monitor, Judge, persistence oraz eksporty u ich dotychczasowych właścicieli.

## Zakres ekstrakcji

- utworzono `src/features/rvSessions/RvSessionPanel.tsx`;
- utworzono publiczny punkt wejścia `src/features/rvSessions/index.ts`;
- przeniesiono stan konfiguracji sesji, widok postępu, obsługę Reveal i Post-Reveal, kontrolki Resume, historię sesji oraz koordynację istniejących use case’ów;
- przeniesiono prywatny `CustomProtocolDialog`, używany wyłącznie przez RV Sessions;
- `App.tsx` zachował top-level navigation, aktywny Profil/Workspace i powłokę przełączającą Chat/RV Session;
- `App.tsx` zmniejszył się z 1590 do 648 linii.

## Zachowane granice

Ekstrakcja nie przenosi ani nie modyfikuje:

- Full RCP w `src/sessions/controller.ts`;
- RV Lite w `src/sessions/rvLiteController.ts`;
- Custom Protocol execution w `src/sessions/customController.ts`;
- Telepathic Protocol i jego checkpointów w `src/sessions/telepathicController.ts`;
- Resume replay, Reveal/Post-Reveal, Batch, Monitor i Judge engines;
- repository, target rules, provider transport/retry ani formatów eksportu;
- promptów Viewer, Monitor lub Judge;
- reguły Training-only dla aktualizacji Viewer Notes.

## Testy ochronne

Dodano test modułu potwierdzający renderowanie przez publiczny punkt wejścia i obecność chronionych wyborów:

- single session i ordinary batch;
- Automatic i Automatic + AI Monitor;
- Full RCP, RV Lite i Telepathic Protocol;
- automatic target i external blind.

Rozszerzono test granic architektury, aby blokował:

- powrót `RvSessionPanel` lub `CustomProtocolDialog` do `App.tsx`;
- głębokie importy z `features/rvSessions/`;
- pominięcie publicznego `index.ts`.

Pełna macierz istniejących testów nadal chroni kolejność protokołów, sealed evidence przed Reveal, automatyczny i zewnętrzny Reveal, Monitor, przerwanie, Resume replay, checkpoint Telepathic, Batch oraz Post-Reveal.

## Weryfikacja lokalna

- `npm run verify:source` — zaliczone;
- `npm run typecheck` — zaliczone;
- `npm test -- --run` — **103 pliki testowe / 312 testów**, zaliczone;
- `npm run build` — zaliczone.

Produkcjny build Vite zgłasza wyłącznie istniejące ostrzeżenie o rozmiarze głównego chunka. Kod Rust nie został zmieniony. Natywne testy Rust/Tauri i Clippy pozostają standardową bramką GitHub Actions.

## Wynik dla planu

Wszystkie planowane frontendowe ekstrakcje Etapu 4 istnieją teraz fizycznie. Etap 4 może otrzymać status `COMPLETED` po zielonym GitHub Actions dokładnego kandydata RV Sessions. Następnym planowanym obszarem jest Etap 5 — wewnętrzny podział repository przy zachowaniu publicznej fasady i kompatybilności danych.

