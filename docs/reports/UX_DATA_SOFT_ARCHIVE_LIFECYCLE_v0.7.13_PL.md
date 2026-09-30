# AI RV Harness v0.7.13 — UX-DATA-6: Soft Archive / Restore dla brakujących typów danych

**Data:** 9 września 2026  
**Etap:** post-Etap-5 UX/data campaign — krok 6  
**Status:** kandydat lokalny przygotowany do niezależnego audytu i GitHub Actions  
**Baza:** UX-DATA-5 `COMPLETED`, GitHub Actions GREEN

## Cel

Rozszerzyć istniejący model soft archive tak, aby brakujące główne typy danych mogły przechodzić przez bezpieczny lifecycle:

```text
ACTIVE
  ↓ Archive
ARCHIVED
  └── Restore → ACTIVE
```

Ten krok **nie implementuje Permanent Delete / purge**. Nie zmienia też modelu Viewer Notes source preservation, który pozostaje zakresem UX-DATA-7.

## Zakres UX-DATA-6

Soft Archive / Restore dodano dla:

- ordinary RV Sessions;
- Training Runs;
- Research projects;
- My Targets.

Centralne `Settings → Data → Archive and recovery` pokazuje teraz również te cztery grupy obok istniejących Profile, Workspace i Conversation / Manual RV.

## Migracja 021

Dodano:

`src-tauri/migrations/021_soft_archive_lifecycle.sql`

Migracja dodaje nullable `archived_at` do:

- `rv_sessions`;
- `training_runs`;
- `research_projects`;
- `targets`.

Dodano indeksy archiwum dla odpowiednich ścieżek listowania.

Migracja nie usuwa danych, nie modyfikuje tabel Viewer Notes i nie dodaje żadnej operacji purge.

## Ordinary RV Sessions

Dodano publiczne operacje:

- `listArchivedRvSessions()`;
- `archiveRvSession(id)`;
- `restoreRvSession(id)`.

Aktywne listy i Home nie zwracają zarchiwizowanych sesji.

Restore wymaga istniejącego i aktywnego Profile oraz Workspace.

Sesja należąca do Training albo Research nie może być zarządzana niezależnie przez publiczny lifecycle ordinary RV Session. Takie sesje są archiwizowane i przywracane przez właścicielski Training/Research.

## Training

Dodano:

- `listArchivedTrainingRuns()`;
- `archiveTrainingRun(id)`;
- `restoreTrainingRun(id)`.

Archive Training obejmuje logicznie Training Run i należące do niego RV Sessions, w tym sesję aktywnego checkpointu, jeżeli istnieje.

Restore odtwarza Training wraz z jego zarchiwizowanymi sesjami i wymaga aktywnego Profile oraz Workspace.

Checkpointy, Viewer/Judge dane, snapshoty i stan Training nie są przeliczane ani resetowane przez Archive/Restore.

## Research

Dodano:

- `listArchivedResearchProjects()`;
- `archiveResearchProject(id)`;
- `restoreResearchProject(id)`.

Archive/Restore Research obejmuje jego Research Sessions jako własność całego projektu.

Nie zmienia się:

- `state` projektu;
- Experiment Lock;
- config hash;
- blinding mappings;
- frozen scores;
- unblinding state.

Zarchiwizowanie i późniejsze przywrócenie Research nie „odblokowuje” eksperymentu.

## My Targets

Dla wszystkich `collection = user` aktywna ścieżka produktu została zmieniona z bezpośredniego Delete na:

```text
My Target → Archive → Archive and recovery → Restore
```

Dodano:

- `listArchivedTargets()`;
- `archiveTarget(id)`;
- `restoreTarget(id)`.

Factory/bundled Training Targets pozostają immutable i nie są dostępne dla Archive/Restore.

Użyty My Target może zostać zarchiwizowany bez zmiany historycznych Session/Training/Research records. Permanent Delete użytego targetu pozostaje osobnym problemem UX-DATA-8 po zabezpieczeniu wymaganych snapshotów.

## UI

Dodano Archive do aktywnych widoków:

- RV Sessions;
- Training;
- Research;
- My Targets.

`Archive and recovery` prezentuje grupy:

- Profiles;
- Workspaces;
- Conversations / Manual RV;
- RV Sessions;
- Training;
- Research;
- My Targets.

Przywracanie dziecka jest blokowane, jeżeli wymagany nadrzędny Profile/Workspace nie jest aktywny. Warstwa repository również egzekwuje te zależności.

## Świadomie niewykonane

UX-DATA-6 nie implementuje:

- Delete permanently;
- purge use cases;
- Deletion Preview;
- safety backup przed purge;
- Viewer Notes source-preservation migration;
- fizycznego usuwania legacy Thread schema;
- zmian provider transport/retry;
- zmian protokołów RV, blind boundary lub Reveal;
- zmian Judge scoring/freeze;
- zmian Research Lock/Blinding/Unblind.

## Walidacja lokalna

W aktualnym środowisku wykonano:

- `npm run verify:source` — **PASS**;
- parser/syntax TypeScript całego `src/` — **317 TS/TSX / 0 błędów składni**;
- zastosowanie wszystkich SQLite migrations `001–021` na świeżej bazie — **PASS**;
- potwierdzenie `archived_at` dla czterech tabel — **PASS**;
- potwierdzenie czterech indeksów archive — **PASS**;
- kontrolę braku `node_modules`, `dist` i `*.tsbuildinfo` w finalnym źródle — wymagana przy pakowaniu;
- kontrolę braku nowych publicznych purge/delete-permanently APIs w UX-DATA-6.

Pełny Vitest, project TypeScript typecheck, Vite build oraz natywne Rust/Tauri/Clippy muszą zostać potwierdzone w niezależnym odbiorze / GitHub Actions. Lokalne środowisko nie posiada toolchainu Rust, a instalacja zależności npm nie została ukończona.

## Testy

Kandydat dodaje nowy boundary test:

`src/uxDataSoftArchiveBoundary.test.ts`

oraz rozszerza contract tests Sessions, Training, Research i Targets o reguły Archive/Restore oraz ownership boundaries.

Ostatni zielony baseline UX-DATA-5 ma **131 plików / 453 testy**. Kandydat UX-DATA-6 ma **132 pliki testowe**; dokładny licznik wykonanych testów należy przyjąć z pełnego Vitest podczas niezależnego odbioru, a nie z prostego statycznego zliczania deklaracji.

## Kryterium odbioru

UX-DATA-6 można oznaczyć `COMPLETED`, gdy dokładnie ten kandydat przejdzie:

- pełny Vitest;
- pełny TypeScript typecheck;
- produkcyjny Vite build;
- `npm run verify:source`;
- Rust/Tauri tests;
- Clippy z `-D warnings`;
- smoke/compatibility dla migracji `001–021` na bazie upgrade z UX-DATA-5.

Po zielonym odbiorze następny krok to:

**UX-DATA-7 — Viewer Notes source preservation.**
