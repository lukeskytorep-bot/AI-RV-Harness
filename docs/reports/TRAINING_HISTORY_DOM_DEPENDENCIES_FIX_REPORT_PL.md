# Training History — komplet zależności testów DOM

## Przyczyna i zakres
Log CI pokazuje ERR_MODULE_NOT_FOUND dla jsdom. Vitest nie uruchomił TrainingScreen.dom.test.tsx, więc 1262 zaliczone testy nie obejmują 7 testów DOM. Sam komunikat „Failed to start forks worker” jest skutkiem braku środowiska, nie dowodem błędu mechanizmu workerów.

Ostatnia mała paczka TRAINING_HISTORY_DOM_FINAL_FIX zawierała test i raport, a wymagała wcześniejszego DOM_INTERACTION_TESTS_CI_CANDIDATE z package.json i package-lock.json. Najbardziej prawdopodobna przyczyna obecnego CI to brak tych plików w gałęzi. Nie sprawdzono aktualnego checkoutu GitHub; diagnoza braku jsdom jest bezpośrednio potwierdzona logiem użytkownika.

Ta nakładka zawiera komplet trzech plików: package.json z devDependency jsdom 26.1.0, odpowiadający package-lock.json oraz test DOM z poprawioną adnotacją this: HTMLElement. Pliki pochodzą ze złożonej, zweryfikowanej bazy gałęzi ai-rv, nie main. Produkcja, Resume, zakończenie treningu i schema 031 pozostają bez zmian.

## Nałożenie
1. Nałóż ZIP na katalog główny aktualnej gałęzi po Training History STEP 2 i jego poprawkach. Zachowaj ścieżki; package.json i package-lock.json mają trafić do katalogu głównego, nie src.
2. Zacommituj oba pliki zależności oraz test. Nie wystarczy skopiować samego testu.
3. Uruchom standardowe CI. Obecne ci.yml i workflow wydania używają npm ci, które instaluje devDependencies; nie trzeba zmieniać workflow ani pomijać testów.
4. Oczekiwany wynik tej bazy: 232 pliki testowe PASS, 1 pominięty; 1269 testów PASS, 1 pominięty; zero unhandled errors.

## Weryfikacja lokalna 2026-10-10
- Czysty, osobny katalog: npm ci --ignore-scripts --no-audit --no-fund — PASS, 203 pakiety. Bez korzystania z wcześniejszego node_modules.
- require.resolve('jsdom') i wersja pakietu — PASS, 26.1.0.
- Pełny Vitest na złożonym źródle i zależnościach z tej instalacji — PASS: 1269 testów, 1 pominięty, bez błędów nieobsłużonych.
- npm run typecheck — PASS.
- Nie oznaczamy GitHub Actions, standardowej instalacji z lifecycle scripts ani wizualnego Windows/Tauri smoke jako wykonanych w tej turze.
