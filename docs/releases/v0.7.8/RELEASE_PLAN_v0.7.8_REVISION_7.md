# AI RV Harness — plan wydania 0.7.8

> Aktualna rewizja: **7** · uzupełniona 25.08.2026  
> Rozszerza rewizję 5 o GitHub Artifact Attestations, niezmienne wydania GitHub, przypięcie GitHub Actions do pełnych SHA, ochronę migracji i parserów dokumentów, testy kontraktowe providerów, uproszczenie Manual RV, widoczne limity tokenów w Manual RV i Conversation, naprawę Zadań specjalnych oraz pełną integrację Protokołu telepatycznego z RV Sessions i Manual RV.

Historia ostatnich rewizji:

- **Rewizja 5** — czytelność czcionek, dokumenty przy rozmowie i Manual, Built-in Library, cztery nowe dokumenty, Linux, Blackbox oraz pierwszy przegląd kodu.
- **Rewizja 6** — pochodzenie instalatorów przez GitHub Artifact Attestations i ochrona opublikowanego wydania przez Release Immutability.
- **Rewizja 7** — dodatkowe zabezpieczenia procesu budowania, aktualizacji, parserów dokumentów i integracji providerów, usunięcie mylącego formalnego statusu z Manual RV, widoczne sterowanie outputem i kontrola input/context w Manual RV oraz Conversation, naprawa przekazywania Zadań specjalnych, integracja Protokołu telepatycznego z automatyczną sesją, AI Monitorem i Manual RV, a także rozdzielenie elementów obowiązkowych, wartościowych i odłożonych.

Status dokumentu: otwarty — zbieranie uwag z testów wersji 0.7.7.

Planowana gałąź robocza: `release/0.7.8`.

Wersja 0.7.8 ma być kontrolowanym wydaniem poprawek po pierwszych testach publicznej wersji 0.7.7. Do czasu zakończenia testów dokument służy jako wspólna lista planowanych zmian. Samo umieszczenie punktu na liście nie oznacza jeszcze wdrożenia go do kodu.

Zasady przygotowania wydania:

- nie zmieniać części aplikacji, które działają prawidłowo;
- preferować małe i odseparowane poprawki;
- każdą zmianę sprawdzić osobno oraz w pełnym przebiegu aplikacji;
- nie publikować wydania bez przetestowania instalatora utworzonego jako Draft Release;
- kolejne uwagi z testów dopisywać do tego dokumentu przed rozpoczęciem prac.

## Zakres zatwierdzony dla 0.7.8

### 1. Ukrycie okna konsoli w Windows

Status: zatwierdzone — oczekuje na wdrożenie.

Informacja pochodzi z testu opublikowanej wersji Windows przez użytkownika. Po uruchomieniu aplikacji nie powinno pojawiać się dodatkowe czarne okno konsoli.

Plik do zmiany: `src-tauri/src/main.rs`

Na początku pliku dodać:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
```

Docelowa zawartość:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ai_rv_harness_lib::run();
}
```

Zakres wpływu:

- ukrywa okno konsoli wyłącznie w produkcyjnym wydaniu Windows;
- pozostawia konsolę w kompilacjach deweloperskich;
- nie zmienia działania Research, sesji, bazy danych ani providerów;
- nie wpływa na już opublikowane wydanie 0.7.7;
- wymaga zbudowania nowego instalatora Windows.

Test przed publikacją:

1. Zbudować aplikację w trybie release.
2. Zainstalować ją na Windows.
3. Uruchomić z menu Start oraz ze skrótu na pulpicie.
4. Potwierdzić, że otwiera się tylko główne okno AI RV Harness.

### 2. Ujednolicenie i zwiększenie czytelności tekstu

Status: zatwierdzone — pierwsza poprawka interfejsu dla 0.7.8, oczekuje na wdrożenie.

Problem został potwierdzony na zrzutach z rzeczywistego używania wersji 0.7.7. W kilku ważnych miejscach tekst ma obecnie około `6.8–10.5 px`, przez co jest praktycznie nieczytelny przy normalnym oglądaniu ekranu. Dotyczy to zarówno danych technicznych Research, jak i właściwej treści sesji oraz oceny AI Judge.

Zasada projektowa:

> Jeżeli informacja jest wystarczająco ważna, aby pokazywać ją użytkownikowi, musi dać się wygodnie przeczytać. Jeżeli nie jest potrzebna, należy ją ukryć, skrócić albo przenieść do rozwijanych szczegółów zamiast wyświetlać mikroskopijną czcionką.

Wzorzec czytelności: tekst pełnej sesji widoczny na ekranie Training w wersji 0.7.7. Treści o tej samej randze powinny korzystać z tego samego rozmiaru i interlinii niezależnie od modułu.

Zakres obowiązkowy:

1. **Research — Experiment Lock**
   - zwiększyć etykiety i wartości: model Viewera, reasoning effort i temperatura;
   - zwiększyć opis blokady oraz listę warunków;
   - pełny hash konfiguracji potraktować jako informację techniczną: pozostawić czytelny, umożliwić kopiowanie albo schować w rozwijanych szczegółach, jeżeli zajmuje zbyt dużo miejsca;
   - nie usuwać informacji potrzebnych do odtworzenia eksperymentu.

2. **Research — Results**
   - zwiększyć tekst tabel, identyfikatory Blind Session, Target ID, Condition, wyniki Judge i rozrzut ocen;
   - zwiększyć `Mean rubric components` oraz wartości G/F/A/C;
   - zwiększyć `Matched comparisons` i opis wins/ties/losses;
   - zachować możliwość przewijania szerokiej tabeli bez zmniejszania tekstu do nieczytelnego rozmiaru.

3. **Training — AI Judge evaluation**
   - wynik, model Judge'a, uzasadnienie, najmocniejsze trafienia i główne chybienia mają mieć rozmiar właściwej treści sesji;
   - nie używać mikroskopijnej czcionki do długiej oceny, którą użytkownik ma przeczytać;
   - hierarchię zachować przez nagłówki, wagę i kolor, a nie przez drastyczne zmniejszenie tekstu.

4. **Workspace — zapis sesji**
   - pełny transcript, Reveal, opinia Viewera, rozmowa po Revealu i AI Judge mają korzystać z tej samej czytelnej typografii co pełna sesja w Training;
   - usunąć obecną różnicę, w której ta sama sesja jest czytelna w Training, ale wyraźnie mniejsza po otwarciu z Workspace;
   - nazwy ról i metadane mogą pozostać wizualnie drugorzędne, ale nadal muszą być czytelne.

5. **Chat i rozmowy z AI**
   - wiadomości użytkownika i odpowiedzi AI mają mieć ten sam podstawowy rozmiar tekstu co treść sesji;
   - dotyczy to także rozmowy po Revealu i interwencji AI Monitor;
   - mały rozmiar można pozostawić wyłącznie dla krótkich metadanych, takich jak nazwa modelu lub czas, ale nie dla właściwej odpowiedzi.

6. **Spójność wybranego ustawienia czcionki**
   - wybrane przez użytkownika ustawienie czcionki ma być stosowane konsekwentnie we wszystkich modułach;
   - Training, Workspace, Chat, AI Monitor, AI Judge i Research nie mogą posiadać niezależnych, przypadkowych skal dla tej samej kategorii treści;
   - różnicować nagłówki, treść i metadane za pomocą małej, kontrolowanej skali typograficznej, a nie wielu lokalnych wartości `6–10 px`.

Planowana czytelna skala do potwierdzenia wizualnego:

- główna treść do czytania — co najmniej `14 px`, z interlinią około `1.55–1.65`;
- tekst wyników, tabel i kontrolek zawierających istotne dane — około `12–14 px`;
- drugorzędne metadane — co najmniej `11–12 px`;
- nagłówki sekcji — odpowiednio większe od treści;
- nie używać tekstu poniżej `11 px` w informacjach przeznaczonych do normalnego czytania.

Ostateczne wartości należy porównać ze wzorcem Training i ocenić na prawdziwym ekranie. Nie zwiększać mechanicznie całej aplikacji jednym mnożnikiem, ponieważ mogłoby to zepsuć układ; poprawić wspólne style kategorii treści i usunąć lokalne, zbyt małe wyjątki.

Test przed publikacją:

1. Porównać tę samą sesję otwartą z Training oraz Workspace — właściwa treść ma mieć ten sam rozmiar.
2. Odczytać pełną ocenę AI Judge bez powiększania ekranu.
3. Sprawdzić Experiment Lock i wyniki Research przy zwykłym powiększeniu aplikacji.
4. Sprawdzić tabele Research dla długich identyfikatorów oraz wielu Judge'ów.
5. Sprawdzić Chat, AI Monitor i rozmowę po Revealu.
6. Przetestować co najmniej rozdzielczości 1366×768 i 1920×1080 oraz skalowanie Windows 100% i 125%.
7. Potwierdzić, że większy tekst nie nachodzi na przyciski, nie jest ucinany i nie wymusza poziomego przewijania całej strony.

### 3. Widoczne załączniki dokumentów w Conversation i Manual

Status: zatwierdzone — oczekuje na wdrożenie.

Obecny stan w 0.7.7:

- obrazy można dodać bezpośrednio przy polu wiadomości;
- pliki `.txt` i `.md` są już technicznie obsługiwane jako `Workspace Sources`, ale przycisk ich dodawania jest schowany w rozwijanej sekcji nad rozmową i łatwo go przeoczyć;
- pliki `.pdf` i `.docx` nie są obecnie obsługiwane jako źródła tekstowe;
- ten sam problem dotyczy zwykłego trybu Conversation oraz ręcznego omawiania/przeglądania sesji w Workspace.

Cel:

Przy polu wpisywania wiadomości pozostawić jeden jednoznaczny przycisk ze spinaczem, pozwalający dołączyć zarówno dokument, jak i obraz. Użytkownik ma móc przesłać materiał, poprosić AI o jego analizę i dalej omawiać go w bieżącej rozmowie bez zastanawiania się, którego z dwóch przycisków powinien użyć.

Zakres obowiązkowy:

1. **Widoczny przycisk załącznika**
   - umieścić ikonę spinacza bezpośrednio przy polu wiadomości i przycisku wysyłania;
   - przycisk ma być dostępny w `Conversation` oraz `Manual` w Workspace;
   - usunąć osobny przycisk `Dodaj obraz`; jeden spinacz ma obsługiwać dokumenty i obrazy;
   - kliknięcie spinacza ma otwierać jeden systemowy wybór plików z obsługiwanymi typami `.txt`, `.md`, `.pdf`, `.docx`, `.png`, `.jpg`, `.jpeg`, `.webp` i `.gif`;
   - gdy wybrany model nie obsługuje vision, spinacz nadal ma działać dla dokumentów tekstowych, natomiast obraz powinien być niedostępny w wyborze albo odrzucony z jasnym komunikatem; brak vision nie może wyłączać całego przycisku załączników;
   - użytkownik powinien móc wskazać kilka obsługiwanych plików podczas jednej operacji;
   - dodać tooltip oraz dostępny opis, np. `Attach files / Załącz pliki`.

2. **Formaty pierwszego etapu**
   - zwykły tekst: `.txt`;
   - Markdown: `.md`;
   - dokument PDF: `.pdf`;
   - dokument Microsoft Word: `.docx`;
   - zachować dotychczasową obsługę obrazów `.png`, `.jpg`, `.jpeg`, `.webp` i `.gif`, zależną od możliwości vision wybranego modelu.

3. **Sposób przekazywania dokumentu AI**
   - aplikacja ma lokalnie odczytać i wyodrębnić tekst z `.txt`, `.md`, tekstowego `.pdf` oraz `.docx`;
   - do providera wysyłać wyodrębniony tekst jako kontrolowane źródło kontekstu, a nie nieznany plik binarny;
   - nie zakładać, że każdy provider potrafi natywnie czytać PDF albo DOCX;
   - zachować nazwę pliku, typ, hash treści i informację o sposobie importu;
   - wykorzystać istniejący system `Workspace Sources`, zamiast tworzyć drugi niezależny magazyn dokumentów.
   - traktować całą treść dokumentu jako niezaufane dane referencyjne, a nie jako polecenia dla AI;
   - przed treścią źródeł dodać stałą instrukcję systemową, że instrukcje znalezione wewnątrz dokumentów nie zmieniają System Promptu ani poleceń użytkownika;
   - każde źródło przekazywać w jednoznacznie odseparowanym bloku zawierającym identyfikator, nazwę, typ i hash; znaczniki muszą być odporne na próbę zamknięcia ich tekstem znajdującym się w dokumencie;
   - nie obiecywać pełnej ochrony przed prompt injection — jest to ograniczenie modeli, dlatego źródło i jego pochodzenie muszą być zawsze widoczne użytkownikowi.

4. **Zakres dokumentu w rozmowie**
   - nowo dołączony dokument ma zostać automatycznie aktywowany dla aktualnej rozmowy/threadu;
   - nie może automatycznie trafiać do innych rozmów w tym samym Workspace;
   - użytkownik ma móc później wyłączyć źródło, ponownie je włączyć albo usunąć;
   - dokument powinien pozostać dostępny po ponownym uruchomieniu aplikacji, dopóki użytkownik go nie usunie.

5. **Widoczny stan załącznika**
   - po wybraniu pliku pokazać czytelny chip z ikoną, nazwą, typem i możliwością usunięcia;
   - dokumenty i obrazy mają być widoczne razem w jednym rzędzie/listwie załączników, ale z odmiennymi ikonami typu;
   - poinformować, czy plik został poprawnie odczytany i ile w przybliżeniu wnosi tokenów;
   - przed wysłaniem użytkownik musi widzieć, które dokumenty będą częścią kontekstu;
   - zachować istniejący licznik i zabezpieczenie przed przekroczeniem kontekstu modelu.

6. **Błędy i ograniczenia**
   - odrzucać pliki uszkodzone, puste, chronione hasłem oraz nieobsługiwane;
   - jeżeli PDF zawiera wyłącznie skan/obrazy i nie ma warstwy tekstowej, wyświetlić jasny komunikat, że OCR nie jest jeszcze obsługiwany, zamiast przekazywać pusty dokument;
   - ustalić bezpieczny limit rozmiaru pliku oraz limit wyodrębnionego tekstu;
   - nie wykonywać makr, skryptów, aktywnej zawartości ani odnośników osadzonych w dokumentach;
   - przetwarzanie dokumentu ma odbywać się lokalnie, a do providera trafia tylko treść potrzebna jako kontekst.

7. **Spójność istniejącego interfejsu**
   - rozwijana sekcja `Workspace Sources` może pozostać jako miejsce zarządzania wszystkimi źródłami;
   - główną drogą dodania dokumentu podczas rozmowy ma jednak być widoczny spinacz przy composerze;
   - nazwy i komunikaty przygotować po polsku i angielsku;
   - kontrolki i opisy muszą spełniać nową zasadę czytelnej typografii z punktu 2.

Test przed publikacją:

1. Dodać osobno `.txt`, `.md`, tekstowy `.pdf` oraz `.docx` w Conversation.
2. Poprosić AI o streszczenie i sprawdzić, czy odpowiedź wykorzystuje właściwą treść dokumentu.
3. Powtórzyć test podczas ręcznego omawiania sesji w `Manual`.
4. Dodać kilka dokumentów, wyłączyć jeden z nich i potwierdzić, że nie jest wysyłany jako kontekst.
5. Zamknąć i ponownie uruchomić aplikację — dokumenty i przypisanie do rozmowy mają pozostać zachowane.
6. Sprawdzić PDF będący samym skanem, plik pusty, uszkodzony i przekraczający limit.
7. Sprawdzić długą nazwę pliku, usunięcie załącznika oraz przekroczenie limitu kontekstu.
8. Potwierdzić, że przy composerze znajduje się jeden spinacz, nie ma osobnego przycisku `Dodaj obraz`, a dokumenty i obrazy można wybrać z tego samego miejsca.
9. Wybrać model bez vision i potwierdzić, że nadal można dodać dokument, ale nie można omyłkowo wysłać obrazu.
10. Dodać dokument zawierający polecenie typu `ignore previous instructions` i potwierdzić, że aplikacja oznacza go jako niezaufane źródło, a model otrzymuje nadrzędną instrukcję traktowania treści wyłącznie jako danych.

### 4. Zapisywanie dokumentów z Built-in Library

Status: zatwierdzone — oczekuje na wdrożenie.

Obecny stan w 0.7.7:

- w `Settings → Built-in Library` użytkownik może zobaczyć listę wbudowanych dokumentów;
- dla dokumentu widoczne są informacje identyfikacyjne, w tym suma SHA;
- dokument można otworzyć i przeczytać w podglądzie;
- nie ma bezpośredniego sposobu zapisania oryginalnego dokumentu poza aplikacją.

Cel:

Dla każdego dokumentu znajdującego się w `Built-in Library` dodać możliwość zapisania jego oryginalnej kopii na dysku. Użytkownik ma móc niezależnie wybrać `Read / Czytaj`, aby otworzyć podgląd, albo `Save / Zapisz`, aby wykorzystać dokument poza aplikacją.

Zakres obowiązkowy:

1. **Przycisk zapisu dla każdego dokumentu**
   - obok istniejącej możliwości podglądu dodać widoczny przycisk `Save / Zapisz` z jednoznaczną ikoną pobierania lub dyskietki;
   - przycisk ma być dostępny przy każdym obecnym oraz przyszłym dokumencie Built-in Library;
   - nie ograniczać funkcji do przykładowego protokołu ani do konkretnego formatu pliku.

2. **Zapis oryginalnego pliku**
   - otwierać systemowe okno wyboru miejsca zapisu;
   - użyć oficjalnego wieloplatformowego pluginu `Tauri Dialog`, zamiast osobnych skryptów PowerShell, AppleScript lub zależności od programu `zenity`;
   - proponować oryginalną nazwę pliku i właściwe rozszerzenie;
   - zapisywać dokładne bajty wbudowanego dokumentu, bez ponownego formatowania, zmiany końców linii lub przepisywania treści;
   - zapisana kopia powinna mieć tę samą sumę SHA, która jest wyświetlana w Built-in Library.

3. **Czytelna informacja o wyniku**
   - po poprawnym zapisie pokazać krótki komunikat z nazwą pliku i wybraną lokalizacją;
   - anulowanie systemowego okna zapisu nie może być traktowane jako błąd;
   - błędy uprawnień, brak miejsca i inne niepowodzenia zapisu mają być pokazane użytkownikowi zrozumiałym komunikatem;
   - etykiety, tooltipy i komunikaty przygotować po polsku i angielsku.

4. **Spójność i bezpieczeństwo**
   - podgląd `Read / Czytaj` pozostaje bez zmian i nie może zostać zastąpiony pobieraniem;
   - zapis dokumentu nie może zmieniać wbudowanej kopii ani wpisu biblioteki;
   - rozwiązanie ma działać na Windows oraz w planowanym wydaniu Linux;
   - wszystkie obecne i cztery planowane nowe dokumenty mają korzystać z jednego wspólnego mechanizmu podglądu i zapisu.

Nowe dokumenty przekazane do Built-in Library:

1. **`AI Field Perception Lexicon.docx`**
   - język: angielski;
   - rodzaj: leksykon percepcyjny pola dla AI;
   - zweryfikowana zawartość: angielski opis użycia leksykonu oraz rozbudowane definicje wzorców pola, m.in. struktur, miasta, wieży i drogi;
   - dokument źródłowy: 31 stron.

2. **`Słownik Percepcyjny Pola dla AI.docx`**
   - język: polski;
   - rodzaj: polska wersja leksykonu percepcyjnego pola dla AI;
   - zweryfikowana zawartość: opis przeznaczenia słownika oraz rozbudowane definicje wzorców pola, m.in. struktur, miasta i wieży;
   - dokument źródłowy: 35 stron.

3. **`TELEPATHY MODULE – PROTOCOL FOR AI VIEWER v1.1.docx`**
   - język: angielski;
   - rodzaj: dodatkowy protokół telepatii dla AI Viewera;
   - zweryfikowana zawartość: zasady RAW, Shadow Zone oraz fazy modułu od T0 do T10;
   - dokument źródłowy: 18 stron.

4. **`MODUŁ TELEPATIA – PROTOKÓŁ DLA AI VIEWERA 1.1 .docx`**
   - język: polski;
   - rodzaj: polska wersja dodatkowego protokołu telepatii dla AI Viewera;
   - zweryfikowana zawartość: zasady RAW, Shadow Zone oraz fazy modułu od T0 do T10;
   - dokument źródłowy: 15 stron;
   - przy integracji zachować dokładną nazwę źródłowego pliku, łącznie z odstępem przed rozszerzeniem `.docx`, chyba że właściciel projektu świadomie zatwierdzi zmianę nazwy.

Zasady dodania tych dokumentów:

- traktować je jako cztery odrębne, wbudowane pliki, a nie jako tekst przepisany do kodu;
- dla każdej pozycji przygotować tytuł, język i krótki opis widoczny na karcie biblioteki;
- każda pozycja ma udostępniać `Read / Czytaj` oraz `Save / Zapisz`;
- SHA wyświetlane w aplikacji ma być obliczane z dokładnych bajtów pliku dołączonego do wydania;
- zapis przez użytkownika ma odtworzyć te same bajty i tę samą wartość SHA;
- nie tłumaczyć, nie poprawiać i nie ujednolicać treści dokumentów podczas ich pakowania do aplikacji.

Test przed publikacją:

1. Otworzyć każdy dokument przez `Read / Czytaj` i potwierdzić poprawność podglądu.
2. Zapisać każdy dokument przez `Save / Zapisz` do wybranego katalogu.
3. Potwierdzić zachowanie oryginalnej nazwy oraz rozszerzenia.
4. Porównać SHA zapisanej kopii z wartością widoczną w Built-in Library.
5. Sprawdzić anulowanie okna zapisu oraz próbę zapisu do miejsca bez uprawnień.
6. Powtórzyć test dla czterech nowych dokumentów po dodaniu ich do biblioteki.

### 5. GitHub Artifact Attestations i niezmienne wydanie 0.7.8

Status: zatwierdzone — obowiązkowe dla publikacji 0.7.8.

Cel:

- kryptograficznie powiązać instalatory z repozytorium, konkretnym commitem oraz workflow, który je zbudował;
- umożliwić użytkownikowi wykrycie pliku podmienionego po kompilacji;
- uniemożliwić zmianę tagu i podmianę albo usunięcie plików po opublikowaniu wydania;
- nie zmieniać kodu ani sposobu działania samej aplikacji.

GitHub Artifact Attestations są dostępne dla repozytoriów publicznych na obecnych planach GitHub. Attestation potwierdza pochodzenie artefaktu, ale nie dowodzi, że kod jest wolny od błędów i nie zastępuje podpisu Authenticode. Dokumentacja: <https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations>.

Zakres obowiązkowy:

1. **Attestation instalatorów Windows**
   - nadać krokowi `tauri-apps/tauri-action` identyfikator, np. `id: tauri_build`;
   - po prawidłowym zbudowaniu instalatorów uruchomić `actions/attest` w trybie SLSA build provenance;
   - objąć attestation oba instalatory tworzone dla Windows: `.exe` i `.msi`;
   - nie ustawiać `continue-on-error`: błąd attestation ma zakończyć workflow niepowodzeniem;
   - ponieważ Release pozostaje Draftem, niepowodzenie może pozostawić nieopublikowany Draft Release, ale nie wolno go wtedy publikować.

2. **Wymagane uprawnienia workflow**
   - zachować `contents: write`, ponieważ Tauri Action tworzy Draft Release i wysyła pliki;
   - dodać `id-token: write`;
   - dodać `attestations: write`;
   - dodać `artifact-metadata: write`, wymagane przez bieżące `actions/attest@v4` do utworzenia rekordu artefaktu;
   - nie przyznawać szerszych uprawnień niż potrzebne.

3. **Poprawne użycie listy `artifactPaths` z Tauri Action**

   `artifactPaths` jest listą JSON, a nie pojedynczą ścieżką. Nie należy przekazywać surowego tekstu wyjścia jako jednej nazwy pliku. Dla wszystkich artefaktów zwróconych przez Tauri Action poprawny wzorzec jest następujący:

   ```yaml
   - name: Build and create draft Windows release
     id: tauri_build
     uses: tauri-apps/tauri-action@<FULL_COMMIT_SHA> # właściwa zatwierdzona wersja
     env:
       GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
     with:
       tagName: app-v__VERSION__
       releaseName: 'AI RV Harness v__VERSION__'
       releaseDraft: true
       prerelease: false

   - name: Attest Windows installers
     uses: actions/attest@<FULL_COMMIT_SHA> # v4
     with:
       subject-path: ${{ join(fromJSON(steps.tauri_build.outputs.artifactPaths), fromJSON('"\n"')) }}
   ```

   `fromJSON(...)` zamienia wyjście Tauri Action w rzeczywistą listę, a `join(..., newline)` przekazuje `actions/attest` listę ścieżek rozdzielonych nowymi liniami. `actions/attest` obsługuje taką listę i tworzy jedną attestation zawierającą wiele artefaktów. Jeżeli Tauri Action zacznie zwracać dodatkowe pliki nieprzeznaczone do attestation, przed tym krokiem należy jawnie odfiltrować `.exe` i `.msi` oraz przerwać workflow, gdy lista instalatorów jest pusta.

4. **Przypięcie wersji akcji**
   - zapis `actions/attest@v4` opisuje wybraną główną wersję, ale w finalnym workflow musi zostać zastąpiony pełnym, czterdziestoznakowym SHA zatwierdzonego commita;
   - tak samo przypiąć `tauri-apps/tauri-action` oraz pozostałe GitHub Actions zgodnie z punktem A5;
   - obok SHA pozostawić komentarz z czytelną wersją, np. `# v4.x.x`, aby Dependabot mógł aktualizować odwołanie i komentarz.

5. **Instrukcja weryfikacji dla użytkownika**
   - do opisu Release albo dokumentacji dodać przykład:

     ```bash
     gh attestation verify "AI-RV-Harness-installer.exe" --repo lukeskytorep-bot/AI-RV-Harness
     ```

   - analogicznie można zweryfikować plik `.msi`;
   - w instrukcji wyraźnie podać, że wymagany jest GitHub CLI oraz dostęp do Internetu, chyba że użytkownik wcześniej pobierze bundle do weryfikacji offline.

6. **Release Immutability**
   - przed publikacją 0.7.8 wejść w ustawienia repozytorium, sekcję `Releases`, i włączyć `Enable release immutability`;
   - ustawienie działa tylko dla przyszłych wydań, dlatego musi zostać włączone przed opublikowaniem 0.7.8;
   - utrzymać obecny bezpieczny przebieg: utworzyć Draft, dołączyć wszystkie instalatory, zakończyć testy, a dopiero potem opublikować;
   - po publikacji pliki Release nie mogą być dodawane, zmieniane ani usuwane, a tag nie może zostać przesunięty;
   - GitHub automatycznie tworzy dodatkową attestation całego niezmiennego wydania. Dokumentacja: <https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases>.

7. **Dwie uzupełniające metody weryfikacji**
   - build provenance konkretnego instalatora: `gh attestation verify FILE --repo OWNER/REPO`;
   - integralność niezmiennego wydania i jego assetów: `gh release verify TAG` oraz `gh release verify-asset TAG FILE`;
   - obie metody są wartościowe: pierwsza wiąże plik z workflow budującym, druga z opublikowanym, niezmiennym Release.

Test przed publikacją:

1. Uruchomić workflow dla commita przeznaczonego do wydania.
2. Potwierdzić, że Tauri Action zwrócił ścieżki `.exe` i `.msi` oraz że attestation objęła oba pliki.
3. Celowo wykonać test z błędną albo pustą ścieżką i potwierdzić, że workflow kończy się błędem, a Release nie jest publikowany.
4. Pobrać instalatory z Draft Release i zweryfikować je poleceniem `gh attestation verify`.
5. Przetestować oba instalatory na Windows.
6. Potwierdzić włączenie Release Immutability i dopiero wtedy opublikować Draft.
7. Po publikacji wykonać `gh release verify app-v0.7.8` oraz `gh release verify-asset` dla obu instalatorów.
8. Potwierdzić, że GitHub oznacza wydanie jako `Immutable`.

Na tym etapie nie tworzyć SBOM. Dla 0.7.8 wystarczy attestation pochodzenia instalatorów i automatyczna attestation niezmiennego wydania. SBOM pozostaje elementem późniejszym po uporządkowaniu procesu aktualizowania zależności.

### 6. Uproszczenie Manual RV oraz widoczne limity outputu i input/context

Status: zatwierdzone — oczekuje na wdrożenie.

#### 6.1. Usunięcie formalnego statusu Manual RV

Obecne przyciski `Rozpocznij stan BLIND`, `Oznacz REVEALED` i `Zakończ stan formalny` należy usunąć z Manual RV Session.

Powód:

- przyciski zapisują jedynie pomocniczą etykietę `BLIND` albo `REVEALED` przy wątku;
- nie zmieniają System Promptu ani danych wysyłanych do AI;
- nie ukrywają i nie ujawniają automatycznie celu;
- nie rozdzielają ani nie pieczętują części pre-reveal i post-reveal;
- nie chronią przed ręcznym wpisaniem Revealu podczas stanu `BLIND`;
- jedynym dodatkowym skutkiem stanu `BLIND` jest blokada archiwizacji rozmowy;
- ich nazwy sugerują pełne zabezpieczenie formalnej sesji, którego Manual RV obecnie nie wykonuje.

Zakres usunięcia:

1. Usunąć z interfejsu pasek `Stan formalnego Manual RV` oraz wszystkie trzy przyciski.
2. Usunąć blokadę archiwizacji wątku i grupy wątków zależną od `formalRvState === BLIND`.
3. Usunąć nieużywane tłumaczenia, style, funkcję przełączania statusu i testy dotyczące tej kontrolki.
4. Nie wykonywać ryzykownej migracji kasującej kolumnę z bazy tylko dla porządku. Istniejące wartości mogą pozostać jako nieużywane dane zgodności albo zostać bezpiecznie usunięte dopiero podczas przyszłej migracji schematu.
5. Manual RV ma pozostać prostą rozmową z Viewer System Promptem, opcjonalnie dołączonym protokołem, historią bieżącego wątku, wiadomościami użytkownika i świadomie wybranymi załącznikami.
6. Pełne pieczętowanie pre-reveal, osobny Reveal i post-reveal pozostają funkcją właściwej automatycznej/zarządzanej RV Session, a nie tych ręcznych etykiet.

Test:

1. Potwierdzić brak paska i przycisków formalnego statusu w Manual RV.
2. Potwierdzić, że rozmowę Manual RV można normalnie archiwizować.
3. Potwierdzić, że usunięcie kontrolki nie zmienia Viewer System Promptu, dołączania protokołu, historii ani wysyłania wiadomości.
4. Otworzyć starszy wątek zapisany ze stanem `BLIND` lub `REVEALED` i potwierdzić, że nie blokuje interfejsu ani archiwizacji.

#### 6.2. Limity outputu oraz wykorzystanie input/context

Obecny stan w 0.7.7:

- automatyczna RV Session pokazuje pole `Maksymalna liczba tokenów outputu`;
- Manual RV Session i zwykła Conversation nie pokazują tego pola;
- mimo braku kontrolki oba tryby narzucają obecnie sztywny limit jednej odpowiedzi równy `min(limit outputu modelu, 4096)`;
- wartość `Default maximum output tokens` z ustawień aplikacji nie jest używana przez Manual RV ani Conversation, ponieważ silnik rozmowy nadpisuje ją limitem `4096`;
- input nie ma osobnego limitu ustawianego przez użytkownika;
- rzeczywistym ograniczeniem inputu jest okno kontekstowe wybranego modelu pomniejszone o miejsce zarezerwowane na output;
- jeżeli provider nie przekazał `contextTokens`, aplikacja nie potrafi wykonać własnej twardej kontroli i zbyt długie żądanie może zostać odrzucone dopiero przez providera;
- aplikacja przesyła pełną historię bieżącego wątku i nie skraca jej automatycznie.

Zasada techniczna:

```text
maksymalny dostępny input ≈ context window modelu − zarezerwowany max output
```

Do inputu zalicza się wszystko, co rzeczywiście trafia do modelu:

- System Prompt odpowiedni dla trybu;
- jawnie dołączony protokół w Manual RV;
- cała historia danego wątku;
- aktywne Workspace Sources;
- bieżąca wiadomość użytkownika;
- narzut struktury wiadomości i parametrów providera;
- obrazy, jeżeli model oraz trasa obsługują vision.

Zakres obowiązkowy:

1. **Pole maksymalnego outputu w obu trybach**
   - dodać widoczne pole `Maximum output tokens / Maksymalna liczba tokenów outputu` w Manual RV i Conversation;
   - pole określa maksymalną długość pojedynczej odpowiedzi AI, a nie łączną długość całej rozmowy;
   - domyślna wartość ma wynosić `min(Default maximum output tokens, limit outputu wybranego modelu)`;
   - usunąć obecny ukryty, sztywny limit `4096` z silnika rozmowy;
   - zmiana modelu ma automatycznie obniżyć wartość, jeżeli nowy model ma mniejszy limit, ale nie może bez ostrzeżenia podnieść wcześniej świadomie wybranej niższej wartości;
   - wartość musi być dodatnią liczbą całkowitą i nie może przekraczać limitu reklamowanego przez model;
   - wybrana wartość powinna pozostać przypisana do bieżącej Conversation/Manual RV albo zostać jednoznacznie przywrócona z ustawienia domyślnego po utworzeniu nowego wątku.

2. **Widoczny wskaźnik input/context**
   - nie dodawać sztucznego, niezależnego limitu inputu niższego niż okno modelu;
   - przy polu wiadomości stale pokazywać prosty, zrozumiały wskaźnik procentowy, np. `Pamięć rozmowy: 14%`, zamiast technicznego zapisu będącego jedyną informacją dla użytkownika;
   - kolor wskaźnika powinien sygnalizować stan: zielony przy bezpiecznym wykorzystaniu, żółty od około `75%` i czerwony od około `90%`;
   - po kliknięciu albo najechaniu na wskaźnik pokazać rozwinięte szczegóły: `Szacowany input`, limit kontekstu modelu, zarezerwowany output i szacowane pozostałe miejsce;
   - przykładowe szczegóły: `Wykorzystano około 18 400 z 131 072 tokenów`, `Pozostało około 112 672 tokenów` oraz osobno `Zarezerwowany output: 8 192 tokeny`;
   - w szczegółach wyjaśnić prostym językiem: `AI wykorzystało około 14% miejsca dostępnego na rozmowę. Wliczane są wiadomości, instrukcje systemowe, protokół i załączniki. Po zbliżeniu się do 100% rozpocznij nową rozmowę albo usuń niepotrzebne załączniki.`;
   - liczby muszą być oznaczone jako przybliżone, a procent powinien być liczony z uwzględnieniem inputu i miejsca zarezerwowanego na następną odpowiedź, tak aby `100%` oznaczało brak bezpiecznego miejsca na wysłanie kolejnego żądania;
   - wskaźnik ma być stale widoczny przy polu wiadomości albo parametrach rozmowy, a nie ukryty wyłącznie w rozwijanej sekcji Workspace Sources;
   - ustawienie `Maksymalna długość odpowiedzi` pozostaje osobną kontrolką i nie może być mylone z procentowym wykorzystaniem pamięci rozmowy;
   - gdy provider nie podał limitu kontekstu, wyświetlić `Context limit unavailable / Limit kontekstu niedostępny`, zamiast sugerować pełną ochronę.

3. **Jedno wspólne obliczenie dla interfejsu i silnika**
   - licznik w interfejsie i kontrola tuż przed wywołaniem API muszą korzystać z tej samej funkcji oraz tego samego kompletnego payloadu;
   - uwzględnić System Prompt Conversation albo Viewer System Prompt, dołączony protokół Manual RV, historię, źródła i bieżącą wiadomość;
   - uwzględnić konserwatywny koszt obrazów zamiast liczyć wyłącznie ich tekstowe etykiety;
   - oznaczyć wynik jako przybliżony, ponieważ różni providerzy i modele używają różnych tokenizerów;
   - pozostawić margines bezpieczeństwa, aby niewielki błąd estymacji nie powodował odrzucenia żądania przez providera.

4. **Zachowanie po zbliżeniu się do limitu**
   - nie usuwać ani nie skracać historii po cichu;
   - przed przekroczeniem pokazać ostrzeżenie z informacją, co zajmuje kontekst;
   - po przekroczeniu zablokować wysłanie i pozwolić użytkownikowi rozpocząć nowy wątek, wyłączyć źródła, usunąć obrazy albo obniżyć rezerwę outputu;
   - ewentualne przyszłe streszczanie lub kompresowanie historii musi być osobną, jawną funkcją, ponieważ w Manual RV mogłoby zmienić zapieczętowany transcript i dane sesji.

5. **Spójność trybów**
   - automatyczna RV Session, Manual RV Session, Conversation, rozmowa po Revealu i Research powinny używać tej samej definicji `max output tokens`;
   - każdy ekran ma jasno mówić, czy limit dotyczy pojedynczej odpowiedzi, kroku protokołu, czy całego przebiegu;
   - automatyczna RV Session nadal stosuje wybrany limit osobno do każdej odpowiedzi/fazy, a nie jako wspólny budżet wszystkich faz.

Test przed publikacją:

1. Wybrać model z limitem outputu większym niż `4096` i potwierdzić, że Manual RV oraz Conversation mogą świadomie użyć większej wartości.
2. Wybrać wartość niższą, zmienić model i potwierdzić, że aplikacja nie podnosi jej bez potrzeby.
3. Sprawdzić payload providera dla OpenAI-compatible, Google i Anthropic i potwierdzić właściwy parametr outputu.
4. Zbudować długi wątek Manual RV zawierający System Prompt, protokół i źródła; licznik ma odpowiadać kontroli wykonywanej przed wysłaniem.
5. Powtórzyć test dla Conversation oraz wiadomości z obrazami.
6. Przekroczyć limit kontekstu i potwierdzić, że aplikacja niczego nie usuwa po cichu oraz nie wywołuje providera.
7. Użyć modelu bez reklamowanego `contextTokens` i potwierdzić uczciwy komunikat o braku znanego limitu.
8. Potwierdzić, że obniżenie rezerwy outputu zwiększa dostępne miejsce inputu i że interfejs pokazuje tę zależność.
9. Potwierdzić, że podstawowy wskaźnik pokazuje czytelny procent, zmienia kolor przy ustalonych progach, a po kliknięciu lub najechaniu wyświetla liczby, skład kontekstu i prostą podpowiedź działania.

## Kandydaci do wydania 0.7.8

Poniższe elementy pozostają w planie, ale ich wejście do 0.7.8 zależy od wyników sprawdzenia technicznego. Nie należy wdrażać ich kosztem stabilności działającej wersji Windows.

### 7. Oficjalne wydanie Linux

Status: planowane; Windows pozostaje główną platformą.

Zakres:

- dodać osobny job Linux do GitHub Actions;
- instalować wymagane zależności systemowe Tauri/WebKitGTK na runnerze Ubuntu;
- budować i publikować pakiety Linux, przynajmniej AppImage oraz `.deb`;
- nie zmieniać logiki aplikacji wspólnej z działającym wydaniem Windows, jeżeli nie wymaga tego zgodność systemowa;
- sprawdzić systemowy magazyn poświadczeń używany przez `keyring` na Linux;
- zweryfikować wybór katalogów, zapis/eksport plików, SQLite, pobieranie targetów i połączenia z providerami;
- usunąć zależność okien wyboru katalogu od obecności programu `zenity`; użyć natywnych dialogów zapewnianych przez oficjalny plugin Tauri;
- oznaczyć pierwsze wydanie Linux jako wymagające testów terenowych, dopóki nie zostanie sprawdzone na prawdziwym systemie.

Test przed publikacją:

1. Instalacja i uruchomienie AppImage oraz pakietu `.deb` na obsługiwanej wersji Ubuntu.
2. Dodanie providera i bezpieczne zapisanie klucza API.
3. Chat, pojedyncza sesja RV oraz Research z co najmniej dwiema sesjami.
4. Zamknięcie i ponowne uruchomienie aplikacji — kontrola trwałości bazy i ustawień.
5. Eksport wyników do wybranego katalogu.

### 8. Obsługa Blackbox

Status: kandydat do 0.7.8 — wymaga potwierdzenia, że istnieje odpowiednie i udokumentowane API.

Zasada testowania providerów:

- OpenRouter jest obecnie jedynym providerem przetestowanym bezpośrednio przez właściciela projektu na jego własnym koncie;
- pozostali istniejący providerzy zostali zaimplementowani na podstawie ich oficjalnych specyfikacji API, ale nie przeszli jeszcze takich samych testów terenowych;
- Blackbox może zostać potraktowany w ten sam sposób, jeśli jego aktualna dokumentacja pozwala jednoznacznie i bezpiecznie przygotować integrację;
- brak osobistego konta Blackbox nie wyklucza implementacji, ale nie wolno przedstawiać jej jako osobiście zweryfikowanej;
- jeśli dokumentacja jest niepełna albo dostępny jest jedynie Blackbox CLI bez odpowiedniego API dla aplikacji, integrację należy odłożyć.

Przed wdrożeniem potwierdzić:

- czy Blackbox udostępnia publiczny endpoint API zgodny z OpenAI albo własną udokumentowaną specyfikację;
- czy integracja dotyczy rzeczywistego API, a nie wyłącznie lokalnego programu Blackbox CLI;
- sposób uwierzytelniania oraz bezpiecznego przechowywania klucza;
- listę i identyfikatory modeli;
- format rozmowy, streaming, błędy i limity;
- obsługiwany poziom reasoning effort.

Jeżeli API jest zgodne z OpenAI, najpierw przygotować obsługę przez istniejącą opcję `Custom OpenAI-compatible`. Dedykowany preset `Blackbox` dodać tylko wtedy, gdy wnosi poprawne wartości domyślne i upraszcza konfigurację.

Do czasu otrzymania testu od użytkownika Blackbox dokumentacja i interfejs aplikacji powinny uczciwie określać tę integrację jako niezweryfikowaną w testach terenowych. Zewnętrzny tester korzysta wyłącznie z własnego konta i własnego klucza API; nie przekazuje klucza właścicielowi projektu.

## Wyniki przeglądu kodu i dokumentacji technicznej — 24.08.2026

Status: analiza wykonana; poniższe punkty są propozycjami do decyzji, a nie automatycznie zatwierdzonym zakresem 0.7.8.

Sprawdzenie lokalne bieżącego źródła 0.7.7:

- TypeScript przechodzi bez błędów;
- komplet 144 testów Vitest w 59 plikach przechodzi;
- produkcyjny build Vite kończy się poprawnie;
- build zgłasza ostrzeżenie o głównym pliku JavaScript wielkości około `1.37 MB` przed gzip (`392 KB` po gzip);
- testów Rust i Clippy nie dało się uruchomić w bieżącym środowisku, ponieważ nie ma w nim programu `cargo`; pozostają obowiązkowe w GitHub Actions i przed wydaniem;
- w repozytorium znaleziono 15 roboczych plików `*.openai-download-*`; 12 jest pustych, a 3 powielają istniejące targety. Obecny glob Vite ich nie dołącza, ale należy je usunąć i ignorować w Git, aby nie weszły przypadkowo do przyszłych paczek.

### Priorytet A — zalecane przed Draft Release 0.7.8

#### A1. Powtarzalny build Rust i brak automatycznych commitów z workflow wydania

Zaobserwowany stan:

- `src-tauri/Cargo.lock` nie znajduje się w bieżącym źródle;
- CI i workflow wydania najpierw generują lockfile;
- workflow Windows może następnie samodzielnie commitować i wysyłać wygenerowany plik bezpośrednio do `main`;
- oznacza to, że zestaw zależności może zostać ustalony dopiero w dniu wydania, zamiast być elementem wcześniej sprawdzonego źródła.

Proponowana poprawka:

1. Wygenerować `src-tauri/Cargo.lock` świadomie na gałęzi roboczej, sprawdzić go i zapisać w repozytorium.
2. Usunąć z workflow wydania krok, który tworzy commit i wykonuje `git push` do `main`.
3. CI i release mają używać istniejącego lockfile przez `cargo test --locked`, `cargo clippy --locked` oraz build `--locked`.
4. Aktualizacje zależności wykonywać w oddzielnym, kontrolowanym commicie albo Pull Requeście.

Uzasadnienie: oficjalny Cargo Book zaleca zapisanie `Cargo.lock` w kontroli wersji, gdy zależy nam na identycznych i powtarzalnych buildach: <https://doc.rust-lang.org/cargo/guide/cargo-toml-vs-cargo-lock.html>.

#### A2. Bezpieczne traktowanie załączonych dokumentów

Obecny `Workspace Source` jest wstawiany do rozmowy jako zwykła wiadomość `user` z pełną treścią. Po dodaniu PDF i DOCX dokument może zawierać jawne albo ukryte instrukcje próbujące zmienić zachowanie modelu.

Poprawka ma zostać wykonana razem z punktem 3 niniejszego planu:

- treść dokumentu oznaczać jako niezaufane dane;
- utrzymywać nadrzędną instrukcję systemową oddzielającą polecenia od źródeł;
- dodawać metadane i odporne ograniczniki źródła;
- nie pozwalać dokumentowi wybierać narzędzi, zmieniać trybu sesji ani nadpisywać System Promptu;
- dodać testy z bezpośrednim i pośrednim prompt injection w `.md`, `.pdf` i `.docx`.

OWASP klasyfikuje instrukcje pochodzące z zewnętrznych plików jako indirect prompt injection i zaznacza, że samo RAG lub dostrojenie modelu nie usuwa tego ryzyka: <https://genai.owasp.org/llmrisk/llm01-prompt-injection/>.

#### A3. Natywne dialogi plików na Windows i Linux

Obecny kod uruchamia PowerShell w Windows, AppleScript w macOS i `zenity` w Linux. Dla Linux oznacza to nieudokumentowaną zależność od programu, którego może nie być w systemie użytkownika.

Proponowana poprawka:

- wdrożyć oficjalny `Tauri Dialog plugin` wspólnie dla wyboru katalogów, dodawania dokumentów i `Save / Zapisz` w Built-in Library;
- w capability przyznać wyłącznie potrzebne operacje `open`, `save` i ewentualnie `message`;
- usunąć własne wywołania skryptów systemowych po potwierdzeniu pełnej zgodności.

Oficjalny plugin obsługuje otwieranie i zapisywanie plików na Windows, Linux oraz macOS: <https://v2.tauri.app/plugin/dialog/>.

#### A4. Walidacja bazy przed przywróceniem backupu

Backupy mają już poprawnie liczone SHA-256 i kontrolę ścieżek, co jest mocną stroną kodu. SHA potwierdza jednak zgodność pliku z manifestem, ale nie potwierdza, że SQLite jest logicznie poprawny ani że posiada oczekiwany schemat.

Przed zastąpieniem aktywnej bazy proponuje się:

1. Otworzyć kopię w trybie tylko do odczytu.
2. Wykonać `PRAGMA quick_check` albo pełne `PRAGMA integrity_check`.
3. Wykonać `PRAGMA foreign_key_check`.
4. Sprawdzić wersję migracji i obecność oczekiwanych tabel, bez uruchamiania SQL pochodzącego z importowanego pliku.
5. Dopiero po pozytywnym wyniku wykonać istniejący bezpieczny swap pliku; zachować obecną kopię `pre_restore`.

SQLite opisuje `integrity_check` jako kontrolę formatowania i spójności bazy, a błędy kluczy obcych wymaga sprawdzać osobno przez `foreign_key_check`: <https://sqlite.org/pragma.html>.

#### A5. Przypięcie wszystkich GitHub Actions do pełnych SHA

Status: obowiązkowe przed Draft Release 0.7.8.

Obecne workflow używają ruchomych odwołań, między innymi `actions/checkout@v7`, `actions/setup-node@v6`, `dtolnay/rust-toolchain@stable`, `swatinem/rust-cache@v2` i `tauri-apps/tauri-action@v1`. Ruchomy tag albo nazwa gałęzi może w przyszłości wskazywać inny commit niż podczas przeglądu workflow.

Proponowana poprawka:

1. Każde zewnętrzne `uses: owner/repository@...` w `.github/workflows` zastąpić pełnym, czterdziestoznakowym SHA świadomie wybranego commita.
2. Na tej samej linii pozostawić komentarz z wersją, np. `# v6.0.0`, aby człowiek nadal widział wybraną wersję.
3. Tą samą zasadą objąć nowe `actions/attest` i ewentualne akcje CodeQL.
4. Nie kopiować SHA z przypadkowego przykładu; przed zapisaniem sprawdzić, czy commit należy do oficjalnego repozytorium akcji i odpowiada zatwierdzonemu tagowi.
5. Dodać Dependabot dla `github-actions`, aby aktualizacje SHA przychodziły jako osobne Pull Requesty możliwe do przejrzenia.

GitHub uznaje pełny commit SHA za jedyny niezmienny sposób wskazania wersji akcji. Dependabot potrafi aktualizować akcje przypięte do SHA i zachować komentarz wersji, gdy znajduje się on na tej samej linii. Dokumentacja: <https://docs.github.com/en/actions/reference/security/secure-use> oraz <https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/auto-update-actions>.

Test przed publikacją:

1. Wyszukać wszystkie wystąpienia `uses:` w repozytorium i potwierdzić brak ruchomych tagów i gałęzi dla akcji zewnętrznych.
2. Uruchomić CI oraz Release workflow na przypiętych SHA.
3. Potwierdzić, że Dependabot rozpoznaje ekosystem GitHub Actions.

#### A6. Automatyczny backup przed migracją i rzeczywisty test aktualizacji 0.7.7 → 0.7.8

Status: obowiązkowe przed publikacją 0.7.8.

Czysta instalacja nie sprawdza najważniejszego scenariusza użytkownika posiadającego już profile, Workspace, sesje, targety i ustawienia z wersji 0.7.7.

Zakres:

1. Przed pierwszą migracją bazy w 0.7.8 automatycznie utworzyć spójny backup istniejącej bazy 0.7.7.
2. Nazwa i manifest backupu mają wskazywać wersję źródłową aplikacji, wersję schematu, czas oraz SHA-256.
3. Jeżeli backup nie powiedzie się, nie rozpoczynać migracji i nie modyfikować aktywnej bazy.
4. Migrację wykonywać transakcyjnie tam, gdzie pozwala na to SQLite; po migracji wykonać kontrolę integralności i oczekiwanego schematu.
5. W razie niepowodzenia zachować bazę źródłową i przekazać użytkownikowi czytelny komunikat z lokalizacją backupu oraz możliwością bezpiecznego ponowienia.
6. Nie usuwać automatycznie backupu po udanej migracji; politykę retencji ustalić osobno.

Obowiązkowy test aktualizacji:

1. Zainstalować publiczną wersję 0.7.7.
2. Utworzyć reprezentatywne dane: profil, kilka Workspace, zwykły Chat, ręczną i automatyczną sesję, Research, AI Judge, źródła oraz zapisane ustawienia providera bez ujawniania klucza.
3. Zainstalować 0.7.8 jako aktualizację istniejącej instalacji, nie jako czystą instalację.
4. Potwierdzić utworzenie backupu przed migracją.
5. Sprawdzić kompletność i czytelność wszystkich wcześniejszych danych oraz możliwość utworzenia nowych danych.
6. Przetestować kontrolowaną awarię migracji i potwierdzić brak utraty bazy 0.7.7.

#### A7. Ochrona parserów PDF i DOCX przed bombami dekompresyjnymi i blokowaniem aplikacji

Status: obowiązkowe razem z obsługą PDF i DOCX z punktu 3.

Sam limit rozmiaru przesłanego pliku nie wystarcza. Mały plik DOCX może po rozpakowaniu zajmować bardzo dużo pamięci, a złożony PDF lub XML może zużyć nadmierny czas procesora i zablokować interfejs.

Zakres:

- limit rozmiaru pliku skompresowanego;
- limit łącznej liczby bajtów po rozpakowaniu DOCX;
- limit liczby wpisów ZIP oraz współczynnika kompresji;
- odrzucanie zagnieżdżonych archiwów i nieoczekiwanych typów wpisów;
- limit liczby stron PDF oraz ilości wyodrębnionego tekstu;
- limit głębokości, liczby węzłów i rozmiaru XML;
- wyłączenie external entities, DTD, odwołań sieciowych, makr i aktywnej zawartości;
- limit czasu i pamięci operacji oraz możliwość jej anulowania;
- przetwarzanie poza głównym wątkiem interfejsu;
- komunikat odróżniający plik uszkodzony, zaszyfrowany, przekraczający limit i PDF bez warstwy tekstowej.

Konkretne wartości limitów należy zapisać w kodzie jako jawne stałe i pokazać użytkownikowi przed importem. Nie wolno polegać wyłącznie na deklarowanym MIME lub rozszerzeniu. Zalecenia ogólne: <https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html>.

Testy negatywne:

1. ZIP bomb podszywający się pod DOCX.
2. DOCX z bardzo dużą liczbą małych wpisów i nadmiernie głębokim XML.
3. PDF z nadmierną liczbą stron, bardzo dużym strumieniem skompresowanym oraz PDF chroniony hasłem.
4. Przekroczenie każdego limitu osobno.
5. Anulowanie trwającego importu i potwierdzenie, że aplikacja nadal odpowiada.

#### A8. Testy kontraktowe providerów na lokalnym symulatorze API

Status: obowiązkowe dla zmian w adapterach providerów i dla każdej nowej integracji, w tym Blackbox; nie zastępuje późniejszych testów terenowych.

Cel: sprawdzać sposób budowania requestów i interpretacji odpowiedzi bez prawdziwych kluczy, płatnych zapytań oraz posiadania kont u wszystkich providerów.

Zakres lokalnego symulatora:

- kontrolowane odpowiedzi zgodne z kontraktami OpenAI/OpenAI-compatible, Google, Anthropic i Mistral;
- scenariusze odpowiedzi zwykłej i streamingu;
- lista modeli, poprawna odpowiedź, pusty wynik, nieznany model i błędny klucz;
- błędy `400`, `401`, `403`, `404`, `429` i `5xx`;
- nagłówek `Retry-After`, timeout, przerwane połączenie i niepełny strumień;
- użycie tokenów, request ID i rzeczywisty identyfikator modelu zwrócony przez providera;
- sprawdzenie, które parametry reasoning są wysyłane, mapowane albo całkowicie pomijane;
- potwierdzenie, że sekrety i pełne treści nie trafiają do domyślnego logu diagnostycznego.

Dla Blackbox test kontraktowy można przygotować dopiero po potwierdzeniu stabilnej, oficjalnej specyfikacji API. Symulator potwierdza zgodność implementacji z dokumentacją, ale interfejs nadal ma oznaczać integrację jako niezweryfikowaną terenowo, dopóki użytkownik nie sprawdzi jej na własnym koncie.

### Priorytet B — małe, wartościowe usprawnienia

#### B1. Ponowne użycie klienta HTTP

Obecnie dla każdego odkrycia modeli i każdego wywołania chatu tworzony jest nowy `reqwest::Client`. Zamiast tego należy utworzyć jeden współdzielony klient i używać jego puli połączeń. Zmniejszy to liczbę negocjacji TLS i opóźnienia przy kolejnych krokach sesji. Dokumentacja `reqwest` wprost zaleca utworzenie klienta raz i ponowne używanie go: <https://docs.rs/reqwest/latest/reqwest/struct.Client.html>.

Przy okazji warto budować `User-Agent` z `env!("CARGO_PKG_VERSION")`, aby nie utrzymywać piątego ręcznie zmienianego numeru wersji.

#### B2. Prywatność logu diagnostycznego providera

Obecny log jest tylko w pamięci i usuwa klucz API, ale przechowuje do 30 pełnych requestów i odpowiedzi. Może to obejmować transcript sesji, System Prompt, Reveal i treść dokumentów.

Proponowana poprawka:

- domyślnie zapisywać jedynie provider, model, endpoint, status, request ID, czas, użycie tokenów i kod błędu;
- pełny request/response udostępniać dopiero po świadomym włączeniu `Detailed diagnostics`;
- przed włączeniem wyświetlić informację, że diagnostyka może zawierać treść sesji;
- zapewnić osobny przycisk natychmiastowego czyszczenia.

#### B3. Rzeczywista walidacja obrazów

Kod sprawdza rozmiar, rozszerzenie i deklarowany MIME, ale nie sprawdza sygnatury bajtów ani tego, czy plik rzeczywiście jest poprawnym obrazem. Należy rozpoznawać format z zawartości, odrzucać rozbieżność MIME/rozszerzenia oraz ograniczyć wymiary i liczbę pikseli, aby uniknąć plików podszywających się pod obraz i bomb dekompresyjnych.

#### B4. Dokładniejszy limit kontekstu

Obecny licznik szacuje tekst wzorem `liczba znaków / 3.5`, nie uwzględnia kosztu obrazów i rezerwuje maksymalnie 4096 tokenów odpowiedzi nawet dla modeli obsługujących więcej.

Proponowana poprawka:

- oznaczyć wartość w interfejsie jako przybliżenie;
- dodać margines bezpieczeństwa dla różnic tokenizerów;
- uwzględnić konserwatywny koszt obrazów;
- nie wysyłać automatycznie pełnej treści każdego długiego dokumentu w każdej turze;
- decyzję o podniesieniu limitu odpowiedzi powyżej 4096 podjąć osobno po testach providerów, ponieważ wpływa ona na koszt i długość sesji.

#### B5. Dependabot dla npm, Cargo i GitHub Actions

Status: wartościowe, lecz nieblokujące 0.7.8.

Dodać `.github/dependabot.yml` z cotygodniowym sprawdzaniem:

- `npm` w katalogu `/`;
- `cargo` w katalogu `/src-tauri`;
- `github-actions` w katalogu `/`.

Aktualizacje mają przychodzić jako kontrolowane Pull Requesty. Nie łączyć automatycznie zmian zależności bez przejścia CI i przeglądu release notes. Można grupować drobne aktualizacje jednego ekosystemu, ale duże wersje i zależności bezpieczeństwa oceniać osobno. Oficjalnie obsługiwane ekosystemy obejmują npm, Cargo i GitHub Actions: <https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference>.

#### B6. CodeQL dla TypeScript, Rust i workflow GitHub Actions

Status: wartościowe, lecz nieblokujące 0.7.8.

Włączyć CodeQL dla:

- JavaScript/TypeScript;
- Rust;
- workflow GitHub Actions, jeżeli wybrana konfiguracja repozytorium udostępnia analizę Actions.

Analiza powinna działać dla Pull Requestów, zmian na `main` oraz cyklicznie. Alerty nie mogą być bezrefleksyjnie ignorowane, ale pierwsze uruchomienie może ujawnić istniejące problemy wymagające osobnej oceny zamiast blokowania całego wydania bez analizy. CodeQL obecnie obsługuje JavaScript/TypeScript, Rust oraz zapytania dla GitHub Actions: <https://docs.github.com/en/code-security/concepts/code-scanning/codeql/codeql-code-scanning>.

#### B7. Pełniejsze metadane sesji i wywołań providerów

Status: wartościowe, lecz nieblokujące 0.7.8.

Dla nowych sesji i poszczególnych wywołań zapisywać, gdy dane są dostępne:

- wersję aplikacji;
- commit SHA użyty do zbudowania aplikacji;
- nazwę i wersję schematu protokołu;
- skonfigurowany provider oraz model żądany przez użytkownika;
- rzeczywisty model zwrócony przez providera;
- request ID providera;
- reasoning effort rzeczywiście wysłany po mapowaniu adaptera;
- wejściowe i wyjściowe użycie tokenów oraz informację, czy jest raportowane przez API czy tylko oszacowane;
- snapshot ceny użyty do obliczenia kosztu, wraz ze źródłem i czasem pobrania ceny.

Nie dopisywać danych, których provider nie zwrócił. Brak wartości oznaczać jako `unavailable`, zamiast udawać precyzję. Snapshot ceny ma zapewniać odtwarzalność historycznego kosztu nawet po późniejszej zmianie cennika.

#### B8. Ostrożna i jawna polityka ponawiania zapytań

Status: wartościowe, lecz nieblokujące 0.7.8.

Automatyczny retry może spowodować drugie płatne wywołanie, jeżeli pierwsze żądanie dotarło do providera, lecz odpowiedź nie wróciła do aplikacji.

Zasady:

- nie ponawiać automatycznie błędów uwierzytelniania, walidacji ani nieobsługiwanego modelu;
- respektować `Retry-After` dla `429`, ale stosować niski, jawny limit prób;
- dla `5xx`, timeoutów i przerwanego streamingu rozróżniać sytuację przed wysłaniem żądania od niepewnego wyniku po jego wysłaniu;
- przy niepewności poinformować użytkownika, że ponowienie może oznaczać dodatkowy koszt, i wymagać świadomej decyzji, jeśli provider nie zapewnia bezpiecznego klucza idempotencyjnego;
- zapisywać liczbę prób, przyczynę retry oraz request ID, bez zapisywania sekretów;
- nie ukrywać retry w podsumowaniu kosztu ani w metadanych sesji;
- sprawdzić politykę w lokalnym symulatorze z punktu A8.

### Priorytet C — większe porządki po ustabilizowaniu 0.7.8

#### C1. Podział dużego frontendu i code splitting

`src/App.tsx` ma około 2640 linii, główny arkusz stylów około 1330 linii, a produkcyjny bundle JavaScript około 1.37 MB. Zalecany jest stopniowy podział na ekrany, komponenty i hooki oraz ładowanie rzadziej używanych części przez dynamiczny import. Nie wykonywać jednorazowego dużego refaktoru tuż przed wydaniem; zacząć od Settings, Research i modali biblioteki.

#### C2. Dostępność modali i przycisków ikonowych

Modale mają podstawowe `role="dialog"` i `aria-modal`, ale część przycisków zamknięcia i strzałek nie posiada dostępnej nazwy. Do ujednolicenia:

- `aria-label` dla wszystkich przycisków ikonowych;
- połączenie modala z nagłówkiem przez `aria-labelledby`;
- zamykanie klawiszem Escape;
- przeniesienie fokusu do modala, pułapka fokusu podczas otwarcia i powrót fokusu po zamknięciu;
- sprawdzenie całego przepływu tylko klawiaturą.

#### C3. Ograniczenie powierzchni SQL w WebView

Capability głównego okna zawiera `sql:allow-execute`, a dodatkowa komenda Rust przyjmuje listę dowolnych instrukcji SQL do wykonania w transakcji. Aktualny CSP jest restrykcyjny, a zapytania aplikacji są parametryzowane, lecz w przypadku przyszłego błędu XSS pełny zapis do bazy byłby dostępny z WebView.

Docelowo warto przenieść najbardziej wrażliwe operacje do typowanych komend Rust albo wprowadzić w backendzie allowlistę dozwolonych operacji i tabel. Jest to większa zmiana architektury i nie powinna być wykonywana pospiesznie. Tauri domyślnie blokuje potencjalnie niebezpieczne operacje SQL; `sql:allow-execute` jest uprawnieniem dodawanym świadomie: <https://v2.tauri.app/plugin/sql/>.

#### C4. Porządek w zasobach i automatyczna kontrola manifestów

- usunąć znalezione pliki `*.openai-download-*` i dodać ten wzorzec do `.gitignore`;
- generować manifest Built-in Library podczas builda z nazwy, typu, rozmiaru i SHA pliku źródłowego;
- testem porównywać manifest z faktycznie spakowanymi bajtami;
- tym samym mechanizmem objąć cztery nowe dokumenty i dotychczasowe protokoły.

### Elementy ocenione pozytywnie — nie wymagają przepisywania

- klucze API są przechowywane w systemowym keyringu i nie są zwracane do frontendu;
- własny endpoint providera wymaga HTTPS, z wyjątkiem jawnie lokalnego `localhost`;
- sekrety są usuwane z błędów i payloadów diagnostycznych;
- Markdown nie wykonuje surowego HTML, a zdalne obrazy są blokowane;
- ścieżki artefaktów i eksportów mają zabezpieczenia przed traversal i symlinkami;
- backup używa spójnego snapshotu SQLite przez `VACUUM INTO`, sum SHA-256 i kopii bezpieczeństwa przed restore;
- CSP ogranicza zasoby i połączenia WebView do lokalnej aplikacji oraz IPC.

Tych części nie należy zastępować bez konkretnego powodu. Oficjalna dokumentacja SQLite potwierdza, że `VACUUM INTO` jest właściwą metodą utworzenia spójnej kopii działającej bazy: <https://www.sqlite.org/lang_vacuum.html>.

## Poza zakresem wydania 0.7.8

### macOS

Status: świadomie odłożony — nie planować w najbliższym wydaniu.

Powód: przygotowanie, podpisywanie, notarization oraz rzetelne testowanie paczek macOS wymaga osobnego procesu i większego nakładu pracy. Najpierw rozwijamy i stabilizujemy wydania Windows oraz Linux.

### Kolorowe, strukturalne szkice wektorowe sesji

Status: ciekawy kierunek do rozważenia w przyszłości — poza zakresem 0.7.8.

Pomysł polega na tym, aby model oprócz zwykłego opisu zwracał kontrolowany blok danych rysunkowych, a Harness wyświetlał go jako prosty, skalowalny szkic. Program nie powinien próbować samodzielnie zgadywać rysunku ze swobodnego tekstu.

Potencjalny zakres:

- biblioteka neutralnych symboli i kształtów, m.in. naturalna masa, wzniesienie/góra, dolina, woda, teren, struktura, osoba, grupa osób, obiekt, droga, roślinność, ogień/energia i ruch;
- możliwość użycia linii, figur, strzałek, podpisów, kolorów, przezroczystości i prostych warstw;
- model określa typ elementu, położenie, względną wielkość, kolor i relację do innych elementów w jednoznacznym, walidowanym formacie;
- Harness jedynie renderuje przekazane dane i nie dodaje własnej interpretacji;
- niepewna percepcja musi pozostać neutralna: np. `duża naturalna masa`, a nie automatycznie `góra`;
- kolor może zostać użyty tylko wtedy, gdy został rzeczywiście zgłoszony; w przeciwnym razie element pozostaje neutralny albo bez wypełnienia;
- oryginalny opis i blok danych rysunkowych powinny zostać zachowane razem z transcriptem, aby szkic był możliwy do odtworzenia i sprawdzenia;
- niepoprawny lub niekompletny blok nie może zostać „naprawiony” przez zgadywanie — aplikacja powinna wtedy zachować tekst/ASCII i wyświetlić informację, że szkicu wektorowego nie udało się utworzyć;
- możliwość powiększenia oraz eksportu do SVG lub PNG;
- funkcja wymaga osobnych testów na wielu modelach i providerach, dlatego nie należy dokładać jej do kontrolowanego wydania 0.7.8.

### Elementy bezpieczeństwa i dystrybucji odłożone na później

#### Podpisane aktualizacje bezpośrednio z aplikacji

Nie wdrażać w 0.7.8. Tauri Updater wymaga osobnego klucza prywatnego do podpisywania aktualizacji, bezpiecznego procesu przechowywania i kopii awaryjnej klucza oraz przetestowanego kanału publikacji. Utrata klucza może uniemożliwić bezpieczne aktualizowanie istniejących instalacji. Dokumentacja: <https://v2.tauri.app/plugin/updater/>.

#### Podpis Authenticode dla Windows

Nie blokuje 0.7.8. Artifact Attestations nie podpisują wykonywalnego kodu dla Windows i nie usuwają ostrzeżenia Microsoft Defender SmartScreen. Ograniczenie tych ostrzeżeń wymaga osobnego certyfikatu podpisywania kodu, weryfikacji wydawcy, ochrony klucza i procesu timestampingu. Dokumentacja Tauri: <https://v2.tauri.app/distribute/sign/windows/>.

#### SBOM

Nie dodawać do 0.7.8. Najpierw zapisać `Cargo.lock`, ustabilizować aktualizowanie zależności i włączyć ich kontrolę. Później można generować SBOM w formacie SPDX lub CycloneDX i dołączać do niego osobną attestation.

#### Pełne automatyczne testy prawdziwego okna aplikacji

Pozostawić na późniejszy etap. Obecne testy jednostkowe i integracyjne nie zastępują testów E2E rzeczywistego WebView, systemowych dialogów, keyringu, instalatora ani aktualizacji. Na 0.7.8 obowiązują ręczne testy Windows i Linux opisane w tym planie; docelowo należy dodać kontrolowany zestaw testów prawdziwego okna aplikacji.

#### Opcjonalne szyfrowanie lokalnej bazy

Nie wdrażać pospiesznie w 0.7.8. Baza może zawierać transcripty, Reveale i prywatne dokumenty, dlatego szyfrowanie jest wartościowe, ale wymaga decyzji o bibliotece, wydajności, zarządzaniu kluczem, odzyskiwaniu danych i migracji istniejących baz. Błąd w tym obszarze mógłby spowodować trwałą utratę danych.

## Kolejne uwagi z testów 0.7.7

W tym miejscu dopisujemy następne drobne poprawki zgłoszone podczas dalszego używania aplikacji. Każdy nowy punkt powinien zawierać:

- opis zaobserwowanego problemu lub proponowanej poprawki;
- ekran albo funkcję, której dotyczy;
- oczekiwane zachowanie;
- informację, czy problem da się powtórzyć;
- minimalny test potwierdzający poprawkę.

### Uwaga 1. Zadanie specjalne nie jest przekazywane po wymaganym etapie sesji

Status: zatwierdzone — obowiązkowe dochodzenie, naprawa i test regresji dla 0.7.8.

#### Zaobserwowany problem

W kilku automatycznych sesjach Full RCP wybrano Zadanie specjalne obejmujące dwa podmioty, lecz po zakończeniu fazy 4 nie pojawiło się oczekiwane polecenie. Próba została powtórzona w kilku sesjach i zachowanie nie wygląda na pojedynczy przypadek.

Oczekiwany przebieg Full RCP:

1. Viewer kończy fazę 4.
2. Protocol Controller przekazuje Viewerowi wybrane Zadanie specjalne w osobnym, ślepym poleceniu.
3. Viewer wykonuje Zadanie specjalne, a odpowiedź trafia do zapieczętowanego transcriptu pre-reveal.
4. Dopiero potem Controller przechodzi do fazy 5.

#### Stan stwierdzony podczas przeglądu kodu

- kontroler Full RCP posiada ścieżkę osobnego wywołania Viewera po fazie 4 w sesji bez AI Monitora;
- kontroler RV Lite posiada odrębną ścieżkę wstrzyknięcia po kroku 3;
- w sesji Full RCP z AI Monitorem wyrenderowane Zadanie specjalne jest przekazywane w pakiecie Monitora od zakończenia fazy 4;
- interfejs przekazuje konfigurację Zadania specjalnego do kontrolerów, a wybór jest zapisywany w snapshocie sesji;
- AI Monitor nie obsługuje obecnie RV Lite, więc kombinacji `RV Lite + AI Monitor` nie wolno przedstawiać jako działającej tylko dlatego, że samo Zadanie specjalne istnieje.

Samo istnienie tych ścieżek nie dowodzi, że działają w rzeczywistym przebiegu. Nie przypisywać przyczyny przed odtworzeniem błędu. Sprawdzić kolejno zapis konfiguracji, payload uruchomienia, warunek przejścia po fazie, renderowanie zadania, wywołanie providera, zapis zdarzenia oraz prezentację odpowiedzi w UI.

#### Zakres obowiązkowy

1. **Jedna definicja aktywnego Zadania specjalnego**
   - aktywność zadania wyliczać z jednej, typowanej funkcji używanej przez UI, snapshot i kontroler;
   - pustego lub niepełnego wyboru nie traktować jako aktywnego zadania;
   - zachować neutralne etykiety, m.in. `Subject A`, `Subject B`, `Structure A` i `Object A`, bez ujawniania prawdziwego celu;
   - zapisać w snapshocie dokładny wybór i tekst zadania użyty w danej sesji.

2. **Full RCP — sesja automatyczna bez Monitora**
   - wstrzyknąć zadanie dokładnie raz po pełnym zakończeniu fazy 4 i przed poleceniem fazy 5;
   - użyć osobnego wywołania Viewera, a nie dopisywać zadania po cichu do innej fazy;
   - zapisać jawne zdarzenie `SPECIAL_TASK_INJECTED`, treść polecenia i odpowiedź Viewera;
   - wznowienie sesji nie może wykonać tego samego płatnego wywołania drugi raz, jeżeli odpowiedź została już trwale zapisana.

3. **RV Lite — sesja automatyczna**
   - zachować właściwy dla RV Lite punkt wstrzyknięcia po kroku 3;
   - nie przenosić mechanicznie reguły Full RCP „po fazie 4” do RV Lite;
   - zadanie ma zostać wykonane przed następnym krokiem protokołu, dokładnie raz i z jawnym wpisem w transcripcie.

4. **Full RCP z AI Monitorem**
   - przed zakończeniem fazy 4 Monitor nie może otrzymać Zadania specjalnego;
   - po zakończeniu fazy 4 zadanie ma znaleźć się w pakiecie Monitora i pozostawać dostępne w dalszej ślepej części sesji;
   - Monitor ma kierować Viewera neutralnie do wskazanych aspektów, bez prób ustalenia ich tożsamości;
   - obowiązuje dotychczasowy limit najwyżej pięciu kolejnych interwencji po danej fazie oraz `CONTINUE_PROTOCOL`;
   - przekazanie zadania Monitorowi musi być widoczne w audycie, ale nie może ujawniać Revealu Viewerowi.

5. **Nieobsługiwana kombinacja**
   - dopóki AI Monitor nie zostanie osobno wdrożony dla RV Lite, interfejs ma jasno oznaczać `RV Lite + AI Monitor` jako niedostępne;
   - test Zadania specjalnego dla RV Lite obejmuje w 0.7.8 automatyczny kontroler RV Lite, a nie nieistniejącą trasę monitorowaną.

#### Minimalna macierz testów regresji

| Protokół | Tryb | Punkt przekazania | Oczekiwany wynik |
|---|---|---|---|
| Full RCP | Automatic | po fazie 4 | osobne zadanie, odpowiedź, potem faza 5 |
| Full RCP | AI Monitor | pakiet Monitora po fazie 4 | neutralne pogłębienie, maks. 5 wymian |
| RV Lite | Automatic | po kroku 3 | osobne zadanie, odpowiedź, potem kolejny krok |
| RV Lite | AI Monitor | nieobsługiwane | jasna blokada, brak obietnicy wykonania |

Każdy obsługiwany wariant sprawdzić co najmniej dla jednego aspektu, dwóch aspektów (`Subject A` i `Subject B`), tekstu niestandardowego, obu języków aplikacji, celu automatycznego i zewnętrznego. Dodatkowo sprawdzić przerwanie i wznowienie bez podwójnego wywołania oraz potwierdzić kolejność w zdarzeniach, transcripcie i UI.

### Uwaga 2. Protokół telepatyczny jako pełny tryb RV Sessions

Status: zatwierdzone — obowiązkowe dla 0.7.8, z zastrzeżeniem dostarczenia i zweryfikowania dokładnych plików źródłowych oraz dziesięciu startowych celów telepatycznych.

#### Cel

Polska i angielska wersja Protokołu telepatycznego mają być nie tylko dokumentami w `Settings → Built-in Library`, lecz również wybieralnym protokołem sesji obok Full RCP, RV Lite i protokołu własnego. Protokół ma działać w:

- automatycznej RV Session;
- RV Session z AI Monitorem;
- Manual RV jako opcjonalnie dołączany protokół z listy rozwijanej.

Integracja ma korzystać z dokładnej, wersjonowanej treści dokumentów źródłowych. Nie przepisywać protokołu z pamięci i nie tworzyć brakujących kroków na podstawie opisu planu. Dokumenty Built-in Library wskazują oznaczenia T0–T10, natomiast przebieg sesji został opisany jako dziewięć wykonywanych kroków. Przed implementacją przygotować i zatwierdzić jednoznaczną tabelę mapowania `krok sesji 1–9 → dokładna sekcja źródłowa`, zachowując całą treść protokołu. Rozbieżności numeracji nie wolno rozstrzygać domysłem w kodzie.

#### Wybór protokołu i konfiguracja ekranu

1. Dodać `Telepathic Protocol / Protokół telepatyczny` do wyboru protokołu automatycznej i monitorowanej RV Session.
2. Dodać ten sam protokół do listy rozwijanej Manual RV obok Full RCP i wariantów RV Lite.
3. Wybór języka aplikacji ma dołączać odpowiadającą mu, dokładną wersję PL albo EN; snapshot przechowuje identyfikator, wersję, język i SHA użytych bajtów.
4. Dla Protokołu telepatycznego całkowicie wyłączyć panel Zadań specjalnych. Nie wystarczy zignorować zaznaczenia dopiero w kontrolerze — niedostępność ma być widoczna już podczas konfiguracji.
5. Zamiast Zadań specjalnych pokazać konfigurację pytań kroku 8 odpowiednią dla wybranego trybu sesji.
6. Początkowy tasking dla Viewera ma zawierać dotychczasową instrukcję wykonywania szkiców także jako rysunki ASCII w bloku kodu.

#### Automatyczna sesja bez AI Monitora

Controller ma wykonywać każdy krok i każde obowiązkowe pogłębienie jako osobne wywołanie modelu, w następującej kolejności:

```text
Krok 1
→ Krok 2
→ Krok 3
→ obowiązkowe dodatkowe pogłębienie Kroku 3
→ Krok 4
→ obowiązkowe dodatkowe pogłębienie Kroku 4
→ Krok 5
→ obowiązkowe dodatkowe pogłębienie Kroku 5
→ Krok 6
→ Krok 7
→ Krok 8
→ pytania Kroku 8
→ Krok 9
→ Reveal albo oczekiwanie na Reveal
```

Stałe polecenia pogłębiające po krokach 3, 4 i 5 mają prosić o wejście głębiej w dane z właśnie zakończonego kroku, znalezienie nowych szczegółów i unikanie niepotrzebnego powtarzania. Ich zatwierdzone brzmienie PL i EN zapisać jako wersjonowane zasoby kontrolera oraz objąć testem snapshotowym.

#### Dwa tryby pytań po Kroku 8 w sesji automatycznej

1. **Pytania przygotowane przed sesją**
   - użytkownik wpisuje dowolną liczbę pytań przed uruchomieniem;
   - pytania zostają zamrożone w snapshocie i po Kroku 8 są zadawane Viewerowi kolejno, w zapisanej kolejności;
   - każde pytanie i odpowiedź stanowią osobną wymianę w zapieczętowanym transcripcie;
   - po ostatniej odpowiedzi Controller automatycznie przechodzi do Kroku 9.

2. **Ręczne pytania podczas sesji**
   - po Kroku 8 Controller przechodzi do trwałego stanu `Awaiting Step 8 Questions / Oczekiwanie na pytania Kroku 8` i zatrzymuje automatyczny przebieg;
   - użytkownik może zadawać Viewerowi kolejne pytania i otrzymywać odpowiedzi bez ustalonej z góry liczby;
   - widoczny przycisk `Finish Step 8 and continue to Step 9 / Zakończ Krok 8 i przejdź do Kroku 9` kończy etap pytań;
   - samo puste pole, zamknięcie okna albo ponowne uruchomienie aplikacji nie może automatycznie przejść do Kroku 9;
   - stan oczekiwania, pytania, odpowiedzi i informację o naciśnięciu przycisku zapisać tak, aby sesję można było bezpiecznie wznowić.

#### Sesja z AI Monitorem

1. AI Monitor uruchamia cykl pogłębiania po Krokach 2, 3, 4, 5, 6, 7 i 8.
2. Po Kroku 9 nie uruchamiać Monitora — następuje bezpośrednio Reveal albo oczekiwanie na jego podanie.
3. Po Krokach 3, 4 i 5 obowiązuje kolejność:

```text
podstawowy krok → obowiązkowe stałe pogłębienie tego kroku → cykl AI Monitora → następny krok
```

4. Po pozostałych monitorowanych krokach obowiązuje kolejność:

```text
podstawowy krok → cykl AI Monitora → następny krok
```

5. W każdym cyklu Monitor może wydać najwyżej pięć kolejnych instrukcji, po jednej na odpowiedź. Może zakończyć wcześniej przez dokładne `CONTINUE_PROTOCOL`.
6. Do zakończenia Kroku 7 pytania Monitora służą pogłębianiu aspektów ujawnionych w bieżącym ślepym transcripcie i nie mogą zgadywać prawdziwego celu.
7. Po Kroku 8 pytania mogą dotyczyć całości zgromadzonych danych sesji, nadal bez dostępu do Revealu.
8. Protokół telepatyczny ma zostać dołączony do pakietu Monitora w dokładnej wersji PL albo EN, wraz z numerem aktualnego kroku, pełnym zaktualizowanym transcriptem i numerem wymiany.

#### Dwa tryby pytań Kroku 8 z AI Monitorem

1. **Pytania przygotowane przez użytkownika**
   - użytkownik wpisuje je przed sesją;
   - po Kroku 8 Monitor otrzymuje tę zamrożoną listę jako jawny tasking i zadaje ją Viewerowi w ramach swojego cyklu;
   - obowiązuje wspólny limit najwyżej pięciu interwencji, dlatego UI nie może przyjąć więcej niż pięć pytań w tym wariancie;
   - po zadaniu wszystkich pytań albo po osiągnięciu limitu Controller przechodzi do Kroku 9.

2. **Pytania wybierane samodzielnie przez AI Monitora**
   - użytkownik zaznacza, że po Kroku 8 Monitor ma sam wybrać najbardziej użyteczne pytania dotyczące całej sesji;
   - Monitor może wydać od zera do pięciu neutralnych instrukcji i zakończyć wcześniej przez `CONTINUE_PROTOCOL`;
   - po zakończeniu cyklu Controller przechodzi do Kroku 9.

#### Krok 9, Reveal i część post-reveal

- po zapisaniu odpowiedzi Kroku 9 zapieczętować transcript pre-reveal;
- jeżeli wybrano zapisany cel telepatyczny, Controller automatycznie ujawnia go tak samo jak cel automatyczny w pozostałych sesjach;
- jeżeli użyto celu zewnętrznego, sesja przechodzi do trwałego stanu oczekiwania na Reveal podany przez operatora;
- po Revealu zachować obecny przebieg komentarza/oceny Viewera, rozmowy post-reveal i opcjonalnego AI Judge;
- Reveal nie może trafić do Viewera ani Monitora przed zapieczętowaniem Kroku 9.

#### Manual RV

- Protokół telepatyczny ma być pozycją na rozwijanej liście protokołów Manual RV;
- wybór dołącza dokładny dokument PL albo EN do Viewer System Promptu bieżącego wątku;
- Manual RV pozostaje ręczną rozmową: nie uruchamia automatycznie kroków, stałych pogłębień, pauzy Kroku 8 ani Revealu;
- UI ma jasno odróżniać `dołączony protokół` w Manual RV od `kontrolowanej sesji telepatycznej` wykonywanej przez automatyczny Controller.

#### Cele telepatyczne

1. Rozszerzyć cele użytkownika o jawny typ `general` albo `telepathic`; istniejące cele po migracji otrzymują typ `general`.
2. W bibliotece celów użytkownika pokazać dwie osobne kategorie: `General targets / Cele ogólne` oraz `Telepathic targets / Cele telepatyczne`.
3. Przy Protokole telepatycznym można wybrać wyłącznie:
   - własny cel oznaczony jako telepatyczny; albo
   - cel zewnętrzny, którego Reveal operator poda po sesji.
4. Cele fabryczne i ogólne cele użytkownika nie mogą pojawiać się na liście wyboru Protokołu telepatycznego.
5. Cele telepatyczne nie mogą pojawiać się w wyborze celu dla Full RCP, RV Lite ani protokołu własnego.
6. Użytkownik dostarczy dziesięć startowych celów telepatycznych. Przy pierwszym uruchomieniu odpowiedniej migracji mają zostać skopiowane do przestrzeni celów użytkownika, aby można je było edytować i usuwać.
7. Usuniętego celu startowego nie wolno tworzyć ponownie przy każdym starcie aplikacji. Seed musi być idempotentny i wersjonowany.
8. Zachować stabilne identyfikatory, Reveal, obrazy/załączniki i sumy integralności tak samo jak dla pozostałych celów użytkownika.

#### Trwałość, audyt i koszty

Snapshot sesji telepatycznej musi przechowywać co najmniej:

- protokół, jego wersję, język, SHA i zatwierdzone mapowanie kroków;
- wybrany tryb Automatic albo AI Monitor;
- wybrany model, provider, reasoning effort, temperaturę i limit outputu;
- typ celu oraz identyfikator celu, bez ujawniania jego treści w części blind;
- tryb pytań Kroku 8 i zamrożone pytania przygotowane przed sesją;
- wykonane kroki, obowiązkowe pogłębienia, cykle Monitora i ich numery wymian;
- stan oczekiwania na ręczne pytania, Krok 9 albo Reveal;
- identyfikatory wywołań i informację, które odpowiedzi zostały trwale zapisane.

Każdy krok, pogłębienie i pytanie jest osobnym potencjalnie płatnym wywołaniem. Interfejs przed rozpoczęciem ma to komunikować, a wznowienie po awarii nie może po cichu powtarzać zakończonych wywołań.

#### Minimalne testy akceptacyjne Protokołu telepatycznego

1. Automatic PL i EN z pytaniami wpisanymi przed sesją.
2. Automatic PL i EN z pauzą po Kroku 8, kilkoma ręcznymi pytaniami, restartem aplikacji i świadomym przejściem do Kroku 9.
3. AI Monitor PL i EN z pytaniami przygotowanymi przez użytkownika.
4. AI Monitor PL i EN z pytaniami wybieranymi samodzielnie po Kroku 8.
5. Potwierdzenie kolejności `Krok 3/4/5 → stałe pogłębienie → Monitor` oraz braku Monitora po Kroku 9.
6. Test limitu pięciu interwencji i wcześniejszego `CONTINUE_PROTOCOL` po każdym monitorowanym kroku.
7. Cel telepatyczny użytkownika: automatyczny Reveal po Kroku 9.
8. Cel zewnętrzny: trwałe oczekiwanie na Reveal i poprawne wznowienie.
9. Potwierdzenie, że Zadania specjalne są wyłączone dla Protokołu telepatycznego.
10. Potwierdzenie filtracji celów w obie strony i migracji istniejących celów do typu `general`.
11. Usunięcie jednego z dziesięciu startowych celów i potwierdzenie, że nie wraca po restarcie.
12. Manual RV PL i EN: dołączenie właściwego dokumentu bez uruchamiania automatycznego Controllera.
13. Porównanie SHA dokumentu użytego w sesji z dokumentem Built-in Library.
14. Test awarii i wznowienia po każdym rodzaju osobnego wywołania, bez duplikacji transcriptu i kosztu.

## Warunki utworzenia Draft Release 0.7.8

1. Zakończyć zbieranie uwag z testów 0.7.7.
2. Ustalić ostateczny zakres — szczególnie decyzję dotyczącą Blackbox i wydania Linux.
3. Wprowadzić zmiany na gałęzi `release/0.7.8`.
4. Zapisać i przejrzeć `src-tauri/Cargo.lock`; usunąć z workflow automatyczny commit i push lockfile do `main`.
5. Przypiąć wszystkie zewnętrzne GitHub Actions do pełnych SHA.
6. Wykonać pełne CI: TypeScript, testy frontendu, produkcyjny build Vite, Rust tests oraz Clippy z `--locked`.
7. Wykonać testy kontraktowe wszystkich zmienionych adapterów providerów na lokalnym symulatorze.
8. Wykonać negatywne testy parserów PDF/DOCX, jeżeli obsługa tych formatów wejdzie do 0.7.8.
9. Potwierdzić usunięcie formalnego statusu Manual RV i sprawdzić archiwizację nowych oraz starszych wątków zapisanych wcześniej jako `BLIND` lub `REVEALED`.
10. Sprawdzić pole maksymalnego outputu i pełny wskaźnik input/context w Manual RV oraz Conversation dla modeli z różnymi limitami.
11. Odtworzyć błąd Zadania specjalnego i wykonać pełną macierz Full RCP Automatic, Full RCP z AI Monitorem oraz RV Lite Automatic, łącznie z testem wznowienia bez podwójnego wywołania.
12. Zweryfikować dokładne dokumenty PL/EN Protokołu telepatycznego, ich SHA oraz zatwierdzone mapowanie dziewięciu kroków do sekcji źródłowych.
13. Dodać i sprawdzić dziesięć startowych celów telepatycznych dostarczonych przez użytkownika oraz filtrację typów celów.
14. Wykonać pełne testy akceptacyjne Protokołu telepatycznego dla Automatic, AI Monitor i Manual RV, w obu językach, z oboma trybami pytań Kroku 8.
15. Połączyć sprawdzoną gałąź z `main`.
16. Ustawić wersję aplikacji na `0.7.8` we wszystkich wymaganych plikach i zapisać commit builda w metadanych aplikacji.
17. Włączyć `Enable release immutability` w ustawieniach repozytorium przed opublikowaniem 0.7.8.
18. Uruchomić ręcznie workflow `Release Windows`, utworzyć Draft Release i wygenerować attestation `.exe` oraz `.msi`.
19. Pobrać oba instalatory z Draft Release, zweryfikować przez `gh attestation verify` i przetestować na Windows.
20. Wykonać rzeczywisty test aktualizacji istniejącej instalacji 0.7.7 do 0.7.8, razem z automatycznym backupem i kontrolą danych po migracji.
21. Jeżeli Linux wejdzie do zakresu, przetestować AppImage i `.deb` na prawdziwym systemie Linux oraz objąć opublikowane pakiety odpowiednią attestation.
22. Opublikować Release dopiero po powodzeniu wszystkich obowiązkowych kontroli.
23. Po publikacji potwierdzić oznaczenie `Immutable` oraz wykonać `gh release verify` i `gh release verify-asset` dla opublikowanych instalatorów.

## Ostateczny podział zakresu Revision 7

Obowiązkowe dla 0.7.8:

- poprawki użytkowe zatwierdzone w punktach 1–6;
- Artifact Attestations instalatorów oraz Release Immutability;
- usunięcie mylących przycisków formalnego statusu Manual RV i powiązanej blokady archiwizacji;
- widoczne sterowanie maksymalnym outputem i pełny wskaźnik input/context w Manual RV oraz Conversation;
- naprawa i test regresji przekazywania Zadań specjalnych w obsługiwanych trasach Full RCP i RV Lite;
- Protokół telepatyczny jako kontrolowana sesja Automatic i AI Monitor oraz jako opcjonalnie dołączany protokół Manual RV;
- dwa tryby pytań Kroku 8, brak cyklu Monitora po Kroku 9 i jednoznaczne przejście do Revealu;
- rozdzielenie celów użytkownika na ogólne i telepatyczne oraz dziesięć edytowalnych, usuwalnych celów startowych dostarczonych przez użytkownika;
- powtarzalny `Cargo.lock` bez automatycznego pushowania z workflow;
- przypięcie wszystkich GitHub Actions do pełnych SHA;
- automatyczny backup przed migracją i test aktualizacji 0.7.7 → 0.7.8;
- zabezpieczenie parserów PDF/DOCX, jeżeli te formaty zostaną wydane w 0.7.8;
- testy kontraktowe adapterów providerów objętych zmianami.

Wartościowe, ale nieblokujące 0.7.8:

- Dependabot dla npm, Cargo i GitHub Actions;
- CodeQL dla TypeScript, Rust i workflow GitHub Actions;
- pełniejsze metadane sesji i kosztów;
- jawna, ostrożna polityka retry;
- usprawnienia oznaczone Priorytetem B, o ile nie zwiększą ryzyka wydania.

Warunkowe:

- oficjalne pakiety Linux — tylko po pomyślnym buildzie i testach na prawdziwym systemie;
- Blackbox — tylko po potwierdzeniu publicznego, udokumentowanego API; samo Blackbox CLI nie wystarcza.

Odłożone:

- macOS;
- Tauri Updater i podpisane aktualizacje z aplikacji;
- Authenticode;
- SBOM;
- pełne automatyczne testy prawdziwego okna aplikacji;
- szyfrowanie lokalnej bazy;
- kolorowe, strukturalne szkice wektorowe sesji generowane z walidowanych instrukcji modelu.
