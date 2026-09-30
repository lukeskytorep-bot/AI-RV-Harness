# AI RV Harness v0.7.13 — raport podziału repository: Targets

**Data:** 7 września 2026  
**Etap planu:** Etap 5 — podział repository  
**Zakres:** drugi kontrolowany podział Targets bez zmiany publicznej fasady i danych

## 1. Punkt wejścia

Prace rozpoczęto na kanonicznym pełnym źródle po zakończonym i potwierdzonym przez GitHub Actions podziale Profiles. Zgodnie z planem kolejnym małym obszarem Etapu 5 były Targets.

## 2. Wykonana granica

Dodano wewnętrzny kontrakt:

- `src/storage/contracts/targetsRepository.ts`.

Dodano dwie zgodne implementacje:

- `src/storage/browser/targetsRepository.ts`;
- `src/storage/sqlite/targetsRepository.ts`.

Publiczne `BrowserRepository` i `SqliteRepository` nadal implementują niezmieniony `AppRepository`, lecz delegują pełny obszar Targets:

- listowanie wszystkich lub wybranej kolekcji;
- tworzenie, edycję i usuwanie celów użytkownika;
- zapis i listowanie użycia celu.

## 3. Ochrona integralności

Podział zachowuje dotychczasowe zabezpieczenia:

- stare dziesięć zastąpionych celów Training pozostaje ukryte w browser preview;
- cele fabryczne nie mogą być edytowane ani usuwane;
- cel wykorzystany w `target_usage`, RV Session albo Research pozostaje zablokowany;
- browserowa kontrola przekraczająca domeny jest jawnie wstrzykiwana przez fasadę;
- SQLite nadal opiera blokadę na istniejących triggerach migracji 012;
- nie zmieniono żadnego klucza storage, tabeli, kolumny, migracji ani kształtu `TargetRecord`.

## 4. Testy

Dodano wspólny zestaw testów kontraktowych dla obu adapterów. Chroni on listowanie bez filtra w kolejności `collection ASC, updatedAt DESC`, listowanie wybranej kolekcji według `updatedAt DESC`, normalizację tworzenia i edycji, niezmienne pola, usuwanie wyłącznie celów użytkownika oraz kolejność zapisów usage. Wcześniejsza różnica kolejności pomiędzy browser preview i produkcyjnym SQLite została usunięta przez dostosowanie browsera do dotychczasowej semantyki SQLite. Osobny test granicy potwierdza delegację całej powierzchni Targets i jawną browserową blokadę operacji przekraczających domeny.

Walidacja lokalna:

- **107 plików testowych / 331 testów** — zaliczone;
- TypeScript typecheck — zaliczony;
- produkcyjny build Vite — zaliczony;
- `verify:source` — zaliczony;
- testy istniejących triggerów ochrony Targets — zaliczone.

Rust/Tauri oraz Clippy pozostają końcową bramką GitHub Actions. Zmiana nie dotyka kodu Rust ani schematu bazy.

## 5. Następny krok

Po zielonym GitHub Actions kolejnym obszarem Etapu 5 są **Settings i konfiguracja modeli**. Należy zachować stabilny `AppRepository`, obecne klucze storage, credential isolation oraz rozdzielenie metadanych providera od sekretów przechowywanych natywnie.
