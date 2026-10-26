# AI RV Harness v0.7.14 — VIEWER OUTPUT SAFETY STEP B1
## Durable Viewer Resume ledger, exact step identity i restart-safe recovery

Data: 2026-10-10. Status implementacji: **B1 COMPLETE / READY FOR INDEPENDENT AUDIT**. Nie oznacza to jeszcze CI PASS ani runtime smoke PASS.

## Baza

Rekonstrukcja zaakceptowanego punktu wejścia została wykonana z:

- `AI-RV-Harness-ai-rv-2.zip` SHA-256 `e48feec377f883ffe8ae901d3310c12f01bd25f511760ca35ea3a16a6a093c8b`;
- kolejno nałożonych zaakceptowanych paczek STEP A: `STEP_A_CHANGED_FILES`, `STEP_A_AUDIT_FIX`, `STEP_A_AUDIT_FIX_2`, `STEP_A_AUDIT_FIX_3`, `STEP_A_CI_BOUNDARY_FIX`.

Użytkownik potwierdził, że ostatni GitHub Actions dla STEP A był zielony. Rekonstrukcja lokalna nie jest deklarowana jako byte-identical z aktualnym GitHub HEAD; audytor powinien porównać nakładkę z aktualną gałęzią przed merge.

Schema pozostaje **031**. B1 nie dodaje migracji.

## Zakres B1

B1 zamyka trwałe wznowienie output-recovery Viewera w RCP, RV Lite, Custom oraz Telepathic bez resetowania semantycznego recovery po restarcie aplikacji.

### 1. Dokładna tożsamość kroku

Dodano `viewerResumeLedger.ts`. Każde nowe wywołanie Viewera otrzymuje trwały `stepId`, który rozróżnia:

- rodzinę kontrolera (`rcp`, `lite`, `custom`, `telepathic`);
- phase/prompt/step;
- zwykłą odpowiedź Viewera;
- Special Task;
- Monitor intervention wraz z `exchangeNumber`;
- pytania telepatyczne wraz z `questionNumber`, jeśli występuje.

Nie opieramy Resume na samym indeksie assistant messages.

### 2. Fingerprint tego samego wejścia

Przed wywołaniem zapisywany jest `requestSha256` semantycznej historii wiadomości. Fingerprint obejmuje role/content/images, ale celowo nie obejmuje provider-specific `continuationState`, ponieważ ten stan jest rekonstruowany osobno przez istniejący mechanizm continuation.

Resume z zapisanym recovery jest dozwolone tylko wtedy, gdy odtworzone wejście ma ten sam fingerprint. Drift powoduje fail-closed przed dispatch.

### 3. Trwały start próby i crash window

Przed fizycznym wywołaniem providera zapisywane jest zdarzenie `VIEWER_OUTPUT_ATTEMPT_STARTED` z:

- `stepId`;
- `requestSha256`;
- `semanticAttempt`;
- `recoveryLevel`;
- requested/effective max output.

W `createSessionReplay()` zapis startu jest tłumiony podczas odtwarzania już zaakceptowanych kroków. Gdy replay dochodzi do pierwszego brakującego kroku, próba Viewer powoduje przejście do live, zapis `SESSION_RESUMED`, a następnie trwały `VIEWER_OUTPUT_ATTEMPT_STARTED` **przed** provider dispatch.

Jeśli proces padnie po tym zapisie, ale przed trwałym wynikiem, ledger uznaje próbę za `uncertain` i blokuje automatyczny resend. Nie ma cichego podwójnego płatnego wywołania.

### 4. Recovery po restarcie

`callViewerWithOutputRecovery()` obsługuje zweryfikowany start od `recoveryLevel=1`.

Scenariusz:

- primary 16K kończy się `length` i zostaje trwale zapisane;
- aplikacja zostaje zamknięta;
- Resume odtwarza wcześniejsze zaakceptowane kroki;
- dokładnie ten sam niedokończony krok rozpoczyna się od recovery 32K, bez ponownego 16K.

Jeżeli efektywny recovery budget nie jest większy od zapisanego primary budget, helper zatrzymuje krok bez identycznego płatnego dispatch.

Jeżeli wcześniej trwale zapisano drugą próbę recovery, automatyczny licznik nie resetuje się po restarcie. Ledger zwraca `exhausted` i blokuje nową parę 16K/32K.

### 5. Accepted i legacy

Accepted Viewer events nowych prób dziedziczą `stepId` przez accepted metadata. Partial/incomplete nadal nie trafia do zaakceptowanej historii.

Stare `VIEWER_RESPONSE` z `length` pozostają barierą replay zgodnie ze STEP A. Dla legacy unresolved attempt bez dokładnego `stepId` B1 działa konserwatywnie: jeżeli odpowiada bieżącemu krokowi, automatyczny paid Resume jest blokowany zamiast zgadywania. Legacy incomplete rozstrzygnięte późniejszym poprawnym accepted event nie blokuje wcześniejszych replayowanych kroków.

### 6. Telepathic

Ta sama polityka została podłączona do zwykłego `runAutomaticTelepathicSession` używanego przez RV Sessions Resume oraz do osobnej ścieżki `resumeTelepathicManualQuestionStage`.

## Zmienione pliki produkcyjne

- `src/sessions/viewerResumeLedger.ts` — nowy trwały ledger i step/request identity;
- `src/sessions/viewerOutputRecovery.ts` — start od recovery level 1, previous budget, attempt-start hook;
- `src/sessions/resumeReplay.ts` — atomowa granica replay → live dla trwałego attempt-start;
- `src/sessions/controller.ts` — RCP wiring;
- `src/sessions/rvLiteController.ts` — Lite wiring;
- `src/sessions/customController.ts` — Custom wiring;
- `src/sessions/telepathicController.ts` — Telepathic wiring.

## Testy / boundary

- `viewerResumeLedger.test.ts`: step identity, fingerprint bez continuation payload, primary→recovery, exhausted recovery, uncertain start, request drift;
- `viewerOutputRecovery.test.ts`: resume bez ponownego primary oraz brak identycznego recovery przy clamp;
- `resumeReplay.test.ts`: attempt-start zapisuje się dopiero na granicy replay→live i przed providerem;
- `postRevealContextBoundary.test.ts`: hash Telepathic Viewer-only wiring zaktualizowany po celowej zmianie B1; Monitor prompt contract pozostaje osobno chroniony.

## Weryfikacja lokalna

- `verify:ux-data`: **PASS**, 31 migracji;
- runtime smoke samego ledgeru po transpile: **PASS** dla `primary_limit`, `uncertain`, `exhausted`, fingerprint drift oraz ignorowania continuation payload w fingerprint;
- source-contract smoke dla wszystkich czterech kontrolerów i replay boundary: **PASS**;
- syntaktyczna transpilacja wszystkich 11 zmienionych TS/TS test/production files: **PASS**;
- dodatkowy production-only TypeScript check z lokalnymi stubami brakujących pakietów zewnętrznych: **PASS** dla siedmiu zmienionych plików produkcyjnych i ich wewnętrznego grafu zależności.

Pełny `npm ci` nie ukończył się w środowisku roboczym z powodu timeoutu transportu, dlatego **nie deklaruję pełnego Vitest/typecheck/build PASS lokalnie**. GitHub Actions pozostaje właściwą bramką.

`verify:source` na rozpakowanej rekonstrukcji zgłasza escaped-Unicode/documents paths. Ten sam zestaw błędów występuje na nietkniętej rekonstruowanej bazie STEP A; diff wyników base vs B1 jest pusty. B1 nie wprowadza tego problemu.

## Kryteria audytu

Audyt powinien przede wszystkim potwierdzić:

1. P1 accepted → P2 primary length → restart → P1 replay → P2 tylko recovery 32K.
2. P2 recovery length → restart → zero provider dispatch.
3. Crash po `VIEWER_OUTPUT_ATTEMPT_STARTED`, przed durable result → zero automatic resend.
4. Request fingerprint drift → zero provider dispatch.
5. Special Task i Monitor exchanges mają różne `stepId`.
6. Telepathic repeated calls/question numbers nie zderzają się w ledgerze.
7. `SESSION_RESUMED` i `VIEWER_OUTPUT_ATTEMPT_STARTED` zapisują się na właściwej granicy, a replay starych accepted odpowiedzi nie tworzy fałszywych attempt-start events.
8. Existing continuation-state hydration, cost guard, transport retry, Conversation i post-Reveal pozostają bez regresji.

## Poza B1

B1 nie implementuje jeszcze Training blind checkpoint ani Research same-assignment Resume. To są osobne kroki B2 i B3 zgodnie z planem. Nie zmieniono Markdown isolation/resource guard.
