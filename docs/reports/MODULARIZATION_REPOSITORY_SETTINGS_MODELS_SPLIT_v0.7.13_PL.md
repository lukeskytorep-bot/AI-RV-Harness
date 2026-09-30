# AI RV Harness v0.7.13 — raport podziału repository: Settings i konfiguracja modeli

**Data:** 8 września 2026  
**Etap planu:** Etap 5 — podział repository  
**Zakres:** trzeci kontrolowany podział bez zmiany publicznej fasady, schematu ani credential isolation

## 1. Punkt wejścia

Prace rozpoczęto na kanonicznym pełnym źródle po podziale Targets. Użytkownik potwierdził zielony GitHub Actions dokładnego kandydata Targets, dlatego zgodnie z planem następnym małym obszarem były Settings i konfiguracja modeli.

## 2. Wykonana granica

Dodano wewnętrzny kontrakt:

- `src/storage/contracts/settingsModelsRepository.ts`.

Dodano zgodne implementacje:

- `src/storage/browser/settingsModelsRepository.ts`;
- `src/storage/sqlite/settingsModelsRepository.ts`.

Publiczne `BrowserRepository` i `SqliteRepository` nadal implementują niezmieniony `AppRepository`, lecz delegują:

- odczyt i zapis `AppSettings`;
- listowanie, tworzenie i usuwanie konfiguracji providerów;
- zmianę metadanych credentiala i statusu połączenia;
- listowanie, atomową wymianę i czyszczenie cache modeli;
- ustawianie ulubionego modelu.

## 3. Integralność danych i credentiali

Nie zmieniono tabel, migracji, kluczy local storage ani serializowanych rekordów. Sekrety API nadal są przechowywane wyłącznie przez natywne komendy credentiali i nie wchodzą do nowego kontraktu.

Usuwanie konfiguracji providera zachowuje dotychczasową semantykę:

- w SQLite metadane providera, metadane credentiala i referencje Viewer/Monitor/Judge w Profile są czyszczone w jednej jawnej transakcji;
- w browser preview adapter usuwa providera i jego modele, a fasada dostarcza jawny callback czyszczący referencje Profile;
- browser preview nadal nie pozwala tworzyć ani rotować credentiali.

Odświeżenie rejestru modeli nadal zachowuje zapisane ulubione modele, a odczyt stosuje istniejący reasoning registry.

## 4. Testy

Dodano testy kontraktowe obu adapterów oraz test granicy fasady. Chronią one:

- niezmienione klucze i round-trip ustawień;
- kolejność konfiguracji providerów;
- filtrowanie i kolejność modeli;
- zachowanie ulubionych modeli podczas odświeżenia;
- niedostępność mutacji credentiali w browser preview;
- atomowe zapisy ustawień i provider/credential metadata w SQLite;
- atomowe usuwanie providera wraz z czyszczeniem referencji Profile;
- pełną delegację publicznej powierzchni `AppRepository`.

Walidacja lokalna:

- **109 plików testowych / 340 testów** — zaliczone;
- TypeScript typecheck — zaliczony;
- produkcyjny build Vite — zaliczony;
- `verify:source` — zaliczony po usunięciu artefaktów kompilatora;
- ponowne nałożenie paczki na czysty baseline Targets oraz pełna powtórna walidacja **109/340**, typecheck, build i `verify:source` — zaliczone.

Rust/Tauri oraz Clippy pozostają końcową bramką GitHub Actions. Zmiana nie dotyka kodu Rust ani schematu bazy.

## 5. Następny krok

Po zielonym GitHub Actions kolejnym obszarem Etapu 5 są **Workspaces i Conversations persistence**. Należy zachować stabilny `AppRepository`, istniejące archiwizowanie, transakcje grup/wątków i zgodność starszych danych.
