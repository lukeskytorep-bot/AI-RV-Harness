# VIEWER OUTPUT SAFETY — STEP B3 — Research same-assignment Resume

Data: 2026-10-10

## Cel

B3 zmienia odzyskiwanie przerwanych sesji Research tak, aby Resume kontynuowało dokładnie tę samą sesję i ten sam zablokowany assignment, z wykorzystaniem istniejącego B1 replay. Nie zmienia Experiment Lock, blinding map, kolejności assignmentów ani zasad Judge/Unblind.

## Zakres

- `src/research/engine.ts`
- `src/research/engine.test.ts`
- `src/research/researchResume.integration.test.ts`
- `src/features/research/ResearchBuilder.tsx`
- `src/i18n/research.ts`

## Zachowanie

1. Przerwany assignment zachowuje `sessionId`.
2. Jawna zgoda recovery ustawia `ResumeApproved`; nie odłącza starej sesji i nie tworzy nowego attemptu.
3. `executeResearchSessions()` ładuje trwałą sesję i Session Snapshot, sprawdza target/project/workspace/profile/provider/model/protokół/generation settings/Viewer Notes/prompt condition, następnie używa `createSessionReplay()`.
4. Zaakceptowane kroki są replayowane. Pierwszy brakujący krok przechodzi do B1 live recovery z trwałym recovery level i continuation state.
5. Target Reveal jest odtwarzany i sprawdzany względem `automaticRevealHash`; drift zatrzymuje Resume.
6. Jeśli sesja została już trwale Revealed przed awarią, assignment jest reconciled do `SessionComplete` bez ponownego Viewer dispatchu, po sprawdzeniu/uzupełnieniu `REVEAL_ACCEPTED` i target usage.
7. Po udanym Resume assignment staje się `SessionComplete` dopiero po potwierdzeniu trwałego Reveal i target usage.
8. Twardy crash może pozostawić projekt jako `Running`; UI wykrywa wtedy zachowaną nieukończoną sesję i nadal wymaga jawnej zgody na Resume.
9. Jawny restart jest oddzielną funkcją `prepareInterruptedResearchRestart()`: stara partial session pozostaje Interrupted w audycie, a dopiero assignment zostaje odłączony i oznaczony `RestartApproved`. Nie jest to używane przez zwykły Resume.
10. Legacy `RetryApproved` bez `sessionId` pozostaje zgodny jako stary restart; B3 nie próbuje zgadywać utraconego powiązania historycznej sesji.

## UI

Dotychczasowy recovery button został semantycznie zmieniony z „approve retry” na „approve same-session Resume”. Po `ResumeApproved` przycisk Resume Research może kontynuować projekt. Nie dodano nowego stałego przycisku restartu.

## Testy dodane / zmienione

- unit: zgoda recovery zachowuje ten sam `sessionId` i ustawia `ResumeApproved`;
- unit: explicit restart ma inną semantykę, zachowuje partial session i dopiero wtedy odłącza assignment;
- integration: prawdziwy RV Lite: `P1 accepted → P2 length → interruption → approval → replay P1 → P2 recovery 32K`, bez zmiany `assignmentId`/`sessionId` i bez dublowania P1.

## Kontrole lokalne

- `npx tsc --noEmit -p tsconfig.json` — PASS, 0 błędów.
- `npm run verify:ux-data --silent` — PASS, schema 031 / 31 migracji.
- `verify:architecture` — niepotwierdzone lokalnie: rekonstrukcja nie zawiera `@babel/parser` w `node_modules`.
- pełny Vitest/build — nie oznaczono jako PASS lokalnie z powodu braku kompletnego `node_modules`; właściwą bramą jest audyt/CI.

## Niezmienione granice

- brak migracji SQL;
- Research nadal nie aktualizuje Field Guide ani Viewer Notes;
- Experiment Lock i blinding map nie są regenerowane podczas Resume;
- Judge i unblind nie zostały zmienione;
- B1 retry/uncertain-dispatch pozostaje jedynym mechanizmem wznowienia kroków Viewera.

## Warunek odbioru

Audyt powinien szczególnie sprawdzić:

- ten sam assignment i sessionId po Resume;
- P1 replay / P2 recovery 32K bez ponownego P1;
- uncertain dispatch nie powoduje resend;
- sesja już Revealed jest reconciled bez nowego Viewer dispatchu;
- target/protocol/prompt/settings drift zatrzymuje Resume;
- restart i Resume nie są mylone;
- pełny Vitest, typecheck, build, verify:ux-data i verify:architecture przechodzą na dokładnej gałęzi.
