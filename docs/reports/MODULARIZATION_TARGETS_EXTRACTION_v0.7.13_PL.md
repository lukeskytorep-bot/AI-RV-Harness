# AI RV Harness v0.7.13 — raport ekstrakcji modułu Targets

> **Status:** wykonano lokalnie; frontend zweryfikowany  
> **Rodzaj zmiany:** refaktoryzacja frontendowa bez celowej zmiany zachowania oraz mała naprawa karty Credits  
> **Etap planu:** Etap 4 — stopniowe odchudzanie `App.tsx`

## 1. Cel i zakres

Kolejny mały krok modularizacji wydziela ekran Targets z `src/App.tsx`. Nie zmienia schematu danych, formatu targetów, reguł blindingu, wyboru celu przez sesje ani kwalifikowania targetów do protokołów.

Razem z tym krokiem wykonano niezależną, niewielką naprawę karty Credits w Settings:

- usunięto surowy adres `CREDITS.md` wyświetlany pod kartą;
- przycisk otrzymał jednoznaczną nazwę PL/EN;
- dokładny adres `CREDITS.md` dodano do ścisłej allowlisty Rust;
- błędy otwierania zewnętrznych stron nie są już bezgłośnie ignorowane w karcie Credits.

## 2. Nowa granica Targets

Utworzono publiczny moduł `src/features/targets/`, który posiada:

- `TargetsScreen.tsx` — ekran oraz prezentację list celów;
- `TargetDialogs.tsx` — formularze tworzenia i edycji celu;
- `targetViewModel.ts` — czyste grupowanie Training/general/telepathic i obliczanie blokad;
- `targetOperations.ts` — ładowanie biblioteki oraz uporządkowane operacje create/update/delete;
- `index.ts` — publiczny punkt wejścia modułu.

`App.tsx` zachowuje top-level navigation i przekazuje modułowi tylko `copy`, `settings` oraz publiczny kontrakt `AppRepository`. Istniejący `src/targets/service.ts` pozostaje właścicielem normalizacji, hashowania treści, typu celu użytkownika i zgodności z protokołami. Moduł UI nie duplikuje tych reguł.

Po ekstrakcji `App.tsx` zmniejszył się z 2638 do 2527 linii.

## 3. Zachowane kontrakty

- Training Targets pozostają tylko do odczytu;
- cele użytkownika nadal dzielą się na general i telepathic;
- cele użyte w sesji lub przypisane do Research pozostają zablokowane przed edycją i usunięciem;
- obrazy celu nadal trafiają do zarządzanego magazynu przed utworzeniem rekordu;
- existing Reveal images są zachowywane podczas edycji;
- sesje nadal korzystają z istniejącego `targetIsEligibleForProtocol` poza modułem ekranu;
- nie zmieniono kolejności Reveal, Judge, Monitora ani Viewer Notes.

## 4. Testy ochronne

Dodano testy:

- grupowania Training, general i telepathic;
- sumowania blokad z target usage oraz Research assignments bez duplikatów;
- ładowania assignments ze wszystkich projektów Research;
- operacji update/delete przez kontrakt repository;
- renderowania ekranu przez publiczny punkt wejścia bez repository;
- granicy architektonicznej blokującej implementację Targets w `App.tsx` i głębokie importy modułu;
- kanonicznego adresu strony pełnych Credits;
- allowlisty Rust: dokładny adres Credits jest akceptowany, a arbitralny obcy adres odrzucany.

Istniejące testy `src/targets/service.test.ts` nadal chronią zapis celu użytkownika, zachowanie obrazów, read-only Training Targets i zgodność general/telepathic z protokołami.

## 5. Naprawa Credits

Przyczyną niedziałającego przycisku nie był błędny adres w React. Komponent wywoływał właściwy URL, ale komenda `open_project_url` po stronie Rust odrzucała go, ponieważ allowlista zawierała tylko `https://github.com/lukeskytorep-bot`.

Naprawa zachowuje zabezpieczenie: nie dopuszcza dowolnych URL ani dopasowania prefiksowego. Do tablicy dodano wyłącznie dokładny, stały adres:

`https://github.com/lukeskytorep-bot/AI-RV-Harness/blob/main/CREDITS.md`

Karta Credits została przeniesiona do prywatnego komponentu `CreditsCard.tsx`, aby duża karta nie obciążała dalej głównego pliku Settings. Wszystkie odnośniki karty korzystają z jednego lokalnego handlera pokazującego ewentualny błąd użytkownikowi.

## 6. Weryfikacja

- `npm run typecheck` — zaliczony;
- `npm test -- --run` — **87 plików testowych, 251 testów zaliczonych**;
- `npm run build` — zaliczony;
- produkcyjny build Vite zakończył się poprawnie;
- pozostało wcześniejsze, nieblokujące ostrzeżenie o głównym chunku większym niż 500 kB;
- lokalne środowisko nie posiada `cargo`, dlatego testy Rust, Clippy i `cargo fmt --check` wymagają końcowego potwierdzenia w GitHub Actions.

## 7. Świadomie niewykonane działania

- nie zmieniono numeru wersji ani publicznego wydania v0.7.12;
- nie zmieniono persistence ani migracji;
- nie przeniesiono target selection z kontrolerów sesji;
- nie rozpoczęto podziału Workspace/RV Sessions;
- nie zmieniono provider transport/retry;
- nie zmieniono zasad Viewer Notes ani Training.

## 8. Następny krok

Po zielonym GitHub Actions należy wybrać jeden kolejny ekran i najpierw scharakteryzować jego granice testami. Kandydatem o niższym ryzyku niż Workspace/RV Sessions jest prezentacyjna część AI Center, ale Viewer Notes i Training muszą zachować obecnych właścicieli domenowych. Duży ekran Workspace/RV należy nadal odłożyć do czasu lepszego pokrycia przejść i Resume.
