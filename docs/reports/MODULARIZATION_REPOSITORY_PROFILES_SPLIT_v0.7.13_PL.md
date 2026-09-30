# AI RV Harness v0.7.13 — raport pierwszego podziału repository: Profiles

**Data:** 6 września 2026  
**Etap planu:** Etap 5 — podział repository  
**Zakres:** pierwszy kontrolowany podział Profiles bez zmiany publicznej fasady i danych

## 1. Punkt wejścia

Użytkownik potwierdził zielony GitHub Actions dla dokładnego kandydata RV Sessions. Tym samym wszystkie zaplanowane ekstrakcje frontendowe Etapu 4 są zakończone i można rozpocząć Etap 5 od najmniej ryzykownego obszaru wskazanego w planie: Profiles.

## 2. Wykonana granica

Dodano wewnętrzny kontrakt:

- `src/storage/contracts/profilesRepository.ts`

oraz dwie implementacje:

- `src/storage/browser/profilesRepository.ts`;
- `src/storage/sqlite/profilesRepository.ts`.

`BrowserRepository` i `SqliteRepository` pozostają publicznymi fasadami zgodnymi z `AppRepository`. Delegują do nowych modułów wyłącznie operacje dotyczące danych Profile:

- listę aktywnych i zarchiwizowanych Profilów;
- tworzenie oraz edycję;
- pełną konfigurację AI Profile;
- wąski zapis promptu Monitora;
- przypisanie credential i wyzerowanie nieaktualnych ustawień Viewera.

## 3. Jawna transakcja Profile–Workspace

`archiveProfile` i `restoreProfile` celowo nie zostały ukryte w `ProfilesRepository`. Obie operacje zmieniają także Workspaces i zachowują istniejącą semantykę wspólnego znacznika czasu. SQLite nadal wykonuje je atomowo przez dotychczasową jednostkę transakcyjną, a browser storage zachowuje istniejący format i regułę odtwarzania wyłącznie potomków zarchiwizowanych razem z Profile.

To realizuje zasadę planu: repozytorium domenowe nie wykonuje ukrytych zmian w innym obszarze.

## 4. Zgodność danych i publicznego API

Nie zmieniono:

- `AppRepository` ani sposobu tworzenia repository;
- schematu SQLite i migracji;
- nazw tabel, kolumn i zapytań;
- klucza browser storage `rvh.dev.profiles`;
- kształtu serializowanego `Profile`;
- działania archive/restore;
- żadnego ekranu, promptu, przepływu AI, eksportu ani providera.

## 5. Testy

Dodano wspólny zestaw testów kontraktowych uruchamiany wobec obu implementacji. Chroni on:

- normalizację pól podczas tworzenia i edycji;
- kolejność aktywnych i zarchiwizowanych rekordów;
- pełny zapis konfiguracji AI;
- wąski zapis promptu Monitora bez utraty innych pól;
- zmianę credential wraz z wyzerowaniem zależnych ustawień Viewera;
- obecność delegacji i pozostawienie jawnych operacji lifecycle w fasadach.

Walidacja lokalna zakończyła się wynikiem:

- **105 plików testowych / 319 testów** — zaliczone;
- TypeScript typecheck — zaliczony;
- produkcyjny build Vite — zaliczony;
- `verify:source` — zaliczony po usunięciu generowanych `*.tsbuildinfo`;
- czysta aplikacja nakładki na baseline RV Sessions i ponowna pełna walidacja — zaliczona.

Rust/Tauri oraz Clippy pozostają bramką GitHub Actions dla dokładnego kandydata. Zmiana nie dotyka kodu Rust ani schematu bazy.

## 6. Dokumentacja architektury

Zaktualizowano `CODE_MAP.md`, `MODULE_BOUNDARIES.md` i indeks dokumentacji architektury. Dodano `ADR-0003-STORAGE_FACADE.md`, który utrwala decyzję o stabilnej fasadzie, dwóch adapterach i jawnym właścicielu operacji przekraczających domeny.

## 7. Następny krok

Po zielonym GitHub Actions dla tego kandydata kolejnym małym obszarem Etapu 5 są **Targets**. Przed jego przeniesieniem należy opisać wspólnym kontraktem listowanie, CRUD kolekcji użytkownika, ochronę targetów fabrycznych oraz zapis usage, bez zmiany schematu.
