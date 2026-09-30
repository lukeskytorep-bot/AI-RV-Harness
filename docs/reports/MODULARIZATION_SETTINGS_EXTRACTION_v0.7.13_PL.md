# AI RV Harness v0.7.13 — raport ekstrakcji modułu Settings

> **Status:** wykonano i potwierdzono w GitHub Actions, łącznie z testami Rust i Clippy  
> **Rodzaj zmiany:** refaktoryzacja frontendowa bez celowej zmiany zachowania oraz dwie małe, jawne poprawki produktu  
> **Etap planu:** Etap 4 — stopniowe odchudzanie `App.tsx`

## 1. Cel

Celem było wykonanie następnego małego kroku modularizacji po wydzieleniu Home: przeniesienie ekranu Settings do samodzielnego modułu z publicznym punktem wejścia. Zmiana nie przebudowuje storage, provider retry ani zasad sesji.

W tym samym prywatnym kandydacie wykonano dwie niezależne, małe poprawki uzgodnione dla v0.7.13:

1. identyfikację aplikacji w OpenRouter przez nagłówki `HTTP-Referer` i `X-OpenRouter-Title`;
2. zmianę wizualną przycisku `Resume training` z koloru ostrzegawczego na niebieski.

## 2. Wydzielenie Settings

Utworzono:

- `src/features/settings/SettingsScreen.tsx`;
- `src/features/settings/index.ts`;
- `src/features/settings/SettingsScreen.test.tsx`.

Do modułu przeniesiono:

- wybór aktywnej zakładki Settings;
- integrację widoków Providers i Models;
- kartę pamięci danych, backupu oraz przywracania archiwum;
- ustawienia targetów i sesji;
- ustawienia wyglądu;
- diagnostykę zaawansowaną;
- bibliotekę protokołów, promptów, dokumentów oraz Credits;
- prywatne dialogi i helpery używane wyłącznie przez Settings.

`App.tsx` zachowuje własność kanonicznego obiektu `AppSettings`, inicjalizację repository i zapis ustawień. Moduł otrzymuje dane oraz operacje przez `SettingsScreenProps`; nie tworzy drugiego globalnego magazynu stanu.

Wspólny `ProtocolDialog` został przeniesiony do `src/components/ProtocolDialog.tsx`, ponieważ korzystają z niego zarówno Settings, jak i ekran sesji RV. Nie utworzono dwóch kopii tego komponentu.

## 3. Granica i kontrola importów

Publiczny import ma postać:

```ts
import { SettingsScreen } from "./features/settings";
```

Test architektury sprawdza, że:

- implementacja `SettingsScreen` nie wróciła do `App.tsx`;
- konsumenci nie importują plików z wnętrza `features/settings/`;
- `App.tsx` korzysta z publicznego `index.ts`.

Po ekstrakcji `App.tsx` zmniejszył się z 3154 do 2932 linii. Liczba linii jest wyłącznie wskaźnikiem pomocniczym; kryterium stanowi jasny właściciel ekranu i zachowanie dotychczasowego kontraktu.

## 4. Identyfikacja OpenRouter

W `src-tauri/src/providers.rs` gałąź uwierzytelnienia `ProviderKind::Openrouter` dodaje teraz do każdego żądania OpenRouter:

```text
HTTP-Referer: https://github.com/lukeskytorep-bot/AI-RV-Harness
X-OpenRouter-Title: AI RV Harness
```

Nagłówki są ustawiane w jednym wspólnym miejscu razem z autoryzacją. Obejmuje to zarówno pobieranie listy modeli, jak i wywołania czatu. Inni providerzy oraz własne endpointy OpenAI-compatible nie otrzymują tych nagłówków.

Dodano test Rust z lokalnym symulatorem HTTP, który sprawdza nagłówek autoryzacji oraz oba nagłówki identyfikujące aplikację. Test nie wysyła prawdziwego klucza ani żądania do OpenRouter.

## 5. Kolor Resume training

Przycisk zachowuje dotychczasową akcję, tekst, warunki widoczności i klasę `training-resume-button`. Zmieniono wyłącznie jego kolory na niebieskie oraz dodano spójny niebieski stan hover.

Czerwony i pomarańczowy pozostają zarezerwowane dla błędów, ostrzeżeń i operacji ryzykownych. Wznowienie jest bezpieczną akcją kontynuacji, dlatego nie powinno wyglądać jak operacja destrukcyjna.

## 6. Weryfikacja

Wynik lokalny:

- `npm run typecheck` — zaliczony;
- `npm test` — **81 plików testowych, 237 testów zaliczonych**;
- `npm run build` — zaliczony;
- produkcyjny build Vite zakończył się poprawnie;
- pozostało istniejące, nieblokujące ostrzeżenie o głównym chunku większym niż 500 kB.

Lokalne środowisko nie zawierało `cargo` ani `rustfmt`. Nowy test nagłówków OpenRouter oraz cały kod Rust zostały następnie potwierdzone przez zielony przebieg GitHub Actions obejmujący:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
```

Pierwszy przebieg Clippy ujawnił `clippy::result_large_err`; reprezentację dużych pól błędu zmniejszono bez zmiany kontraktu JSON. Po tej korekcie użytkownik potwierdził pełny zielony przebieg workflowów.

## 7. Świadomie niewykonane działania

- nie zmieniono wersji aplikacji — baza pozostaje prywatnym v0.7.13;
- nie zmieniono repository ani schematu bazy;
- nie przenoszono Profiles, Targets, Training ani krytycznych kontrolerów sesji;
- nie zmieniono retry, cancellation, Viewer Notes ani kolejności Reveal/Judge;
- nie dodano automatycznego fallbacku modelu;
- nie zmieniono sposobu zapisu ustawień;
- nie zmieniono publicznego wydania v0.7.12.

## 8. Następny zalecany krok

Następnym kandydatem jest osobna ekstrakcja Profiles. Przed przeniesieniem należy opisać testami:

1. tworzenie i pierwszą konfigurację Profilu;
2. edycję nazw Human/AI IS-BE i domyślnych tras modeli;
3. archiwizację oraz przywracanie;
4. zależności od konfiguracji providerów;
5. zachowanie Workspace należących do Profilu.

Nie należy łączyć tego kroku z podziałem repository ani zmianą przepływu pierwszego uruchomienia.
