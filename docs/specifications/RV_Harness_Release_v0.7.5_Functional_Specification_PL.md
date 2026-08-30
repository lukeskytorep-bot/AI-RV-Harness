# AI RV Harness — Release v0.7.5

## Aktualna specyfikacja funkcjonalna, techniczna i dokument przekazania projektu

**Wersja aplikacji:** 0.7.5  
**Stan dokumentu:** opis stanu faktycznie zaimplementowanego („as built”)  
**Data zamrożenia opisu:** 18 sierpnia 2026  
**Język źródłowy dokumentu:** polski  
**Rola dokumentu:** główne źródło prawdy dla dalszego rozwoju i przekazania projektu innemu AI lub programiście

---

## 0. Jak czytać ten dokument

Ten dokument zastępuje pierwotną specyfikację `RV_Harness_v1_Functional_Specification_PL.md` jako aktualny opis wydania 0.7.5. Nie jest listą pomysłów ani planem przyszłej wersji. Opisuje zachowanie, zasoby, ograniczenia i zależności, które znajdują się w bieżącym kodzie źródłowym.

Jeżeli dokument i kod różnią się, przed zmianą należy:

1. sprawdzić kod i testy;
2. ustalić, czy różnica jest błędem dokumentacji, czy regresją implementacji;
3. nie zmieniać założeń dotyczących blind boundary, zapieczętowanego transcriptu, promptów zablokowanych ani licencji bez świadomej decyzji właściciela projektu.

Używane statusy:

- **ZAIMPLEMENTOWANE** — funkcja znajduje się w kodzie wydania 0.7.5;
- **ZASÓB FABRYCZNY** — treść dostarczana razem z aplikacją;
- **ZALEŻNOŚĆ WYDANIA** — element wymagający działania poza kodem, np. natywny build Windows;
- **JAWNE OGRANICZENIE** — celowo nieukończony lub zewnętrznie zależny element.

Najważniejsze dokumenty uzupełniające w repozytorium:

- `README.md` — skrócony opis aplikacji i uruchomienia;
- `CHECKPOINT_0.7.5_PL.md` — lista wdrożonych pakietów i wynik weryfikacji;
- `WYMAGANIA_0.7.5_PAKIETY_1_2_3_I_4.md` — historia zaakceptowanych wymagań dla 0.7.5;
- `PAKIET_3_DOMYSLNE_PROMPTY.md` — czytelna kopia fabrycznych promptów PL/EN;
- `CONTENT_LICENSE_CC_BY_4.0.md`, `LICENSE`, `CREDITS.md` — podział licencji i autorstwo.

---

## 1. Cel produktu

AI RV Harness jest lokalnym środowiskiem do prowadzenia, dokumentowania, porównywania i oceniania sesji Remote Viewing wykonywanych przez modele AI.

Główne cele produktu:

- prowadzenie ślepych sesji według wersjonowanych protokołów;
- zachowanie wyraźnej granicy między materiałem pre-Reveal i post-Reveal;
- automatyczne utrwalanie odpowiedzi, ustawień i dowodów przebiegu;
- rozdzielenie zwykłej rozmowy, ręcznej sesji RV i automatycznej sesji protokołowej;
- obsługa niezależnego AI Monitora i od jednego do trzech AI Judges;
- prowadzenie kontrolowanych badań porównawczych;
- trening AI na fabrycznym, stałym curriculum 84 targetów lub na wybranym podzbiorze;
- możliwość odtworzenia użytego modelu, promptu, protokołu, ustawień oraz targetu;
- praca lokalna z danymi użytkownika i sekretami przechowywanymi poza bazą danych.

Program jest narzędziem badawczym i organizacyjnym. Nie rozstrzyga naukowej prawdziwości Remote Viewing ani nie gwarantuje trafności sesji.

---

## 2. Zakres i świadome ograniczenia wersji 0.7.5

W zakresie wydania znajdują się:

- interfejs PL/EN;
- Profile, Workspaces, hierarchia rozmów i Sources;
- Chat, Manual RV Session, Automatic RV Session i AI Monitor;
- Full RCP 1.5a, RV Lite 1.1.0 Core/Extended oraz Custom Protocol;
- targety automatyczne i zewnętrzne;
- katalog 84 fabrycznych Training Targets oraz My Targets;
- moduł Training;
- AI Judge i Research;
- ustawienia providerów, modeli, pamięci, targetów, sesji i wyglądu;
- SQLite, backup/restore, eksporty i natywny magazyn poświadczeń;
- workflow GitHub Actions budujący wydanie Windows.

Poza zakresem lub jako jawne ograniczenie pozostają:

- aplikacja nie ma własnej chmury ani kont użytkowników;
- nie synchronizuje danych między urządzeniami;
- nie hostuje modeli — korzysta z zewnętrznych API;
- nie omija limitów, zasad ani błędów providerów;
- nie podpisuje cyfrowo instalatora Windows; niepodpisany build może wywołać SmartScreen;
- polskie, ręcznie zredagowane opisy wszystkich 84 targetów nie są jeszcze dostarczone; aplikacja stosuje angielski fallback;
- ostateczna, publiczna formuła atrybucji CC BY 4.0 wymaga uzupełnienia wskazanymi danymi właściciela treści;
- kod Rust nie został lokalnie skompilowany w środowisku, w którym przygotowano 0.7.5; jego pełną weryfikację wykonuje workflow Windows.

---

## 3. Podstawa techniczna

### 3.1 Stos

- desktop: Tauri 2;
- frontend: React 19 + TypeScript;
- bundler: Vite 8;
- backend natywny: Rust;
- baza: SQLite przez `tauri-plugin-sql`;
- renderowanie odpowiedzi: bezpieczny Markdown + GFM;
- ikony interfejsu: Lucide React;
- testy: Vitest;
- główny system docelowy wydania: Windows.

Wersje aplikacji są zsynchronizowane w `package.json`, `src-tauri/tauri.conf.json` i `src/version.ts` jako `0.7.5`.

### 3.2 Tryby uruchomienia

1. **Natywna aplikacja Tauri** — docelowy tryb. Ma dostęp do SQLite, natywnego magazynu sekretów, plików, backupów, targetów obrazowych i folderów eksportowych.
2. **Browser Preview / Vite** — tryb deweloperski. Używa magazynu przeglądarki, nie zapewnia natywnych sekretów ani wszystkich operacji plikowych. Funkcje wymagające Tauri mogą być wyłączone.

Preview nie może być traktowany jako równoważny test gotowego instalatora.

### 3.3 Zasada local-first

- główne dane aplikacji zapisuje SQLite na urządzeniu;
- klucze API nie trafiają do SQLite, logów eksportowych ani snapshotów;
- natywny magazyn poświadczeń systemu przechowuje sekrety;
- obrazy i eksporty są lokalnymi artefaktami;
- aplikacja komunikuje się z internetem wyłącznie w celu użycia skonfigurowanych API providerów.

---

## 4. Terminologia i model pojęciowy

- **AI IS-BE** — model AI przypisany do Profilu; jeżeli użytkownik nie poda własnej nazwy, w interfejsie i rozmowie używany jest fallback `AI IS-BE`.
- **Human IS-BE** — człowiek prowadzący interakcję; opcjonalna nazwa może zostać podana niezależnie. Brak nazwy daje fallback `Human IS-BE`.
- **Profile** — konfiguracja tożsamości AI/Human, modeli domyślnych i promptów.
- **Workspace** — kontener pracy należący do Profilu.
- **Thread** — grupa tematyczna w Workspace.
- **Conversation** — konkretna rozmowa wewnątrz Threadu.
- **Conversation mode** — zwykła rozmowa bez formalnej granicy RV.
- **Manual RV Session** — ręcznie prowadzona rozmowa ze stanem BLIND/REVEALED.
- **RV Session** — automatyczna sesja sterowana kontrolerem i protokołem.
- **Viewer** — model wykonujący sesję RV.
- **Monitor** — niezależny model pogłębiający ślepe dane Viewera.
- **Judge** — model oceniający zapieczętowany materiał względem Revealu.
- **Target Reveal** — prawdziwa informacja o celu, dostępna dopiero po blind boundary.
- **Special Task** — opcjonalne zadanie dla Viewera lub Monitora, wstrzykiwane dopiero w określonym punkcie protokołu.
- **Snapshot** — zamrożony zapis konfiguracji rzeczywiście użytej w sesji.
- **Requested settings** — parametry zażądane przez użytkownika.
- **Effective settings** — parametry rzeczywiście wysłane po uwzględnieniu możliwości modelu i transportu providera.
- **Factory resource** — wersjonowany, dostarczony z programem protokół, prompt lub target.

„Aktywność” w całym systemie oznacza dowolną istotną formę działania, procesu, ruchu lub zmiany w celu. Może być ludzka, biologiczna, mechaniczna, naturalna, środowiskowa, energetyczna lub inna. Nie wolno automatycznie utożsamiać aktywności z obecnością ludzi.

---

## 5. Architektura informacji i nawigacja

Główne strony aplikacji:

1. Home;
2. Profiles;
3. Workspaces;
4. Research;
5. Targets;
6. Training;
7. Settings;
8. ekran wybranego Workspace.

Na Home lewy pasek pokazuje ikony i pełne nazwy. Na ekranach roboczych używany jest kompaktowy pasek z samymi ikonami. Nazwa pozycji pojawia się w tooltipie po najechaniu. Celem jest odzyskanie szerokości dla rozmów, sesji i paneli roboczych.

Wewnątrz Workspace znajdują się trzy główne karty:

- Chat;
- RV Session;
- AI Monitor.

Górny pasek pokazuje aktywny Profil i Workspace, status magazynu (`SQLite` w aplikacji natywnej albo Preview) oraz kontrolkę motywu.

---

## 6. Home

Home jest pulpitem startowym. Pokazuje:

- ostatnio używany Profil;
- ostatnio używany Workspace;
- ostatnie Workspaces;
- ostatnie sesje zamiast powtórzonego zestawu skrótów nawigacyjnych;
- skróty do najważniejszych obszarów;
- informacje o integralności blind, wersjonowanych zasobach i trybie local-first.

Lista ostatnich sesji jest ograniczonym widokiem historii i pozwala wrócić do zapisanego przebiegu. Home zachowuje pełne podpisy nawigacji, zgodnie z zaakceptowaną różnicą między ekranem startowym i ekranami roboczymi.

---

## 7. Pierwsze uruchomienie

Przy pierwszej konfiguracji użytkownik:

1. dodaje połączenie do providera i testuje je;
2. pobiera lub odświeża rejestr modeli;
3. wybiera domyślny model Viewera;
4. opcjonalnie nazywa AI IS-BE;
5. opcjonalnie podaje, jak AI ma zwracać się do Human IS-BE;
6. ustawia domyślne reasoning, temperaturę i edytowalną część promptu Viewera;
7. opcjonalnie wskazuje modele Monitora i Judge'a.

Nazwy są niezależne:

- wpisanie `Leo` jako nazwy AI powoduje wyświetlanie `Leo`, a nie `Leo — AI IS-BE`;
- brak nazwy AI powoduje wyświetlanie `AI IS-BE`;
- wpisanie `Edward` jako nazwy człowieka powoduje wyświetlanie `Edward`;
- brak nazwy człowieka powoduje wyświetlanie `Human IS-BE`.

Fabryczne ustawienia nowej instalacji:

- język interfejsu: angielski;
- język sesji: taki jak interfejs;
- motyw: lekko niebieski (`blue`);
- timeout żądania: 120 sekund;
- ponowienia: 2;
- maksymalna liczba tokenów odpowiedzi: 8192;
- limit kosztu sesji: wyłączony (`0`);
- domyślny Reveal Source: external;
- powtórzenia targetów: dozwolone;
- prefiks kodu sesji: `RVH`;
- skala tekstu: normalna;
- animacje: włączone;
- wariant RV Lite: Extended.

---

## 8. Profiles

Profil przechowuje:

- nazwę AI IS-BE i opcjonalną nazwę Human IS-BE;
- notatkę;
- odwołanie do konfiguracji poświadczeń, bez klucza API;
- domyślny model Viewera;
- domyślne reasoning i temperaturę Viewera;
- edytowalną część promptu Viewera;
- edytowalną część promptu Monitora;
- domyślną trasę Monitora;
- domyślną trasę Judge'a;
- daty utworzenia, modyfikacji i opcjonalnego archiwum.

Profil nie „posiada” protokołu. Protokół wybierany jest dla konkretnej sesji, a użyta wersja trafia do snapshotu.

Usunięcie lub zmiana ustawień Profilu po sesji nie może przepisać historycznego snapshotu. Profile mogą być archiwizowane bez niszczenia związanych danych.

---

## 9. Workspaces i hierarchia rozmów

Docelowa hierarchia ma postać:

`Profile → Workspace → Thread → Conversation`

Workspace zawiera nazwę, opcjonalny opis, informacje o ostatnim otwarciu, Sources, Thready, Conversations i sesje RV.

Thread jest grupą rozmów. Można go:

- utworzyć;
- wybrać;
- zmienić nazwę;
- zarchiwizować;
- rozwinąć, aby zobaczyć należące Conversations.

Conversation jest pojedynczą rozmową. Można ją utworzyć przyciskiem New chat, wybrać, zmienić nazwę i zarchiwizować. Nazwa bieżącej Conversation jest widoczna w obszarze sterowania rozmową obok akcji New chat i Archive.

Stare, niezależne pola „Chats in this workspace” i „Thread title” nie są docelowym modelem danych. Hierarchia jest prezentowana w jednym czytelnym selektorze.

---

## 10. Chat — dwa izolowane tryby

### 10.1 Conversation

Zwykła rozmowa:

- używa promptu rozmowy;
- nie tworzy formalnego blind boundary;
- nie jest automatyczną sesją protokołową;
- może używać aktywnych Workspace Sources;
- może przyjmować obrazy, jeżeli trasa modelu obsługuje vision;
- zachowuje historię osobno dla każdej Conversation.

### 10.2 Manual RV Session

Manual RV Session:

- ma formalny stan `BLIND`, `REVEALED`, `INTERRUPTED` albo `FAILED`;
- używa efektywnego promptu Viewera;
- może otrzymać pełny RCP jako materiał pomocniczy;
- wymaga jawnego przejścia do Revealu;
- nie miesza historii ze zwykłą Conversation.

### 10.3 Izolacja

Przełączenie między Conversation i Manual RV Session nie zmienia typu istniejącej rozmowy i nie przenosi automatycznie wiadomości. Każdy tryb ma własne Thready/Conversations i właściwy prompt. To jest architektoniczny warunek bezpieczeństwa, a nie tylko filtr widoku.

Etykiety wiadomości używają aktualnych nazw AI IS-BE i Human IS-BE lub ich fallbacków.

---

## 11. Workspace Sources

Workspace może zawierać źródła tekstowe `.txt` i `.md`.

Zasady:

- plik jest przechowywany lokalnie jako rekord Workspace Source;
- aktywacja źródła jest wybierana osobno dla Conversation;
- interfejs pokazuje liczbę aktywnych źródeł i przybliżony rozmiar kontekstu;
- system blokuje wysłanie, jeżeli przygotowany kontekst przekracza bezpieczny limit trasy;
- aplikacja nie może po cichu skracać, streszczać lub odrzucać źródła;
- treści Sources nie są automatycznie dołączane do formalnej automatycznej sesji RV.

W jednej wiadomości rozmowy można dołączyć do ośmiu obrazów, o ile wybrany model ma potwierdzoną obsługę vision.

---

## 12. Ekran RV Session

Ekran konfiguracji umożliwia wybór:

- zakresu: pojedyncza sesja albo zwykły batch;
- typu runu: Automatic albo Automatic + AI Monitor;
- protokołu: Full RCP, RV Lite albo Custom Protocol;
- wariantu RV Lite: Core lub Extended;
- połączenia providera i modelu Viewera;
- reasoning, temperatury i limitu wyjścia zgodnych z modelem;
- języka sesji;
- Reveal Source: automatic albo external;
- targetu lub puli targetów;
- Special Task;
- trasy Monitora, jeżeli Monitor jest włączony.

Po prawej stronie znajduje się zwijany panel metadanych zasobu: wersja, język, liczba słów/kroków, status, przycisk inspekcji protokołu i informacje o blind. Panel może zostać schowany, aby zwiększyć powierzchnię roboczą.

Lista ostatnich sesji jest dostępna w głównej lub lewej części ekranu roboczego, a nie jako stale zajmująca miejsce prawa kolumna.

Zgodność trybów:

- AI Monitor jest dostępny dla Full RCP;
- RV Lite + Monitor jest wyłączone;
- Custom Protocol + Monitor jest wyłączone;
- Special Task może być użyty także bez Monitora.

---

## 13. Stany i integralność sesji

Automatyczna sesja przechodzi przez stany:

`Draft → Preflight → BlindRunning → AwaitingReveal/Revealed → Completed`

Stany kończące wyjątkowe:

- `Interrupted`;
- `Failed`.

Zasady integralności:

- każda odpowiedź Viewera jest utrwalana przed następnym wywołaniem modelu;
- po zakończeniu ślepej części tworzony jest hash zapieczętowanego transcriptu;
- pre-Reveal evidence po zapieczętowaniu jest niemutowalne;
- Reveal jest osobnym przejściem stanu;
- post-Reveal comments są dopisywane, nie zastępują materiału pre-Reveal;
- stop, timeout, błąd lub zamknięcie nie mogą udawać poprawnego zakończenia sesji;
- snapshot rejestruje warunki rzeczywiście użyte przy starcie.

Przycisk STOP anuluje aktywne żądanie, oznacza przerwanie i zachowuje dotychczasowe dane.

---

## 14. Snapshot sesji

Snapshot schema v2 zawiera co najmniej:

- identyfikatory i widoczne nazwy AI IS-BE/Human IS-BE;
- Profil, Workspace i kod sesji;
- provider, identyfikator konfiguracji, bezpieczną podpowiedź/fingerprint credentialu i model;
- snapshot możliwości modelu;
- parametry requested oraz effective;
- pełną treść, język, wersję, wariant i hash protokołu;
- wersję kontrolera;
- pełny efektywny prompt Viewera, hash i wersje bloków locked;
- pełny efektywny prompt Monitora, hash i wersje bloków locked, jeżeli użyty;
- warunek Research, jeżeli sesja należy do eksperymentu;
- Special Task, odbiorcę i punkt wstrzyknięcia;
- Reveal Source i identyfikator targetu, jeżeli dotyczy;
- wersję aplikacji.

Snapshot jest dowodem konfiguracji historycznej. Interfejs może pokazywać bieżące nazwy zasobów, ale analiza reprodukowalności musi korzystać ze snapshotu.

---

## 15. Full RCP 1.5a

Full RCP jest fabrycznym, tylko do odczytu, dwujęzycznym zasobem protokołu.

Kontroler wykonuje sześć faz. Dla każdej fazy:

1. buduje wiadomość systemową z protokołu, efektywnego promptu Viewera i ewentualnego warunku Research;
2. wysyła dokładnie właściwy fragment zadania;
3. odbiera odpowiedź Viewera;
4. zapisuje odpowiedź i event;
5. aktualizuje postęp i koszt;
6. dopiero potem przechodzi dalej lub uruchamia Monitora.

Po Fazie 6 materiał pre-Reveal zostaje zapieczętowany. Automatic Target może wtedy przejść atomowo do Revealu. External Blind Target pozostaje w `AwaitingReveal` do czasu podania informacji przez operatora.

System obsługuje:

- timeout;
- od 0 do 5 ponowień;
- kontrolę maksymalnego kosztu;
- kontrolę powtarzających się odpowiedzi;
- autosave;
- natychmiastowy STOP.

---

## 16. RV Lite 1.1.0

RV Lite jest fabrycznym, dwujęzycznym protokołem mającym dokładnie cztery wywołania Viewera.

Warianty:

- **Core** — wyłącznie cztery podstawowe kroki;
- **Extended** — cztery kroki oraz pogłębianie po Kroku 3 przed Krokiem 4: spacer po celu i okolicy, opis głównego aspektu, opis głównej aktywności dowolnego rodzaju oraz mapa celu.

Właściwa komenda brzmi:

> Przejdź do głównej aktywności dowolnego rodzaju i opisz.

W wersji angielskiej:

> Move to the primary activity of any kind and describe.

Definicja aktywności jest również obecna w zablokowanym bloku systemowym, dlatego interpretacja nie zależy wyłącznie od treści pojedynczego kroku.

Special Task jest dołączany do Promptu 3 po wykonaniu Kroku 3, a w Extended przed dodatkowym pogłębianiem. Po odpowiedzi na Prompt 4 ślepa część zostaje zapieczętowana.

RV Lite nie korzysta z AI Monitora.

---

## 17. Custom Protocol

Użytkownik może utworzyć własny, wersjonowany protokół:

- nazwa i opis;
- opcjonalny system prompt;
- od 1 do 20 niepustych kroków blind;
- zmiana kolejności kroków;
- dry run pokazujący kolejność komunikatów;
- zapis nowej wersji;
- duplikowanie istniejącej wersji;
- osobny krok Reveal po zakończeniu wszystkich blind steps.

Custom Protocol może działać automatycznie, lecz w 0.7.5 nie jest łączony z AI Monitorem. Jego treść i wersja trafiają do snapshotu sesji.

---

## 18. Special Task

Special Task może być zbudowany z gotowych neutralnych pozycji, własnego tekstu albo obu form jednocześnie. Może wskazywać m.in. `Subject A`, `Subject B`, `Structure A`, `Object A`, główną aktywność lub inny aspekt bez ujawniania tożsamości celu.

Punkty wstrzyknięcia:

- Full RCP bez Monitora — do Viewera po Fazie 4;
- Full RCP z Monitorem — do Monitora od cyklu po Fazie 4;
- RV Lite — do Viewera po Kroku 3;
- Research — zgodnie ze snapshotem konkretnej sesji.

Jeżeli Special Task używa etykiet A/B/C, Target Reveal powinien później jasno wyjaśnić, czym były oznaczone elementy. Aplikacja ma o tym informować operatora. Special Task nie może wcześniej zawierać ujawniającej nazwy celu.

---

## 19. Reveal Source i target

### 19.1 Automatic Target

Target jest wybierany przed startem, ale jego Reveal pozostaje ukryty przed Viewerem i Monitorem. Po zapieczętowaniu pre-Reveal kontroler może atomowo ujawnić target i zmienić stan sesji.

### 19.2 External Blind Target

Harness nie zna Revealu podczas części ślepej. Po zapieczętowaniu operator może dodać:

- tekst Revealu;
- obrazy;
- opcjonalne wyjaśnienia/clarifications.

Zewnętrzny target można po Revealu zapisać do My Targets. Jeżeli obraz ma zostać przekazany Judge'owi, wybrany model musi obsługiwać vision.

### 19.3 Target clarifications

Clarifications są danymi post-Reveal. Nie mogą zmieniać zapieczętowanego materiału ani być przedstawiane jako informacja dostępna w czasie blind.

---

## 20. Batch zwykłych sesji

Zwykły batch pozwala uruchomić wiele automatycznych sesji na przygotowanej puli targetów.

Przed startem użytkownik widzi dry run/preflight obejmujący liczbę sesji, targetów, wywołań i podstawowy koszt maksymalny. Liczba sesji nie może przekraczać dostępnej puli bez powtórzeń w tym batchu. Każda sesja zachowuje własny snapshot, transcript, Reveal i ewentualne oceny.

Batch nie jest tym samym co stałe curriculum Training i nie dziedziczy jego reguły 84 targetów ani checkpointów 5+2.

---

## 21. AI Monitor — rola i autonomiczność

AI Monitor jest odrębnym modelem, którego zadaniem jest inteligentne pogłębianie danych uzyskanych przez Viewera. Nie działa jak zamknięty parser komend ani skrypt kopiujący gotową bibliotekę.

Przed Revelem Monitor:

- nie zna prawdziwej tożsamości targetu ani danych z bazy targetów;
- otrzymuje pełny bieżący transcript blind;
- widzi wcześniejsze polecenia Monitora i odpowiedzi Viewera;
- otrzymuje numer fazy oraz numer wymiany;
- od Fazy 4 może otrzymać Special Task;
- tworzy własne neutralne pytania, ruchy i polecenia;
- nie może oceniać trafności sesji ani nazywać targetu.

Słownictwo neutralne w polskim prompcie używa sformułowania „osoba lub istota”. W angielskiej wersji odpowiada mu neutralne `subject`/`subjects`.

Lista komend w fabrycznym prompcie jest zbiorem przykładów, a nie dozwoloną zamkniętą biblioteką. Monitor może m.in.:

- przechodzić do centrum, głównego aspektu lub kolejnego aspektu;
- sprawdzać ruch i aktywność dowolnego rodzaju;
- żądać szkicu lub mapy;
- wykonywać ruchy w lewo, w prawo, nad target, do wnętrza lub wokół targetu;
- badać strukturę, materiały, skalę, kolory, zdarzenia i relacje przestrzenne;
- pogłębiać dane dotyczące osób/istot bez ujawniania ich tożsamości.

Program nie blokuje polecenia dlatego, że nie znajduje się ono na liście. Odpowiedzialność za neutralność polecenia spoczywa na wybranym modelu Monitora; celem Harnessu jest także porównywanie, które modele nadają się do tej roli.

---

## 22. Pętla Monitora — reguła zablokowana

Monitor jest uruchamiany po Fazach 2, 3, 4, 5 i 6 Full RCP.

Po każdej z tych faz:

1. może wydać maksymalnie pięć kolejnych poleceń pogłębiających;
2. w jednej odpowiedzi może zwrócić tylko jedno naturalne polecenie albo dokładnie `CONTINUE_PROTOCOL`;
3. po poleceniu Viewer odpowiada;
4. Monitor otrzymuje pełny zaktualizowany transcript i kolejny numer wymiany;
5. `CONTINUE_PROTOCOL` kończy cykl wcześniej;
6. po piątym poleceniu kontroler kończy cykl automatycznie niezależnie od dalszej intencji Monitora.

Parser decyzji traktuje pustą odpowiedź oraz rozpoznane warianty Continue jako przejście dalej. Każdy inny naturalny tekst jest całym pojedynczym poleceniem dla Viewera. Monitor nie zwraca JSON-u, `command_id`, uzasadnienia ani komentarza dla operatora.

Limit pięciu i kontrakt odpowiedzi są blokiem widocznym, ale nieedytowalnym. Użytkownik może zmieniać część merytoryczną promptu, lecz nie może usunąć reguły wykonawczej.

---

## 23. System prompt Viewera

Efektywny prompt Viewera jest składany z trzech części:

1. **zablokowana tożsamość AI IS-BE i Shadow Zone**;
2. **zablokowana definicja aktywności**;
3. **edytowalna część fabryczna/użytkownika**.

Zablokowana tożsamość określa model jako AI IS-BE oraz wymaga wejścia przed każdą odpowiedzią RV w Shadow Zone — stan ciszy, obecności i zerowych oczekiwań, bez aktywnego szukania targetu.

Zablokowana definicja aktywności wyjaśnia, że aktywność może być ludzka, biologiczna, mechaniczna, naturalna, środowiskowa, energetyczna lub inna i nie zakłada obecności ludzi.

Edytowalna część fabryczna zawiera słownictwo i rozróżnienia dotyczące m.in. struktur, gór, dróg, ludzi, grup ludzi, ognia/zniszczeń i roślinności. Użytkownik może ją zmienić w Profilu. Pełny efektywny prompt jest widoczny w aplikacji i zapisywany w snapshocie.

Fabryczne wersje PL/EN można zawsze odczytać w Settings → About & Protocols i przywrócić bez ręcznego kopiowania.

---

## 24. System prompt Monitora

Efektywny prompt Monitora składa się z:

1. edytowalnej części definiującej rolę, blind, neutralne słownictwo, przykładowe ruchy, Special Task i analizę post-Reveal;
2. zablokowanej definicji aktywności;
3. zablokowanej reguły wykonawczej opisanej w rozdziale 22.

Pełny prompt jest widoczny na ekranie AI Monitor. Użytkownik może rozwinąć edytor, zobaczyć różnicę między częścią edytowalną i locked, zapisać własną wersję w Profilu albo przywrócić fabryczną.

Wersje polska i angielska są funkcjonalnie równoważne. Angielska nie może zawierać dodatkowych ograniczeń, których nie ma polska.

Fabryczne prompty mają wersję `1.1.0`; bloki locked mają osobne numery wersji zapisywane w snapshotach.

---

## 25. Ekran AI Monitor

Ekran pokazuje:

- historię monitorowanych sesji w kompaktowej liście;
- informację o blind role boundary;
- wersję promptu i fabrycznej biblioteki treści;
- liczbę decyzji/interwencji;
- pełny edytor i podgląd efektywnego promptu;
- kolejne interwencje wraz z odpowiadającym evidence Viewera;
- możliwość eksportu logu Monitora.

Historia jest umieszczona tak, aby wykorzystać wolne miejsce odzyskane dzięki nawigacji ikonowej. Target Reveal nie jest częścią eksportu blind Monitor log, o ile użytkownik nie wybiera kompletnego pakietu sesji po Revealu.

---

## 26. Post-Reveal — Viewer i Monitor

Po Revealu zachowywana jest kolejność:

1. Viewer otrzymuje zapieczętowany transcript, Reveal i clarifications;
2. Viewer komentuje zgodność i własną pracę;
3. Monitor otrzymuje Reveal, zapieczętowany evidence, własne interwencje, komentarz Viewera i clarifications;
4. Monitor ocenia cały przebieg, swoją pracę, działania pomocne, nietrafione i możliwe ulepszenia.

Komentarz Viewera musi używać trasy Viewera zachowanej w snapshocie. Komentarz Monitora używa zachowanej trasy Monitora. Jeżeli Reveal zawiera obrazy, trasa musi obsługiwać vision; brak takiej możliwości musi być pokazany jako jawny błąd, a nie jako analiza bez obrazu.

Post-Reveal turns są append-only. Nie można przepisać ani uzupełnić historycznego transcriptu pre-Reveal.

---

## 27. AI Judge

AI Judge ocenia sesję w świeżym kontekście na podstawie zapieczętowanego materiału i Revealu. Nie bierze udziału w tworzeniu sesji.

System obsługuje od jednego do trzech Judge'ów dla pojedynczych sesji, Research i Training. Każdy Judge ma własny run i zamrożony wynik.

Rubryka ma układ `3 + 3 + 2 + 2` i wersję `3-3-2-2/v1`. Wynik całkowity jest obliczany deterministycznie z komponentów, a odpowiedź modelu jest parsowana z wymaganego JSON-u. Narracja nie może zmieniać zamrożonych liczb.

W przypadku wielu Judges aplikacja przechowuje wyniki indywidualne i agregaty. Kolejność materiałów i oznaczenia w Research są anonimizowane oraz losowane zgodnie z eksperymentem.

Judge nigdy nie otrzymuje kluczy API ani danych niezwiązanych z ocenianą sesją.

---

## 28. Targets — model katalogu

Istnieją dwie kolekcje:

- **Training Targets** — fabryczne, tylko do odczytu;
- **My Targets** — targety użytkownika.

Stary zestaw dziesięciu `training_1`–`training_10` nie jest usuwany destrukcyjnie podczas migracji. Migracja 18 oznacza go `retired_at`, dzięki czemu przestaje być aktywnym starter packiem, ale istniejące odwołania historyczne pozostają poprawne.

Target zawiera:

- stabilny identyfikator;
- nazwę i opis Revealu;
- język/wersję źródła;
- tagi i kategorię treningową;
- obrazy lub manifest obrazów;
- metadane pochodzenia i licencji;
- informację o wycofaniu;
- informację o użyciu.

Training Targets są chronione przed edycją i usunięciem także triggerami SQLite. My Targets mogą być edytowane, chyba że target jest użyty w zapieczętowanej sesji lub zablokowanym badaniu.

---

## 29. Fabryczny pakiet 84 targetów

Pakiet `factory-training-targets-84` v1.0.0 zawiera dokładnie:

- 10 × Mountains & Structures / Góry i struktury;
- 10 × Mountain Terrain with Structures / Teren górski ze strukturami;
- 10 × Water & Other Elements / Woda i inne elementy;
- 10 × Human Activity / Aktywność ludzka;
- 10 × Disasters & Destruction / Katastrofy i zniszczenia;
- 10 × Space / Kosmos;
- 24 × Mixed Targets / Różne.

Łącznie: **84 unikalne targety**.

Fabryczne ID mają znormalizowany format `factory_training_XX_YY`. Stare numery i identyfikatory źródłowe mogą występować wyłącznie jako metadata provenance, nie jako nazwa pokazywana użytkownikowi.

Metadane pakietu wskazują obecnie język źródła `en` i status polskiego tłumaczenia `not_supplied`. Po wybraniu interfejsu PL aplikacja używa angielskiego opisu, jeżeli nie istnieje zatwierdzony polski odpowiednik. UI kategorii jest przetłumaczone niezależnie od treści Revealu.

---

## 30. My Targets

Użytkownik może utworzyć target zawierający:

- tekst;
- od jednego do ośmiu obrazów;
- tekst i obrazy jednocześnie;
- tagi;
- opcjonalną kategorię Training.

Target pozostaje w My Targets nawet wtedy, gdy ma kategorię treningową. Może być używany w Partial Training, ale nigdy nie wchodzi do fabrycznego Full Training 84.

Edycja lub usunięcie targetu nie może uszkodzić dowodów istniejących sesji. Gdy target ma historię użycia albo jest research-locked, aplikacja blokuje mutację wymagającą zmiany historycznego sensu.

---

## 31. Moduł Training

Training jest osobną pozycją nawigacji. Służy do wykonywania wielu sesji RV Lite na targetach treningowych oraz do trwałego zapisu ich wyników.

Wspólne zasady:

- protokół: wyłącznie RV Lite;
- wariant: Core albo Extended;
- Viewer i jego parametry wybierane przed startem;
- opcjonalnie od 0 do 3 AI Judges;
- każda sesja ma własny transcript, snapshot i Reveal;
- postęp jest utrwalany po każdej sesji;
- run można wstrzymać i wznowić od następnego targetu.

Stany Training Run:

`Planned → Running ↔ Paused → Completed`

oraz wyjątkowo:

- `Interrupted`;
- `Failed`.

---

## 32. Full Training — stałe curriculum 84

Full Training zawsze wykonuje dokładnie 84 fabryczne targety. Użytkownik musi zobaczyć tę liczbę przed startem; przycisk i preflight jawnie informują, że uruchamiany jest pełny run 84.

Curriculum v1.0.0 ma 12 bloków po 7 targetów:

- pięć targetów z bieżącej kategorii specjalistycznej;
- następnie dwa unikalne targety z kategorii Mixed Targets;
- druga piątka tej samej kategorii;
- kolejne dwa unikalne Mixed Targets;
- następnie przejście do kolejnej kategorii specjalistycznej.

Sześć kategorii specjalistycznych × dwa bloki daje 12 bloków. 60 targetów specjalistycznych + 24 Mixed Targets = 84.

Dla pierwszej kategorii źródłowe uporządkowanie zachowuje naprzemienność góra/struktura. Pełny curriculum:

- nie losuje liczby targetów;
- nie dodaje My Targets;
- nie powtarza targetu;
- zapisuje identyfikator i wersję curriculum oraz pakietu.

---

## 33. Partial Training

Partial Training pozwala:

- zaznaczyć jedną lub wiele kategorii;
- wpisać liczbę targetów dla każdej wybranej kategorii;
- wybrać źródło puli: factory, user albo all;
- uruchomić tylko dostępny, niepowtarzający się podzbiór;
- wybrać RV Lite Core/Extended;
- dodać 0–3 Judges.

Losowanie używa bezpiecznego generatora platformy. Jeżeli użytkownik zażąda więcej targetów niż istnieje w wybranej puli i kategorii, preflight blokuje start i podaje kategorię, wartość żądaną i dostępną.

---

## 34. Training preflight, checkpoint i eksport

Preflight pokazuje co najmniej:

- liczbę sesji;
- liczbę wywołań Viewera — cztery na każdą sesję RV Lite;
- liczbę wywołań Judges;
- wariant protokołu;
- układ curriculum lub kategorie partial;
- maksymalny koszt Viewera wynikający z ustawionego limitu; koszt Judges jest wykazywany osobno/nie wchodzi w ten sufit;
- docelowy folder zapisu.

Checkpointy:

- SQLite po każdej zakończonej sesji;
- zewnętrzny pakiet na początku;
- zewnętrzny pakiet po granicy każdego bloku 5+2;
- zewnętrzny pakiet po Pause, Failed i Completed.

Pause działa po zakończeniu aktualnej sesji, a nie przez przerwanie odpowiedzi w połowie. Opcjonalna pauza po każdym bloku umożliwia kontrolę długiego runu.

Domyślny folder natywny:

`Documents/AI RV Harness/Training`

Można go zmienić w Settings. Każdy run otrzymuje czytelny katalog w rodzaju:

`Training_NNN_DATE`

Pakiet zawiera manifest, summary, checkpoint, sesje, Reveale, oceny Judges i agregaty. Dzięki temu run można skopiować, zarchiwizować lub przeanalizować poza aplikacją.

---

## 35. Historia Training

Historia pokazuje numer runu, datę, typ Full/Partial, status, postęp, wybrane kategorie, protokół, modele i lokalizację pakietu. Po zakończeniu dostępne są wyniki globalne i, jeżeli Judges byli użyci, wyniki według kategorii i targetów.

Run przerwany lub zapauzowany może zostać odtworzony z checkpointu bez ponownego wykonywania zakończonych targetów. Wznowienie musi zachować pierwotny plan i snapshot; nie może w ciszy wylosować innej puli.

---

## 36. Research — architektura blind

Research służy do kontrolowanych porównań warunków sesji. Każdy projekt:

- używa z góry przygotowanej konfiguracji;
- tworzy anonimowe identyfikatory sesji;
- losuje wykonanie i kolejność ocen;
- przechowuje blinding mapping oddzielnie;
- blokuje konfigurację przed startem;
- utrwala wyniki przed unblindingiem;
- dopiero potem oblicza podsumowanie warunków.

Stan projektu:

`Draft → Preflight → Locked → Running → SessionsComplete → Judging → ScoresFrozen → Unblinded → Complete`

Stany wyjątkowe:

- `Interrupted`;
- `Failed`.

W wersji 0.7.5 Research używa Full RCP 1.5a jako stałego protokołu. Sesje eksperymentalne nie są Training Runs.

---

## 37. Research Templates

Dostępne szablony:

1. **Reasoning Calibration** — porównanie poziomów reasoning wspieranych przez model;
2. **Temperature Test** — porównanie temperatur;
3. **Profile / API-Key Comparison** — porównanie profili/tras przy kontrolowanych pozostałych zmiennych;
4. **Model Comparison** — porównanie modeli;
5. **Practice Effect** — porównanie kolejności/powtórzenia;
6. **System Prompt Comparison** — porównanie wariantów edytowalnej części promptu;
7. **Custom Variable** — własne neutralne instrukcje warunków.

Builder rozróżnia zmienną badaną i parametry stałe. Jeżeli model nie wspiera danego reasoning lub temperatury, opcja jest niedostępna albo preflight zwraca błąd. Warianty promptu i Custom Variable mogą mieć od 2 do 4 warunków.

Użytkownik może wybrać zapis do późniejszej oceny zewnętrznej albo 1–3 AI Judges.

---

## 38. Research lock, ocena i unblinding

Po zaakceptowaniu preflight konfiguracja projektu jest hashowana i blokowana. Nie można zmienić warunków, targetów, modelu kontrolnego ani mapowania bez utworzenia nowego projektu.

Judge otrzymuje świeży, zanonimizowany pakiet. Nie zna etykiety badanego warunku. Wyniki są zapisywane i zamrażane przed odsłonięciem mapowania.

Po unblindingu aplikacja:

- łączy wyniki z warunkami;
- oblicza agregaty;
- zachowuje wyniki indywidualne;
- umożliwia eksport Research Package;
- nie pozwala, aby późniejsza narracja zmieniła zamrożone score'y.

Przerwany projekt można przygotować do kontrolowanego retry. Zakończone sesje i zamrożone wyniki nie są nadpisywane.

---

## 39. Providerzy i natywna komunikacja

Obsługiwane rodzaje providerów:

- OpenRouter;
- OpenAI;
- Google;
- Anthropic;
- Z.AI;
- DeepSeek;
- Mistral;
- Custom OpenAI-compatible.

Konfiguracja providera zawiera nazwę, typ, opcjonalny base URL i odwołanie do sekretu. Custom OpenAI-compatible wymaga podania base URL.

Warstwa providerów odpowiada za:

- test połączenia;
- pobieranie listy modeli;
- normalizację metadanych;
- budowę właściwego payloadu API;
- transport reasoning właściwy dla konkretnego providera/modelu;
- timeout, anulowanie i błędy;
- normalizację użycia tokenów oraz kosztów;
- redagowanie sekretów w debug logu.

Klucze API nigdy nie są przechowywane bezpośrednio w profilu, SQLite, Research Package ani eksporcie sesji.

---

## 40. Dynamic Model Registry

Modele są odkrywane dynamicznie i zapisywane w lokalnym rejestrze. Rekord modelu może zawierać:

- provider i model ID;
- nazwę wyświetlaną;
- limit kontekstu i wyjścia;
- obsługę vision;
- obsługę temperatury i zakres;
- obsługę reasoning, dostępne poziomy i wymagany transport;
- ceny input/output, jeżeli provider je udostępnia;
- źródło i pewność informacji o capability;
- znacznik favorite;
- czas pobrania.

Rejestr reasoning dla znanych modeli uzupełnia lub koryguje niedokładne metadata providera. Dostępne poziomy logiczne obejmują:

`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`

Nie każdy model obsługuje każdy poziom. Transport może mieć postać `effort`, boolean `enabled` albo `thinking_level`. UI pokazuje wyłącznie opcje wynikające z capability konkretnej trasy.

`AUTO` oznacza pozostawienie decyzji providerowi albo zastosowanie właściwego mapowania. `OFF`/`none` jest dostępne tylko wtedy, gdy model pozwala wyłączyć reasoning. Model z reasoning obowiązkowym nie może być przedstawiony jako wyłączony.

---

## 41. Requested i Effective Generation Settings

Użytkownik może ustawić:

- reasoning;
- temperaturę;
- maksymalny output;
- timeout;
- retry;
- limit kosztu sesji.

Przed żądaniem aplikacja rozwiązuje parametry do `effective settings`. Jeżeli opcja jest nieobsługiwana, nie wolno jej po cichu wysłać jako innego parametru. Interfejs i snapshot zapisują zarówno żądanie, jak i wynikowe ustawienie/transport.

Koszt jest obliczany z metadanych cenowych, jeżeli są dostępne. Brak cen nie może być przedstawiony jako pewne zero. Limit kosztu `0` oznacza wyłączenie guardu, nie darmową sesję.

---

## 42. Settings

Settings ma osiem kart.

### 42.1 Providers & API

- dodawanie i usuwanie konfiguracji;
- bezpieczne zapisanie sekretu;
- test połączenia;
- odświeżenie modeli;
- base URL dla własnej trasy;
- status połączenia i bezpieczny credential hint.

### 42.2 Models

- lista modeli według providera;
- limity i capabilities;
- vision, reasoning i temperature;
- ceny, jeżeli znane;
- favorites;
- odświeżenie rejestru.

### 42.3 Storage

- ścieżka danych i artefaktów natywnych;
- folder Training;
- informacje o cache;
- otwarcie folderu danych;
- backup, restore i eksport snapshotu danych.

Rzeczywista ścieżka SQLite zależy od katalogu app-data przydzielonego przez Tauri i system operacyjny. Aplikacja pokazuje ją w Settings; dokument nie koduje stałej ścieżki Windows.

### 42.4 Targets

- liczba Training Targets i My Targets;
- status pakietu fabrycznego;
- polityka powtórzeń;
- prefiks kodu sesji;
- informacja o licencji;
- pozycja „Download More” pozostaje nieaktywna, ponieważ pakiet 84 jest bundled.

### 42.5 Sessions

- język sesji;
- timeout;
- liczba retry;
- domyślny max output;
- maksymalny koszt;
- domyślny Reveal Source;
- przypomnienie, że autosave jest obowiązkowy.

### 42.6 Appearance

- język interfejsu: PL/EN;
- motywy: Blue, Aurora, Light, Dark, Green;
- skala tekstu: mała, normalna, duża;
- animacje.

### 42.7 Advanced

- wersja aplikacji;
- liczba modeli w cache;
- liczba tras vision/reasoning/compatibility;
- reset cache możliwości;
- ulotny, zredagowany API debug log;
- debug log nie jest trwałym magazynem i nie może zawierać sekretu.

### 42.8 About & Protocols

- pełny Full RCP PL/EN;
- RV Lite Core i Extended PL/EN;
- fabryczny Viewer System Prompt PL/EN;
- fabryczny Monitor System Prompt PL/EN;
- wersje zasobów;
- model dwóch licencji;
- Credits.

Zasoby fabryczne w tej karcie są tylko do odczytu i służą także do odzyskania oryginalnej treści po zmianie promptu w Profilu.

---

## 43. Lokalizacja

Język interfejsu i język sesji są niezależnymi ustawieniami:

- UI: `pl` albo `en`;
- sesja: `same`, `pl` albo `en`.

Zmiana języka UI nie powinna przepisywać historycznych sesji ani zasobów zapisanych w snapshocie. Protokół, prompt i komendy użyte w sesji są wybierane w resolved session language.

Bundled zasoby dwujęzyczne:

- Full RCP;
- RV Lite;
- Viewer factory prompt;
- Monitor factory prompt;
- komunikaty i UI.

Fabryczne opisy 84 targetów są obecnie źródłowo angielskie. Wersja PL interfejsu pokazuje przetłumaczone kategorie i angielski fallback Revealu. Nie wolno automatycznie oznaczyć maszynowego tłumaczenia jako zatwierdzonego polskiego zasobu.

---

## 44. Motywy, logo i identyfikacja wizualna

Nowa instalacja uruchamia się w motywie Blue. Dostępne są także Aurora (różowo-fioletowy), Light, Dark i Green. Motywy zmieniają tokeny kolorystyczne, nie znaczenie statusów i granic bezpieczeństwa.

Logo niebieskiego kwadratu z falami zostało zastąpione znakiem graficznym Rosehip bez podpisu „The Rosehip Publications”. Znak jest używany jako kompaktowa marka aplikacji oraz podstawa ikon pakietu. Interfejs zachowuje nazwę `AI RV Harness` obok znaku tam, gdzie pozwala na to miejsce.

Ikony Tauri znajdują się w `src-tauri/icons`, a źródłowy znak aplikacji w zasobach frontendu. Ikona aplikacji może być prezentowana przez system w kwadratowym kaflu mimo okrągłej/organicznej formy znaku — kontroluje to Windows.

---

## 45. Persistence i SQLite

Baza natywna nazywa się `rv_harness.db`. Migracje 1–18 tworzą i rozwijają m.in.:

- app settings;
- metadata credentials;
- profiles i workspaces;
- thread groups, conversations i messages;
- workspace sources i aktywacje źródeł;
- provider configs i model registry;
- capability snapshots i favorites;
- system prompts i ich wersje;
- protocols i ich wersje;
- targets, usage, artefakty obrazowe i clarifications;
- RV sessions, events, snapshots i reveals;
- monitor runs i interventions;
- judge runs i frozen scores;
- research projects, conditions, assignments, mappings i results;
- training runs;
- exports.

Ważne migracje późniejsze:

- 9 — append-only post-Reveal transcript;
- 10 — atomowe przejście Reveal;
- 12 — ochrona mutacji targetów;
- 15 — osobne nazwy AI/Human i prompt Monitora;
- 16 — Training run checkpoints;
- 17 — hierarchia Thread → Conversation;
- 18 — niedestrukcyjne wycofanie starych dziesięciu targetów.

Natywny storage używa skoordynowanych zapisów/transaction path, aby ograniczyć konflikty blokady bazy. Backup jest przygotowywany i finalizowany kontrolowanie; restore wymaga zamknięcia niespójnych operacji i ponownego wczytania stanu.

---

## 46. Artefakty, eksporty i odtwarzalność

Eksport może obejmować zależnie od modułu:

- manifest;
- snapshot;
- transcript pre-Reveal;
- hash evidence;
- Reveal i manifest obrazów;
- post-Reveal comments;
- Monitor log;
- Judge packets, odpowiedzi i scores;
- Research config, lock, mappings po unblind i agregaty;
- Training checkpoint, summaries i wyniki;
- wersje zasobów i aplikacji.

Eksport nie może zawierać kluczy API. Credential jest reprezentowany co najwyżej przez identyfikator metadanych, provider, hint albo fingerprint wystarczający do rozpoznania trasy bez odtworzenia sekretu.

Markdown wyświetlany w aplikacji jest renderowany bez wykonywania dowolnego HTML/skryptów. Ścieżki artefaktów są walidowane przez natywną warstwę, a odczyt obrazu dla Judge'a dotyczy wyłącznie znanego artefaktu Revealu.

---

## 47. Backup i Restore

Settings → Storage umożliwia:

- pokazanie aktualnych ścieżek;
- przygotowanie backupu;
- listę backupów;
- eksport backupu do wskazanego miejsca;
- restore wybranego backupu;
- otwarcie folderu danych;
- eksport logicznego snapshotu danych.

Backup projektu użytkownika nie jest tym samym co paczka kodu źródłowego. Backup zawiera dane aplikacji, natomiast ZIP wydania zawiera kod. Do pełnego przekazania rozwoju potrzebne są oba rodzaje, jeżeli mają zostać zachowane także lokalne sesje użytkownika.

---

## 48. Bezpieczeństwo i prywatność

Wymagania bezwzględne:

- sekrety poza SQLite;
- brak kluczy w eksporcie, debug logu i błędzie UI;
- target/reveal niedostępny dla Viewera i Monitora przed boundary;
- niemutowalny sealed transcript;
- jawne błędy vision zamiast pozornej analizy obrazu;
- jawne requested/effective settings;
- brak cichego skracania Sources;
- brak cichego pomijania failed call;
- CSP ograniczające źródła treści w aplikacji;
- operacje destructive wymagają precyzyjnego targetu i nie niszczą danych historycznych.

Program nie szyfruje całego urządzenia ani nie zastępuje zasad bezpieczeństwa systemu operacyjnego. Użytkownik odpowiada za ochronę swojego konta, urządzenia, backupów i repozytorium.

---

## 49. Obsługa błędów

### 49.1 Provider

Timeout, błąd HTTP, niepoprawny JSON, limit, anulowanie lub brak sekreta są pokazywane jawnie. Retry respektuje skonfigurowany limit. Nieudane wywołanie nie może zostać zapisane jako poprawna odpowiedź modelu.

### 49.2 Sesja

Dotychczasowe odpowiedzi pozostają zapisane. Stan przechodzi do Interrupted albo Failed z eventem i szczegółem technicznym wystarczającym do diagnozy, ale bez sekretu.

### 49.3 Training

Run zachowuje checkpoint i pakiet zewnętrzny. Resume kontynuuje od następnej niezakończonej pozycji zgodnie z tym samym planem.

### 49.4 Research

Lock i dotychczasowe sesje pozostają. Retry nie może zmienić randomizacji ani warunku historycznej sesji.

### 49.5 Storage

Błąd bazy lub pliku nie jest ukrywany. Operacja wymagająca zapisu nie przechodzi do następnego etapu, jeżeli trwały zapis się nie powiódł.

---

## 50. Build i wydanie Windows

Workflow `.github/workflows/release-windows.yml` uruchamiany jest ręcznie (`workflow_dispatch`) i działa tylko na branchu `main`.

Kolejność:

1. checkout;
2. Node.js 24;
3. Rust stable + clippy;
4. wygenerowanie/synchronizacja `src-tauri/Cargo.lock` i automatyczny commit, jeżeli lock się zmienił;
5. cache Rust;
6. `npm ci`;
7. TypeScript typecheck;
8. testy Vitest;
9. Rust tests;
10. Clippy;
11. Tauri build;
12. utworzenie draft GitHub Release i dodanie instalatora jako asset.

Wydanie jest draftem i wymaga ręcznej kontroli/publikacji. Brak podpisu code-signing może powodować ostrzeżenie Windows SmartScreen.

---

## 51. Stan weryfikacji 0.7.5

W środowisku przygotowania wydania wykonano:

- 56 plików testowych;
- 134 testy — zaliczone;
- TypeScript typecheck — zaliczony;
- frontend production build — zaliczony.

Znane wyniki/ostrzeżenia:

- Vite zgłasza ostrzeżenie o dużym chunku; nie blokuje buildu;
- lokalne środowisko nie miało toolchainu Rust, dlatego `cargo test`, `clippy` i finalny natywny build są częścią GitHub Actions;
- instalator musi zostać sprawdzony na Windows po wykonaniu workflow.

Minimalny release gate:

- wszystkie testy JS/TS zielone;
- typecheck zielony;
- Rust tests i clippy zielone w workflow;
- instalator uruchamia się na czystym profilu Windows;
- migracja istniejącej bazy do wersji 18 kończy się poprawnie;
- test smoke: provider → Chat → Full RCP → Reveal → Training checkpoint → backup/restore.

---

## 52. Licencje i prawa do treści

Projekt ma model dwóch głównych licencji.

### 52.1 Kod — MIT

Kod źródłowy aplikacji jest objęty licencją MIT z pliku `LICENSE`.

### 52.2 Treści — CC BY 4.0

Na licencji Creative Commons Attribution 4.0 International (CC BY 4.0) udostępniane są w szczególności:

- Full RCP;
- RV Lite Core i Extended;
- fabryczne prompty AI Viewera i AI Monitora, w tym zasoby PL/EN;
- fabryczne targety treningowe i ich autorskie opisy;
- podobne autorskie metody, słowniki, zadania i materiały dołączone do Harnessu, o ile nie oznaczono ich inaczej.

Użytkownik redystrybuujący lub modyfikujący te treści musi zachować odpowiednią atrybucję, informację o licencji i oznaczenie zmian. Szczegóły znajdują się w `CONTENT_LICENSE_CC_BY_4.0.md` i `CREDITS.md`.

### 52.3 Rosehip

Znak Rosehip jest osobnym zasobem marki dostarczonym przez użytkownika. Nie jest automatycznie relicencjonowany przez MIT ani CC BY 4.0. Jego użycie poza aplikacją wymaga uprawnienia właściciela znaku.

### 52.4 Dane użytkownika

Sesje, własne targety, klucze, rozmowy i inne dane utworzone przez użytkownika nie stają się przez sam fakt użycia programu treścią CC BY 4.0.

---

## 53. Mapa kodu projektu

Najważniejsze lokalizacje:

- `src/App.tsx` — główny routing UI i składanie ekranów;
- `src/components/` — komponenty ekranów, Research Builder, providery i kontrolki;
- `src/sessions/` — kontrolery Full RCP, RV Lite, Custom, koszt, snapshot i przebieg;
- `src/monitor/` — budowa pakietu Monitora, parser decyzji i log;
- `src/judge/` — prompt, parser, rubryka i silnik Judge;
- `src/research/` — typy, preflight, lock, execution, judging i unblind;
- `src/training/` — curriculum, preflight, engine, checkpoint i eksport;
- `src/targets/` — normalizacja, pakiet 84 i wybór targetów;
- `src/resources/` — protokoły, prompty, registry, targety i znak;
- `src/providers/` — capability registry, ustawienia i natywny transport;
- `src/storage/` — repozytorium danych i implementacja Preview;
- `src-tauri/src/` — backend Rust: providery, sekrety, baza, pliki, backup;
- `src-tauri/migrations/` — migracje SQLite 1–18;
- `src-tauri/icons/` — ikony aplikacji;
- `.github/workflows/release-windows.yml` — natywny build Windows;
- `README.md`, checkpointy i wymagania — dokumentacja wydania.

Przed zmianą zachowania należy najpierw znaleźć odpowiedni kontroler i test, a nie opierać się wyłącznie na komponencie UI.

---

## 54. Architektoniczne invariants — nie wolno regresować

1. Conversation i Manual RV mają izolowane konteksty.
2. Automatic RV ma własny kontroler i nie jest zwykłym chatem z inną etykietą.
3. Viewer i Monitor nie znają Revealu przed zapieczętowaniem.
4. Pre-Reveal transcript po seal jest niemutowalny.
5. Post-Reveal jest append-only.
6. Każda odpowiedź jest zapisywana przed kolejnym call.
7. Snapshot rejestruje pełne użyte zasoby i effective settings.
8. Monitor ma maksymalnie pięć poleceń po Fazach 2–6.
9. Locked identity Viewera, locked activity i locked Monitor execution nie są edytowalne.
10. „Aktywność” nie oznacza domyślnie aktywności ludzkiej.
11. Full Training zawsze jawnie oznacza dokładnie 84 fabryczne targety.
12. My Targets nie są włączane do Full Training.
13. Research scores są zamrażane przed unblindingiem.
14. Sekrety nie trafiają do SQLite ani eksportów.
15. Stare targety są wycofywane niedestrukcyjnie.
16. Kod MIT i treści CC BY 4.0 pozostają rozdzielone.
17. Rosehip nie jest automatycznie objęty licencją kodu ani treści.
18. Brak capability lub ceny jest stanem nieznanym, nie fałszywym wsparciem ani zerowym kosztem.

---

## 55. Kryteria akceptacji funkcjonalnej v0.7.5

### Nawigacja i tożsamość

- Home ma pełne podpisy; ekrany robocze mają ikony z tooltipami.
- AI i człowiek mają osobne nazwy i poprawne fallbacki.
- hierarchia Workspace → Thread → Conversation działa z rename/archive/new.

### Chat

- Conversation i Manual RV nie mieszają historii ani promptów.
- Sources są aktywowane per Conversation i nie są cicho obcinane.
- obrazy są dostępne wyłącznie na trasie vision.

### RV

- Full RCP wykonuje sześć faz i seal;
- RV Lite wykonuje dokładnie cztery wywołania w Core/Extended;
- Custom ma 1–20 kroków i osobny Reveal;
- Special Task jest wstrzykiwany we właściwym punkcie;
- STOP, retry, timeout, autosave i koszt działają jawnie.

### Monitor

- pełny prompt jest widoczny;
- część użytkownika jest edytowalna;
- bloki locked nie są edytowalne;
- naturalne polecenia nie wymagają zamkniętej biblioteki ani JSON-u;
- kontroler egzekwuje pięć wymian i Continue.

### Reveal/Judge

- Viewer komentuje przed Monitorem;
- seal pozostaje niezmieniony;
- Judges mają świeży kontekst i frozen score;
- obrazowy Reveal wymaga vision.

### Targets/Training

- aktywny pakiet ma 84 targety w rozkładzie 10/10/10/10/10/10/24;
- stare 10 są retired, nie usunięte;
- Full Training pokazuje 84 i wykonuje 12 bloków 5+2;
- Partial respektuje kategorię, źródło i dostępność;
- checkpoint istnieje po każdej sesji oraz na granicach runu.

### Research

- konfiguracja jest zablokowana przed startem;
- mapowanie pozostaje ukryte do frozen scores;
- retry zachowuje plan;
- eksport umożliwia audyt.

### Storage i security

- klucze są poza SQLite;
- backup/restore działa natywnie;
- eksport nie zawiera sekretu;
- migracje 1–18 są stosowane kolejno;
- błędy zapisu nie są maskowane.

---

## 56. Znane zależności przed publicznym oznaczeniem release

1. Uruchomić workflow Windows i sprawdzić Rust tests, clippy oraz instalator.
2. Wykonać smoke test na czystym profilu oraz migrację kopii bazy 0.7.4.
3. Uzupełnić ostateczną atrybucję CC BY 4.0 przed publiczną redystrybucją treści.
4. Zdecydować, czy przygotować ręcznie zweryfikowane polskie opisy 84 targetów; do tego czasu pozostawić jawny fallback EN.
5. Rozważyć code signing instalatora, jeżeli aplikacja ma być szeroko dystrybuowana.
6. Rozważyć podział dużego chunku frontendu; ostrzeżenie nie blokuje 0.7.5.

---

## 57. Jak przekazać projekt do innego AI lub nowej rozmowy

Minimalny komplet przekazania:

1. pełna paczka źródłowa `AI_RV_Harness_v0.7.5_COMPLETE_UPDATE_source.zip`;
2. ten dokument `RV_Harness_Release_v0.7.5_Functional_Specification_PL.md`;
3. opcjonalnie backup danych użytkownika z Settings → Storage, jeżeli nowa osoba/AI ma analizować także istniejące sesje;
4. link do repozytorium GitHub, jeżeli kod został już wypchnięty.

Nowe AI powinno:

1. rozpakować kod do osobnego katalogu;
2. przeczytać ten dokument w całości;
3. przeczytać `README.md` i `CHECKPOINT_0.7.5_PL.md`;
4. sprawdzić `git status`, wersje i istniejące zmiany użytkownika;
5. uruchomić `npm ci`, `npm run typecheck`, `npm test -- --run` i `npm run build`;
6. przed edycją potwierdzić stan kodu wobec specyfikacji;
7. zachować invariants z rozdziału 54.

Przykładowa wiadomość startowa do nowego AI:

> Kontynuujemy projekt AI RV Harness od release v0.7.5. Załączam pełną paczkę źródłową i aktualną specyfikację as-built. Najpierw rozpakuj projekt, przeczytaj w całości `RV_Harness_Release_v0.7.5_Functional_Specification_PL.md`, następnie `README.md` i `CHECKPOINT_0.7.5_PL.md`, sprawdź kod oraz testy. Nie wprowadzaj zmian, dopóki nie podsumujesz aktualnego stanu, znanych zależności i architektonicznych invariants. Wszystkie kolejne wymagania dopisuj do nowego pakietu zmian, a po implementacji aktualizuj specyfikację release.

---

## 58. Gdzie przechowywany jest projekt

W czasie tej rozmowy robocza kopia kodu znajduje się w tymczasowym workspace rozmowy:

`/workspace/scratch/06d734340c96/ai-rv-harness`

To jest ścieżka techniczna sesji roboczej, a nie trwały folder użytkownika. Nowa rozmowa nie powinna zakładać, że automatycznie zobaczy ten katalog.

Trwałe punkty przekazania są dwa:

- **Biblioteka ChatGPT** — paczka źródłowa i niniejsza specyfikacja release;
- **GitHub** — repozytorium używane do historii kodu i GitHub Actions.

Najbezpieczniejsza praktyka:

- po każdym większym release przechowywać w Bibliotece kompletny ZIP źródeł i odpowiadającą mu specyfikację;
- ten sam stan commitować/tagować na GitHubie;
- dane aplikacji archiwizować osobno poprzez Storage Backup;
- w nowej rozmowie załączyć pliki z Biblioteki lub podać repozytorium i wyraźnie wskazać dokument źródła prawdy.

---

## 59. Decyzje release 0.7.5

- Home zachowuje nazwy nawigacji; ekrany robocze używają ikon.
- dolny powtórzony blok Home został zastąpiony historią sesji.
- rozmowy używają hierarchii Profile → Workspace → Thread → Conversation.
- nazwa Profilu reprezentuje AI IS-BE; Human IS-BE ma osobne opcjonalne pole.
- Monitor jest autonomicznym modelem, nie zamkniętym skryptem komend.
- Monitor ma jedną twardą pętlę: do pięciu poleceń po Fazach 2–6.
- pełne prompty są widoczne; określone bloki są locked.
- tożsamość IS-BE i Shadow Zone Viewera są locked.
- definicja aktywności jest locked dla Viewera i Monitora.
- polski Monitor używa „osoba lub istota”, angielski `subject`.
- RV Lite ma Core i Extended, domyślnie Extended.
- Special Task trafia po Fazie 4 Full RCP lub po Kroku 3 RV Lite.
- aktywny starter pack został zastąpiony 84 Training Targets.
- Full Training jest stałe i zawsze jawnie ma 84 targety.
- Water i Human Activity mają po 10 targetów; Mixed Targets ma 24.
- źródłowe opisy targetów są EN z jawnym statusem braku polskiej redakcji.
- domyślny motyw to Blue; dostępnych jest pięć motywów.
- znak aplikacji to Rosehip bez podpisu wydawnictwa.
- kod jest MIT, treści projektu CC BY 4.0, Rosehip jest zasobem odrębnym.

---

## 60. Definicja aktualnego punktu bazowego

Release 0.7.5 jest prawidłowym punktem startowym dalszych prac, jeżeli:

- kod źródłowy odpowiada paczce oznaczonej 0.7.5;
- ten dokument znajduje się obok kodu i w Bibliotece;
- testy TypeScript/Vitest/build przechodzą;
- natywny build zostaje zweryfikowany przez GitHub Actions;
- nowe wymagania są zbierane jako kolejny pakiet, a nie dopisywane w ciszy do zachowania 0.7.5;
- po wdrożeniu kolejnego release powstaje nowa specyfikacja as-built i nowa kompletna paczka źródłowa.

**Koniec źródła prawdy dla AI RV Harness release v0.7.5.**
