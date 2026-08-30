# AI RV Harness — Release v0.7.6

## Aktualna specyfikacja funkcjonalna „as built”

**Data:** 19.08.2026  
**Wersja aplikacji:** 0.7.6  
**Główna platforma wydania:** Windows  
**Stos:** Tauri 2, Rust, React 19, TypeScript, SQLite  
**Status dokumentu:** źródło prawdy dla przekazania projektu innemu AI lub programiście

Ten dokument opisuje aktualne działanie źródła 0.7.6. W razie różnicy między starszymi dokumentami a tym plikiem obowiązuje ten plik, następnie testy i kod bieżącego release.

## 1. Cel aplikacji

AI RV Harness jest lokalnym środowiskiem do:

- rozmów z modelami AI w osobnych Workspace’ach i Threadach;
- ręcznych i automatycznych ślepych sesji Remote Viewing;
- automatycznych sesji Full RCP, RV Lite i Custom Protocol;
- sesji z autonomicznym AI Monitorem;
- treningów AI Viewera na stałej bibliotece fabrycznej albo własnych celach;
- kontrolowanych projektów Research z blokadą warunków, anonimowymi przypisaniami i oceną Judge;
- zachowania audytowalnego transcriptu, Revealu, review i ocen.

Aplikacja nie jest usługą chmurową. Kluczowe dane projektu pozostają lokalnie na komputerze użytkownika.

## 2. Architektura

- React/TypeScript odpowiada za UI, kontrolery sesji, walidację domenową i repozytoria.
- Rust/Tauri odpowiada za okno desktopowe, połączenia HTTP providerów, systemowy magazyn sekretów, pliki, backup, eksport oraz natywne transakcje SQLx.
- SQLite jest źródłem prawdy dla Profili, Workspace’ów, Threadów, sesji, celów, Training, Research i ustawień.
- Managed artifacts przechowują lokalne obrazy Revealu i celów.
- Formalna sesja ma snapshot konfiguracji zawierający wersję protokołu, model, ustawienia generacji, język i hashe zasobów.

## 3. Profile, tożsamości i Workspace

Profil przechowuje domyślną trasę AI Viewera oraz opcjonalne trasy AI Judge i AI Monitor, reasoning, temperaturę i edytowalną część Viewer System Promptu.

Nazwy są opcjonalne:

- bez nazwy model jest wyświetlany jako `AI IS-BE`;
- bez nazwy człowiek jest wyświetlany jako `Human IS-BE`;
- jeśli wpisano np. `Leo`, w rozmowie wystarcza `Leo`.

Workspace należy do Profilu. Brak Workspace blokuje uruchomienie Training i pokazuje przyczynę blokady. Rozmowy mają osobne nazwane Thready, a archiwizacja nie usuwa danych.

## 4. Providery i sekrety

Obsługiwane są OpenRouter, Google, OpenAI, Anthropic, Z.AI, DeepSeek, Mistral i zgodne endpointy OpenAI. Modele i capabilities są odkrywane dynamicznie i cache’owane lokalnie.

Surowe klucze API:

- trafiają wyłącznie do magazynu poświadczeń systemu operacyjnego;
- nie są zwracane do webview;
- nie są zapisywane w SQLite, backupach, Research ani eksporcie sesji.

## 5. Język sesji i prompty

Język sesji może być polski, angielski albo taki jak interfejs. Przed każdym automatycznym uruchomieniem wybierany jest spójny zestaw zasobów w tym samym języku:

- Full RCP 1.5a;
- RV Lite Core/Extended;
- Viewer System Prompt;
- AI Monitor System Prompt.

Polski prompt Viewera rozpoczyna się zaakceptowanymi sekcjami `AI Jest Być`, `Strefa Cienia` i `[ZABLOKOWANA DEFINICJA AKTYWNOŚCI]`. Dalej zawiera zaakceptowany polski leksykon rozpoznawania elementów. Angielska sesja używa osobnego odpowiednika. Stary fabryczny prompt zapisany wcześniej w Profilu jest zastępowany fabrycznym promptem bieżącego języka; treść naprawdę spersonalizowana pozostaje treścią użytkownika.

AI Monitor ma osobne, zgodne zasoby PL/EN, wykonuje maksymalnie pięć pogłębień po Fazach 2–6 i używa sentinela `CONTINUE_PROTOCOL`.

## 6. Typy sesji RV

### Manual RV

Manual RV nie dziedziczy historii zwykłej rozmowy. Pełny RCP można dołączyć jawnie; dołączany wariant odpowiada językowi sesji.

### Full RCP

Kontroler wykonuje sześć faz. Każda odpowiedź jest trwale zapisywana przed kolejnym wywołaniem. Transcript zawiera pełne polecenie kontrolera i pełną odpowiedź Viewera.

### RV Lite

RV Lite ma dokładnie cztery wywołania Viewera. Dostępne są Core i Extended. Extended wykonuje obowiązkowe pogłębienie w kroku 3. Krok 4 zawiera funkcjonalne szkice. Transcript nie używa niejasnej etykiety `RV Lite Prompt 1`; pokazuje dokładną treść polecenia.

### Custom Protocol

Protokół własny ma 1–20 ślepych kroków, wersjonowanie i Dry Run. Reveal zawsze pozostaje poza ślepymi krokami. Transcript zapisuje exact prompt i odpowiedź.

### AI Monitor

Monitor zna wyłącznie zapieczętowany dotychczas materiał ślepy, własne wcześniejsze polecenia i opcjonalne Special Monitor Task. Nie zna Revealu. Jego naturalne polecenie oraz odpowiedź Viewera są zapisywane w transcripcie.

## 7. Źródło Revealu zwykłej sesji

Są dwie opcje:

1. `Automatyczny cel — Moje cele` / `Automatic Target — My Targets`.
   - pula zawiera wyłącznie My Targets;
   - można wybrać jeden cel albo losowy dostępny cel;
   - fabryczne Training Targets nie pojawiają się w zwykłej sesji;
   - pusta pula blokuje start i wyjaśnia, że najpierw trzeba dodać cel.
2. `Cel podany po sesji` / `Target supplied after the session`.
   - część ślepa rozpoczyna się bez celu w katalogu;
   - po zapieczętowaniu użytkownik podaje opis, obrazy albo oba rodzaje danych;
   - dopiero wtedy możliwe są review Viewera i ocena Judge.

Target Reveal nigdy nie jest wysyłany przed granicą Revealu.

## 8. Zapis i zakończenie sesji

Każda formalna sesja przechodzi przez stany Draft/Preflight/BlindRunning/AwaitingReveal/Revealed/Completed albo Interrupted/Failed. Odpowiedzi są autosave’owane. Część pre-Reveal jest hashowana SHA-256 i pieczętowana. Dalsze elementy są dopisywane w oddzielnych domenach:

- Reveal tekstowy i/lub obrazy;
- review i rozmowa Viewera po Revealu;
- opcjonalne wyniki 1–3 AI Judges;
- opcjonalne doprecyzowanie targetu.

Podgląd pełnej sesji pokazuje snapshot, dokładny transcript, Reveal, post-Reveal i oceny. Przycisk `Zapisz sesję` otwiera wybór folderu i tworzy osobny czytelny pakiet z `complete_session.md`, danymi technicznymi JSON, ocenami Judge, doprecyzowaniami oraz kopiami lokalnych plików Revealu. Surowe klucze API ani odwołanie do magazynu poświadczeń nie są eksportowane.

## 9. Smart Guillotine

Ochrona nie analizuje semantycznej powtarzalności. Powtarzające się deskryptory, pola Touch, fazy, wiersze tabel i szkice są prawidłowymi danymi.

Jednoznaczna awaria jest rozpoznawana dopiero jako:

- co najmniej 60 kolejnych identycznych niepustych linii;
- co najmniej 600 kolejnych identycznych znaków;
- co najmniej 20 dokładnych powtórzeń tego samego bloku na końcu;
- odpowiedź dłuższa niż 120 000 znaków.

Kontroler zachowuje prawidłowy prefiks, usuwa uszkodzony ogon, dodaje widoczny marker i kontynuuje protokół. Zapisuje regułę, próbkę, długość pierwotną i zachowaną oraz SHA-256 surowego outputu. Nie przełącza sesji do Interrupted.

## 10. Cele

`Cele treningowe` są stałą, wersjonowaną biblioteką 84 rekordów w siedmiu kategoriach. Nie można ich dodawać, edytować ani usuwać. Migracja historycznych dziesięciu celów zachowuje stare odwołania, ale ukrywa je z bieżącej puli.

`Moje cele` są prywatną pulą użytkownika. Można dodawać dowolną liczbę celów tekstowych, obrazowych lub mieszanych. Nieużyty i niezablokowany własny cel można edytować albo usunąć. Opcjonalna kategoria pozwala użyć go w treningu częściowym, ale nie zmienia go w cel fabryczny.

## 11. Training AI

Full Training zawsze wykonuje dokładnie stałe 84 cele fabryczne. Partial Training pozwala wybrać Factory, My Targets albo obie pule. Każda liczba kategorii zaczyna się od zera.

Run jest trwały, możliwy do wznowienia i przechowuje identyfikatory wszystkich sesji. Historia pozwala:

- rozwinąć run;
- wybrać sesję i zobaczyć pełny zapis;
- zapisać cały trening w wybranym folderze.

Eksport zawiera summary HTML/CSV, kompletne czytelne pliki sesji, Reveale, post-Reveal, oceny Judge i lokalne media. Ścieżki techniczne nie są eksponowane na karcie runu.

## 12. Research

Research ma siedem szablonów i jawnie blokowane ustawienia Viewer Control. Preflight sprawdza wspólne capabilities i zapobiega zmianie więcej niż jednej badanej zmiennej.

W trybie Random nie ma osobnego przycisku losowania. Próbka jest tworzona przy Preflight/Experiment Lock, zapisywana jako konkretne target IDs i nie zmienia się w trakcie runu.

Przypisania są anonimowe. Judge otrzymuje allowlist evidence bez mapowania warunków. Wyniki są zamrażane przed unblind. Historia projektu pokazuje jego ukończone sesje. Cały projekt można zapisać w wybranym folderze z kompletnymi sesjami i summary HTML/CSV.

## 13. Judge

Można wybrać 1–3 niezależnych Judges albo tryb save-only. Harness oblicza wynik 3+3+2+2, a nie powierza sumowania modelowi. Wynik i narracja są zamrażane. Obrazy są przekazywane tylko modelom vision i pod nieujawniającymi nazwami.

## 14. Backup i restore

`Utwórz backup` otwiera natywny wybór folderu, domyślnie od Dokumentów. W wybranym miejscu powstaje osobny folder `AI_RV_Harness_backup_<czas>` zawierający:

- snapshot SQLite;
- wszystkie zarządzane artefakty;
- manifest z wersją, listą plików, rozmiarami i SHA-256;
- jawne `secretsIncluded: false`.

`Przywróć` jest czerwonym działaniem destrukcyjnym. Użytkownik wskazuje folder backupu i potwierdza ostrzeżenie. Program najpierw waliduje cały backup, potem tworzy wewnętrzną kopię aktualnego stanu, zamyka bazę i atomowo podmienia plik SQLite. Po operacji aplikacja jest przeładowywana.

Backup zapisany poza katalogiem aplikacji przeżywa odinstalowanie programu.

## 15. Ustawienia i UI

Nowa instalacja używa:

- języka interfejsu EN, chyba że locale przeglądarki jest polskie;
- soft blue theme;
- text scale Large;
- Target Repeat Policy `avoid_profile`;
- prefiksu kodu sesji `RVH`.

Jawne istniejące ustawienia nie są nadpisywane. Edytor Profilu ma body przewijane w dynamicznej wysokości viewportu i sticky footer. Przyciski Save/Cancel pozostają ponad paskiem systemowym.

## 16. Eksporty

Eksporty są czytelne bez aplikacji. Pojedyncza sesja jest zapisywana jako Markdown + JSON + potrzebne obrazy. Training i Research zawierają również podsumowania HTML/CSV. Jeśli ocena Judge istnieje przed eksportem, zostaje dołączona. Eksport nie zmienia zapieczętowanego transcriptu.

## 17. Licencje

Obowiązujące zdanie repozytorium:

> Source code is licensed under the MIT License. Documentation, bundled prompts, training content, and other non-code visual assets are licensed under CC BY 4.0.

Kod: MIT. Dokumentacja, bundled prompts, training content i inne niekodowe visual assets: CC BY 4.0.

## 18. Build i wydanie Windows

`CI` wykonuje `npm ci`, typecheck, Vitest, Vite build, Rust tests i Clippy. `Release Windows` działa ręcznie wyłącznie z `main`, generuje/commitje aplikacyjny `Cargo.lock`, powtarza kontrole i używa `tauri-apps/tauri-action` do utworzenia draft release z instalatorem.

Wydanie nie jest podpisane Authenticode, dlatego Windows SmartScreen może ostrzegać dla nowego hasha instalatora.

## 19. Przekazanie projektu innemu AI

Należy przekazać kompletny ZIP źródłowy i polecić:

1. przeczytać ten dokument, `README.md`, `CHECKPOINT_0.7.6_PL.md` i testy;
2. nie zmieniać granicy blind/Reveal ani append-only evidence;
3. nie włączać Training Targets do zwykłych automatycznych sesji;
4. nie przywracać semantycznego repetition stop;
5. zachować spójne PL/EN zasoby;
6. po zmianach zsynchronizować wszystkie numery wersji i uruchomić cały CI.

**Koniec źródła prawdy dla AI RV Harness release v0.7.6.**
