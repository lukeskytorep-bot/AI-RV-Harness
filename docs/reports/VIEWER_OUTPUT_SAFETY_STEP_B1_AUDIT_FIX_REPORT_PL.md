# VIEWER OUTPUT SAFETY — STEP B1 AUDIT FIX

Data: 2026-10-10

## Zakres

Poprawka nakładana na zaakceptowaną bazę Step A + B1. Obejmuje wszystkie uwagi audytu B1 oraz decyzję użytkownika o całkowitym usunięciu aktywnego limitu kosztu sesji. Training i Research durable Resume pozostają poza B1.

## 1. Trwały attemptId

Każda logiczna próba Viewera otrzymuje unikalny `attemptId` tworzony przez wspólny helper output recovery. Ten sam identyfikator trafia do:

- `VIEWER_OUTPUT_ATTEMPT_STARTED`;
- `VIEWER_OUTPUT_INCOMPLETE`;
- zaakceptowanej odpowiedzi Viewera;
- `PROVIDER_ERROR`;
- `PROVIDER_ATTEMPT_FAILED`, gdy błąd należy do aktywnej próby.

Ledger nie dopasowuje już rozpoczęcia i zakończenia przez sam `recoveryLevel`. Rozpoczęta próba jest rozstrzygnięta tylko przez terminalny zapis z identycznym `attemptId`.

Dodano regresję: stara zakończona próba level 0 + nowa rozpoczęta próba level 0 bez własnego terminala => `uncertain`, a nie `fresh`.

## 2. Dokładna tożsamość replay

`resumeReplay.ts` używa `stepId` tam, gdzie jest dostępny. Legacy fallback zawiera teraz również `questionNumber` i `exchangeNumber`.

Przed odtworzeniem odpowiedzi Viewera proxy replay przechwytuje `VIEWER_OUTPUT_ATTEMPT_STARTED` kontrolera i zapamiętuje oczekiwany `stepId`. Persisted Viewer event musi odpowiadać temu krokowi. Dla identity-sensitive historii bez jednoznacznej tożsamości replay zatrzymuje Resume zamiast podstawiać odpowiedź z innego kroku.

Bariera niekompletności rozróżnia pytania telepatyczne. Odpowiedź na question 2 nie może rozstrzygać incomplete question 1.

Hydratacja continuation state po wejściu w live Resume nie bierze już historycznych odpowiedzi leżących za unresolved cutoff. Uwzględnia stare zaakceptowane eventy sprzed bariery oraz nowe eventy zapisane po `SESSION_RESUMED`.

## 3. Moment dispatchu i niepewność

`VIEWER_OUTPUT_ATTEMPT_STARTED` jest zapisywany po lokalnej walidacji budżetu continuation, bezpośrednio przed wejściem w provider executor.

Jeśli błąd ma potwierdzoną fazę `before_dispatch` albo jest anulowaniem przed dispatch, zapisywany jest `VIEWER_OUTPUT_ATTEMPT_NOT_DISPATCHED` z tym samym `attemptId`. Taki zapis pozwala bezpiecznie ponowić krok.

Jeśli wynik dispatchu nie jest pewny, brak terminala dla konkretnego `attemptId` pozostawia stan `uncertain` i automatyczny resend jest blokowany.

`PROVIDER_ATTEMPT_FAILED` i `PROVIDER_ERROR` są powiązane z aktywnym `attemptId` oraz `dispatchOutcome` (`not_dispatched` / `unknown`).

## 4. SessionCostGuard usunięty

Zgodnie z decyzją użytkownika nie odtwarzano kosztu po restarcie. Zamiast tego usunięto aktywny hard per-session cost stop.

Usunięto:

- preautoryzację i zatrzymywanie żądań przez `SessionCostGuard`;
- post-request `configured session cost limit exceeded` w kontrolerach;
- pole limitu z Settings UI;
- przekazywanie limitu z RV Sessions, Training i Research do kontrolerów;
- Research preflight wymuszający pricing dla hard cost limit;
- Training preflight pokazujący cost ceiling.

Zachowano raportowanie kosztu. `withEstimatedCost()` pozostawia `usage.costUsd` dostawcy, jeśli jest dostępne, a przy jego braku może oszacować koszt z usage i cached pricing.

Stare pola `maxSessionCostUsd` pozostają wyłącznie jako nieaktywne legacy w strukturach, w których ich natychmiastowe usunięcie wymagałoby migracji danych. Settings loader nie przywraca starej wartości do aktywnego ustawienia. Nowe Research/Training nie używa jej. Schema pozostaje 031, bez migracji.

## 5. Testy i atrapy repozytorium

Uzupełniono atrapy repozytoriów w testach RCP, Lite, Custom i Telepathic o wymagane `listSessionEvents` zamiast maskowania kontraktu rzutowaniem.

Dodano `viewerResumeControllers.test.ts`: dla każdego z czterech kontrolerów pierwsza sesja zapisuje prawdziwe `VIEWER_OUTPUT_ATTEMPT_STARTED` + `VIEWER_OUTPUT_INCOMPLETE`, następnie Resume na tym samym sessionId ma rozpocząć od recovery 32768 zamiast ponownie wysyłać primary 16384.

Dodano testy ledgeru dla:

- starszego terminala i nowszej próby na tym samym recoveryLevel;
- potwierdzonego `not_dispatched`;
- uncertain bez dokładnego terminala.

Dodano test replay telepathic question 1 vs question 2.

## 6. Kontrole lokalne

- `verify:ux-data`: PASS, 31 migracji.
- Transpilacja składni wszystkich `src/**/*.ts` i `src/**/*.tsx` przez TypeScript `transpileModule`: PASS, 0 plików z błędami składni.
- Pełny `typecheck`, Vitest i build: NIE DEKLAROWANE jako PASS. Próba odtworzenia `node_modules` w środowisku roboczym nie zakończyła się w limicie narzędzia; lokalna kopia pozostała bez `vite/client`, `@types/node`, Vitest i części zależności.
- `verify:architecture`: nieuruchamialny z tej samej przyczyny (`@babel/parser` nieobecny w niepełnym `node_modules`).
- `verify:source` na czystej kopii dochodzi do znanych problemów bazy z nazwami Unicode / brakującymi dokumentami i nie stanowi wyniku tej nakładki.

GitHub Actions i niezależny audyt mają być bramką dla pełnego typecheck/Vitest/build.

## 7. Warunek odbioru audytowego

Audyt powinien w szczególności odtworzyć cztery przypadki:

1. zakończona próba level 0, potem nowa rozpoczęta level 0 i crash => `uncertain` dla nowej `attemptId`;
2. telepathic q1 incomplete + q2 accepted => q2 nie jest replayowane jako q1 i continuation q2 nie jest przypinane do q1;
3. błąd `before_dispatch` => dokładny attempt ma `NOT_DISPATCHED` i może być ponowiony, natomiast błąd o nieznanym wyniku => blokada automatycznego resend;
4. ustawiona historycznie dodatnia wartość `maxSessionCostUsd` nie blokuje żadnej sesji, a usage/cost reporting nadal działa.
