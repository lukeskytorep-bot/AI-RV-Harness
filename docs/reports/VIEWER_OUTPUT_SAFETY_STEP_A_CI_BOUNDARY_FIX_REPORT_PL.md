# Viewer Output Safety — Step A — CI boundary fix

Poprawka dotyczy wyłącznie trzech istniejących testów granic, które nadal oczekiwały starego kształtu kodu po zaakceptowanych zmianach Step A.

1. `providerContinuationBoundary.test.ts`
   - zachowuje wymaganie, że wszystkie wspierane kontrolery walidują continuation budget;
   - akceptuje aktualną nazwę lokalnej zmiennej `requestMessages` obok `messages`.

2. `streamingWorkflowBoundary.test.ts`
   - zachowuje wymaganie rozdzielenia strumienia Conversation / Manual RV;
   - sprawdza aktualne jawne gałęzie `streamWorkflowContext: "conversation"` i `"manual_rv"` zamiast usuniętego ternary.

3. `postRevealContextBoundary.test.ts`
   - Monitor prompt contract pozostaje osobno byte-stable;
   - aktualizuje hash zaakceptowanej struktury `telepathicController.ts`, ponieważ Step A celowo zmienił Viewer-only execution/recovery wiring.
   - nowy hash odpowiada dokładnie wartości raportowanej przez CI: `1f364b941483f3d5ac35dc99ec0f4e8627fb19526bc730ccb5e8376051b124e7`.

Kod produkcyjny nie został zmieniony.
