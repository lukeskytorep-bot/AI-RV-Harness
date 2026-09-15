# AI RV Harness v0.7.13 — POST-REVEAL-CONTEXT-1

**Status:** `CANDIDATE — INDEPENDENT AUDIT, FULL GITHUB ACTIONS AND WINDOWS RUNTIME SMOKE REQUIRED`  
**Data:** 2026-09-16

## Baza

Kandydat został zbudowany wyłącznie na complete-source zaakceptowanego i potwierdzonego przez użytkownika jako zielony kroku `CONVERSATION-COMPOSER-1`:

- complete-source SHA-256: `94807e32573bfd35a02d96cd1fcf63397d09ef2c33cdc976bd7abfb31769605c`;
- liczba plików: **750**;
- source-tree: `f1fa9f9ae68c71e1475741b55b26779046bb0a60c5c8742e6efac9c667cba728`;
- algorytm source-tree: SHA-256 uporządkowanych leksykograficznie według ścieżki linii `file_sha256  relative_path\n`.

SHA bazowego commita Git **nie jest zapisany** w dostarczonym complete-source ani w artefaktach `CONVERSATION-COMPOSER-1`. Użytkownik potwierdził, że dokładny wynik poprzedniego kroku otrzymał zielone GitHub Actions, ale bez identyfikatora commita nie wolno przypisać mu zgadywanego SHA. Instrukcja Git dla tego kandydata wymaga więc zapisania rzeczywistego `git rev-parse HEAD` z zielonego checkoutu przed nałożeniem patcha oraz potwierdzenia, że checkout odpowiada powyższemu source-tree.

## Zakres wykonanej zmiany

Zmiana dotyczy tylko automatycznej samooceny Viewera po Reveal oraz jawnej kompatybilności Training Resume.

### 1. Kanoniczny request Viewera

`src/sessions/postReveal.ts` nadal pozostaje jedynym źródłem pełnej automatycznej instrukcji po Reveal. `automaticPostRevealReviewRequest(language)` zwraca dokładnie nową treść PL/EN określoną dla `POST-REVEAL-CONTEXT-1`.

Grzecznościowy wstęp nadal pochodzi z mechanizmu `politeRevealTransition()`, ale dodano w nim wariant `automatic_review`. Domyślny wariant `session` zachowuje dotychczasową treść używaną przez kontrolery sesji. Dzięki temu zmiana wymagana przez nowy angielski request Viewera nie modyfikuje zwykłego komunikatu przejścia do Reveal w RV Lite, Full RCP, Custom ani Telepathic.

### 2. Historyczna zgodność Training Resume

Dodano jawny zestaw obsługiwanych wersji requestu:

- aktualny polski request;
- historyczny polski request z poprzedniej wersji;
- aktualny angielski request;
- historyczny angielski request z poprzedniej wersji.

`findCompletedAutomaticViewerReview()` używa dokładnego dopasowania całej treści do tego zestawu. Nie ma wyszukiwania słów kluczowych ani częściowych fragmentów. Wiadomość różniąca się choćby jednym znakiem nie jest traktowana jako ukończona automatyczna opinia.

Historyczne transcript-y nie są modyfikowane ani przepisywane. Training Resume może odczytać poprzednią lub nową wersję i wykorzystać istniejącą odpowiedź Viewera zamiast wykonywać drugi płatny request.

### 3. Audyt grafu przepływów

Rzeczywisty graf wywołań potwierdza jedno kanoniczne źródło requestu:

- **Training:** `executeTrainingRun()` → `runAutomaticPostRevealReview()`;
- **RV Sessions:** `finishRevealedSession()` → `automaticReview()` → `runAutomaticPostRevealReview()`;
- **RV Lite:** wynik `runAutomaticRvLiteSession()` przechodzi przez `finishRevealedSession()`;
- **Full RCP:** wynik `runAutomaticRcpSession()` przechodzi przez `finishRevealedSession()`;
- **Custom Protocol:** wynik `runAutomaticCustomSession()` przechodzi przez `finishRevealedSession()`;
- **Telepathic Protocol:** wynik `runAutomaticTelepathicSession()` i ścieżka resume przechodzą przez `finishRevealedSession()`;
- **zewnętrzny Reveal w RV Sessions:** `submitReveal()` wywołuje ten sam `automaticReview()`;
- **Research:** `executeResearchSessions()` wywołuje `runAutomaticPostRevealReview()` po ujawnionej sesji RCP.

Pełny request nie został skopiowany do żadnego kontrolera ani do Training/Research.

### 4. Viewer Notes i Research

Training zachowuje dotychczasowy `afterViewerReview` i przekazuje ukończoną samoocenę do `runViewerNoteReflection()`.

Research nadal nie importuje ani nie wywołuje `runViewerNoteReflection`/`commitViewerNoteReflection` i nie przekazuje `afterViewerReview` do wspólnej automatycznej analizy. Nowa reguła celu i otoczenia nie została skopiowana do promptu Viewer Notes Reflection.

### 5. Sealed evidence

`PostRevealRepository` nadal posiada wyłącznie odczyt danych pre-Reveal oraz zapis osobnych turnów post-Reveal. Nie dodano żadnej ścieżki modyfikującej sealed pre-reveal evidence.

### 6. Monitor i AI Judge

Nie zmieniono promptów Monitora, Monitora telepatycznego ani kodu jego oceny po Reveal. Test graniczny porównuje SHA-256 kanonicznych plików Monitora z zieloną bazą.

Nie zmieniono AI Judge: promptu, wersji promptu, rubryki, wersji rubryki, scoringu, pakietu Judge ani silnika zamrażania wyników. Test graniczny porównuje SHA-256 odpowiednich plików z zieloną bazą.

Nie dodano migracji `024`.

## Zmienione pliki

- `src/sessions/postReveal.ts`
- `src/sessions/postReveal.test.ts`
- `src/sessions/courtesy.ts`
- `src/sessions/courtesy.test.ts`
- `src/features/training/trainingExecution.test.ts`
- `src/postRevealContextBoundary.test.ts` — nowy
- `docs/reports/POST_REVEAL_CONTEXT_1_v0.7.13_PL.md` — nowy

Brak usuniętych plików.

## Testy regresyjne

Dodane/rozszerzone testy obejmują:

1. dokładny nowy request PL;
2. dokładny nowy request EN;
3. pojedyncze dodanie grzecznościowego wstępu;
4. dokładne rozpoznanie historycznej i nowej wersji PL/EN;
5. odrzucenie prawie zgodnego, ale nieidentycznego requestu;
6. brak ponownego wywołania Viewera po Training Resume dla wszystkich czterech wariantów current/history × PL/EN;
7. ponowne wykonanie Training na już ukończonym wyniku bez drugiej refleksji ani płatnej opinii;
8. wspólne użycie `runAutomaticPostRevealReview()` przez Training, RV Sessions i Research;
9. wspólną ścieżkę RV Lite, Full RCP, Custom i Telepathic przez `finishRevealedSession()`;
10. brak Viewer Notes Reflection w Research;
11. brak ścieżki zapisu do sealed pre-reveal evidence;
12. bajtową niezmienność kanonicznych plików Monitora względem bazy;
13. bajtową niezmienność promptu/rubryki/scoringu/pakietu/silnika frozen scores AI Judge względem bazy.

## Rzeczywiście wykonane lokalne bramki

### PASS

- identyfikacja complete-source bazy i source-tree: PASS;
- `npm run verify:source`: PASS;
- `npm run verify:ux-data`: PASS;
- transpile/syntax check wszystkich zmienionych plików TS przy użyciu dostępnego globalnego TypeScript 5.8.3: PASS;
- niezależny statyczny audyt kontraktu POST-REVEAL-CONTEXT: PASS;
- audyt grafu wspólnych wywołań: PASS;
- porównanie 7 chronionych hashy Monitor/Judge do zielonej bazy: PASS.

### Uruchomione, lecz niewykonalne w tym sandboxie z przyczyn środowiskowych

Próba `npm ci` nie mogła ukończyć pobierania zależności. Pozostawiła niekompletne katalogi pakietów; zostały one następnie całkowicie usunięte przed finalnym pakowaniem.

- pełny Vitest: `vitest: not found`;
- pełny typecheck: brak lokalnych `vite/client` i `@types/node`;
- Vite build: zatrzymał się na tym samym braku zależności podczas `tsc -b`;
- `verify:architecture`: brak kompletnego `@babel/parser`;
- Rust tests: `cargo: command not found`;
- Clippy: `cargo: command not found`.

Nie są one oznaczone jako PASS. Muszą zostać wykonane przez pełne GitHub Actions dla dokładnego kandydata.

Po nieudanych próbach usunięto `node_modules`, `tsconfig.app.tsbuildinfo` i `tsconfig.node.tsbuildinfo`, po czym ponownie wykonano `verify:source` i `verify:ux-data` z wynikiem PASS.

## Runtime smoke do odbioru

Na Windows należy co najmniej potwierdzić:

- automatyczną opinię po Reveal w zwykłej sesji;
- Training Resume z historycznym transcript-em bez ponownego requestu Viewera;
- nowy transcript z bieżącym requestem i poprawne Resume;
- RV Lite, Full RCP, Custom i Telepathic po Reveal;
- Research bez aktualizacji Viewer Notes;
- brak zmian w zwykłym przejściu Reveal oraz w działaniu Monitor/Judge.

## Status

`CANDIDATE — INDEPENDENT AUDIT, FULL GITHUB ACTIONS AND WINDOWS RUNTIME SMOKE REQUIRED`
