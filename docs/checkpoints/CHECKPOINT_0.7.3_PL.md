# AI RV Harness — checkpoint 0.7.3

## Cel aktualizacji

Wersja 0.7.3 jest poprawką stabilności po wydaniu 0.7.2. Usuwa błąd SQLite `error returned from database: (code: 5) database is locked`, który mógł pojawić się podczas rozpoczynania sesji. Nie zmienia ani nie przepisuje wcześniejszych tagów i wydań.

## Przyczyna

Tauri SQL wykonuje zapytania przez pulę połączeń. Kod 0.7.2 próbował realizować część transakcji jako kilka niezależnych wywołań z frontendu:

1. `BEGIN IMMEDIATE`;
2. jedno lub więcej zapytań zapisujących;
3. `COMMIT` albo `ROLLBACK`.

Kolejne wywołania nie miały gwarancji użycia tego samego połączenia z puli. Otwarta transakcja mogła więc pozostać na innym połączeniu i utrzymywać blokadę zapisu. Niezależne autozapisy ustawień i zapis startującej sesji także nie miały jednej wspólnej kolejki.

## Naprawa

- wszystkie zapisy SQLite przechodzą przez jedną kolejkę aplikacji;
- krótkie odpowiedzi `SQLITE_BUSY`, `SQLITE_LOCKED` oraz kod 5/6 są automatycznie ponawiane z ograniczonym backoffem;
- operacje wieloetapowe są wykonywane przez natywną komendę Rust jako prawdziwa transakcja SQLx przypięta do jednego połączenia;
- usunięto wszystkie osobne frontendowe wywołania `BEGIN`, `COMMIT` i `ROLLBACK`;
- baza pracuje w trybie WAL, aby odczyty nie blokowały zapisu dowodów sesji;
- natywne repozytorium jest inicjalizowane tylko raz, również przy powtórnym montowaniu interfejsu.

Prawdziwe transakcje obejmują między innymi zapis konfiguracji providera, usuwanie providera, odświeżanie rejestru modeli, zamrażanie wyniku Judge’a oraz Experiment Lock Research.

## Dane i aktualizacja

Aktualizacja nie usuwa ani nie zeruje bazy. Zachowuje Profile, Workspace, klucze w systemowym magazynie poświadczeń, sesje, cele, ustawienia oraz projekty Research. Nie dodaje migracji schematu; po zamknięciu starego procesu istniejąca blokada systemowa zostaje zwolniona.

## Weryfikacja

- TypeScript: poprawny;
- Vitest: 45 plików, 106/106 testów;
- test regresji zabrania powrotu do osobnych frontendowych wywołań kontroli transakcji;
- produkcyjny build Vite: wykonywany w końcowej kontroli paczki;
- natywny Rust/Tauri i nowy `Cargo.lock` są sprawdzane przez workflow CI/Release Windows.
