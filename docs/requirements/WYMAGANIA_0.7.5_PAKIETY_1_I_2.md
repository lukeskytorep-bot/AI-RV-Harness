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

