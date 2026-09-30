# AI RV Harness v0.7.13 — raport ekstrakcji modułu Home

> **Status:** wykonano i potwierdzono w GitHub Actions; prywatna baza rozwojowa  
> **Rodzaj zmiany:** refaktoryzacja bez celowej zmiany zachowania  
> **Etap planu:** Etap 3 — pierwszy wzorzec modułu frontendowego

## 1. Cel

Celem było rozpoczęcie rzeczywistego odchudzania `src/App.tsx` od ekranu o małym ryzyku. Home wyświetla dane przekazane przez powłokę aplikacji i deleguje akcje przez callbacki. Nie wykonuje operacji providerów, nie zapisuje danych oraz nie steruje przebiegiem sesji RV.

## 2. Wykonane zmiany

- utworzono `src/features/home/HomeScreen.tsx`;
- utworzono publiczny punkt wejścia `src/features/home/index.ts`;
- przeniesiono ekran Home i jego prywatne komponenty prezentacyjne z `src/App.tsx`;
- zachowano w `App.tsx` własność stanu nawigacji oraz funkcji otwierających Profile, Workspace i sesje;
- nie zmieniono tekstów, klas CSS, układu ani zasad wyboru ostatniego Profilu i Workspace;
- dodano `src/features/home/HomeScreen.test.tsx`;
- zaktualizowano mapę kodu i opis granic modułów.

## 3. Granica modułu

Publicznym kontraktem jest `HomeScreenProps`. Moduł Home otrzymuje:

- gotowe dane Profilu, Workspace i ostatnich sesji;
- przetłumaczony zestaw tekstów;
- callbacki nawigacyjne należące do powłoki aplikacji.

Moduł nie importuje repository, transportu providera, Tauri ani kontrolerów sesji. Dzięki temu pozostaje widokiem łatwym do sprawdzenia bez uruchamiania całej aplikacji.

## 4. Testy regresyjne

Testy modułu sprawdzają:

1. pusty stan Home bez Profilu, Workspace i historii;
2. renderowanie bieżących oraz ostatnich danych;
3. przekazywanie akcji do callbacków powłoki, bez przejmowania nawigacji przez moduł.

Końcowa weryfikacja lokalna:

- **80 plików testowych — 234 testy zaliczone**;
- `npm run typecheck` — zaliczony;
- `npm run build` — zaliczony;
- Vite zgłasza jedynie istniejące ostrzeżenie o rozmiarze głównego chunku; nie blokuje ono buildu i nie zostało wywołane przez zmianę zachowania Home.

### 4.1. Korekta po pierwszym przebiegu GitHub Actions

GitHub Actions z Rust 1.98 przerwał `cargo clippy --all-targets --locked -- -D warnings`, ponieważ `ProviderCallError` miał co najmniej 168 bajtów. Clippy zgłosił `result_large_err` dla trzech funkcji zwracających ten typ.

Wprowadzona korekta:

- tekstowe pola `ProviderCallError` używają teraz `Box<str>` zamiast `String`;
- kształt i nazwy pól serializowanego błędu pozostały identyczne dla frontendu;
- typ zajmuje najwyżej 128 bajtów, co chroni nowy test regresyjny;
- test sprawdza także pełny JSON błędu, w tym `code`, `message`, `phase`, status HTTP, metadane providera, `Retry-After` i identyfikator żądania;
- nie zastosowano `#[allow(clippy::result_large_err)]` i nie ukryto ostrzeżenia.

Po korekcie użytkownik potwierdził pełny zielony przebieg GitHub Actions, obejmujący także kontrolę Rust/Clippy. Frontendowe testy, typecheck i build również pozostały zaliczone.

## 5. Wpływ na `App.tsx`

`App.tsx` zmniejszył się z około 3242 do 3154 linii. Sama liczba linii nie jest kryterium sukcesu. Ważniejsze jest to, że Home ma teraz jednego właściciela i publiczny punkt wejścia, który można zastosować jako wzorzec przy kolejnych ekstrakcjach.

## 6. Świadomie niewykonane działania

- nie przenoszono Settings ani innych ekranów;
- nie tworzono globalnego contextu React;
- nie zmieniano CSS ani tłumaczeń;
- nie zmieniano repository, schematu bazy ani żadnej ścieżki AI;
- nie przenoszono wspólnych helperów na zapas — lokalne elementy Home pozostają prywatne, dopóki nie pojawi się rzeczywista potrzeba współdzielenia.

## 7. Następny zalecany krok

Settings został następnie wydzielony jako osobna, odwracalna zmiana opisana w `MODULARIZATION_SETTINGS_EXTRACTION_v0.7.13_PL.md`. Następnym niskiego ryzyka kandydatem jest Profiles, po wcześniejszym opisaniu zależności tworzenia, edycji i archiwizacji Profilu.
