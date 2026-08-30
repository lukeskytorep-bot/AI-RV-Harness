# AI RV Harness 0.7.2 — poprawki po testach wdrożone w 0.7.4

Status: **wdrożone w całości w źródle 0.7.4**. Lista pozostaje specyfikacją akceptacyjną i historią decyzji z testów Edwarda.

Aktualizacja została wykonana na bazie 0.7.3 z zachowaniem naprawy blokad SQLite. Obejmuje punkty 1–9, testy regresji, aktualizację wersji i nową paczkę źródłową.

## Zasada integracji

- Punktem wyjścia jest **już przygotowane i poprawione źródło 0.7.3**, a nie ponownie wersja 0.7.2.
- Wszystkie kolejne usterki wykrywane podczas testowania 0.7.2 należy dopisywać i później wdrożyć **na istniejącą 0.7.3**, bez cofania gotowych zmian.
- W szczególności zachować pełną naprawę blokad SQLite, wspólną kolejkę zapisów, natywne transakcje, retry, WAL, pojedynczą instancję repozytorium oraz wcześniejsze poprawki 0.7.3.
- Nie składać jeszcze nowej paczki 0.7.3. Najpierw zebrać wszystkie uwagi Edwarda, następnie wprowadzić je razem do istniejącego źródła 0.7.3, wykonać pełne testy regresji i dopiero wtedy utworzyć nową, jednoznacznie nazwaną paczkę.

## 1. Blokada SQLite

- Naprawa `database is locked` jest już wykonana w źródle 0.7.3. Zachować ją bez regresji podczas dodawania następnych poprawek.
- Naprawa musi obejmować wszystkie ścieżki zapisu, w tym Session, Reveal, AI Judge, AI Monitor, Profile, Providers, Targets, Research i Settings.

## 2. Fałszywe odrzucenie interwencji AI Monitora

Do wykonania:

- poprawić walidację `viewer_evidence`, aby nie odrzucała prawidłowych form liczby mnogiej ani normalnych odmian polskich i angielskich;
- nadal wymagać rzeczywistego oparcia komendy w wcześniejszym ślepym materiale Viewera i zachować ochronę przed naprowadzaniem;
- odrzucona lub wadliwa odpowiedź Monitora ma zostać zapisana do audytu, ale nie może zatrzymywać całej sesji;
- po odrzuceniu interwencji Protocol Controller ma wykonać `CONTINUE_PROTOCOL` i przejść do następnego kroku;
- chwilowy błąd API/odpowiedzi Monitora ponowić w ograniczony sposób, a po niepowodzeniu pominąć tę kolejkę Monitora;
- zapisywać dokładną przyczynę odrzucenia oraz surową odpowiedź Monitora potrzebną do diagnostyki;
- dodać testy regresji w języku polskim i angielskim, w tym `wall`/`walls`, `interior`, `corridor structure` oraz typowe polskie odmiany słów oznaczających strukturę, wnętrze i ścianę.

## 3. AI Monitor z RV Lite — jawnie zablokować w najbliższej poprawce

Stan faktyczny 0.7.2:

- kontroler AI Monitora jest zaimplementowany wyłącznie dla Full RCP;
- kontroler RV Lite wykonuje cztery podstawowe wywołania Viewera i ani razu nie uruchamia Monitora;
- interfejs blokuje wybranie Monitora dopiero wtedy, gdy RV Lite jest już aktywny, ale odwrotna kolejność jest myląca: po wybraniu `Automatic + AI Monitor`, a następnie RV Lite, aplikacja po cichu przełącza tryb na zwykły Automatic;
- użytkownik może przez to rozpocząć RV Lite w przekonaniu, że AI Monitor nadal jest aktywny, mimo że nie zostanie ani razu uruchomiony.

Decyzja dla najbliższej poprawki:

- nie dodawać jeszcze AI Monitora do RV Lite;
- zablokować nieobsługiwaną kombinację symetrycznie: przy aktywnym RV Lite przycisk Monitora jest wyłączony, a przy aktywnym Monitorze kafel RV Lite jest wyłączony;
- nie wykonywać cichego przełączenia `Automatic + AI Monitor` na `Automatic`;
- przy obu zablokowanych wyborach pokazać krótką informację: `AI Monitor działa obecnie tylko z Full RCP`;
- zachować także walidację w Preflight i kontrolerze, aby nieobsługiwanej kombinacji nie dało się uruchomić przez stan zapisany wcześniej lub inną ścieżkę interfejsu;
- dodać test interfejsu dla obu kolejności wyboru: `RV Lite → AI Monitor` oraz `AI Monitor → RV Lite`.

Ewentualna obsługa AI Monitora w RV Lite pozostaje osobną przyszłą funkcją do zaprojektowania i przetestowania. Nie łączyć jej z bieżącą poprawką usterek 0.7.2.

## 4. Fałszywy AUTO-STOP po prawidłowej Fazie 1 / 6× Touch

Zaobserwowany przypadek:

- sesja zakończyła się natychmiast po odpowiedzi Fazy 1 komunikatem `AUTO-STOP: repetitive output detected`;
- odpowiedź zawierała komplet sześciu Touches i wymagany, powtarzalny układ pól;
- takie wartości jak `Structure`, `Hard` i `Natural` powtarzały się, ale są dozwolonymi odpowiedziami warstwy kontaktu, a nie same w sobie dowodem zapętlenia modelu.

Potwierdzona przyczyna w 0.7.2:

- `detectRepetitiveOutput()` analizuje każdą pojedynczą odpowiedź Viewera natychmiast po jej zapisaniu;
- jeżeli dowolna linia o długości co najmniej 12 znaków wystąpi pięć razy, funkcja uznaje całą odpowiedź za zapętloną;
- detektor nie usuwa wcześniej składni Markdown ani stałych etykiet protokołu;
- w Fazie 1 nagłówki `**1. Echo Dot**`, `**2. Contact Category**`, `**3. Primitive Descriptor**`, `**4. Advanced Descriptor**` i `**5. Forming**` występują po sześć razy, więc sama poprawna struktura 6× Touch gwarantuje przekroczenie progu;
- AUTO-STOP nie oznacza zatem, że model rzeczywiście się zapętlił. W pokazanym przypadku jest to jednoznaczny fałszywy alarm detektora.

Do wykonania:

- przed analizą usunąć/ignorować nagłówki, numerację, separatory Markdown i inne stałe elementy formularza protokołu;
- nie traktować powtórzeń krótkich wartości kontrolowanego słownika, takich jak kategoria kontaktu i deskryptory, jako samodzielnej podstawy przerwania;
- wykrywać powtarzanie wyłącznie w treści merytorycznej Viewera, np. identyczne dłuższe frazy lub akapity;
- nie kończyć sesji po pierwszym niejednoznacznym podejrzeniu. Pierwsze wykrycie zapisać jako ostrzeżenie, a twardy AUTO-STOP stosować dopiero przy jednoznacznej długiej pętli albo ponownym zapętleniu w kolejnej odpowiedzi;
- zachować limit output tokens i limit kosztu jako niezależne, twarde zabezpieczenia;
- zastosować poprawkę we wszystkich kontrolerach używających tej wspólnej funkcji: Full RCP, RV Lite, Custom Protocol oraz odpowiedź po interwencji AI Monitora;
- dodać test regresji z dokładnie sześcioma powtarzającymi się nagłówkami Touch, który ma przechodzić bez AUTO-STOP;
- zachować test rzeczywistej pętli zawierającej wielokrotnie identyczną, długą treść merytoryczną;
- w komunikacie diagnostycznym zapisywać, która reguła i jaki fragment wywołały podejrzenie powtórzeń.

## 5. Renderowanie Markdown zamiast pokazywania surowych gwiazdek

Stan faktyczny 0.7.2:

- odpowiedzi w Chat są wyświetlane w zwykłym elemencie tekstowym, dlatego składnia taka jak `**pogrubienie**`, nagłówki `##` i listy pozostaje widoczna użytkownikowi;
- bieżący i zapisany transcript sesji RV jest wyświetlany jako surowy tekst w elemencie `pre`;
- podobnie surowy tekst jest używany w rozmowie po revealu i w części pozostałych widoków treści generowanej przez AI;
- aplikacja nie ma obecnie renderera Markdown.

Do wykonania:

- renderować bezpieczny Markdown we wszystkich widokach wiadomości i transcriptów przeznaczonych do czytania przez człowieka: Chat, Manual RV, Automatic Session, Automatic + AI Monitor, zapisane sesje, rozmowa post-reveal oraz czytelne treści Judge/Monitor;
- zachować w bazie i eksportach oryginalny, niezmieniony tekst Markdown; zmiana dotyczy wyłącznie prezentacji w interfejsie;
- obsłużyć co najmniej nagłówki, pogrubienie, kursywę, listy, cytaty, separatory, tabele i bloki kodu;
- nie zezwalać na wykonywanie surowego HTML ani skryptów pochodzących z odpowiedzi modelu;
- bloki kodu i szkice ASCII zachować w czcionce monospace, z zachowaniem spacji i podziałów wierszy oraz przewijaniem poziomym zamiast deformowania szkicu;
- podczas trwającej sesji renderer ma poprawnie aktualizować kolejne fazy bez zmiany treści zapisywanego transcriptu;
- dodać testy dla `**bold**`, nagłówków, list, tabeli, fenced code block oraz nieszkodliwego wyświetlenia surowego HTML/skryptu.

## 6. Full RCP — zawsze wykonywać wymagane szkice jako ASCII

Zaobserwowany problem:

- Full RCP wymaga dwóch funkcjonalnych szkiców w Fazach 2, 3 i 4;
- protokół mówi o rysowaniu, ale nie określa technicznego formatu odpowiedzi modelu;
- model może przez to opisać rysunek słownie zamiast rzeczywiście wykonać szkic tekstowy.

Decyzja:

- nie zmieniać merytorycznej treści RCP v1.5a;
- do stałej instrukcji Protocol Controllera dla Full RCP dodać jedno globalne zdanie w PL i EN: gdy protokół wymaga rysunku lub szkicu, Viewer ma zawsze wykonać go jako tekstowy szkic ASCII w fenced code block, z etykietami umieszczonymi bezpośrednio przy elementach, a nie zastępować go samym opisem słownym;
- instrukcję przekazać w pierwszym wywołaniu Viewera tak, aby pozostawała w kontekście całej sesji i działała identycznie w `Automatic` oraz `Automatic + AI Monitor`;
- zaktualizować wersję promptu kontrolera i zachować jej identyfikator w snapshotach/zdarzeniach sesji dla odtwarzalności badań;
- nie dodawać tej zmiany do RV Lite, ponieważ Lite już jawnie wymaga szkiców ASCII;
- dodać test kontrolera potwierdzający obecność instrukcji ASCII w obu językach i niezmieniony przebieg sześciu faz.

## 7. Reasoning — rozdzielić Auto, OFF/NONE i poziomy wysiłku

Stan faktyczny 0.7.2:

- pusta wartość `Provider default` nie oznacza `OFF`; aplikacja po prostu nie wysyła żadnej konfiguracji reasoning, więc model/provider stosuje własne ustawienie domyślne;
- interfejs pokazuje wybór tylko wtedy, gdy metadane modelu zawierają dokładną listę `supported_efforts`; gdy provider zgłasza samo istnienie thinking/reasoning bez listy poziomów, kontrolka jest blokowana;
- bezpośredni rejestr modeli Google zgłasza istnienie thinking, ale obecny kod celowo pozostawia listę poziomów pustą, dlatego Gemma może wyglądać jak model z reasoningiem włączonym i niemożliwym do zmiany;
- OpenRouterowe `NONE` jest obecnie widoczne tylko wtedy, gdy dosłownie występuje w `supported_efforts` albo provider zwraca `supported_efforts: null`; przy liście takiej jak `HIGH/XHIGH` aplikacja nie dodaje osobnego wyłącznika, nawet jeśli reasoning nie jest obowiązkowy;
- dla bezpośredniego Google obecna obsługa wartości `none` jest niepoprawna: pomija `thinkingConfig`, co ponownie oznacza domyślne zachowanie providera, a nie gwarantowane wyłączenie;
- zapis `NONE` oznacza brak dodatkowego budżetu/reasoningu ustawianego przez interfejs, nie brak zwykłego przetwarzania odpowiedzi przez model.

Wymagane zachowanie:

- nie dodawać osobnego pola do ręcznego wpisywania dowolnej wartości reasoning;
- zastosować tylko dwa źródła listy wyboru:
  1. `Znany model` — dokładny identyfikator modelu rozpoznany w lokalnym, wersjonowanym rejestrze JSON; UI pokazuje wyłącznie zapisane tam opcje oraz `AUTO / domyślne providera`;
  2. `Nieznany model` — UI pokazuje `AUTO / domyślne providera`, poziomy zgłoszone przez providera oraz brakujące wartości z pełnej standardowej listy `NONE / MINIMAL / LOW / MEDIUM / HIGH / XHIGH / MAX`; wybór spoza metadanych ma być oznaczony jako niezweryfikowany, ale nie wymaga ręcznego wpisywania;
- lokalny rejestr ma opisywać możliwości modelu, nie najlepszy wynik RV; rekomendowany poziom nadal jest wynikiem osobnej kalibracji każdej pary `Profil/API key × model`;
- rejestr ma przechowywać dokładne identyfikatory i aliasy tras, dozwolone wartości UI, sposób transportu do OpenRouter/bezpośredniego providera, `mandatory`, źródło weryfikacji i datę weryfikacji;
- warianty tej samej trasy, np. `:free` i `:batch`, mogą dziedziczyć wpis modelu bazowego, jeżeli ich obsługa reasoning jest identyczna; w przeciwnym razie wymagają osobnego wpisu;
- początkowy lokalny rejestr:
  - `nousresearch/hermes-4-405b` — `NONE / ENABLED`;
  - `google/gemma-4-31b-it` — `NONE / ENABLED`;
  - `google/gemini-3-flash-preview` — `MINIMAL / LOW / MEDIUM / HIGH`;
  - `z-ai/glm-5.2` — `NONE / HIGH / XHIGH`;
  - `deepseek/deepseek-v4-pro` — `NONE / HIGH / XHIGH`;
  - `inclusionai/ring-2.6-1t` — `HIGH / XHIGH`, `mandatory: true`;
  - `nvidia/nemotron-3-ultra-550b-a55b` — `NONE / MEDIUM / HIGH`;
  - `cohere/command-a` — brak konfigurowalnego reasoning, tylko `AUTO`; nie mylić z osobnym modelem `Command A Reasoning`;
  - `ai21/jamba-large-1.7` — brak parametru reasoning w aktualnej trasie OpenRouter, tylko `AUTO`;
  - `qwen/qwen2.5-vl-72b-instruct` — brak parametru reasoning w aktualnej trasie OpenRouter, tylko `AUTO`;
  - `google/gemini-3.1-pro-preview` — `LOW / MEDIUM / HIGH`, `mandatory: true`;
  - `openai/gpt-5.5` — `NONE / LOW / MEDIUM / HIGH / XHIGH`;
  - `qwen/qwen3.8-max` — `MINIMAL / LOW / MEDIUM / HIGH / XHIGH`, `mandatory: true`;
- kolejnych wpisów nie dodawać na podstawie samej nazwy „reasoning model”; przed wpisaniem na stałe sprawdzić dokładny identyfikator, payload i zachowanie trasy;
- dla Gemma 4 pokazać modelowe `OFF/NONE` i `ON/ENABLED` (transportowo zgodne z wymaganiem konkretnego providera), zamiast blokować kontrolkę;
- dla ZAI/GLM-5.2 udostępnić `NONE` obok `HIGH/XHIGH`;
- jeżeli `mandatory: true`, ukryć `OFF/NONE` i wyraźnie napisać, że reasoning tego modelu nie może zostać wyłączony;
- nie zgadywać poziomu przy `AUTO`; przechowywać osobno wybór użytkownika, ustawienie efektywne i dokładny payload/tryb transportowy potrzebny do reprodukcji badania;
- zastosować wspólną logikę w Profile defaults, Chat, zwykłej sesji RV, Monitorze, Judge i Research;
- dodać testy dla OpenRouter, bezpośredniego Google, Gemma on/off, ZAI NONE/HIGH/XHIGH, Ring mandatory, modelu znanego bez konfigurowalnego reasoning, modelu nieznanego oraz odświeżenia metadanych providera.

## 8. Workspace — poprawić odnajdywanie i przełączanie

Stan faktyczny 0.7.2:

- utworzony workspace jest zapisywany i po utworzeniu automatycznie otwierany;
- później można go znaleźć na ekranie `Profiles`, na liście pod Profilem, do którego należy;
- ekran Home pokazuje tylko pięć ostatnich workspace'ów;
- nie istnieje osobny ekran wszystkich workspace'ów, wyszukiwarka ani przełącznik dostępny z otwartego workspace'u, dlatego przy większej liczbie utworzony workspace może sprawiać wrażenie zaginionego.

Do wykonania:

- dodać łatwo dostępny widok/przełącznik wszystkich aktywnych workspace'ów, pogrupowanych według Profili;
- umożliwić wyszukiwanie po nazwie workspace'u i Profilu;
- z otwartego workspace'u umożliwić bezpośrednie przełączenie na inny bez wracania przez kilka ekranów;
- po utworzeniu nadal automatycznie otworzyć nowy workspace i pokazać jednoznaczne potwierdzenie jego nazwy oraz Profilu;
- zachować widok pięciu ostatnich na Home jako skrót, ale nie jako jedyne globalne wejście;
- dodać test: utworzenie kilku workspace'ów, restart aplikacji, odnalezienie każdego z nich i przełączenie między nimi.

## 9. Wiele osobnych czatów w jednym workspace

Stan faktyczny 0.7.2:

- schema bazy już pozwala przechowywać wiele rekordów `chat_threads` dla jednego workspace'u;
- warstwa repozytorium udostępnia jednak tylko `getOrCreateChatThread(workspaceId, mode)` i zawsze wybiera pierwszy istniejący wątek danego trybu;
- interfejs nie ma listy wątków ani przycisku `Nowy czat`;
- w praktyce użytkownik ma jeden ciągły `Conversation` oraz osobno jeden ciągły `Manual RV` w danym workspace.

Do wykonania:

- dodać listę wątków dla bieżącego workspace'u i trybu;
- dodać `Nowy czat`, przełączanie między czatami i zmianę nazwy każdego czatu;
- pozwolić na dowolną praktyczną liczbę wątków (5–6 i więcej), bez naruszania istniejącego pierwszego czatu;
- zachować osobną historię wiadomości, stan Manual RV i zestaw aktywnych Workspace Sources dla każdego wątku — schema już wiąże te dane z `thread_id`;
- dodać bezpieczne archiwizowanie lub usuwanie czatu z potwierdzeniem, bez usuwania całego workspace'u;
- przy wejściu do modułu Chat otwierać ostatnio używany wątek, a nie zawsze najstarszy;
- nie wymaga to migracji dotychczasowych wiadomości: istniejący wątek pozostaje pierwszym wątkiem danego trybu;
- dodać testy tworzenia, przełączania, restartu aplikacji oraz izolacji historii i źródeł pomiędzy wątkami.
