# VIEWER OUTPUT SAFETY — STEP B2 AUDIT FIX 2

## Zakres

Poprawka na bazie zaakceptowanego B1 + B2 AUDIT FIX. Nie obejmuje Research ani Markdown.

## Naprawa finalizacji po pełnym replay

`createSessionReplay()` zachowuje tłumienie zapisów podczas odtwarzania zaakceptowanych odpowiedzi. Po odtworzeniu ostatniej odpowiedzi nie czeka już jednak na kolejne wywołanie providera, którego w tym przypadku nie będzie.

Przejście do trybu live następuje przy pierwszym zapisie finalizacyjnym po ostatnim replay. Dla zwykłego blind jest to `updatePreRevealTranscript`; dla sesji już zapieczętowanej przed awarią `REVEAL_TRANSITION`. Dzięki temu:

- ostatnia zapisana odpowiedź Viewera nie jest duplikowana;
- brak ponownego wywołania providera;
- `sealPreReveal()` wykonuje się, jeśli sesja nie była jeszcze zapieczętowana;
- `acceptReveal()` i `recordTargetUsage()` wykonują się w brakującej części finalizacji;
- sesja dostaje trwały `SESSION_RESUMED` przed nowymi zapisami finalizacyjnymi.

Jeśli `preRevealSealedAt` już istnieje, replay nie zapisuje ponownie transcriptu ani seal; przechodzi do live dopiero przy Reveal.

## Bariera przed checkpointem `session_revealed`

Training nie ufa już samemu wynikowi kontrolera `state: Revealed` ani staremu stanowi checkpointu. Przed przejściem do `session_revealed` funkcja `ensurePersistedTrainingBlindReveal()` potwierdza:

1. istnieje sesja i ma trwały stan `Revealed`;
2. `preRevealSealedAt` jest zapisane;
3. istnieje trwały Reveal (`getReveal`);
4. istnieje `REVEAL_ACCEPTED`; jeśli stan Revealed jest trwały, ale crash nastąpił przed zapisaniem eventu, event jest idempotentnie uzupełniany;
5. istnieje target usage dla `(sessionId,targetId)`; brakujący zapis po crashu jest idempotentnie uzupełniany.

Dopiero po tej weryfikacji Training zapisuje `session_revealed` i może rozpocząć post-Reveal workflow.

## Testy

- Dodano test replay: cztery zapisane odpowiedzi Lite są w całości odtworzone; provider nie jest wywoływany; po ostatniej odpowiedzi wykonywana jest finalizacja blind/Reveal; zapis odpowiedzi nie jest duplikowany.
- Poprawiono typy fixture `trainingBlindResume.test.ts`: `ViewerSystemPromptSnapshot` bez nieistniejącego `language` oraz pełny `ViewerNotesSessionSnapshot` dla disabled notes.
- Uzupełniono wspólny harness `trainingExecution.test.ts` o trwałe sesje, events i target usage wymagane przez nową barierę finalizacji, zamiast omijać ją przez niepełne mocki.

## Lokalne kontrole

- `tsc --noEmit -p tsconfig.json` — PASS, 0 błędów.
- `npm run verify:ux-data` — PASS, 31 migracji.
- Schema pozostaje 031; brak migracji.
- `npm run verify:architecture` — NIEZWERYFIKOWANE lokalnie: kopia `node_modules` nie zawiera `@babel/parser`, więc self-test zatrzymuje się przed analizą projektu.
- Pełny Vitest/build — NIEDEKLAROWANE jako PASS z tego samego powodu niekompletnych zależności lokalnych. Odbiór ma wykonać audyt/CI.

## Warunek odbioru

Audyt powinien ponownie sprawdzić trzy crash windows:

- po ostatniej odpowiedzi, przed seal;
- po seal, przed Reveal;
- po Reveal, przed checkpointem Training.

W żadnym z nich Resume nie może ponowić blind ani przejść do post-Reveal bez trwałego Reveal i target usage.
