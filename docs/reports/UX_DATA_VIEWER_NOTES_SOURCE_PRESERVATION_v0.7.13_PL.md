# AI RV Harness v0.7.13 — UX-DATA-7: Viewer Notes source preservation

**Data:** 9 września 2026  
**Etap:** post-Etap-5 UX/data campaign — krok 7  
**Status:** kandydat poprawiony po niezależnym audycie; oczekuje na GitHub Actions  
**Baza:** UX-DATA-6 `COMPLETED`, GitHub Actions GREEN

## Cel

Przygotować historię Viewer Notes na przyszły kontrolowany Permanent Delete z UX-DATA-8 tak, aby usunięcie źródłowej Session, Training lub Workspace nie wymuszało usunięcia ani przepisywania Viewer Notes / Viewer Notes History.

UX-DATA-7 rozdziela dwa pojęcia:

```text
LIVE SOURCE REFERENCE
        +
IMMUTABLE SOURCE SNAPSHOT
```

Live reference może w przyszłości zostać odłączone od usuniętego rekordu. Historyczny snapshot źródła pozostaje niezmienny i czytelny.

Ten krok **nie implementuje Permanent Delete ani purge**.

## Migracja 022

Dodano:

`src-tauri/migrations/022_viewer_notes_source_preservation.sql`

oraz rejestrację migracji `22` w `src-tauri/src/lib.rs`.

Migracja przebudowuje tabele provenance Viewer Notes tak, aby:

- `ai_note_reflection_runs.source_session_id` i `source_workspace_id` były nullable oraz używały `ON DELETE SET NULL`;
- `ai_note_versions.source_session_id` i `source_workspace_id` były nullable oraz używały `ON DELETE SET NULL`;
- reflection runs i note versions posiadały wymagany `source_snapshot_json`;
- istniejące rekordy otrzymały snapshot z danych historycznej Session/Workspace/protocol oraz Training ownership, jeżeli było dostępne;
- activation history mogła technicznie odłączyć source Session/Workspace bez zmiany innych pól;
- append-only guards nadal blokowały edycję contentu, hashes, change summary i snapshotu.

Dla samoreferencyjnego `base_version_id` migracja zachowuje bezpieczną kolejność kopiowania danych i usuwa stare połączenie wyłącznie w tabeli tymczasowej po skopiowaniu nowych rekordów, tak aby stara tabela mogła zostać usunięta przy aktywnym foreign-key enforcement.

## Immutable source snapshot

Dodano typ `ViewerNoteSourceSnapshot`.

Snapshot przechowuje w miarę dostępności:

- schema version;
- source session ID;
- session code;
- Workspace ID i nazwę;
- Profile ID;
- Training Run ID / numer / nazwę, jeżeli Reflection pochodzi z Training;
- protocol ID i version;
- session run type;
- czas capture.

Snapshot powstaje podczas nowej Reflection na podstawie faktycznej Session, Workspace i Training ownership. Następnie jest zapisany razem z Reflection Run i kopiowany do aktywowanej Viewer Note Version.

Niezależny audyt wykrył, że pierwotny backfill SQLite zachowywał Training ownership wyłącznie dla nowych Reflection. Migracja `022` została skorygowana: dla historycznych rekordów odtwarza teraz Training Run ID, numer i nazwę zarówno z `sessionIds`, jak i z aktywnego checkpointu zapisanego w `training_runs.record_json`.

Dla historycznych Browser-storage records bez snapshotu repozytorium posiada kompatybilny fallback, dzięki któremu przed odłączeniem live reference zapisuje minimalny snapshot istniejących danych źródłowych.

## Live source references

Live references pozostają użyteczne tak długo, jak źródłowy rekord istnieje. UX-DATA-7 dodaje techniczną operację repository:

`detachViewerNoteSourceReferences(...)`

Operacja:

- nie usuwa Viewer Notes;
- nie usuwa Reflection Runs;
- nie usuwa Versions ani Activation History;
- nie zmienia contentu ani source snapshotu;
- odłącza wyłącznie live Session/Workspace references.

SQLite dodatkowo wspiera ten model przez `ON DELETE SET NULL`. Operacja repository jest potrzebna również dla Browser adaptera oraz przyszłego kontrolowanego purge z UX-DATA-8.

## Viewer Notes domain

Nowa Reflection tworzy source snapshot dopiero po sprawdzeniu istniejącego idempotentnego run. Nie zwiększa to kosztu ścieżki ponownego odczytu już zakończonej Reflection.

Training metadata jest rozpoznawane przez ownership Session w Training Run, w tym aktywny checkpoint.

Historyczne snapshoty zapisane w istniejących Session/Research records pozostają nietknięte.

## UI

AI Center → Viewer Notes pokazuje źródło historycznej wersji/reflection z immutable snapshotu.

Jeżeli live source nadal istnieje, UI może używać aktywnego powiązania. Jeżeli live reference zostało odłączone, historia nadal pokazuje snapshot i oznaczenie:

- PL: `rekord źródłowy usunięty`;
- EN: `source record deleted`.

Opis AI Center został zaktualizowany tak, aby wyjaśniał różnicę między live reference i trwałym provenance snapshot.

## Zachowane granice metodologiczne

UX-DATA-7 nie zmienia:

- protokołów RV ani kolejności ich kroków;
- blind boundary ani Reveal;
- Viewer Notes content policy / reflection prompt;
- Judge scoring ani frozen results;
- Research Lock, Blinding ani Unblind;
- Monitor behavior;
- Soft Archive/Restore z UX-DATA-6;
- factory Training Targets;
- provider transport/retry.

## Świadomie niewykonane

Ten krok nie dodaje:

- `purgeProfile`;
- `purgeWorkspace`;
- `purgeRvSession`;
- `purgeTrainingRun`;
- `purgeResearchProject`;
- `purgeUserTarget`;
- Delete Permanently w UI;
- Deletion Preview;
- safety backup przed deletion.

To pozostaje zakresem UX-DATA-8.

## Walidacja lokalna

W aktualnym środowisku wykonano:

- `node scripts/verify-source-integrity.mjs .` — **PASS**;
- TypeScript transpile/syntax całego `src/` — **318 TS/TSX / 0 błędów składniowych**;
- SQLite migrations `001–022` na świeżej bazie z `PRAGMA foreign_keys=ON` — **PASS**;
- migrację historycznego Viewer Notes z wieloma wersjami i `base_version_id` — **PASS**;
- `PRAGMA foreign_key_check` po migracji — **0 naruszeń**;
- usunięcie testowej source Session — live Session refs przechodzą na `NULL`, snapshot pozostaje bez zmian — **PASS**;
- późniejsze usunięcie source Workspace — live Workspace refs przechodzą na `NULL`, Viewer Notes/History pozostają — **PASS**;
- próba edycji contentu historycznej Version po migracji — nadal blokowana przez append-only guard — **PASS**;
- próba niedozwolonej edycji Activation History — nadal blokowana — **PASS**.
- historyczny Training ownership (`trainingRunId`, numer i nazwa) podczas upgrade — **PASS po korekcie audytowej**;
- pełny Vitest — **133/133 pliki, 468/468 testów PASS**;
- project TypeScript typecheck — **PASS**;
- produkcyjny Vite build — **PASS**.

Natywne Rust/Tauri tests oraz Clippy pozostają do GitHub Actions, ponieważ środowisko niezależnego audytu nie posiada `cargo`.

## Testy kandydata

Zielony UX-DATA-6 baseline ma **132 pliki / 461 testów**.

UX-DATA-7 dodaje nowy test graniczny/persistence:

`src/storage/viewerNotesSourcePreservation.test.ts`

oraz rozszerza:

- AI Center repository contract;
- Viewer Notes domain tests;
- repository boundary tests;
- bootstrap fixtures.

Statycznie kandydat zawiera **133 pliki testowe / oczekiwane 468 testów**. Dokładny wynik należy przyjąć z pełnego Vitest podczas niezależnego audytu.

## Kryterium odbioru

UX-DATA-7 można oznaczyć `COMPLETED`, gdy dokładnie ten kandydat przejdzie:

- pełny Vitest;
- pełny TypeScript typecheck;
- produkcyjny Vite build;
- `verify:source`;
- upgrade/migration compatibility `001–022`;
- Rust/Tauri tests;
- Clippy `-D warnings`;
- kontrolę, że odłączenie źródła nie modyfikuje immutable Viewer Notes provenance.

Po zielonym odbiorze następny krok to:

**UX-DATA-8 — Permanent Delete / controlled purge.**
