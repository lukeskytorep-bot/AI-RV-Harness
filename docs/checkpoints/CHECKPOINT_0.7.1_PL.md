# AI RV Harness — checkpoint 0.7.1

## Cel tej poprawki

Wersja 0.7.1 domyka problemy ujawnione przez pierwszy instalator Windows oraz audyt kodu wykonany przed Release Windows #4. Numer wersji pozostaje 0.7.1, ponieważ wydanie nie zostało jeszcze opublikowane.

## Pierwsze uruchomienie

- jawne uprawnienie SQLite do zapisu podczas inicjalizacji;
- ekran błędu z ponowieniem zamiast nieskończonego wskaźnika ładowania;
- English jako język nowej instalacji;
- kolorowa Aurora jako motyw nowej instalacji;
- jasne natywne tło okna przed załadowaniem interfejsu.

## Poprawki po audycie

1. Practice Effect losuje całe pary, zachowując bezpośrednią kolejność `FIRST → SECOND` dla tego samego celu.
2. Synchroniczna blokada Start nie pozwala uruchomić dwóch płatnych przebiegów podwójnym kliknięciem.
3. Włączony twardy limit kosztu wymaga znanych cen wejścia/wyjścia, wylicza koszt z tokenów, gdy dostawca nie poda kwoty, i autoryzuje bezpieczny górny koszt przed każdym żądaniem.
4. STOP anuluje aktywne natywne żądanie HTTP, a nie tylko następny krok protokołu.
5. Zapis Reveal i przejście sesji do stanu `Revealed` są jednym atomowym przejściem SQLite.
6. Judge pobiera dane z zapieczętowanego transcriptu i sprawdza jego SHA-256; tabela zdarzeń nie jest już źródłem dowodów do oceny.
7. Pierwszy Release 0.7.1 generuje prawdziwy `src-tauri/Cargo.lock`, zapisuje go na `main` i używa trybu `--locked` podczas kontroli Rust.
8. CI i Release uruchamiają testy Rust oraz Clippy; Release działa tylko z `main` i nie może uruchomić dwóch równoległych wydań.
9. Zapisy ustawień są kolejkowane, więc starszy zapis nie może zakończyć się po nowszym i go nadpisać; błędy zapisu są obsługiwane.
10. Full RCP przyjmuje automatyczne cele zawierające wyłącznie obsługiwany obraz, zgodnie z wcześniejszym Preflightem.

## Weryfikacja lokalna

- TypeScript: poprawny;
- Vitest: 33 pliki, 72/72 testy;
- produkcyjny build Vite: poprawny;
- npm audit: 0 znanych podatności;
- 10 migracji SQLite: zastosowane kolejno do czystej bazy;
- test atomowego Reveal: poprawny;
- pliki GitHub Actions: poprawna składnia YAML.

Kompilacja, testy i Clippy części Rust/Tauri są celowo wykonywane na runnerze GitHub Actions, ponieważ lokalne środowisko przygotowania paczki nie zawiera toolchainu Rust.
