# MONITOR-STREAM-TELEPATHY-REPAIR — STEP 1

## Zakres

Etap 1 realizuje wyłącznie pierwszy punkt planu: aktywny guard zapętlenia streamingu, rzeczywiste przerwanie bieżącej próby oraz trwałe, ograniczone recovery współdzielone z istniejącą polityką Viewer 16K → 32K.

Nie obejmuje jeszcze:
- deduplikacji prezentacji interwencji Monitora;
- nowych budżetów Telepathic Conversation/Training;
- zmian historii/metryk Telepathy;
- dwukrokowej konfiguracji uczestników i prowadzącego.

## Baza

Aktualny zielony ZIP użytkownika:
`AI-RV-Harness-ai-rv-2 (2).zip`

SHA-256 bazy:
`8c640348be226af3b971e1905932fe49656aadd161de361a14cb6707589944be`

Schema: 031. Migracje 001–031 nie zostały zmienione.

## Implementacja

1. Dodano `src/sessions/streamingRepetitionGuard.ts`.
   - bounded incremental scan: skanowany jest wyłącznie ostatni bufor 24K znaków;
   - kontrola wykonywana jest co 384 nowe znaki, a nie po każdym tokenie;
   - wykrycie `stop` tworzy attempt-local abort i zachowuje sanitizowany partial;
   - zwykły parent/user Abort pozostaje zwykłym Stop i nie jest konwertowany na repetition recovery.

2. `src/providers/requestExecutor.ts` otrzymał neutralny `internalOnStreamEvent`.
   - nie importuje logiki domenowej Sessions;
   - ukryty stream jest włączany dla transportu tylko wtedy, gdy potrzebuje go wewnętrzny guard;
   - dotychczasowy callback UI nadal jest prezentowany tylko dla `presentationMode === live`.

3. `callViewerWithOutputRecovery()` traktuje `repetition_runaway` jako niekompletną próbę semantyczną.
   - pierwsza próba może przejść do istniejącej próby recovery;
   - recovery level 1 kończy krok bez trzeciej próby;
   - `length → repetition` również kończy się po dwóch łącznych próbach;
   - zapisywane są `attemptId`, `recoveryLevel`, requested/effective output budget, providerRequestId jeśli znany, partial, SHA-256 raw outputu oraz rule/length diagnostics;
   - również kompletna odpowiedź non-streaming jest sprawdzana przed akceptacją.

4. Guard został podłączony do Viewer calli w:
   - Full RCP;
   - RV Lite;
   - Custom Protocol;
   - Telepathic RV + Resume.
   Training/Research korzystające z tych kontrolerów dziedziczą ten sam mechanizm bez osobnego retry engine.

5. `viewerResumeLedger` i `resumeReplay` rozpoznają `repetition_runaway` jako ten sam ograniczony poziom recovery co output-limit.
   - restart po recoveryLevel 0 wznawia od poziomu 1;
   - recoveryLevel 1 jest exhausted;
   - ordinary user Stop nie został zmieniony w automatyczne retry.

6. Nowy engine `telepathicExchange` używa tego samego attempt-local guardu.
   - streaming loop zapisuje call jako `failed`, nie `uncertain` ani `succeeded`;
   - zachowany jest partial i `finishReason: repetition_runaway`;
   - odpowiedź non-streaming jest również sprawdzana przed walidacją domenową;
   - istniejący limit dwóch technical attempts pozostaje jedynym retry ceiling.

7. Zaktualizowano boundary hash Telepathic Viewer execution w `postRevealContextBoundary.test.ts`. Monitor prompt contract pozostaje osobno zamrożony.

## Testy dodane / rozszerzone

- incremental stream split across deltas (`our`);
- poprawny długi materiał RV + etykiety + fenced drawing nie jest zatrzymywany;
- parent/user abort nie staje się repetition;
- faktyczny attempt signal zostaje abortowany i nie uruchamia physical transport retry;
- repetition → udane recovery;
- length → repetition → brak trzeciej próby;
- streaming repetition → recovery;
- durable Resume po pierwszym repetition i exhaustion po drugim;
- recoverability po interruption level 0 vs level 1;
- Telepathic Exchange streaming repetition jako failed technical attempt;
- Telepathic Exchange non-streaming repetition jako failed technical attempt.

## Kontrole lokalne

- TypeScript parser/transpile dla 18 zmienionych plików: PASS (0 błędów składniowych).
- Manual runtime smoke incremental guard: PASS. Pętla `our ` została zatrzymana przy 384 znakach; rule `repeated-tail-block`; partial zawiera marker truncation.
- `verify:ux-data`: PASS, 31 migracji.
- `verify:v0.7.14-release-gate`: PASS.
- `verify-source-integrity-selftest`: PASS.
- `verify:source`: FAIL na bazie i po patchu z identycznym zestawem wcześniejszych problemów ZIP-a (escaped `#U...` filenames oraz trzy brakujące document paths). Diff wyników base vs patched = identyczny.
- Architecture gate: niewykonany, ponieważ lokalne `node_modules` nie są dostępne (`@babel/parser` missing).
- Pełny Vitest/typecheck/build: niewykonane. `npm ci` przekroczył limit środowiska; `npm ci --offline` potwierdził brak `zwitch-2.0.4` w cache.
- Native/OpenRouter continuation bridge: niewykonany lokalnie, ponieważ wymaga Vitest po `npm ci`.

Patch należy więc traktować jako **STEP 1 candidate do pełnego CI/audytu**, a nie jako certyfikat końcowy całego planu.
