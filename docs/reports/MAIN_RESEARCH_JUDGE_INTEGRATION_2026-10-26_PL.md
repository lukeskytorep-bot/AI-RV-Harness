# Nakładka aktualnego main do pełnej bazy Research Judge Completion 1–2

26 października 2026. Przygotowana względem załączonego AI-RV-Harness-main.zip. Dokładny SHA-256 archiwum i plików znajduje się w manifeście.

## Zastosowanie

Otwórz plik AI_RV_HARNESS_MAIN_COMPLETE_RESEARCH_INTEGRATION_CHANGED_FILES.zip i skopiuj CAŁĄ zawartość bezpośrednio do katalogu repozytorium na main, zastępując istniejące pliki. ZIP ma od razu katalogi src/, src-tauri/, docs/, .github/ itd., bez dodatkowego katalogu nadrzędnego. Uwzględnij ukryty katalog .github. Nie trzeba niczego usuwać. Zapisz i wypchnij zmianę z GitHub Desktop. Nie nakładaj potem starszych paczek Completion 1/2 ani starego pełnego źródła.

Poczekaj na pełne CI, w tym Cargo tests i Clippy. Następnie z jednego commitu main zbuduj Release Windows i Release Linux. Istniejące instalatory z commitu c6e55e7 nie zawierają tych zmian; trzeba zastąpić je nowymi buildami, z nowymi hashami i attestacjami. Poprzednich sum SHA-256 i attestacji nie wolno przypisywać nowym plikom. Jeśli 0.7.14 pozostaje szkicem, aktualizuj szkic; jeżeli została już opublikowana, przygotuj osobną nową wersję zamiast po cichu podmieniać publiczne wydanie.

## Dlaczego zakres jest większy niż dwie nakładki

Załączony main nie ma wcześniejszej bazy wymaganej przez Completion 1, np. src/application/workflowOwnership.ts i src/research/judgeRequestRecovery.ts. Completion 1 był przygotowany na załączonym wówczas ai-rv-2, a Completion 2 na pełnym wyniku Completion 1. Samo skopiowanie 17+28 plików na ten main dałoby niekompletną aplikację.

Punktem docelowym jest pełny SOURCE.zip z załączonego pakietu Research Judge Completion 2. Zawiera oba etapy i ich wcześniejsze zależności projektowe. Nie pisano na nowo tych mechanizmów. Nakładka obejmuje wszystkie różnice między tą bazą a załączonym main: 608 plików kodu i dokumentacji, plus ten raport i manifest. To awans pełnej, uprzednio audytowanej linii źródła do main, a nie izolowany backport dwóch funkcji.

Przenosi m.in. istniejące w docelowej bazie Telepathy, aktualizacje Training/Reveal, sampling, schema 028–034, naprawę native runtime ownership/IPC, recovery i oba etapy Judge Completion. Schema rośnie z 027 do 034 przy zachowaniu istniejącego compatibility epoch v0.7.13. Nie zmieniano ani nie otwierano bazy użytkownika. Przed instalacją wykonaj kopię zapasową; rzeczywiste przejście bazy na Windows pozostaje elementem odbioru desktopowego.

## Co zachowano z załączonego main

Bajt w bajt zachowano:

- README.md;
- .github/workflows/release-windows.yml;
- .github/workflows/release-linux.yml;
- .github/workflows/build-linux-test.yml (plik istniejący tylko na main);
- scripts/verify-direct-providers-direct2a.mjs;
- scripts/verify-direct-providers-direct2b.mjs.

Te pliki nie są w nakładce, bo nie trzeba ich zastępować. Pozostałe pliki pochodzą z docelowego SOURCE Completion 2. Wersja aplikacji pozostaje 0.7.14. Nowszy docelowy test wersji uwzględnia 0.7.14. Workflow gałęzi roboczej nie zastępuje workflow Release na main.

## Sprawdzenie

Typecheck: PASS.
Frontend production build: PASS (istniejące ostrzeżenie o dużym bundle).
Architektura i jej self-tests: PASS.
UX-DATA/schema 34: PASS.
Strukturalny release gate: PASS.
Statyczne skrypty DIRECT-2A i DIRECT-2B: PASS.
Integralność czystego źródła: PASS.
Self-tests i hash verification native runtime ownership patch: PASS.

Pierwsze wywołanie kontroli integralności w katalogu roboczym odrzuciło node_modules i wygenerowane pliki tsbuildinfo, zgodnie z zasadami czystości paczki. Następnie kontrolę uruchomiono na czystym źródle i przeszła. Paczka końcowa nie zawiera zależności ani wyników kompilacji. Pierwsza próba uruchomienia weryfikatora z katalogu nadrzędnego nie znalazła skryptu; poprawne uruchomienia wykonano z katalogu projektu.

Pełny Vitest: 337 plików PASS, 1 SKIP; 2580 testów PASS, 1 SKIP; czas 126,73 s.

Nie uruchomiono Cargo/Clippy ani natywnego Windows/Linux, ponieważ to środowisko nie ma kompilatora Rust. Nie potwierdzono live API ani Windows upgrade na prywatnej bazie. Hash verification poprawki Rust nie zastępuje kompilacji i testu runtime.

## Korekta pakowania R2

Usunięto z nakładki katalogi architecture/, development/ i wiki/ z katalogu głównego. Ich dokumentację scalono pod docs/; nowszy Developer Guide z opisem Completion 1–2 zachowano. Kod aplikacji i testów jest identyczny jak w poprzedniej przetestowanej nakładce (2580 PASS, 1 SKIP). Nie uruchamiano ponownie pełnego zestawu po zmianie wyłącznie rozmieszczenia dokumentacji. ZIP zawiera jawne wpisy katalogów. Jeśli poprzednia nakładka została już nałożona, usuń z repozytorium tylko te trzy nieprawidłowe katalogi główne; nie usuwaj docs/architecture, docs/development ani docs/wiki.
