# AI RV Harness v0.7.13 — DATABASE-COMPATIBILITY-EPOCH-1-R1

**Data:** 17 września 2026
**Status:** `CANDIDATE — INDEPENDENT AUDIT, FULL GITHUB ACTIONS AND WINDOWS RUNTIME SMOKE REQUIRED`

## 1. Baza i zakres

R1 został zbudowany bezpośrednio na dokładnym zaakceptowanym `POST-REVEAL-CONTEXT-1`:

- liczba plików bazy: **752**;
- source-tree bazy: `d6c65488693e436c8fa6848c4d14b356dd8f60a00e49cc4b0d5e7796a92e109b`;
- aktualna wersja schematu SQLite: **23**;
- migracje 021–023 pozostają byte-for-byte niezmienione;
- migracja 024 nie została dodana.

Dostarczony complete-source nie zawiera `.git`, dlatego nazwy gałęzi, pełnego SHA commita i rzeczywistego `git status` nie można odzyskać z samej zawartości źródłowej. Nie zostały one zgadywane. Instrukcja Git wymaga zapisania tych danych z rzeczywistego zielonego checkoutu i zweryfikowania source-tree przed nałożeniem R1.

R1 nie jest warstwową poprawką odrzuconego `DATABASE-COMPATIBILITY-EPOCH-1`. Źródło zostało ponownie odtworzone z zaakceptowanego `POST-REVEAL-CONTEXT-1`; poprzedni kandydat służył wyłącznie jako materiał diagnostyczny.

## 2. Diagnoza

Audyt potwierdził trzy problemy wymagające R1:

1. numer migracji 1–20 sam w sobie nie odróżnia prawdziwej bazy v0.7.12 od przerwanej pierwszej inicjalizacji świeżej bazy v0.7.13;
2. wcześniejsza bramka porównywała wersję, opis i `success`, lecz nie weryfikowała checksumów `_sqlx_migrations`;
3. potwierdzenie `Start Fresh` egzekwowane wyłącznie w WebView nie stanowiło natywnej granicy bezpieczeństwa dla komendy IPC.

Pozostaje również wcześniejsze ustalenie: klientowe `Database.load("sqlite:rv_harness.db")` uruchamia migracje pluginu SQL, dlatego klasyfikacja musi nastąpić przed tym wywołaniem. R1 zachowuje kolejność `inspect → prepare → Database.load → validate`.

## 3. Marker niedokończonej inicjalizacji v0.7.13

Dodano natywny marker `rv_harness.initializing-v0.7.13.json`.

Marker:

- może zostać utworzony tylko wtedy, gdy zarządzany plik bazy naprawdę nie istnieje;
- jest tworzony atomowo (`create_new`) przed pierwszym `Database.load()`;
- zawiera epokę `v0.7.13`, docelową migrację 23 i timestamp;
- nie pozwala częściowej bazie kontynuować migracji;
- służy wyłącznie jako dowód pochodzenia częściowego schematu;
- jest usuwany dopiero po osiągnięciu v23 i udanym `validate_live_database`.

Jeżeli marker istnieje, a baza zatrzymała się na migracji 1–22, klasyfikacja to `incomplete_current_initialization`. Ten stan jest blokowany przed `Database.load()` tak samo jak legacy i uszkodzona baza. Użytkownik nie otrzymuje w tym przypadku fałszywej informacji, że ma uruchomić v0.7.12.

Prawdziwa baza v20 bez markera pozostaje `legacy`.

Jeżeli inicjalizacja osiągnęła v23, lecz proces zakończył się przed końcową walidacją, baza może zostać ponownie otwarta jako v23, zwalidowana, a marker zostaje wtedy sfinalizowany/usunięty.

## 4. Pełna weryfikacja ledgeru SQLx

`inspect_database_identity()` odczytuje teraz dla każdego wpisu `_sqlx_migrations`:

- `version`;
- `description`;
- `success`;
- `checksum`.

Każdy wpis jest porównywany pozycyjnie z kanonicznym `MIGRATION_SPECS`. Oczekiwany checksum jest obliczany jako **SHA-384 dokładnych bajtów SQL** (`Sha384::digest(expected.sql.as_bytes())`), zgodnie z mechanizmem checksum SQLx.

Brak wpisu, dodatkowy/future wpis, zmieniony numer, opis, `success=false` albo niezgodny checksum powoduje `corrupt_or_unknown`. Po ledgerze nadal wykonywane są niezależne markery strukturalne schematu, w tym 021–023. Numer migracji nie jest więc jedynym sygnałem tożsamości.

Fixture testowe zapisują prawdziwe checksumy SHA-384. Dodano test, który zmienia wyłącznie checksum migracji 020, pozostawiając numer, opis, `success=true` i strukturę bazy; taka baza jest odrzucana jako `corrupt_or_unknown`.

## 5. Natywna ochrona Start Fresh

Potwierdzenie `Start Fresh` nie jest już egzekwowane przez `window.confirm` ani webowy dialog React.

Komenda `start_fresh_database`:

1. dopuszcza wyłącznie `legacy` lub `incomplete_current_initialization`;
2. zapisuje rozmiar i SHA-256 aktywnego pliku bazy;
3. pokazuje natywny modal Tauri z ostrzeżeniem i przyciskami PL/EN;
4. po potwierdzeniu ponownie wykonuje pełną klasyfikację oraz ponownie sprawdza rozmiar i SHA-256;
5. przerywa bez zmian, jeżeli baza zmieniła się podczas otwartego dialogu;
6. dopiero wtedy zamyka ewentualny pool SQLite;
7. zachowuje bazę i istniejące WAL/SHM przez rename do niekolidującej nazwy;
8. weryfikuje rozmiary i SHA-256 plików po rename;
9. wykonuje rollback częściowych rename przy błędzie.

Nazwy kopii:

- legacy: `ai-rv-harness.legacy-v0.7.12.<timestamp>[.<collision>].sqlite`;
- niedokończona v0.7.13: `ai-rv-harness.incomplete-v0.7.13.<timestamp>[.<collision>].sqlite`.

Marker niedokończonej inicjalizacji zostaje zachowany po przeniesieniu częściowej bazy, dzięki czemu kolejna próba tworzenia świeżej bazy ma nadal udokumentowane pochodzenie. Sam marker nie daje jednak prawa do migracji częściowej bazy.

## 6. Ekrany zgodności

Dla `legacy` zachowano dokładny wymagany komunikat PL/EN o danych z wcześniejszej wersji oraz trzy przyciski:

- `Zamknij aplikację / Close application`;
- `Otwórz folder starej bazy / Open legacy database folder`;
- `Rozpocznij od nowa w v0.7.13 / Start fresh in v0.7.13`.

Dla `incomplete_current_initialization` dodano osobny komunikat PL/EN informujący o niedokończonej świeżej inicjalizacji v0.7.13. Nie zawiera on porady o uruchamianiu v0.7.12.

`corrupt_or_unknown` pozostaje oddzielnym błędem i nie otrzymuje ścieżki `Start Fresh`.

## 7. Granice zmian

Nie zmieniono:

- migracji 021–023 ani ich treści;
- controlled purge;
- Viewer Notes;
- providerów, retry i credential binding;
- Research;
- Training;
- protokołów ani promptów;
- numeru wersji produktu;
- Field Guide ani Viewer Learning.

Usunięto jedynie wcześniejsze automatyczne uruchamianie pre-migration backup jako pluginu setupowego. Backup przed zgodną migracją v0.7.13.x jest teraz wywoływany dopiero przez `prepare_database_for_load`, po natywnej klasyfikacji zgodności i przed `Database.load()`.

## 8. Testy R1

Dodane/rozszerzone testy obejmują:

1. świeży start: marker może powstać wyłącznie bez bazy, v23 przechodzi walidację, marker jest finalizowany dopiero po niej;
2. przerwanie na migracji 1, 10, 20, a dodatkowo 21 i 22 → `incomplete_current_initialization`;
3. prawdziwa v20 bez markera → `legacy`;
4. marker nie może uczynić częściowej bazy `compatible`;
5. niezgodny checksum ledgeru → `corrupt_or_unknown`;
6. kanoniczne checksumy v20 i v23 → odpowiednio `legacy` i `compatible`;
7. natywne potwierdzenie następuje przed zamknięciem poolu i rename, a po dialogu wykonywana jest ponowna klasyfikacja i fingerprint;
8. preservation bazy oraz WAL/SHM z kontrolą SHA-256;
9. wyczerpanie kolizji nazwy bez nadpisania danych;
10. zachowanie niedokończonej bazy jako kopii diagnostycznej;
11. uszkodzona baza pozostaje byte-for-byte nietknięta przez inspection;
12. ścieżki Unicode i nazwy bez znaków zabronionych w Windows;
13. świeża v23: `integrity_check=ok`, `foreign_key_check=0`;
14. niezmienność migracji 021–023 i brak migracji 024;
15. kolejność bramki przed pluginowym `Database.load()`.

## 9. Rzeczywiście wykonane bramki lokalne

### PASS

- identyfikacja dokładnej bazy wejściowej i source-tree;
- `npm run verify:source`;
- `npm run verify:ux-data`;
- niezależny transpile zmienionych TS/TSX przy użyciu globalnego TypeScript 5.8.3;
- statyczny test kolejności `inspect → prepare → Database.load → validate`;
- statyczny test natywnego `confirm → recheck → close pool → preserve`;
- kontrola rejestracji komend w ACL, AppManifest i `invoke_handler`;
- kontrola SHA-256 migracji 021–023;
- brak migracji 024;
- niezależny SQLite smoke na kanonicznym SQL migracji i prawdziwych checksumach SHA-384 dla v1/v10/v20/v21/v22/v23;
- SQLite smoke potwierdził `integrity_check=ok` i `foreign_key_check=0` dla świeżej v23;
- model strict-ledger odrzuca zmieniony checksum v20;
- kontrola whitespace/diff.

### NIEWYKONALNE DO KOŃCA W TYM ŚRODOWISKU — NIE SĄ OZNACZONE JAKO PASS

Dwie próby `npm ci --no-audit --no-fund` zakończyły się `TransportTimeoutError`, dlatego nie powstał kompletny lokalny `node_modules`.

Z tego powodu pełne:

- Vitest;
- typecheck projektu;
- Vite production build;
- `verify:architecture`

nie mogą być oznaczone jako PASS dla R1 w tym środowisku. `verify:architecture` wymaga m.in. lokalnego `@babel/parser`.

Toolchain Rust (`cargo`, `rustc`, `rustfmt`) nie jest dostępny, dlatego:

- `cargo test`;
- `cargo clippy --all-targets --all-features -- -D warnings`

również pozostają obowiązkowymi bramkami GitHub Actions.

## 10. Wymagany Windows runtime smoke

Przed akceptacją należy na Windows potwierdzić co najmniej:

1. rzeczywistą bazę v0.7.12/v20 → ekran legacy bez automatycznej migracji;
2. anulowanie natywnego `Start Fresh` → baza byte-for-byte pozostaje na miejscu;
3. potwierdzone `Start Fresh` → kopia legacy istnieje i świeża baza v23 uruchamia onboarding;
4. symulowane przerwanie świeżej inicjalizacji na 1/10/20 → osobny ekran `incomplete_current_initialization`, nigdy legacy;
5. preservation częściowej bazy i ponowne utworzenie świeżej v23;
6. błędny checksum → `corrupt_or_unknown` bez modyfikacji danych;
7. brak regresji backup/restore;
8. normalny start zgodnej bazy v23.

## 11. Status

`CANDIDATE — INDEPENDENT AUDIT, FULL GITHUB ACTIONS AND WINDOWS RUNTIME SMOKE REQUIRED`

R1 zatrzymuje się na tym etapie. Viewer Learning i Field Guide nie zostały rozpoczęte.
