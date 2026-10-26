# VIEWER OUTPUT SAFETY — STEP B2 TEST FIX

Zakres: wyłącznie dane testowe po zaakceptowanym audycie kodu produkcyjnego B2.

## Zmiana

Zmodyfikowano tylko `src/features/training/trainingExecution.test.ts`.

Sześć parametryzowanych testów ponownego użycia zapisanego Viewer Review (PL/EN: current, historical-context, historical-original) deklarowało checkpoint `session_revealed`, lecz fixture nie zawierał trwałej sesji w stanie `Revealed`. Nowy kontrakt B2 prawidłowo wymaga trwałego Reveal do wyliczenia fingerprintu pakietu Review.

Fixture tworzy teraz odpowiadającą checkpointowi trwałą sesję `session_t1` w stanie `Revealed`. Harness udostępnia `durableSessions` wyłącznie na potrzeby przygotowania tej trwałej historii w testach. `getReveal()` pozostaje niezmienione i zwraca Reveal na podstawie rzeczywistego stanu fixture.

Nie zmieniono kodu produkcyjnego, repozytorium aplikacji, migracji, replay, Training execution ani polityki Review. Testy nadal wymagają, aby zapisany Viewer Review został użyty bez ponownego płatnego wywołania.

## Oczekiwany odbiór

- 6 wcześniej niezaliczonych wariantów Review powinno przejść;
- `runAutomaticPostRevealReview` nadal nie może zostać wywołane ponownie;
- Field Guide Update i Viewer Notes Reflection nadal wykonują się po jednym razie;
- schema pozostaje 031, bez migracji.

Pełny Vitest i CI powinny być końcową bramą tej czysto testowej poprawki.
