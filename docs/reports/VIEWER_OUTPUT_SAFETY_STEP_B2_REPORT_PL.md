# VIEWER OUTPUT SAFETY — STEP B2

Data: 2026-10-10
Status: **CHANGED FILES — do niezależnego audytu**

## Punkt wejścia

B2 wykonano po zaakceptowanym przez użytkownika i audytora STEP B1 AUDIT FIX 2. SHA-256 dostarczonej nakładki B1 AUDIT FIX 2: `1d69ea4504630a8db79176711d24404853132a93b739480c06001dab88d7e583`.

Rekonstrukcja robocza została utworzona z zaakceptowanego drzewa B1 oraz nakładki AUDIT FIX 2. Nie deklaruje byte-identical z GitHub HEAD; właściwą bramą pozostaje audyt i CI na aktualnej gałęzi.

## Zakres

B2 dotyczy wyłącznie Training blind przed Reveal. Research i renderer Markdown pozostają poza zakresem.

### 1. Durable `blind_running`

`TrainingTargetStage` otrzymał etap `blind_running`. Nowa sesja Training przekazuje `onSessionCreated` do RV Lite. Callback jest awaitowany przez kontroler przed pierwszym wywołaniem Viewera i zapisuje w TrainingRun: targetId, sessionId i etap blind_running.

Jeżeli blind zostanie przerwany, checkpoint nie jest zastępowany nową sesją.

### 2. Resume tej samej sesji

Dla `blind_running` Training ładuje dokładnie sessionId i immutable Session Snapshot. Przed resume sprawdza:

- target/session identity;
- Profile i Workspace;
- provider/model route;
- RV Lite language/variant/version/hash;
- target/reveal hash, jeżeli snapshot go zawiera.

Następnie używa zamrożonych z Session Snapshot:

- requested generation settings;
- Field Guide / pełnego Viewer system promptu;
- Viewer Notes;
- identities;
- continuation route;
- Session Language i wariantu RV Lite.

Nie wykonuje ponownie `prepareFieldGuideForSession` ani `prepareViewerNotesForSession`.

### 3. Reveal crash window

Jeżeli TrainingRun nadal ma `blind_running`, ale powiązana sesja jest już `Revealed`, Training nie wykonuje blind ponownie. Promuje checkpoint do `session_revealed` i korzysta z istniejącego post-Reveal workflow. Chroni to przed ponownym blind oraz podwójnym uczeniem po crashu między Reveal i zapisem checkpointu Training.

### 4. Fail closed

Drift targetu, trasy, Profile/Workspace, protokołu lub brak immutable Session Snapshot zatrzymuje Resume przed provider dispatch. B2 nie tworzy w takim przypadku nowej sesji jako cichego fallbacku.

## Nowe testy

`trainingBlindResume.test.ts` obejmuje:

1. zapis blind_running przez onSessionCreated przed zwrotem przerwanej sesji;
2. Resume tego samego sessionId z zamrożonym Field Guide, Viewer Notes i generation settings, bez odświeżania learning context;
3. crash po trwałym Reveal: brak ponownego runAutomaticRvLiteSession, tylko przejście do session_revealed.

## Schema

Bez migracji SQL. Schema pozostaje 031. Dodana wartość checkpointu jest zgodną wstecznie wartością JSON/type; istniejące rekordy bez blind_running zachowują dotychczasowe zachowanie.

## Kontrole lokalne

- `tsc --noEmit --pretty false`: **PASS, 0 błędów**.
- `npm run verify:ux-data -- --json`: **PASS, 31 migracji**.
- Vitest: **niepotwierdzony lokalnie** — w kopii roboczej brak lokalnego binarnego Vitest, a npx nie ukończył uruchomienia w limicie środowiska.
- `verify:architecture`: **niepotwierdzony z przyczyn środowiskowych** — brak `node_modules/@babel/parser`; selftest kończy się ERR_MODULE_NOT_FOUND przed audytem architektury.
- Rust/UI runtime: nie wykonywano w tym kroku.

## Punkty audytu

Audytor powinien szczególnie sprawdzić:

- czy onSessionCreated faktycznie pozostaje przed pierwszym provider dispatch w RV Lite;
- czy resumeSession nie tworzy drugiej sesji i B1 replay/ledger zachowuje accepted history;
- crash windows wokół utworzenia sesji, snapshotu i checkpointu Training;
- route/target/protocol drift fail-closed;
- dokładnie-once skutki post-Reveal po promocji blind_running -> session_revealed;
- pełny Vitest/typecheck/build/verify:architecture na kompletnej instalacji.

## Następny krok

Nie przechodzić do B3 (Research) przed niezależnym odbiorem B2 i zielonym CI.
