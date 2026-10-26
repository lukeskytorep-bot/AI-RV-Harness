# Training History UX — STEP 2 DOM interaction tests

Data: 2026-10-10.

## Status

Kandydat do CI. Ta paczka nie zmienia kodu produkcyjnego Training History UX. Dodaje brakujące środowisko DOM i montowane testy `TrainingScreen`, wymagane przez audyt STEP 2 FIX 3.

## Zakres zmian

- `jsdom` 26.1.0 dodany jako `devDependency`.
- `package-lock.json` zaktualizowany zgodnie z `package.json`; `npm install --package-lock-only --offline` przechodzi.
- nowy `src/features/training/TrainingScreen.dom.test.tsx` używa `// @vitest-environment jsdom`, `react-dom/client` i `act()` z React 19;
- brak zmian w `TrainingScreen.tsx`, CSS, repozytoriach, Resume, termination, Viewer recovery i migracjach.

## Montowane scenariusze

Testy renderują prawdziwy `TrainingScreen` i wywołują handlery przez kliknięcia/focus/hover DOM:

1. skuteczne `End training`: zapis termination, zniknięcie Resume/End, zachowanie sesji i trzech akcji historii;
2. błąd zapisu End: komunikat błędu, Resume/End pozostają dostępne, guard zostaje zwolniony;
3. Resume → End i End → Resume: tylko pierwsza operacja może wejść;
4. oczekujące Resume blokuje Archive; otwarty dialog Archive blokuje Resume; anulowanie odblokowuje kontrolki;
5. collapse/expand historii zachowuje rozwiniętą kartę i wybraną sesję;
6. tooltip portalowy działa na focus/hover, w EN i PL, a kontener sesji zachowuje `hidden` po zwinięciu.

Testy jednostkowe geometrii tooltipu i CSS z poprzednich FIX pozostają bez zmian.

## Zależność i lockfile

Użyto `jsdom` 26.1.0. Wersja wymaga Node >=18, a projekt/CI używa współczesnego Node. Dane lockfile dla `jsdom` i jego zależności odpowiadają oficjalnemu lockfile projektu jsdom v26.1.0; istniejące nowsze wpisy projektu, np. `debug`, pozostawiono bez cofania wersji.

Sprawdzenie lokalne:

- `npm install --package-lock-only --offline --ignore-scripts --no-audit --no-fund` — PASS;
- `npm ls --package-lock-only jsdom --depth=1` — `jsdom@26.1.0`, deduplikowany także dla Vitest;
- składnia nowego TSX przez TypeScript `transpileModule` — PASS;
- `verify:ux-data` — PASS, 31 migracji;
- migracje — bez zmian.

## Ograniczenia lokalnego środowiska

Pełnego `npm ci`, Vitest, build i typecheck nie oznaczono jako PASS. Lokalny cache npm nie zawiera wszystkich istniejących zależności projektu (`npm ci --offline` zatrzymuje się m.in. na wcześniej istniejącym `zwitch`). Dostęp do npm registry z kontenera przekracza limit wykonania.

`verify:architecture` nie może wystartować bez zainstalowanego `@babel/parser`. `verify:source` na tej rozpakowanej bazie nadal widzi istniejące w wejściowym ZIP-ie brakujące dokumenty i nazwy `#U...`; audytor wcześniej potwierdzał tę bramkę na czystym źródle.

## CI gate

Repozytorium ma `npm ci` w `.github/workflows/ci.yml` oraz workflow release. Po nałożeniu paczki GitHub Actions powinien pobrać `jsdom` z lockfile i uruchomić pełny Vitest/typecheck/build. STEP 2 nie powinien zostać formalnie zamknięty, dopóki ten CI nie jest zielony.

Windows/Tauri smoke przy 330 px, breakpoint oraz zoom 125/150% pozostaje osobnym odbiorem wizualnym; testy DOM nie zastępują pomiaru realnego układu.
