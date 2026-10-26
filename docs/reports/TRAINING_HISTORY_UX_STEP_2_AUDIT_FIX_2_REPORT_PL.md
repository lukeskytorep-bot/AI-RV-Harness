# Training History UX — STEP 2 AUDIT FIX 2

Data: 2026-10-10.
Baza: zaakceptowany STEP 1 AUDIT FIX 2 + STEP 2 HISTORY UI + STEP 2 AUDIT FIX. Poprawka dotyczy wyłącznie UI/testów STEP 2; schema 031 i migracje pozostają bez zmian.

## Zakres

1. Tooltip historii Training nadal jest renderowany portalem do `document.body`, ale jego pozycja jest teraz liczona po zmierzeniu zarówno przycisku, jak i tooltipu.
2. Pozycja jest ograniczana do viewportu z marginesem 10 px. Preferowane jest położenie nad kontrolką; jeśli brakuje miejsca, tooltip przechodzi pod przycisk. Pozycja jest ponownie liczona przy `resize`, `scroll` oraz zmianie dynamicznej etykiety.
3. `training-session-links[hidden]` ma jawne `display: none !important`, więc reguła siatki nie znosi semantyki `hidden`.
4. Testy dodają geometrię prawego/górnego brzegu, kontrolę `hidden`, zachowanie wspólnego guarda podczas oczekującego Promise/dialogu oraz sprawdzenie mapowania wszystkich pięciu akcji karty do właściwych callbacków.
5. Nazwa wcześniejszego testu CSS nie twierdzi już, że statyczny test układu dowodzi braku realnych kolizji.

## Tooltip

Nowy helper `computeTrainingTooltipPosition()` jest funkcją czystą. Dla zmierzonego `buttonRect`, rozmiaru tooltipu i viewportu wyznacza końcowe `left/top` oraz placement `above|below`. CSS nie używa już `transform: translate(-50%, -100%)`; komponent ustawia gotowe współrzędne fixed.

Tooltip pozostaje dostępny dla hover i focus, zachowuje `aria-label`, `aria-describedby`, PL/EN i dynamiczne Show/Hide / Collapse/Expand.

## Testy i kontrole lokalne

- TypeScript `transpileModule` dla zmienionych TS/TSX: PASS, 0 błędów składni.
- `verify:ux-data` na zrekonstruowanej bazie: PASS, 31 migracji.
- `verify-source-integrity-selftest`: PASS.
- `verify:source` na przekazanym bazowym ZIP-ie nie przechodzi z powodu istniejących w tej kopii brakujących dokumentów i nazw `#U...`; nie jest to zmiana tej nakładki. Audytor poprzedniej paczki potwierdzał PASS na swojej czystej bazie.
- Pełny Vitest/typecheck/build nie został lokalnie uruchomiony, ponieważ lokalna kopia nie zawiera kompletnego `node_modules`.
- Windows/Tauri UI, zoom 125/150% i rzeczywiste pomiary prostokątów: NIEWYKONANE. Test geometrii tooltipu nie jest przedstawiany jako zastępstwo realnego smoke UI.

## Do ponownego audytu

Uruchomić pełny Vitest, typecheck, build, verify:architecture, verify:ux-data i verify:source na właściwej czystej bazie. W realnym UI sprawdzić tooltip przy prawym i górnym brzegu, focus klawiaturą, dynamiczne etykiety, zwiniętą listę sesji oraz layout 330 px / breakpoint / zoom 125% i 150%.
