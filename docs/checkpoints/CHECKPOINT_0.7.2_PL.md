# AI RV Harness — checkpoint 0.7.2

## Cel aktualizacji

Wersja 0.7.2 konsoliduje wszystkie niewydane zmiany wykonane po opublikowanym Windows Release 0.7.1. Nie zmienia ani nie przepisuje tagu `app-v0.7.1`.

## Pierwsze uruchomienie i Profile

Nowa instalacja prowadzi użytkownika przez konfigurację providera i klucza API, test połączenia, wybór modelu Viewera oraz utworzenie pierwszego Profilu. Imię/nazwa Profilu, AI Judge i AI Monitor pozostają opcjonalne.

Podczas pierwszej konfiguracji, tworzenia i edycji Profilu można ustawić:

- model Viewera;
- dokładny poziom reasoning albo `Automatycznie / domyślne providera`;
- temperaturę, początkowo 0,9, tylko gdy model jawnie ją obsługuje;
- System Prompt Viewera;
- opcjonalny model AI Judge;
- opcjonalny model AI Monitora.

Nieznane albo nieobsługiwane parametry pozostają zablokowane i nie trafiają do requestu. Domyślne ustawienia są nadal możliwe do jednorazowej zmiany dla konkretnej sesji.

## Klucze API

Przyczyną wcześniejszego komunikatu `credential not found in secure storage` był brak jawnie włączonego natywnego backendu Windows w bibliotece keyring. Wersja 0.7.2:

- włącza osobne natywne backendy keyring dla Windows, macOS i Linux;
- po zapisie natychmiast odczytuje nowy sekret kontrolnie;
- nigdy nie zapisuje surowego klucza w SQLite, eksporcie ani webview.

Jeśli połączenie z wcześniejszej wadliwej instalacji nie ma sekretu, należy je usunąć i dodać ponownie. Interfejs nie zawiera osobnego przycisku `Replace API key`.

## System Prompt Viewera

Prompt Profilu jest używany w Manual RV oraz automatycznych sesjach Full RCP, RV Lite i Custom Protocol. Conversation zachowuje własny, odseparowany prompt rozmowy. Formalne sesje zapisują dokładną treść, identyfikator, wersję i SHA-256 promptu, dlatego późniejsza edycja Profilu nie zmienia historii.

System Prompt jest wprowadzany w dużym, wielowierszowym i pionowo rozszerzalnym edytorze, a nie w małym polu tekstowym. Ten sam czytelny układ obowiązuje przy pierwszej konfiguracji, tworzeniu i edycji Profilu, własnym stałym prompcie Research, wariantach System Prompt Comparison oraz System Prompcie Custom Protocol. Podgląd promptu Profilu w Research jest powiększony i przewijalny.

## My Targets i wybór celów

Własne, jeszcze nieużyte cele można edytować i usuwać. Training Targets pozostają tylko do odczytu. Cel użyty przez sesję albo zablokowany Research jest chroniony przez reguły aplikacji i SQLite.

Research pozwala wybrać `Training Targets`, `My Targets` albo obie pule, a następnie:

- wyszukać i zaznaczyć cele ręcznie; albo
- wylosować zadaną liczbę unikalnych celów.

Wylosowana lista jest zamrażana w Experiment Lock.

## Nadrzędne ustawienia Research

Na początku każdego Buildera znajduje się blok `Ustawienia Viewera dla tego badania`. Domyślnie przejmuje wartości bazowego Profilu, ale pozwala ustawić inne parametry tylko dla tego eksperymentu:

- model LLM Viewera;
- System Prompt z Profilu albo własny;
- reasoning;
- temperaturę, gdy wszystkie uczestniczące trasy ją obsługują;
- maksymalną liczbę tokenów outputu.

Szablon badania określa dokładnie jedną zmienną. Przy teście reasoning zmienia się tylko reasoning, przy teście temperatury tylko temperatura, przy porównaniu modeli tylko model, a przy System Prompt Comparison tylko prompt. Pozostałe wartości są identyczne we wszystkich warunkach.

W porównaniu Profili/API key wybrany model, prompt, reasoning, temperatura i limit outputu są stosowane identycznie do każdego Profilu. Wspólne kontrolki pojawiają się tylko wtedy, gdy wszystkie wybrane trasy deklarują zgodną obsługę. Preflight blokuje:

- drugą przypadkowo zmienioną zmienną;
- nieobsługiwane requested settings;
- rozbieżność między nadrzędnym Viewer Control a warunkami;
- różne prompty poza System Prompt Comparison.

Pełny Viewer Control, capabilities, requested/effective settings, treść/hash promptu i lista targetów trafiają do Experiment Lock oraz eksportu Research.

## Dobrowolny AI Judge

Research może użyć 1–3 wewnętrznych AI Judge’ów albo trybu `Tylko zapisz / ocena zewnętrzna`. Tryb save-only eksportuje:

- `external_evaluation` — anonimowe sesje, obrazy Revealu, prompt i instrukcję dla innego AI albo ludzkiego Judge’a;
- `private_master` — konfigurację, mapowanie warunków i Blinding Key, których nie należy ujawniać przed zamrożeniem ocen.

## O projekcie i protokoły

Settings ma nową kartę `O projekcie i protokoły`. Zawiera:

- pełny Full RCP 1.5a po polsku i angielsku;
- pełny RV Lite 1.0.0 po polsku i angielsku;
- liczbę słów, wersję i hashe zasobów;
- credits projektu i współpracowników AI;
- numer aplikacji i informację o licencji MIT.

Protokoły są tylko do odczytu i pochodzą z dokładnie tych samych wersjonowanych zasobów, których używają kontrolery sesji.

## Windows SmartScreen / antywirus

Kod 0.7.2 nie jest podpisany Authenticode. Każdy nowy build ma inny hash, dlatego Windows SmartScreen lub zewnętrzny antywirus może ponawiać ostrzeżenie. Trwałe ograniczenie tego problemu wymaga stałej, zweryfikowanej tożsamości podpisującej albo dystrybucji przez Microsoft Store; nie da się tego wiarygodnie usunąć samą zmianą interfejsu.

## Zgodność i weryfikacja

Aktualizacja zachowuje Profile, Workspace, sesje, cele, Research i ustawienia z bazy 0.7.1. Nowe pola są opcjonalne, a migracje nie nadpisują istniejących danych.

- TypeScript: poprawny;
- Vitest: 43 pliki, 101/101 testów;
- produkcyjny build Vite: poprawny;
- 13 migracji SQLite;
- testy obejmują konfigurację Profili, capabilities, targety, wybór/losowanie celów, save-only, stałość kontrolowanych zmiennych, System Prompt i granice blindingu;
- natywny Rust/Tauri jest sprawdzany przez workflow CI/Release Windows, jeśli lokalne środowisko nie ma toolchainu Rust.
