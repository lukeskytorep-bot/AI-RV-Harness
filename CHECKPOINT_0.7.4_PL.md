# AI RV Harness — checkpoint 0.7.4

## Cel aktualizacji

Wersja 0.7.4 wdraża łącznie wszystkie uwagi z testów 0.7.2 na poprawionej bazie 0.7.3. Zachowuje kolejkę zapisów SQLite, natywne transakcje SQLx, retry dla `BUSY/LOCKED`, WAL oraz pojedynczą instancję repozytorium.

## AI Monitor i bezpieczeństwo przebiegu

- walidator dowodów rozpoznaje angielskie liczby mnogie oraz normalne odmiany polskie, m.in. `wall/walls`, `interior`, `corridor structure`, `ściana/ściany`, `wnętrze`, `konstrukcja` i `korytarz`;
- nadal wymaga dosłownego fragmentu z wcześniejszego ślepego transcriptu i nie pozwala Monitorowi dopowiadać nowych danych;
- wadliwa lub odrzucona odpowiedź jest zapisywana z kodem, przyczyną i surową treścią;
- Monitor otrzymuje najwyżej jedną ograniczoną próbę ponowną, a po niepowodzeniu kontroler zapisuje `CONTINUE_PROTOCOL` i prowadzi sesję dalej;
- koszt i ręczne przerwanie pozostają twardymi granicami;
- AI Monitor działa wyłącznie z Full RCP. Kombinacja z RV Lite lub Custom Protocol jest zablokowana symetrycznie w UI i Preflight, bez cichej zmiany trybu.

## AUTO-STOP i Full RCP

- wspólny, stanowy detektor powtórzeń działa w Full RCP, RV Lite, Custom Protocol i odpowiedziach po interwencji Monitora;
- ignoruje stałe nagłówki protokołu, numerację, krótkie deskryptory kontrolowane i fenced ASCII;
- pierwsze niejednoznaczne powtórzenie zapisuje jako ostrzeżenie, kolejne ostrzeżenie w następnej odpowiedzi zatrzymuje sesję, a jednoznaczna długa pętla zatrzymuje ją od razu;
- diagnostyka zawiera regułę i fragment, który uruchomił zabezpieczenie;
- instrukcja kontrolera Full RCP ma wersję 1.1.0 i wymaga szkiców jako fenced ASCII z etykietami przy elementach w języku polskim i angielskim.

## Czytelność treści AI

Chat, Manual RV, sesje bieżące i zapisane, post-reveal, Judge oraz Monitor renderują bezpieczny Markdown. Obsługiwane są nagłówki, pogrubienie, kursywa, listy, cytaty, separatory, tabele i bloki kodu. Surowy HTML/skrypty nie są wykonywane, zewnętrzne obrazy Markdown nie są pobierane, a szkice ASCII zachowują odstępy i przewijanie poziome. Baza i eksporty nadal przechowują oryginalny tekst.

## Reasoning

- dodano wersjonowany rejestr `src/resources/modelReasoningRegistry.json` z dokładnymi identyfikatorami, aliasami, `mandatory`, datą/źródłem weryfikacji i transportem providera;
- znane modele pokazują tylko opcje rejestru i AUTO; znane trasy bez konfigurowalnego reasoning pokazują wyłącznie AUTO;
- nieznane modele pokazują AUTO, poziomy providera i pełną listę `NONE–MAX`; wartości spoza metadanych są jawnie oznaczone jako niezweryfikowane;
- Gemma 4 otrzymuje czytelne `NONE / OFF` i `ENABLED / ON`, Z.AI GLM-5.2 ma `NONE/HIGH/XHIGH`, a modele obowiązkowe nie pokazują `NONE`;
- OpenRouter i Google otrzymują właściwy payload transportowy zamiast utożsamiania AUTO z OFF;
- snapshoty i Experiment Lock przechowują wybór użytkownika, ustawienie efektywne, etykietę, źródło weryfikacji i transport potrzebny do reprodukcji;
- rejestr jest nakładany również na wcześniejszy cache modeli, więc nie wymaga ręcznego odświeżania po aktualizacji.

## Workspaces i Chat

- nowy ekran Workspaces pokazuje wszystkie aktywne przestrzenie pogrupowane według Profili i wyszukuje po obu nazwach bez wrażliwości na polskie znaki;
- otwarty Workspace ma bezpośredni przełącznik, a utworzenie nowego pokazuje potwierdzenie `Profil → Workspace`;
- Chat i Manual RV obsługują wiele nazwanych wątków, przycisk Nowy czat, przełączanie, zmianę nazwy oraz archiwizację z potwierdzeniem;
- wiadomości, stan formalnego Manual RV i aktywne Workspace Sources pozostają odseparowane dla każdego wątku;
- ostatnio używany aktywny wątek otwiera się jako pierwszy, a aktywnego stanu `BLIND` nie można zarchiwizować;
- migracja 14 dodaje wyłącznie `archived_at` i indeks; istniejący pierwszy czat oraz cała historia pozostają bez zmian.

## Weryfikacja

- TypeScript typecheck: poprawny;
- Vitest: 53 pliki, 139/139 testów;
- produkcyjny build Vite: poprawny;
- testy obejmują Monitor PL/EN, sześć Touches, prawdziwe pętle, Markdown/HTML/ASCII, obie kolejności wyboru Monitor–Lite, reasoning znany/nieznany i transporty, wiele czatów po restarcie oraz katalog Workspace po restarcie;
- lokalne środowisko checkpointu nie zawiera toolchainu Rust; natywne testy payloadów zostały dodane do `src-tauri/src/providers.rs` i są wykonywane przez istniejący workflow CI/Release Windows.

## Aktualizacja danych

Aktualizacja nie resetuje bazy ani kluczy systemowych. Wszystkie Profile, Workspaces, providery, cele, sesje, Reveal, wyniki Judge, historie Monitora i projekty Research pozostają zachowane.
