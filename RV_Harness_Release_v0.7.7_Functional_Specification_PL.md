# AI RV Harness — Release v0.7.7

## Funkcjonalna specyfikacja stanu „as built”

**Wersja aplikacji:** 0.7.7  
**Platforma wydania:** Windows przez Tauri 2 i GitHub Actions  
**Interfejs:** React + TypeScript  
**Warstwa natywna:** Rust + Tauri + SQLite  
**Data checkpointu:** 2026-08-21

Ten dokument jest bieżącym opisem zachowania wydania 0.7.7. W przypadku sprzeczności ze starszymi planami pierwszeństwo mają: kod i testy 0.7.7, ten dokument, `CHECKPOINT_0.7.7_PL.md`, a następnie wcześniejsze materiały.

## 1. Zasady trwałości i aktualizacji

- Aktualizacja z 0.7.6 nie wymaga usunięcia bazy danych.
- Migracje SQLite są addytywne; wcześniejsze profile, Workspaces, cele, sesje i Research pozostają dostępne.
- Sekrety providerów są przechowywane w natywnym magazynie poświadczeń systemu, nie w SQLite ani eksportach.
- Wszystkie formalne operacje zapisu zachowują istniejące blokady transakcyjne i retry dla SQLite busy/locked.

## 2. Cele

Istnieją dwa rozłączne zbiory:

1. **Training Targets** — fabryczna, read-only biblioteka dokładnie 84 celów w siedmiu kategoriach. Użytkownik nie może jej rozszerzać, edytować ani usuwać. Ustawienia nie pokazują `Download More`.
2. **My Targets** — cele użytkownika, bez fabrycznego limitu. Formularz `Add target` zawsze zapisuje tutaj i nie pokazuje kategorii Factory.

Zwykła automatyczna sesja może korzystać automatycznie wyłącznie z My Targets. Możliwy jest wybór losowy albo jawny wybór dostępnego My Target. Jeżeli katalog jest pusty, rozpoczęcie jest zablokowane z czytelną informacją, gdzie dodać cel. Druga droga to cel zewnętrzny ujawniany dopiero po zakończeniu części blind; może zawierać tekst, obrazy albo oba rodzaje danych.

## 3. Trening AI

### 3.1 Pełny trening

Pełny trening zawsze obejmuje dokładnie wszystkie 84 Factory Training Targets. Nie ma selektora źródła ani możliwości dołączenia My Targets.

### 3.2 Trening częściowy

Użytkownik ustawia liczby dla siedmiu fabrycznych kategorii i oddzielną liczbę My Targets. Każdy licznik domyślnie wynosi zero. Cele fabryczne są losowane wyłącznie z właściwej kategorii, a My Targets z całej prywatnej puli, niezależnie od historycznej kategorii w starszych danych.

Rozpoczęcie jest blokowane, jeśli suma wynosi zero, brakuje Workspace'a/modelu albo liczba przekracza dostępne cele. Zablokowana akcja wyjaśnia wymaganie.

### 3.3 Koniec sesji treningowej

Po części blind kontroler ujawnia Target Reveal i automatycznie prosi Viewera o samoocenę: zgodność danych, elementy trafne, nietrafne i częściowe, konfabulacje, mocne strony oraz możliwe usprawnienia. Jeśli wybrano AI Judge, ocena Judge'a następuje po review Viewera.

Historia treningu pozwala rozwinąć run, wybrać sesję i przeczytać dokładne instrukcje kontrolera, odpowiedzi Viewera, Reveal, review oraz oceny Judge'ów.

## 4. Automatyczna sesja RV

Obsługiwane są Full RCP 1.5a, RV Lite Core 1.1.0, RV Lite Extended 1.1.0 i Custom Protocol. Transcript pokazuje dokładną treść każdej instrukcji, a nie etykiety typu `Prompt 1`.

Po przyjęciu Revealu:

1. zapieczętowany transcript pre-Reveal pozostaje niezmienny;
2. Viewer automatycznie otrzymuje Reveal i polecenie samooceny;
3. w sesji z AI Monitor po Viewerze wypowiada się Monitor;
4. opcjonalny AI Judge ocenia wyłącznie dozwolony, zweryfikowany pakiet dowodowy;
5. użytkownik może rozpocząć opcjonalną dwustronną rozmowę po Revealu.

Nie istnieje osobny przycisk `Generate Viewer + Monitor review` ani formularz `Ask for Target Clarification`. Dodatkowe wyjaśnienia odbywają się w rozmowie, która nie zmienia zapieczętowanej części blind ani wcześniejszych ocen.

## 5. Manual RV

Manual RV utrzymuje czysty kontekst odseparowany od zwykłego czatu. Użytkownik może dołączyć jawnie jeden z zasobów:

- bez dodatkowego protokołu;
- Full RCP 1.5a;
- RV Lite Core 1.1.0;
- RV Lite Extended 1.1.0.

Wersja zasobu odpowiada językowi sesji. System Prompt Viewera z profilu nadal jest dołączany według zasad profilu.

## 6. AI Monitor i Special Task

Monitor pracuje blind, nie zna celu i po Fazach 2–6 może wydać najwyżej pięć kolejnych neutralnych poleceń. Zasady wykonawcze są widoczne i zablokowane. Edytowalna treść fabryczna jest dostępna po polsku lub angielsku zgodnie z językiem interfejsu.

Special Task jest sekcją zwijaną. Interfejs wyjaśnia, że zadanie jest przekazywane po Fazie 4 Full RCP albo po kroku 3 RV Lite, kieruje ku części celu (podmiot, struktura, obiekt, aktywność lub zdarzenie) i wymaga późniejszego wyjaśnienia neutralnych etykiet w Target Reveal.

Lista wcześniejszych sesji znajduje się w przewijanym panelu metadanych po prawej stronie, dzięki czemu setki rekordów nie wydłużają formularza nowej sesji.

## 7. Ochrona przed zapętleniem

Ochrona działa jako konserwatywna gilotyna wyjścia, a nie powód przerwania całej sesji. Zwykłe powtórzenia deskryptorów RV, numerowane dotyki, szkice i podobne wzorce pozostają dozwolone. Skracane są tylko jednoznaczne skrajne przypadki, między innymi bardzo długi identyczny znak, dziesiątki identycznych kolejnych linii, wielokrotnie powtórzony blok końcowy albo bezwzględny limit rozmiaru wiadomości. Zachowana część odpowiedzi jest zapisywana i oznaczana diagnostycznie.

## 8. Research

Research zachowuje Experiment Lock, anonimowe assignmenty, rozdział warunków od oceniającego, zamrażanie wyników przed odślepieniem i możliwość oceny zewnętrznej. Losowy wybór targetów odbywa się podczas Preflight/Lock bez dodatkowego przycisku `Wylosuj targety`.

Po zakończeniu i odślepieniu przycisk każdej sesji pokazuje badany warunek. Przed odślepieniem etykieta pozostaje ukryta.

Eksport Research ma dwa poziomy:

- czytelny dla człowieka: kompletne sesje `.md`, klucz odślepienia `.md`, README i podsumowania;
- techniczny: JSON, CSV/HTML, manifesty i pakiety Judge potrzebne do audytu i odtwarzalności.

W trybie zewnętrznej oceny udostępnia się tylko `external_evaluation`. `private_master` pozostaje ukryty do zamrożenia ocen.

## 9. Eksporty sesji i obrazów

### Zwykła sesja

Eksport użytkownika zawiera `complete_session.md` i — jeśli występują — pliki Revealu w `reveal_files`. Markdown obejmuje metadane, pełną część blind, Reveal, post-Reveal review/rozmowę i oceny Judge'ów.

### Trening

Eksport całego runu zawiera `summary.md`, katalog dla każdej sesji z `complete_session.md` oraz jej obrazy Revealu. Redundantne pliki JSON nie są częścią ludzkiego eksportu treningu.

### Reveal obrazowy

Sama ścieżka lub opis nie wystarcza. Eksporter odczytuje zarządzany artefakt, kopiuje rzeczywiste bajty obrazu do eksportu, zachowuje bezpieczne rozszerzenie/nazwę i tworzy względny link lub osadzenie Markdown. Brak lub błąd integralności artefaktu jest zgłaszany zamiast udawania kompletnego eksportu.

## 10. Prompty i język

- Zaakceptowana polska treść Viewera jest fabrycznym zasobem PL.
- Viewer i Monitor mają niezależne zasoby PL/EN.
- Przełączenie języka zamienia nietkniętą fabryczną treść edytowalną na właściwą wersję językową.
- Rzeczywiście zmodyfikowany przez użytkownika prompt nie jest nadpisywany.
- Zablokowane bloki tożsamości, definicji aktywności i reguł wykonania nie są edytowalne.

## 11. Licencje

Kod źródłowy jest objęty MIT. Dokumentacja, dołączone prompty, treści treningowe i pozostałe niekodowe zasoby wizualne są objęte CC BY 4.0. Nie ma osobnego wyjątku licencyjnego dla znaku Rosehip. Materiały użytkownika i treści stron trzecich zachowują własne prawa i nie są automatycznie relicencjonowane przez aplikację.

## 12. Wydanie Windows

Workflow `.github/workflows/release-windows.yml` działa ręcznie na `main`, synchronizuje `Cargo.lock`, instaluje Node i Rust, uruchamia TypeScript, Vitest, Rust tests i Clippy, a potem wywołuje oficjalną akcję Tauri tworzącą draft release `AI RV Harness v0.7.7` oraz instalator Windows.

Paczka źródłowa musi zawierać całą strukturę repozytorium, w tym pliki ukryte `.github`, `.gitignore` i `.env.example`, ale nie powinna zawierać `node_modules`, `dist`, cache TypeScript ani `src-tauri/target`.

**Koniec źródła prawdy dla AI RV Harness release v0.7.7.**
