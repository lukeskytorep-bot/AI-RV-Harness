# RV Harness — wymagania do następnej wersji po 0.7.4

Status: wymagania zatwierdzone; wdrożenie techniczne wykonane w wersji 0.7.5 dnia 18.08.2026. Ten plik jest pełnym aliasem dokumentu Pakietów 1–4. Wyniki kontroli i jawne zależności przed wydaniem opisuje `CHECKPOINT_0.7.5_PL.md`.

## Pakiet 1 — Home, nawigacja, rozmowy i ekran RV Session

### Home

- Zachować pełny lewy panel z ikonami i nazwami: Home, Profiles, Workspaces, Research Tests, Targets, Settings.
- Usunąć dolny prawy kafel powtarzający Home, Research Tests, Profiles i Settings.
- W jego miejscu dodać kafel Recent Sessions, analogiczny do Recent Workspaces, z możliwością szybkiego otwarcia ostatnio używanych/wykonywanych sesji.

### Rozdzielenie AI IS-BE i Human IS-BE

- Obecna widoczna nazwa Profilu, np. „Leo”, oznacza nazwę/tożsamość AI IS-BE, a nie imię człowieka korzystającego z Harnessu.
- Przy tworzeniu Profilu dodać opcjonalne pole „Nazwa AI IS-BE” / „AI IS-BE name”. Jeżeli pozostanie puste, aplikacja używa widocznej nazwy domyślnej „AI IS-BE”.
- Jeżeli podano własną nazwę AI IS-BE, zastępuje ona nazwę domyślną: w interfejsie i dyskusji pokazywać wyłącznie np. „Leo”, bez dopisywania „AI IS-BE”.
- Nie nazywać tego pola wyłącznie „Model”, ponieważ techniczny model providera (np. Gemma lub Gemini) pozostaje osobnym ustawieniem.
- Osobno dodać opcjonalne pole „Nazwa Human IS-BE” / „Human IS-BE name”, określające, jak AI ma zwracać się do człowieka. Jeżeli pozostanie puste, używać określenia „Human IS-BE”.
- Jeżeli podano nazwę Human IS-BE, zastępuje ona nazwę domyślną: w interfejsie i dyskusji pokazywać wyłącznie np. „Edward”, bez dopisywania „Human IS-BE”. Nazwa człowieka nie staje się nazwą Profilu ani AI.
- Reguła wyświetlania jest jednoznaczna: `AI display name = wpisana nazwa albo AI IS-BE`; `Human display name = wpisana nazwa albo Human IS-BE`.
- Oba pola muszą być później edytowalne, przechowywane oddzielnie i nigdy nie mogą być wzajemnie zastępowane.
- Dla istniejących danych potraktować dotychczasową nazwę Profilu jako nazwę AI IS-BE, a nowe opcjonalne pole Human IS-BE pozostawić puste, co daje wartość domyślną „Human IS-BE”.
- Snapshot sesji zapisuje użyte w danym uruchomieniu nazwy/oznaczenia AI IS-BE i Human IS-BE, aby późniejsza zmiana nie modyfikowała historycznego zapisu.

### Nawigacja na ekranach roboczych workspace'u

- Na ekranach Conversation, Manual RV Session i RV Session zwęzić lewy panel do samych ikon.
- Nazwy pozycji pokazywać w dymku po najechaniu kursorem.
- Dzięki zwężeniu przesunąć główną część roboczą w lewo i zwiększyć jej szerokość.
- Dopasować logo oraz tekst „Blind sessions. Reproducible research.” do węższego panelu.
- Pełne ikony wraz z nazwami pozostawić na Home.

### Docelowa hierarchia rozmów

- Wprowadzić strukturę: Profil → Workspace → Thread → Conversations.
- Przykład: Leo → pierwsza sesja → Thread „Kakao” → konwersacje.
- Rozszerzyć górny breadcrumb do: Profil → Workspace → Threads/aktualny Thread.
- Kliknięcie Threads ma otwierać listę Threadów; Thread ma dać się rozwinąć do należących do niego konwersacji.
- Umożliwić przejście bezpośrednio do wybranej konwersacji.
- Dodać menu z trzema kropkami przy Threadzie, m.in. do zmiany jego nazwy.

### Ekran Conversation

- Usunąć z głównej części obecne duże wiersze „Chats in this workspace” i „Thread title” wraz z obecnym osobnym polem zmiany nazwy Threadu.
- Zachować przełączniki Conversation i Manual RV Session.
- Obok przełączników, w wolnym miejscu, umieścić nazwę aktywnej konwersacji jako listę rozwijaną oraz przyciski New chat i Archive chat.
- Zachować odpowiedni odstęp, aby kontrolki aktywnej konwersacji nie zlewały się z przełącznikami trybu.
- New chat ma poprosić o nazwę i utworzyć konwersację w aktualnym Threadzie.
- Archive chat ma archiwizować aktywną konwersację.
- Zachować istniejące ustawienia Operator, Router, model i pozostałe elementy poniżej.

### Ekran RV Session

- Duży prawy panel z metadanymi protokołu domyślnie schować.
- Dodać mały przycisk/uchwyt przy prawej krawędzi do wysuwania i chowania panelu.
- W panelu zachować: protokół (np. Full RCP/RV Lite), Ready, język, liczbę słów, wersję, Inspect protocol resource, blind/reveal, External Blind i pozostałe dane techniczne.

### Recent RV sessions

- Wyjąć listę Recent RV sessions z prawego panelu.
- Przenieść ją na lewą stronę, pod ikonami nawigacji.
- Pokazywać ją po przejściu do RV Session i umożliwić szybkie otwieranie ostatnich sesji RV.

### Cel pakietu

- Usunąć powtórzenia, odzyskać miejsce na rozmowę/sesję, uporządkować relację Thread–Conversation i schować techniczne dane RV wtedy, gdy użytkownik ich nie potrzebuje.

## Pakiet 2 — autonomiczny AI Monitor

### Założenie

- Monitor ma działać jako samodzielna AI, a nie jak program wybierający wyłącznie identyfikatory z zamkniętej biblioteki.
- Usunąć programową ocenę treści polecenia Monitora: walidację command_id, prerequisite, dosłownego viewer_evidence i argumentu.
- Nie blokować polecenia tylko dlatego, że nie znajduje się na zamkniętej liście. Jakość i samokontrola mają zależeć od wybranego modelu Monitora i być widoczne w zapisie sesji.
- Nadal zachować pełny audyt wszystkich surowych odpowiedzi, poleceń i odpowiedzi Viewera.

### Widoczny i edytowalny prompt

- Na ekranie AI Monitor dodać przycisk/panel pokazujący cały efektywny prompt Monitora w wersji zgodnej z językiem sesji (PL lub EN).
- Użytkownik ma móc edytować główną część promptu i dostosować ją do własnych potrzeb.
- Pełny podgląd ma jasno pokazywać także nieedytowalną regułę wykonawczą dotyczącą limitu pytań/pogłębień.
- Zakres zapisu promptu (np. globalnie, dla Profilu, Workspace'u lub pojedynczego uruchomienia) wymaga późniejszego ustalenia.

### Naturalna lista przykładowych poleceń

- Usunąć formalny nagłówek/wersjonowanie „Allowed Command Library v1.0.1” z treści przeznaczonej dla Monitora.
- Usunąć techniczne identyfikatory CENTER, MOST_IMPORTANT_ASPECT itd., pola prerequisite oraz formalny format biblioteki.
- Zachować wszystkie dotychczasowe komendy jako naturalnie napisane przykłady, np. „Przejdź do centrum celu i opisz”, „Sprawdź i opisz ruch oraz aktywność”.
- Lista ma być zbiorem podpowiedzi, a nie zamkniętym katalogiem. Monitor może tworzyć własne neutralne pytania i polecenia.

### Swoboda prowadzenia sesji

- Monitor może wydawać własne polecenia pogłębiające, o ile pozostają neutralne i respektują ślepy charakter sesji.
- Może wykonywać ruchy przestrzenne, np. 100 m w lewo/prawo, 200 m nad celem, wejście do środka, orbitę/okrążenie celu z określonej odległości, opis otoczenia oraz mapę przestrzenną z zaznaczonym celem.
- W prompcie nadal wymagać używania neutralnego słownictwa: subject, structure, event, activity, location, object/aspect itd., bez nazywania celu i bez celowego podsuwania jego tożsamości.
- Harness nie ma sprawdzać, czy Monitor poprawnie przestrzega tych zasad. Ma jedynie wykonywać i zapisywać jego decyzje.

### Nowa pętla po fazach

- Nie uruchamiać Monitora po Fazie 1.
- Uruchamiać go po Fazach 2, 3, 4, 5 i 6.
- Po każdej z tych faz Monitor może wykonać maksymalnie pięć kolejnych pytań/ruchów pogłębiających.
- Pętla jest iteracyjna: Monitor wydaje jedno polecenie → Viewer odpowiada → Monitor dostaje zaktualizowany pełny transcript i decyduje o następnym poleceniu.
- Monitor może zakończyć wcześniej po 0, 1, 2, 3 lub 4 poleceniach, zwracając ustalony sygnał CONTINUE_PROTOCOL/Continue.
- Po piątej odpowiedzi Viewera kontroler automatycznie kończy pętlę Monitora i przechodzi do następnej fazy, nawet jeśli Monitor chciałby pytać dalej.
- Limit pięciu ma być egzekwowany przez kod i nie może być usuwalny przez edycję promptu.
- Do ustalenia przy implementacji pozostaje minimalny, odporny format odróżniający Continue od dowolnego swobodnego polecenia (bez powrotu do zamkniętej biblioteki).

### Dane przekazywane Monitorowi

- Zachować obecny dobry układ: numer fazy oraz cały dotychczasowy ślepy transcript Viewera, w tym wcześniejsze polecenia Monitora i odpowiedzi Viewera.
- Po każdej odpowiedzi w pętli Monitor otrzymuje transcript ponownie, już uzupełniony o najnowszą wymianę.
- Przed revealem Monitor nadal nie otrzymuje prawdziwego targetu ani jego opisu.

### Opcjonalne zadanie specjalne Monitora

- Podczas tworzenia sesji Automatic + AI Monitor dodać opcjonalne pole „Special Monitor Task”.
- Udostępnić dwa sposoby definiowania zadania: gotowe opcje do zaznaczenia oraz własne pole tekstowe; można rozważyć ich łączenie.
- Przykładowe gotowe opcje: główny subject, Subject A/B/C, główna aktywność, główne zdarzenie, Structure A, Object A/B oraz dalsze pogłębienie wybranego aspektu.
- Zadanie specjalne nie jest przekazywane Monitorowi na początku. Zostaje dołączone dopiero po zakończeniu Fazy 4 i jest dostępne w dalszej pracy Monitora.
- Przed revealem zadanie używa wyłącznie neutralnych etykiet (np. Subject A), bez ujawniania, że chodzi o prezydenta lub konkretną osobę/obiekt.
- Przy zadaniu własnym pokazać ostrzeżenie, aby nie wpisywać prawdziwej tożsamości ślepego celu.
- Jeżeli użyto etykiet Subject A/B/C, Structure A, Object A/B itd., Target Reveal musi zawierać ich jednoznaczne definicje/mapowanie. UI ma o tym wyraźnie ostrzegać operatora.
- Wybrane i wpisane zadanie specjalne zapisać w snapshotcie oraz logu sesji dla odtwarzalności badania.

### Komentarz Monitora po revealu

- Po ujawnieniu targetu najpierw Viewer otrzymuje reveal i przedstawia swoją opinię o sesji.
- Następnie Monitor otrzymuje Target Reveal, pełny przebieg sesji, własne interwencje oraz komentarz Viewera.
- Monitor tworzy osobny komentarz po revealu dotyczący trafności i przebiegu sesji, pracy Viewera oraz własnych decyzji/interwencji.
- Komentarz Monitora zapisać i pokazać razem z całościowym widokiem sesji; jest to etap post-reveal i nie może zostać włączony do zapieczętowanego materiału pre-reveal.

### Ekran AI Monitor

- Zastosować zwężoną nawigację z samymi ikonami i dymkami, zgodnie z Pakietem 1.
- Przenieść listę historycznych sesji Monitora na lewą stronę, pod ikonami nawigacji, wykorzystując wolne miejsce.
- Odzyskane miejsce w głównym panelu przeznaczyć m.in. na rozwijany podgląd/edytor pełnego promptu Monitora oraz szczegóły wybranej sesji.

## Pakiet 3 — warianty RV Lite, wygląd, Special Task, fabryczne prompty i licencje

### Dwa warianty RV Lite

- Po wybraniu RV Lite pokazać dwa wzajemnie wykluczające się warianty (karty/radio, a nie dwa niezależne checkboxy):
  - RV Lite Core — tylko cztery podstawowe kroki;
  - RV Lite Extended — cztery podstawowe kroki oraz dodatkowe pogłębienie pomiędzy Krokiem 3 i Krokiem 4: spokojny spacer po celu, główny aspekt, główna aktywność, centrum, otoczenie i mapa.
- Użytkownik wybiera dokładnie jeden wariant.
- Domyślny wariant wymaga ostatecznego potwierdzenia; dla zachowania obecnego działania najbezpieczniejszy jest Extended.
- Wybrany wariant zapisać w snapshotcie i eksporcie sesji.
- W części Extended użyć krótkiego polecenia: „Przejdź do głównej aktywności dowolnego rodzaju i opisz” / „Move to the primary activity of any kind and describe”. Pełne znaczenie aktywności definiują nieedytowalne bloki systemowe Viewera i Monitora.

### Niezmienne bloki systemowe Viewera i Monitora

- Definicję aktywności dołączyć jako widoczny, ale nieedytowalny blok systemowy zarówno do AI Viewera, jak i AI Monitora, w odpowiednim języku sesji.
- Definicja PL: „Aktywność oznacza każdą istotną formę działania, procesu, ruchu lub zmiany zachodzącej w celu. Może mieć charakter ludzki, biologiczny, mechaniczny, naturalny, środowiskowy, energetyczny lub inny. Nie zakładaj, że aktywność oznacza obecność ludzi.”
- Definicja EN: „Activity means any significant form of action, process, movement, or change occurring at the target. It may be human, biological, mechanical, natural, environmental, energetic, or of another kind. Do not assume that activity implies the presence of people.”
- W AI Viewerze dodatkowo zablokować przed edycją cały początkowy blok identyfikacji AI IS-BE oraz pełny blok `Base State during Remote Viewing Sessions: The Shadow Zone` dostarczony przez użytkownika.
- W AI Monitorze pozostawić również istniejącą nieedytowalną `LOCKED EXECUTION RULE` z limitem pięciu pogłębień.
- Zablokowane fragmenty pozostają widoczne w podglądzie efektywnego promptu, ale użytkownik nie może ich edytować, usunąć, zastąpić ani wyłączyć.
- Blokady egzekwować podczas składania promptu przez kontroler, a nie tylko przez wyłączenie pola w interfejsie. Efektywny prompt zawsze składa się z bloków kontrolera oraz edytowalnej części użytkownika.
- Każdy zablokowany blok ma własną wersję i hash; jego wersję oraz pełny efektywny prompt zapisać w snapshotcie i eksporcie sesji.

### Motywy kolorystyczne

- Dodać w Settings wybór motywu interfejsu.
- Dostępne warianty: lekko niebieski, obecny różowo-fioletowy, jasny/biały, ciemny/czarny oraz delikatny zielony.
- Przy pierwszym uruchomieniu domyślny ma być motyw lekko niebieski.
- Palety mają być łagodne, spójne i czytelne, bez agresywnych odcieni.
- Zapamiętywać wybór użytkownika pomiędzy uruchomieniami.

### Ikona aplikacji

- Zastąpić obecny niebieski symbol z falami znakiem graficznym dostarczonym przez użytkownika w pliku `29e82948-7c59-431a-931e-eaaaa45eac0c.jpg`.
- Użyć wyłącznie górnego symbolu: geometrycznej formy z liśćmi, literą „A” i małym obiektem przypominającym UFO. Całkowicie usunąć podpis „THE ROSEHIP PUBLICATIONS”, linię oraz pozostały wordmark.
- Nowe ustalenie zastępuje wcześniejszy pomysł okrągłej ikony z napisem biegnącym półkolem.
- Przygotować czystą wersję znaku na przezroczystym tle, najlepiej również jako odtworzony wektor/SVG, aby uniknąć białego prostokąta i utraty jakości.
- Ten sam symbol ma zastąpić falę w bocznym panelu oraz służyć jako baza ikon aplikacji. Tekst „AI RV Harness” i obecny opis mogą nadal pozostawać obok znaku w interfejsie, ale nie mogą być częścią samej ikony.
- Ze względu na dużą liczbę cienkich elementów przygotować pełny wariant dla większych rozmiarów oraz czytelnie uproszczony wariant dla ikon 16–32 px; uproszczenie nie może zmieniać rozpoznawalnego charakteru znaku.
- Przygotować wariant ciemny na jasne tło i jasny na ciemne tło albo inną równoważną wersję zapewniającą kontrast we wszystkich motywach.
- Wygenerować wszystkie formaty i rozmiary wymagane przez Windows/Tauri.
- Znak marki nie jest automatycznie objęty licencją MIT kodu ani CC BY 4.0 treści; jego status i zasady użycia należy wskazać osobno przed wydaniem.

### Special Task w zwykłych sesjach RV

- Udostępnić ten sam mechanizm Special Task także dla zwykłych sesji automatycznych, niezależnie od autonomicznego AI Monitora.
- W Full RCP zadanie specjalne przekazać bezpośrednio Viewerowi po Fazie 4.
- W RV Lite zadanie specjalne przekazać bezpośrednio Viewerowi po Kroku 3, przed opcjonalnym pogłębieniem Extended i Krokiem 4.
- Pozostawić dwa sposoby definiowania zadania: gotowe opcje oraz własne pole tekstowe; umożliwić użycie obu jednocześnie.
- Gotowe opcje mogą obejmować m.in. Main Subject, Subject A/B/C, Main Activity, Main Event, Structure A oraz Object A/B.
- W trybie Automatic + AI Monitor zachować ustalenie z Pakietu 2: zadanie specjalne otrzymuje Monitor po Fazie 4.
- Obecna blokada RV Lite + AI Monitor pozostaje, dopóki użytkownik osobno nie zdecyduje o jej usunięciu.
- Ostrzegać, że neutralne etykiety użyte w zadaniu (Subject A, Object B itd.) muszą zostać wyjaśnione w Target Reveal.
- Zadanie, moment jego wstrzyknięcia i odbiorcę (Viewer/Monitor) zapisać w snapshotcie i audycie sesji.

### Fabryczne zasoby w Settings

- Rozszerzyć istniejący ekran przechowujący Full RCP o bibliotekę fabrycznych, wersjonowanych zasobów.
- Udostępnić co najmniej:
  - Full RCP PL i EN;
  - RV Lite Core/Extended PL i EN;
  - domyślny AI Viewer System Prompt PL i EN;
  - domyślny AI Monitor System Prompt PL i EN.
- Fabryczne wersje są tylko do odczytu i muszą pozostać dostępne nawet po zmianie aktywnej kopii.
- Użytkownik może edytować aktywne prompty, porównać je z oryginałem oraz użyć funkcji Restore factory default.
- Przy pierwszym uruchomieniu Profile/Monitor otrzymują kopię odpowiedniego domyślnego promptu; późniejsze zmiany nie nadpisują fabrycznego zasobu.
- Każdy zasób przechowuje język, wersję, hash, datę i informację o licencji.
- Dokładne zatwierdzone prompty oraz źródłowy mieszany prompt Viewera zapisano w pliku PAKIET_3_DOMYSLNE_PROMPTY.md.

### Domyślny AI Viewer System Prompt

- Źródłowy prompt dostarczony przez użytkownika jest mieszany językowo.
- Przygotować dwie kompletne, znaczeniowo zgodne wersje: polską i angielską.
- Nie rozszerzać ani nie skracać treści podczas tłumaczenia bez osobnego zatwierdzenia.
- Wersje będą domyślnie wpisane przy pierwszym uruchomieniu, możliwe do edycji, a ich niezmienne kopie fabryczne pozostaną w Settings.

### Domyślny AI Monitor System Prompt

- Przyjąć zatwierdzoną polską wersję po edycjach użytkownika.
- Angielska wersja ma być tłumaczeniem 1:1 aktualnej polskiej wersji: identyczna struktura, znaczenie, kolejność i liczba przykładów; bez dodatkowych komend lub rozszerzeń.
- Do aktywnego promptu dołączać widoczną, ale nieedytowalną LOCKED EXECUTION RULE z limitem pięciu pogłębień po Fazach 2–6.
- Pełny tekst obu wersji zapisano w PAKIET_3_DOMYSLNE_PROMPTY.md.

### Podział licencji

- Kod źródłowy aplikacji, kod kontrolerów, adaptery providerów, migracje, testy i inne elementy programistyczne pozostają na licencji MIT.
- Autorskie zasoby treściowe dostarczane z aplikacją są licencjonowane na Creative Commons Attribution 4.0 International (CC BY 4.0), w szczególności:
  - Full RCP i wszystkie jego wersje językowe;
  - RV Lite Core/Extended i wszystkie wersje językowe;
  - fabryczny AI Viewer System Prompt PL/EN;
  - fabryczny AI Monitor System Prompt PL/EN;
  - autorskie biblioteki pytań, poleceń, instrukcji, rubric i podobne materiały metodologiczne;
  - wbudowane cele, ich opisy, reveale i inne autorskie materiały targetowe, o ile zostały stworzone dla projektu i można je legalnie objąć tą licencją.
- Dodać osobny plik licencji/notice dla treści, np. CONTENT_LICENSE_CC_BY_4.0.md, obok istniejącej licencji MIT dla kodu.
- README, Settings/About oraz ekran zasobów mają jasno pokazywać podział „Source code: MIT” oraz „Protocols, prompts and bundled original content: CC BY 4.0”.
- Metadane każdego fabrycznego zasobu powinny zawierać pole license=CC-BY-4.0 i wymagane przypisanie autorstwa.
- Przed wydaniem ustalić dokładną, jednolitą linię atrybucji, której użytkownicy mają używać zgodnie z CC BY 4.0; nie wymyślać jej bez potwierdzenia autora.
- Materiały osób trzecich zachowują swoje pierwotne licencje i nie mogą zostać automatycznie relicencjonowane jako CC BY 4.0.
- Importowane cele, obrazy, pliki i inne dane użytkownika pozostają treścią użytkownika i nie są automatycznie obejmowane licencją projektu.
- Wygenerowane sesje, prywatne transcripty i dane badawcze użytkownika również nie stają się automatycznie CC BY 4.0 tylko dlatego, że powstały w Harnessie.

## Pakiet 4 — Training Targets i moduł Training

### Źródło i stan pakietu targetów

- Źródłowy katalog znajduje się w Bibliotece pod ścieżką `/RV Harnes/cele`.
- Rozpoznane kategorie i aktualne liczby plików:
  - góry i struktury — 10;
  - struktury na górze — 10;
  - woda z innymi elementami — 10;
  - aktywność ludzka — 10;
  - katastrofy i zniszczenia — 10;
  - kosmos — 10;
  - różne — 24.
- Łącznie obecnie: 84 targety. Fabryczny zestaw jest kompletny; liczby zostały zweryfikowane 18.08.2026.
- Nie brakuje już żadnych targetów wymaganych przez fabryczny curriculum.
- Importer/build validation ma wymagać co najmniej 10 targetów w każdej z sześciu kategorii głównych oraz co najmniej 24 targetów w kategorii mieszanej. Wersjonowany fabryczny curriculum wykorzystuje z tego dokładnie 60 targetów specjalistycznych i 24 mieszane, czyli łącznie 84.
- Pliki źródłowe są niejednorodne (Markdown/TXT, różne długości i układy, stare kody, daty i nazwy); przed wbudowaniem wymagają normalizacji.

### Zastąpienie Starter Targets

- Na ekranie Targets usunąć sekcję dziesięciu Starter Targets.
- W jej miejscu dodać Training Targets.
- Sekcja Your Targets pozostaje bez zmian: dotychczasowe dodawanie własnych celów, opisów i obrazów ma nadal działać.
- Training Targets są fabrycznie dostarczone, podzielone na kategorie i używane przez moduł Training.
- Użytkownik może dodawać własne cele treningowe do kategorii, lecz takie cele nie stają się częścią stałego fabrycznego curriculum 84.

### Nazwy kategorii PL/EN

- `mountain_structure_contrast`: PL „Góry i struktury — kontrast”; EN „Mountains and Structures — Contrast”.
- `structures_in_mountain_terrain`: PL „Struktury w terenie górskim”; EN „Structures in Mountain Terrain”.
- `water_combined_elements`: PL „Woda i elementy towarzyszące”; EN „Water and Combined Elements”.
- `human_activity`: PL „Aktywność ludzka”; EN „Human Activity”.
- `disasters_destruction`: PL „Katastrofy i zniszczenia”; EN „Disasters and Destruction”.
- `space`: PL „Kosmos”; EN „Space”.
- `mixed_targets`: PL „Cele mieszane”; EN „Mixed Targets”.

### Normalizacja targetów

- Każdy target otrzymuje nowy stabilny identyfikator aplikacji niezależny od dawnych nazw plików i kodów RV.
- Nie pokazywać użytkownikowi starych etykiet typu `Target 0001` ani dawnych kodów typu `4738 9292`.
- Stary identyfikator można zachować wyłącznie jako niewidoczne pole provenance/sourceLegacyId.
- Ujednolicić strukturę: tytuł, krótki reveal, pełny opis, mapa/szkic, artefakty, kategoria, podtyp, język, źródło, licencja i kolejność curriculum.
- Angielska treść źródłowa pozostaje wersją EN; przygotować zgodną wersję PL dla każdego targetu.
- Target i reveal mają być pokazywane w języku sesji/interfejsu bez zmiany znaczenia.
- Fabryczne targety i ich autorskie materiały są CC BY 4.0 zgodnie z Pakietem 3; targety użytkownika nie są automatycznie relicencjonowane.
- Kategoria Góry i struktury wymaga jawnego podtypu `mountain` albo `structure` oraz kuratorskiej kolejności umożliwiającej naprzemienny trening.

### Nowa pozycja Training

- Dodać do głównej nawigacji osobny moduł Training/Trening.
- Na Home pokazywać ikonę z pełną nazwą; na wewnętrznych ekranach używać kompaktowej ikony z tooltipem zgodnie z Pakietem 1.
- Training korzysta z profilu, modelu Viewera, połączenia providera, ustawień generacji oraz Training Targets.
- Na początku udostępnić wyłącznie protokół RV Lite, w dwóch wariantach z Pakietu 3:
  - RV Lite Core;
  - RV Lite Extended.
- Full RCP nie jest na tym etapie trybem treningowym.

### Tryby treningu

- Udostępnić dwa jednoznaczne tryby: Full Training oraz Partial Training.

#### Full Training — stały fabryczny curriculum

- Full Training zawsze korzysta dokładnie z wersjonowanego zestawu 84 fabrycznych targetów.
- Skład: 60 targetów specjalistycznych (po 10 z każdej z sześciu kategorii głównych) oraz 24 unikalne targety mieszane.
- Targety dodane przez użytkownika nigdy nie są automatycznie dołączane do Full Training.
- Tryb nie losuje kolejności. Używa kuratorskiej, zapisanej kolejności curriculum.
- Schemat dla każdej kategorii głównej:
  1. pięć targetów kategorii;
  2. dwa kolejne, niepowtarzające się targety mieszane;
  3. pięć kolejnych targetów tej samej kategorii;
  4. dwa kolejne, niepowtarzające się targety mieszane;
  5. przejście do następnej kategorii.
- Kolejność kategorii: Góry i struktury — kontrast; Struktury w terenie górskim; Woda i elementy towarzyszące; Aktywność ludzka; Katastrofy i zniszczenia; Kosmos.
- Dla pierwszej kategorii obowiązuje ciąg: góra → struktura → góra → struktura → góra → struktura → góra → struktura → góra → struktura.
- Wszystkie 24 cele mieszane są używane dokładnie raz w jednym pełnym przebiegu.
- Curriculum otrzymuje stały identyfikator i wersję, np. `factory-training-curriculum:1.0.0`; snapshot przechowuje pełną listę 84 użytych targetów i ich wersje.

### Jawna informacja o stałych 84 targetach

- Karta Full Training musi stale pokazywać komunikat PL/EN, że jest to porównywalny, fabryczny program 84 targetów i że cele użytkownika są wykluczone.
- Przykładowa treść PL: „Full Training zawsze wykonuje stały, wersjonowany program 84 fabrycznych targetów: 60 specjalistycznych i 24 mieszane. Cele dodane przez użytkownika nie są dołączane. Użyj Partial Training, aby trenować na własnych celach.”
- Przykładowa treść EN: „Full Training always runs the fixed, versioned curriculum of 84 factory targets: 60 specialized and 24 mixed. User-added targets are not included. Use Partial Training to train with your own targets.”
- Ten sam fakt powtórzyć na ekranie preflight przed uruchomieniem wraz z dokładną liczbą sesji, wariantem protokołu, listą kategorii i przewidywanym kosztem.
- Start wymaga świadomego kliknięcia `Start 84-session training`; nie używać niejasnego przycisku tylko `Start`.

#### Partial Training

- Użytkownik wybiera jedną, kilka albo wszystkie kategorie.
- Dla każdej wybranej kategorii określa liczbę targetów.
- Partial Training może używać fabrycznych oraz dodanych przez użytkownika Training Targets.
- UI ma pozwalać zawęzić pulę do `Factory only`, `User-added only` albo `All available`.
- W jednym runie nie powtarzać targetu, dopóki wybrana pula nie zostanie wyczerpana.
- Przed startem pokazać wybrane kategorie, liczbę targetów i finalną liczbę sesji.

### Checkpoint, Pause i Resume

- „Przerwa” po sekwencji 5 + 2 jest logiczną granicą i punktem kontrolnym, a nie obowiązkowym ręcznym zatrzymaniem.
- Po każdym bloku siedmiu sesji Harness zapisuje kompletny checkpoint, aktualizuje podsumowanie bloku i domyślnie automatycznie przechodzi dalej.
- Użytkownik może w dowolnym momencie wybrać Pause; bezpieczne zatrzymanie następuje po zakończeniu bieżącej sesji i zapisie jej revealu/oceny.
- Resume wznawia dokładnie od następnego targetu, bez powtarzania ukończonych sesji.
- Awaria, zamknięcie aplikacji lub błąd providera nie mogą zniszczyć dotychczasowego przebiegu; run otrzymuje stan `Interrupted`/`Paused` i możliwość wznowienia.
- Dodać `Pause after each 5+2 block` jako opcję użytkownika, domyślnie wyłączoną; jej wyłączenie zachowuje pełną automatyzację.

### Preflight, koszt i zabezpieczenia

- Przed startem pokazać liczbę sesji, orientacyjną liczbę wywołań Viewera i Judge, szacowany koszt, wybrane modele, RV Lite Core/Extended, katalog zapisu i wersję curriculum.
- Zachować istniejący cost guard i limity providerów.
- Dla Full Training szczególnie wyraźnie ostrzec o długim czasie i koszcie 84 sesji oraz dodatkowych 84–252 wywołaniach Judge, zależnie od liczby sędziów.
- Jeżeli fabryczny pakiet nie przechodzi walidacji 84 targetów, Full Training pozostaje zablokowany z dokładnym raportem braków; Partial Training nadal może działać.

### AI Judge

- W Full i Partial Training AI Judge jest opcjonalny.
- Użytkownik wybiera od jednego do trzech modeli Judge zgodnie z istniejącym mechanizmem sesji/research.
- Zapisywać osobną ocenę każdego Judge dla każdego targetu.
- Tworzyć agregaty: per target, per kategoria, per blok 5+2, per Judge i dla całego runu.
- Gdy Judge jest wyłączony, nadal tworzyć pełne podsumowanie przebiegu bez ocen punktowych.

### Trwały zapis i dostępny folder

- Każdy trening zapisywać w bazie aplikacji oraz w zwykłym, dostępnym folderze plikowym.
- Domyślna lokalizacja Windows: `%USERPROFILE%/Documents/AI RV Harness/Training/`; użytkownik może wybrać inny katalog w Settings.
- Nie zapisywać treningów wyłącznie wewnątrz katalogu instalacyjnego ani tylko w SQLite.
- Dla runu tworzyć katalog w rodzaju `Training_001_YYYY-MM-DD/` zawierający co najmniej:
  - `manifest.json`;
  - `summary.md`;
  - `sessions/`;
  - `reveals/`;
  - `judges/`;
  - `category_results/`;
  - checkpoint/state potrzebny do Resume.
- W aplikacji pokazywać pełną ścieżkę oraz przycisk Open folder.
- Pliki mają być samodzielnie kopiowalne, przenoszalne i archiwizowalne bez utraty czytelności.

### Historia i podsumowanie runów

- Każdy run otrzymuje kolejny numer, nazwę, datę, status, profil, workspace, model, provider, ustawienia generacji, wariant protokołu, target list i wersję curriculum.
- Statusy co najmniej: Planned, Running, Paused, Interrupted, Completed.
- Podsumowanie pokazuje liczbę ukończonych/pozostałych sesji, kategorie, kolejność targetów, czas, koszt, błędy, ścieżkę zapisu oraz wyniki Judge.
- Dla ukończonego runu generować czytelne wyniki per kategoria i wynik całościowy.
- Historia treningów pozwala otworzyć szczegóły, wznowić niedokończony run, otworzyć folder albo wyeksportować podsumowanie.
