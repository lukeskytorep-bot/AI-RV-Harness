# RV Harness — wymagania do następnej wersji po 0.7.4

Status: zbieranie informacji. Nie wdrażać zmian, nie zmieniać numeru wersji i nie budować paczki do czasu wyraźnego polecenia użytkownika.

## Pakiet 1 — Home, nawigacja, rozmowy i ekran RV Session

### Home

- Zachować pełny lewy panel z ikonami i nazwami: Home, Profiles, Workspaces, Research Tests, Targets, Settings.
- Usunąć dolny prawy kafel powtarzający Home, Research Tests, Profiles i Settings.
- W jego miejscu dodać kafel Recent Sessions, analogiczny do Recent Workspaces, z możliwością szybkiego otwarcia ostatnio używanych/wykonywanych sesji.

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

### Motywy kolorystyczne

- Dodać w Settings wybór motywu interfejsu.
- Dostępne warianty: lekko niebieski, obecny różowo-fioletowy, jasny/biały, ciemny/czarny oraz delikatny zielony.
- Przy pierwszym uruchomieniu domyślny ma być motyw lekko niebieski.
- Palety mają być łagodne, spójne i czytelne, bez agresywnych odcieni.
- Zapamiętywać wybór użytkownika pomiędzy uruchomieniami.

### Ikona aplikacji

- Przygotować nowy okrągły wariant graficzny ikony aplikacji; techniczny plik ikony nadal może mieć kwadratowe płótno z przezroczystymi narożnikami.
- Preferowany układ: okrągły symbol pośrodku oraz napis „AI RV Harness” biegnący półkolem u góry.
- Jeżeli tekst po zmniejszeniu ikony będzie nieczytelny, przygotować czytelny wariant bez tekstu dla małych rozmiarów i pełny wariant dla dużego rozmiaru/ekranu startowego.
- Wygenerować wszystkie formaty i rozmiary wymagane przez Windows/Tauri; nie zmieniać charakteru istniejącego symbolu bez akceptacji.

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

