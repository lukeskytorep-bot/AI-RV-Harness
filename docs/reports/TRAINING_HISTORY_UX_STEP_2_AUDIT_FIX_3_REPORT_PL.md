# Training History UX — STEP 2 AUDIT FIX 3

## Zakres

Poprawka wyłącznie warstwy testowej względem STEP 2 AUDIT FIX 2. Kod produkcyjny TrainingScreen.tsx i CSS nie zostały zmienione.

## Poprawione błędy

1. Deferred Promise w teście wspólnego guarda ma jawnie typowany resolver `let resolveDialog!: (value: boolean) => void;`, dzięki czemu build TypeScript nie powinien zgłaszać TS2349.
2. Helper testu pięciu akcji składa tekst z `Children.toArray(props.children)` dla dzieci string/number. Resume i End training, które mają ikonę + tekst, są więc wykrywane tak samo jak TooltipButton.
3. Test wymaga jawnie obecności wszystkich pięciu akcji przed wywołaniem. Brak callbacku nie jest już maskowany optional chaining.

## Ograniczenie odbioru interakcji

Audyt wymaga dodatkowych testów montowanego TrainingScreen w środowisku DOM dla End/Resume/Archive, zachowania stanu po collapse/expand oraz tooltipu focus/hover. Obecne repozytorium nie deklaruje jsdom/happy-dom ani biblioteki test-renderer w devDependencies, a środowisko wykonawcze nie mogło pobrać dodatkowej zależności. Nie dodano niezweryfikowanej zależności tylko w celu obejścia audytu.

Dlatego ta paczka naprawia dwa konkretne czerwone testy wskazane przez audytora, ale nie deklaruje lokalnego PASS dla brakującego montowanego DOM integration suite ani Windows/Tauri visual smoke. Te kontrole powinny zostać wykonane w wyposażonym środowisku/CI albo w osobnym kroku test-infrastructure, jeśli projekt zdecyduje się dodać kontrolowane środowisko DOM.

## Produkcja i dane

- brak zmian produkcyjnych;
- brak zmian migracji;
- schema pozostaje 031;
- STEP 1 termination foundation pozostaje bez zmian;
- tooltip geometry/hidden/common operation guard z FIX 2 pozostają bez zmian.
