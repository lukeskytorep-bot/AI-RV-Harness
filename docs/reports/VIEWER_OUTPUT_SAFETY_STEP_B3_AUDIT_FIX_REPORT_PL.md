# VIEWER OUTPUT SAFETY — STEP B3 AUDIT FIX

Data: 2026-10-10
Zakres: Research same-assignment Resume po audycie B3.

## Co poprawiono

1. **Polityka recovery a Experiment Lock**
   - Nowe Research zamraża w każdej condition `viewerOutputPolicy` v1.
   - Polityka zawiera `initialTokens`, `recoveryTokens` i `preserveConfiguredBudget`.
   - Dla standardowego nowego Research 16 384 → 32 768 staje się częścią zablokowanej metodologii.
   - Stare locked projekty bez `viewerOutputPolicy` zachowują legacy single-budget przez dotychczasowe `preserveConfiguredBudget` i nie są po cichu podnoszone do 32K.
   - Snapshot sesji zapisuje dokładnie zamrożoną politykę; Resume odrzuca drift względem Experiment Lock.

2. **Trwała inicjalizacja Research dla Full RCP i RV Lite**
   - Przed wejściem do kontrolera assignment rezerwuje deterministyczny `sessionId` i przechodzi do `Initializing`.
   - Full RCP otrzymał `sessionIdentity` analogiczne do Lite.
   - Oba kontrolery obsługują dokończenie inicjalizacji istniejącej sesji bez drugiego INSERT.
   - Session Snapshot jest zapisywany przed callbackiem `onSessionCreated`, który dopiero wtedy promuje assignment do `Running`.
   - Po crashu przed utworzeniem sesji lub po utworzeniu session row, ale przed snapshotem, użytkownik może zatwierdzić Resume i dokończyć tę samą inicjalizację pod tym samym `sessionId`.
   - Snapshot bez session row pozostaje błędem integralności i nie jest automatycznie zgadywany.

3. **Testy**
   - Nowy locked Research: recovery P2 po zapisanym 16K `length` oczekuje 32K przy tym samym assignment/session.
   - Legacy locked Research: pojedynczy limit pozostaje zachowany i brak większego budżetu kończy krok bez cichej zmiany metodologii.
   - Full RCP: test chroni kolejność `saveSessionSnapshot` → `onSessionCreated`.
   - RV Lite: analogiczny test kolejności snapshot → linkage.
   - Test freeze policy sprawdza, że nowa polityka jest dodawana do nowych konfiguracji bez mutowania wejściowego legacy configu.

## Niezmienione

- schema 031; brak migracji SQL;
- migracja/trigger 010 bez zmian;
- B1 replay, attemptId i uncertain-dispatch pozostają aktywne;
- B2 Training pozostaje bez zmian;
- Judge/Unblind bez zmian;
- jawny Research restart pozostaje osobną semantyką od Resume.

## Kontrole lokalne

- `git diff --check` — PASS.
- transpilacja składni wszystkich zmienionych TS/TSX — PASS, 0 błędów składni.
- `verify:ux-data` — PASS, 31 migracji.
- `verify:architecture` — NIEPOTWIERDZONE lokalnie; środowisko nie ma `@babel/parser`.
- pełny `typecheck`/Vitest/build — NIEPOTWIERDZONE lokalnie z powodu niepełnego `node_modules` (`vite/client`, `@types/node`, narzędzia testowe). Audyt/CI pozostaje właściwą bramą.

## Zalecany audyt

1. New locked Research: 16K length → Resume → 32K tego samego kroku.
2. Legacy locked Research bez policy: brak ukrytego 32K.
3. Full RCP crash windows:
   - po rezerwacji assignment przed session INSERT,
   - po session INSERT przed snapshot,
   - po snapshot przed linkage.
4. RV Lite — te same trzy granice inicjalizacji.
5. Finalizacja dla obu protokołów:
   - przed seal,
   - po seal przed Reveal,
   - po Reveal przed `SessionComplete`.
6. Uncertain dispatch nadal nie może powodować automatycznego resend.
