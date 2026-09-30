# AI RV Harness v0.7.13 — UX-DATA-8: Permanent Delete / controlled purge

**Data:** 10 września 2026  
**Etap:** post-Etap-5 UX/data campaign — krok 8  
**Status:** skorygowany kandydat po niezależnym audycie; frontend przyjęty lokalnie, Rust/Tauri wymaga GitHub Actions  
**Baza:** poprawiony UX-DATA-7 `COMPLETED`, niezależny audyt 133/468 oraz GitHub Actions GREEN

## Cel

Dodać świadomy, kontrolowany etap końcowy lifecycle danych:

```text
ACTIVE
  ↓ Archive
ARCHIVED
  ├── Restore → ACTIVE
  └── Delete permanently → PURGED
```

Permanent Delete nie jest zwykłym CRUD `DELETE`. Operacja jest dostępna wyłącznie dla rekordów już zarchiwizowanych i posiada osobny Deletion Preview, domenowe reguły własności oraz jawny use case purge.

Zakres obejmuje:

- Profile;
- Workspace;
- Conversation / Manual RV;
- ordinary RV Session;
- Training Run jako cały pakiet;
- Research project jako cały pakiet;
- My Target.

Training/Research-owned Session nie można usuwać niezależnie. Factory Training Targets pozostają poza lifecycle i nie mogą być trwale usunięte.

## Migracja 023 — controlled purge

Dodano:

`src-tauri/migrations/023_controlled_purge.sql`

Migracja nie usuwa dotychczasowych zabezpieczeń immutable/frozen/locked. Zamiast tego tworzy tabelę kontekstu:

`controlled_purge_context`

oraz przepina wybrane **delete guards** tak, aby pozostawały aktywne w normalnym CRUD i mogły zostać pominięte wyłącznie w jawnej, jednej transakcji controlled purge. Każda operacja purge:

1. otwiera transakcję;
2. ustawia pojedynczy kontekst `id = 1`;
3. wykonuje ściśle określoną sekwencję deletion/detachment;
4. usuwa kontekst przed `COMMIT`;
5. przy błędzie cały zestaw, włącznie z kontekstem, podlega rollback.

Po poprawnym commit baza nie może zawierać aktywnego wiersza `controlled_purge_context`.

Normalne zabezpieczenia nadal blokują m.in.:

- usunięcie immutable Session Snapshot;
- usunięcie frozen Judge score / Judge run;
- usunięcie Locked Research conditions / assignments / blinding;
- usunięcie Research Results;
- usunięcie target clarifications;
- usunięcie użytego My Target zwykłym CRUD;
- usunięcie Viewer Notes versions/activation history;
- **factory Training Target nawet wewnątrz controlled purge**.

## Target history preservation

Permanent Delete użytego My Target nie może wyczyścić historycznej tożsamości celu. Migracja 023 dodaje:

- `rv_sessions.target_id_snapshot`;
- `research_assignments.target_id_snapshot`.

Kolumny są backfillowane z istniejącego `target_id` i uzupełniane przy nowych insertach. Live FK może później przejść na `NULL`, lecz historyczny snapshot ID pozostaje.

SQLite Session/Research mappers korzystają z live `target_id`, a po jego utracie z `target_id_snapshot`.

My Target można usunąć z Archive również wtedy, gdy był już użyty, ale operacja jest blokowana, jeżeli target nadal jest potrzebny przez **niedokończony** Training albo Research. Zakończona historia nie blokuje purge.

## Deletion Preview

Publiczny `AppRepository` otrzymał:

- `previewPermanentDelete(kind, id)`;
- `purgeProfile(id)`;
- `purgeWorkspace(id)`;
- `purgeChatThread(id)`;
- `purgeRvSession(id)`;
- `purgeTrainingRun(id)`;
- `purgeResearchProject(id)`;
- `purgeTarget(id)`.

Preview jest read-only. Pokazuje zakres operacji, m.in. liczbę:

- Profile/Workspace;
- Conversations/Messages;
- RV Sessions i Session Events;
- immutable Snapshots i Reveals;
- Target Clarifications;
- Monitor runs/interventions;
- Judge runs/scores;
- Training Runs;
- Research Projects/Conditions/Assignments/Blinding/Results;
- exports i Workspace Sources;
- Viewer Notes, które zostaną zachowane albo usunięte razem z własnym Profile.

Preview posiada również domenowy `blockedReason`, flagę rekomendacji safety backup i opcjonalną wymaganą frazę potwierdzenia.

## Viewer Notes

UX-DATA-8 wykorzystuje przygotowany w UX-DATA-7 model:

```text
nullable live source reference
+
immutable source snapshot
```

Usunięcie source Session/Training/Research/Workspace:

- nie usuwa Viewer Notes należących do zachowanej AI identity;
- odłącza live Session/Workspace references;
- zachowuje immutable `sourceSnapshot`;
- zachowuje Reflection Runs, Versions i Activation History.

Permanent Delete całego Profile usuwa natomiast AI identities i Viewer Notes należące do tego Profile jako część jego logicznego subtree. Viewer Notes innego Profile, które wskazywały źródła w usuwanym subtree, pozostają i tracą jedynie live reference.

## Profile / Workspace / Conversation

### Profile

Purge wymaga archived Profile i usuwa cały logiczny subtree, w tym Workspaces, Conversations, Sessions, Training, Research, exports/sources oraz Profile-scoped AI identities + Viewer Notes.

### Workspace

Purge wymaga archived Workspace i usuwa cały workspace subtree. Viewer Notes obcych AI identities są zachowywane przez odłączenie live source references.

### Conversation / Manual RV

Purge wymaga archived record i usuwa Conversation/Manual RV wraz z jego Messages. Legacy `ChatThreadGroup` nie wraca do produktu.

## RV Session

Samodzielnie można usunąć tylko ordinary RV Session.

Purge usuwa cały pakiet sesji, w tym:

- events;
- immutable snapshot;
- Reveal;
- target clarifications;
- Monitor run/interventions;
- Judge runs i frozen scores.

Training-owned i Research-owned Session są blokowane w standalone preview/purge i mogą zniknąć wyłącznie razem z właścicielem.

## Training

Purge archived Training Run usuwa cały Training wraz z jego Session IDs oraz aktywnym checkpoint Session, a następnie dane potomne tych sesji. Viewer Notes utworzone na podstawie tych sesji pozostają zachowane według UX-DATA-7.

## Research

Purge archived Research usuwa cały projekt, jego Research Sessions, conditions, assignments, blinding mappings, Research Results, exports oraz Judge data związane z jego sesjami.

Research po Lock lub po wyjściu poza Draft/Preflight wymaga w destructive dialog dokładnej frazy:

`DELETE`

Research Lock, Blinding, Unblind oraz frozen Judge guards pozostają niezmienione dla normalnych operacji. Controlled purge stanowi osobny lifecycle use case i nie odblokowuje ani nie przelicza badania.

## Browser persistence

Browser adapter wykonuje purge jako jedną logiczną zmianę zestawu kluczy localStorage. Przed zapisem przechowuje poprzednie wartości. Jeżeli którykolwiek zapis się nie powiedzie, wcześniej zmienione klucze są przywracane.

Nie jest to transakcja bazodanowa, ale zapobiega pozostawieniu połowicznie zmienionego zestawu danych przy błędzie `setItem`.

## Archive and recovery UI

`Settings → Data → Archive and recovery` otrzymało `Delete permanently` dla wszystkich głównych archived records.

Przepływ:

1. użytkownik wybiera `Delete permanently`;
2. aplikacja pobiera Deletion Preview;
3. jeśli operacja jest zablokowana, wyświetla powód i nie usuwa danych;
4. dla Profile/Workspace/Training/Research można utworzyć opcjonalny safety backup;
5. destructive dialog pokazuje zakres operacji;
6. dla wymagającego Research użytkownik wpisuje `DELETE`;
7. dopiero wtedy wykonywany jest właściwy `purge*()`;
8. archive/recovery listy są odświeżane.

Nie ma bezpośredniej ścieżki `ACTIVE → DELETE` dla głównych rekordów.

## Zachowane granice

UX-DATA-8 nie zmienia:

- protokołów RV;
- blind boundary ani Reveal;
- Monitor prompt/behavior;
- Judge rubric, scoring ani freeze semantics;
- Research Lock, Blinding lub Unblind semantics;
- Viewer Notes reflection prompt/content policy;
- provider transport/retry;
- UX-DATA-6 Archive/Restore contract;
- UX-DATA-7 immutable source snapshots;
- factory Training Targets.

## Walidacja wykonana w środowisku pakowania

Wykonano:

- TypeScript syntax/transpile scan całego `src/`: **323 TS/TSX / 0 błędów**;
- źródło zawiera **135 plików testowych**;
- `node scripts/verify-source-integrity.mjs .`: **PASS** po usunięciu lokalnych `*.tsbuildinfo` powstałych przy niepełnej próbie typecheck;
- migracje SQLite `001–023` na świeżej bazie z `PRAGMA foreign_keys=ON`: **PASS**;
- zwykły DELETE Session z immutable child: **BLOCKED zgodnie z guardem**;
- controlled purge archived Session zawierającej snapshot, clarification i frozen Judge: **PASS**;
- zachowanie Viewer Notes + odłączenie live source Session: **PASS**;
- zwykły DELETE użytego My Target: **BLOCKED**;
- controlled purge użytego My Target z zachowaniem `target_id_snapshot` w Session i Locked Research assignment: **PASS**;
- factory Training Target wewnątrz controlled context: **NADAL BLOCKED**;
- zwykły DELETE Locked Research z immutable result: **BLOCKED**;
- controlled purge Locked Research: **PASS**;
- po commit guardy ponownie aktywne: **PASS**;
- `PRAGMA foreign_key_check`: **0 naruszeń**;
- `controlled_purge_context` po commit: **0 wierszy**.
- Browser controlled-purge runtime smoke, w tym rollback localStorage po błędzie drugiego staged write: **PASS**.

### Niezależny audyt i korekta Profile purge

Niezależny audyt wykrył błąd blokujący SQLite Profile purge. `rv_sessions.profile_id` ma celowo relację `ON DELETE RESTRICT`, więc poleganie wyłącznie na kaskadzie `Profile → Workspace → Session` kończyło transakcję błędem `FOREIGN KEY constraint failed`. Browser adapter nie był dotknięty tym problemem. Skorygowana implementacja jawnie usuwa wszystkie Session z obliczonego i pokazanego w preview zakresu Profile **przed** usunięciem rekordu Profile.

Dodano test regresyjny kolejności. Rzeczywisty test in-memory SQLite po migracjach `001–023`, z `PRAGMA foreign_keys=ON`, potwierdził usunięcie Profile/Workspace/Session oraz **0 naruszeń** w `PRAGMA foreign_key_check`.

Po korekcie: `npm ci` **PASS**, Vitest **135/135 plików i 482/482 testy**, typecheck **PASS**, produkcyjny Vite build **PASS** oraz `verify:source` **PASS**. Rust/Tauri i Clippy nie zostały wykonane lokalnie, ponieważ środowisko audytowe nie zawiera `cargo`; pozostają bramką GitHub Actions.

### Pierwotna walidacja środowiska pakującego

Pełny `npm ci` nie mógł zostać wykonany w tym środowisku, ponieważ wymagany pakiet `zwitch-2.0.4.tgz` nie jest dostępny w lokalnym cache, a środowisko pakujące nie posiada niezawodnego dostępu do rejestru npm. Z tego powodu **nie deklaruje się tutaj wykonania pełnego Vitest/typecheck/Vite build**.

Statycznie kandydat posiada **135 plików testowych**. Na podstawie zielonego UX-DATA-7 `133/468` i 13 dodanych testów UX-DATA-8 oczekiwany wynik pełnego zestawu to **135/481**, ale dokładną liczbę ma potwierdzić niezależny audyt.

Rust/Tauri tests oraz Clippy `-D warnings` pozostają bramką GitHub Actions.

## Uwaga o nazwach Unicode zasobów DOCX

Podczas wcześniejszej pracy pojawił się przejściowy sygnał, że lokalne narzędzie rozpakowujące może prezentować trzy nazwy DOCX jako literalne markery `#U...`. Użytkownik potwierdził, że na jego kanonicznym drzewie Git nazwy są prawidłowe.

W finalnym kandydacie przed pakowaniem ponownie sprawdzono źródło. Pliki są widoczne pod prawidłowymi nazwami Unicode, m.in.:

- `MODUŁ TELEPATIA – PROTOKÓŁ DLA AI VIEWERA 1.1 .docx`;
- `Słownik Percepcyjny Pola dla AI.docx`;
- `TELEPATHY MODULE – PROTOCOL FOR AI VIEWER v1.1.docx`.

`verify-source-integrity` przechodzi. UX-DATA-8 **nie zmienia ani nie przemianowuje tych zasobów**. Niezależny audyt w Work powinien mimo to ponownie sprawdzić nazwy w clean extraction i w kanonicznym Git tree, aby wykluczyć różnice konkretnego narzędzia ZIP.

## Kryterium odbioru

UX-DATA-8 można oznaczyć `COMPLETED`, gdy dokładnie ten kandydat przejdzie:

- niezależny full Vitest;
- project TypeScript typecheck;
- produkcyjny Vite build;
- `verify:source` na clean source;
- migracje/upgrade przez `023`;
- Browser i SQLite controlled-purge contract/integration tests;
- Rust/Tauri tests;
- Clippy `-D warnings`;
- kontrolę, że normalne immutable/frozen/locked guards nadal działają poza purge;
- kontrolę preservation Viewer Notes i target snapshot history;
- clean `PRAGMA foreign_key_check` po reprezentatywnych purge operations.

Po zielonym odbiorze następnym krokiem jest **UX-DATA-9 — final cleanup, documentation and compatibility gate**.
