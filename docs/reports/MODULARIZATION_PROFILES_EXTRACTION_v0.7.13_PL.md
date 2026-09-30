# AI RV Harness v0.7.13 — raport ekstrakcji modułu Profiles

> **Status:** wykonano i potwierdzono w GitHub Actions  
> **Rodzaj zmiany:** refaktoryzacja frontendowa bez celowej zmiany zachowania oraz konserwacja GitHub Actions  
> **Etap planu:** Etap 4 — stopniowe odchudzanie `App.tsx`

## 1. Cel i zakres

Kolejny mały krok modularizacji wydziela ekran Profiles z `App.tsx` bez zmiany schematu danych, nawigacji, provider transportu, sesji ani zasad Viewer Notes. W tym samym kandydacie zaktualizowano przypięte akcje GitHub do wydań uruchamianych natywnie na Node.js 24, aby usunąć ostrzeżenie o wymuszonym przejściu z Node.js 20.

## 2. Nowa granica Profiles

Utworzono publiczny moduł `src/features/profiles/`, który posiada:

- ekran listy Profilów oraz należących do nich Workspace;
- prezentację gotowości konfiguracji Viewera i historii kalibracji;
- formularze tworzenia i edycji Profilu;
- kontrolki reasoning, temperature i system promptu Viewera;
- uporządkowane operacje edycji, konfiguracji AI i archiwizacji Profilu;
- publiczny punkt wejścia `src/features/profiles/index.ts`.

`App.tsx` zachowuje własność kanonicznej listy Profilów, inicjalizacji repository, nawigacji, pierwszego uruchomienia oraz odświeżania danych. Moduł Profiles otrzymuje repository i callbacki przez jawny kontrakt `ProfilesScreenProps`.

Współdzielone prymitywy `PageHeader`, `EmptyState` i `FormDialog` przeniesiono do `src/components/`, ponieważ korzystają z nich również inne obszary. Etykiety możliwości reasoning przeniesiono do `src/providers/reasoningPresentation.ts`. Usunięto nieużywany `LegacyCreateProfileDialog`.

Po ekstrakcji `App.tsx` zmniejszył się z 2932 do 2638 linii.

## 3. Ochrona regresji

Dodano testy:

- pustego i wypełnionego widoku Profiles;
- renderowania przez publiczny punkt wejścia;
- kolejności archiwizacji i odświeżenia listy;
- kolejności zapisu Profilu, konfiguracji AI, zamknięcia formularza i odświeżenia;
- normalizacji konfiguracji Viewera i odrzucenia temperature poza zakresem;
- granicy architektonicznej blokującej implementację Profiles w `App.tsx` oraz głębokie importy modułu.

## 4. Konserwacja GitHub Actions

Zaktualizowano wszystkie wystąpienia, zachowując przypięcie do pełnego SHA:

| Akcja | Poprzednio | Obecnie |
| --- | --- | --- |
| `actions/checkout` | v4.4.0 / Node.js 20 | v5.1.0 / Node.js 24 |
| `actions/setup-node` | v4.4.0 / Node.js 20 | v6.5.0 / Node.js 24 |
| `Swatinem/rust-cache` | v2.8.0 / Node.js 20 | v2.9.2 / Node.js 24 |

Zmiana obejmuje CI, CodeQL, przygotowanie `Cargo.lock` oraz workflowy wydawnicze Windows i Linux. `node-version: 24` pozostaje bez zmian; określa Node używany przez projekt, natomiast ostrzeżenie dotyczyło runtime samych akcji.

## 5. Weryfikacja lokalna

- `npm run typecheck` — zaliczony;
- `npm test -- --run` — **84 pliki testowe, 244 testy zaliczone**;
- `npm run build` — zaliczony;
- produkcyjny build Vite zakończył się poprawnie; pozostało wcześniejsze, nieblokujące ostrzeżenie o głównym chunku większym niż 500 kB;
- wszystkie pięć workflowów YAML poprawnie przechodzi parser, a kontrola nie wykazała aktywnych wystąpień starych SHA.

Kod Rust nie został zmieniony w tym kroku. Użytkownik potwierdził 2 września 2026, że pełny GitHub Actions, w tym Rust i Clippy, zakończył się bez błędów i bez wcześniejszych ostrzeżeń o runtime Node.js 20.

## 6. Świadomie niewykonane działania

- nie zmieniono wersji aplikacji ani publicznego wydania v0.7.12;
- nie zmieniono persistence ani formatu danych Profilu;
- nie przeniesiono przepływu pierwszego uruchomienia;
- nie zmieniono tworzenia, edycji ani archiwizacji Workspace;
- nie zmieniono provider retry, Reveal, Judge, Monitora ani Viewer Notes;
- nie rozpoczęto podziału repository.

## 7. Następny krok

GitHub Actions został potwierdzony. Następny osobny krok — moduł Targets — został wykonany i opisany w `docs/reports/MODULARIZATION_TARGETS_EXTRACTION_v0.7.13_PL.md`.
