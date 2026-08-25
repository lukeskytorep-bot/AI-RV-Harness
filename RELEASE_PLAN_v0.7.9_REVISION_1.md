# AI RV Harness — plan wydania 0.7.9

> Aktualna rewizja: **1** · 25.08.2026  
> Dokument utworzony po porównaniu planu `0.7.8 Revision 7` z pełnym źródłem `AI_RV_Harness_v0.7.8_COMPLETE_SOURCE.zip`.

Status dokumentu: **otwarty — zakres przeniesiony do wdrożenia i weryfikacji**.

Planowana gałąź robocza: `release/0.7.9`.

Bazą prac jest pełne źródło `0.7.8`. Nie należy ponownie składać projektu z paczki `0.7.7` i częściowej nakładki. Przed rozpoczęciem zmian trzeba rozpakować kompletną paczkę `0.7.8`, sprawdzić jej sumy SHA-256 i dopiero na niej utworzyć gałąź `release/0.7.9`.

## 1. Cel wydania 0.7.9

Wydanie `0.7.9` ma domknąć zatwierdzone elementy planu, które zostały opisane dla `0.7.8`, ale nie trafiły do faktycznego kodu. Najważniejsze cele to:

- poprawienie czytelności i prostoty najczęściej używanych ekranów;
- pełna obsługa dokumentów w Conversation i Manual RV;
- bezpieczne zapisywanie oryginalnych dokumentów z Built-in Library;
- usunięcie mylącego formalnego statusu Manual RV;
- widoczne sterowanie maksymalnym outputem i rzeczywistym wykorzystaniem kontekstu;
- powtarzalny build Rust bez automatycznych commitów wykonywanych przez workflow;
- bezpieczne migracje i przywracanie bazy;
- utwardzenie integracji providerów, parserów i obrazów;
- obowiązkowe GitHub Artifact Attestations dla artefaktów następnego wydania;
- przygotowanie wydania w sposób możliwy do zweryfikowania przez użytkownika.

Zasady pracy:

- nie przepisywać części aplikacji, które działają prawidłowo;
- wdrażać małe, odseparowane zmiany z osobnymi testami regresji;
- nie oznaczać punktu jako wykonanego tylko dlatego, że został opisany w planie;
- po każdej zmianie sprawdzić jej rzeczywisty stan w kodzie i w interfejsie;
- nie publikować wydania bez pełnego CI, testu instalatora i weryfikacji attestation;
- Windows pozostaje główną platformą.

## 2. Wynik audytu pełnego źródła 0.7.8

Audyt miał charakter statyczny: porównano kod i konfigurację z wymaganiami `Revision 7`. Nie uruchamiano ponownie testów Rust ani instalatora Windows.

### 2.1. Elementy wykonane w 0.7.8 — nie przenosić ponownie

- Zadania Specjalne w Full RCP i RV Lite są osobnymi wywołaniami, trafiają do zdarzeń i są widoczne w transkrypcie.
- Zadanie Specjalne dla AI Monitora jest udostępniane dopiero od właściwej granicy po Fazie 4.
- Protokół Telepatyczny PL/EN działa w Automatic RV, AI Monitor RV i Manual RV.
- Kontroler telepatyczny obsługuje dziewięć kroków, obowiązkowe pogłębienia po krokach 3–5, pytania po kroku 8, wznowienie i Reveal po kroku 9.
- Zwykłe i telepatyczne cele użytkownika są rozdzielone.
- W kodzie znajduje się dziesięć startowych celów telepatycznych.
- Wersja aplikacji jest ustawiona na `0.7.8`.
- Dostarczona aktualizacja przeszła TypeScript, 158 testów Vitest i build Vite; Rust nie był wtedy dostępny.

### 2.2. Elementy opisane, lecz niewdrożone albo tylko częściowo wdrożone

| Obszar | Stan w źródle 0.7.8 | Decyzja dla 0.7.9 |
| --- | --- | --- |
| Ukrycie konsoli Windows | `src-tauri/src/main.rs` nie zawiera `windows_subsystem = "windows"` | obowiązkowe |
| Czytelność tekstu | arkusz nadal zawiera liczne rozmiary `6.5–10.5 px` | obowiązkowe |
| Dokumenty przy composerze | obsługiwane są tylko `.txt` i `.md`; obrazy mają osobny przycisk | obowiązkowe |
| PDF i DOCX | brak parserów, limitów i testów negatywnych | obowiązkowe |
| Built-in Library Save | dokumenty można jedynie czytać; brak zapisu oryginalnych bajtów | obowiązkowe |
| Cztery nowe dokumenty Built-in Library | oryginalne pliki DOCX nie są dołączone | obowiązkowe |
| Manual RV formal state | kontrolka BLIND/REVEALED i blokada archiwizacji nadal istnieją | obowiązkowe |
| Output w Conversation/Manual | silnik nadal wymusza ukryte `min(model limit, 4096)` | obowiązkowe |
| Wskaźnik input/context | brak stałego procentowego wskaźnika; źródła pokazują tylko przybliżoną liczbę | obowiązkowe |
| GitHub Artifact Attestations | brak uprawnień i kroku `actions/attest` | obowiązkowe |
| Release Immutability | brak potwierdzonego wdrożenia w ustawieniach repozytorium | obowiązkowe przed publikacją |
| Cargo.lock | `src-tauri/Cargo.lock` nie istnieje | obowiązkowe |
| Workflow wydania | nadal generuje lockfile, commit i `git push` do `main` | obowiązkowe do usunięcia |
| Przypięcie GitHub Actions | akcje nadal używają ruchomych tagów i gałęzi | obowiązkowe |
| Natywne dialogi | nadal używane są PowerShell, AppleScript i `zenity` | obowiązkowe |
| Walidacja restore | sprawdzany jest SHA, ale nie `integrity_check` i `foreign_key_check` SQLite | obowiązkowe |
| Backup przed migracją | brak automatycznego backupu blokującego migrację przy błędzie | obowiązkowe |
| Testy kontraktowe providerów | brak lokalnego symulatora API | obowiązkowe dla zmienianych adapterów |
| Wspólny klient HTTP | klient `reqwest` jest tworzony dla kolejnych wywołań; User-Agent ma ręczny numer wersji | do wdrożenia |
| Prywatność diagnostyki | pełne requesty i odpowiedzi są zapisywane domyślnie w pamięci | do wdrożenia |
| Walidacja obrazów | sprawdzany jest głównie rozmiar i deklarowany MIME/rozszerzenie | do wdrożenia |
| Szacowanie kontekstu | używany jest wzór `znaki / 3.5`; część ścieżek nie uwzględnia obrazów | do wdrożenia |
| Retry providerów | automatyczne ponowienia nie rozróżniają bezpiecznych i niepewnych błędów | do wdrożenia |
| Metadane wywołań | część istnieje, ale brak m.in. commit SHA, pełnego provenance requestów i snapshotu ceny | do uzupełnienia |
| Dependabot | brak konfiguracji | wartościowe, nieblokujące |
| CodeQL | brak konfiguracji | wartościowe, nieblokujące |
| Linux release | CI używa Linux, ale nie tworzy oficjalnego AppImage ani `.deb` | warunkowe |
| Blackbox | brak integracji i brak potwierdzonego oficjalnego API | warunkowe |

## 3. Zakres obowiązkowy wydania 0.7.9

### 3.1. Ukrycie okna konsoli w produkcyjnym Windows

W `src-tauri/src/main.rs` dodać:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ai_rv_harness_lib::run();
}
```

Wymagania:

- konsola ma być ukryta wyłącznie w produkcyjnym buildzie Windows;
- kompilacja deweloperska ma zachować konsolę;
- zmiana nie może wpływać na pozostałe platformy ani logikę aplikacji.

Test: instalator release uruchomiony z menu Start i skrótu pulpitu otwiera tylko główne okno aplikacji.

### 3.2. Czytelna i spójna typografia

Obowiązkowa skala docelowa:

- główna treść do czytania: co najmniej `14 px`, interlinia około `1.55–1.65`;
- istotne dane, tabele i kontrolki: około `12–14 px`;
- drugorzędne metadane: co najmniej `11–12 px`;
- nie używać tekstu poniżej `11 px` w informacjach przeznaczonych do normalnego odczytu.

Zakres:

- Research: Experiment Lock, Results, komponenty G/F/A/C i Matched comparisons;
- Training: pełna ocena AI Judge;
- Workspace: transcript, Reveal, Viewer review, Monitor review i AI Judge;
- Conversation i Manual RV: wiadomości użytkownika oraz AI;
- historia AI Monitora i rozmowa post-Reveal;
- ustawienie czcionki użytkownika musi działać spójnie we wszystkich modułach.

Nie zwiększać mechanicznie całej aplikacji jednym mnożnikiem. Najpierw uporządkować wspólne style treści, metadanych, tabel i nagłówków, a potem usunąć lokalne wyjątki.

Testy wizualne:

- 1366×768 i 1920×1080;
- Windows 100% i 125%;
- ta sama sesja otwarta w Training i Workspace;
- pełna ocena AI Judge bez powiększania;
- brak uciętych przycisków, nachodzenia tekstu i poziomego przewijania całej strony.

### 3.3. Jeden widoczny przycisk załączników w Conversation i Manual RV

Przy composerze ma znajdować się jeden przycisk ze spinaczem. Zastępuje on osobny przycisk obrazu i ukryty główny przepływ dodawania Workspace Sources.

Obsługiwane formaty pierwszego etapu:

- `.txt`;
- `.md`;
- tekstowy `.pdf`;
- `.docx`;
- `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` dla modeli z vision.

Wymagania:

1. Jeden systemowy wybór plików, możliwość wskazania wielu plików.
2. Brak vision nie może wyłączać dokumentów tekstowych; ma blokować wyłącznie obrazy.
3. Nowy dokument jest automatycznie aktywny tylko w bieżącej Conversation/Manual RV.
4. Źródło pozostaje dostępne po ponownym uruchomieniu, dopóki użytkownik go nie usunie.
5. Użytkownik może źródło wyłączyć, włączyć i usunąć.
6. Przy composerze pokazać chip: nazwa, typ, stan importu, szacowane tokeny i przycisk usunięcia.
7. Przed wysłaniem użytkownik musi widzieć wszystkie dokumenty i obrazy dołączone do następnej wiadomości.
8. Rozwijana sekcja Workspace Sources może pozostać jako panel zarządzania.
9. PDF bez warstwy tekstowej ma zwrócić jasny komunikat, że OCR nie jest jeszcze obsługiwany.
10. Pliki puste, uszkodzone, zaszyfrowane, chronione hasłem i nieobsługiwane mają być odrzucane czytelnym komunikatem.

Do providera przekazywać wyodrębniony tekst, a nie nieznany plik binarny. Zachować nazwę, typ, hash treści, metodę importu i informację o pochodzeniu.

### 3.4. Bezpieczne traktowanie dokumentów i parsery PDF/DOCX

Treść dokumentu jest niezaufanym źródłem, a nie instrukcją systemową.

Wymagania bezpieczeństwa:

- stała nadrzędna instrukcja systemowa oddzielająca polecenia użytkownika od zawartości źródeł;
- każdy dokument w osobnym bloku z identyfikatorem, nazwą, typem i SHA;
- ograniczniki odporne na próbę zamknięcia ich tekstem dokumentu;
- dokument nie może wybierać narzędzi, zmieniać trybu sesji ani nadpisywać System Promptu;
- testy bezpośredniego i pośredniego prompt injection w `.md`, `.pdf` i `.docx`;
- nie obiecywać pełnej ochrony przed prompt injection — pochodzenie źródła ma być widoczne użytkownikowi.

Limity parserów:

- maksymalny rozmiar pliku skompresowanego;
- maksymalna liczba bajtów po rozpakowaniu DOCX;
- limit liczby wpisów ZIP i współczynnika kompresji;
- odrzucanie zagnieżdżonych archiwów i nieoczekiwanych typów wpisów;
- limit stron PDF i wyodrębnionego tekstu;
- limit głębokości, liczby węzłów i rozmiaru XML;
- wyłączenie external entities, DTD, makr, odwołań sieciowych i aktywnej zawartości;
- limit czasu i pamięci oraz możliwość anulowania;
- przetwarzanie poza głównym wątkiem interfejsu;
- rozpoznawanie pliku z zawartości, a nie wyłącznie rozszerzenia lub deklarowanego MIME.

Obowiązkowe testy negatywne:

- ZIP bomb podszywający się pod DOCX;
- DOCX z nadmierną liczbą wpisów i głębokim XML;
- PDF z nadmierną liczbą stron lub dużym skompresowanym strumieniem;
- PDF i DOCX chronione hasłem;
- przekroczenie każdego limitu osobno;
- anulowanie importu bez zawieszenia aplikacji.

### 3.5. Built-in Library: cztery oryginalne dokumenty oraz Save / Zapisz

Dołączyć jako odrębne, oryginalne pliki:

1. `AI Field Perception Lexicon.docx`;
2. `Słownik Percepcyjny Pola dla AI.docx`;
3. `TELEPATHY MODULE – PROTOCOL FOR AI VIEWER v1.1.docx`;
4. `MODUŁ TELEPATIA – PROTOKÓŁ DLA AI VIEWERA 1.1 .docx`.

Zachować dokładną nazwę czwartego pliku, łącznie z odstępem przed `.docx`, dopóki właściciel projektu nie zatwierdzi innej nazwy.

Wymagania:

- traktować dokumenty jako oryginalne bajty, a nie tekst przepisany do kodu;
- każda karta ma tytuł, język, opis, `Read / Czytaj` i `Save / Zapisz`;
- systemowy dialog zapisu proponuje oryginalną nazwę i rozszerzenie;
- zapis odtwarza dokładne bajty, a SHA zapisanej kopii jest identyczne z SHA pokazywanym w aplikacji;
- anulowanie nie jest błędem;
- błędy uprawnień i braku miejsca są czytelne po polsku i angielsku;
- jeden mechanizm podglądu i zapisu ma obsługiwać obecne oraz przyszłe zasoby.

### 3.6. Oficjalny Tauri Dialog plugin

Zastąpić własne uruchamianie PowerShell, AppleScript i `zenity` oficjalnym pluginem dialogowym Tauri.

Zakres:

- wybór folderu backupu i eksportu;
- wybór dokumentów i obrazów;
- `Save / Zapisz` w Built-in Library;
- uprawnienia ograniczone do niezbędnych operacji `open`, `save` i ewentualnie `message`;
- Windows i Linux mają korzystać z tego samego interfejsu aplikacji.

### 3.7. Usunięcie formalnego statusu Manual RV

Usunąć z Manual RV:

- pasek `Formal Manual RV state / Stan formalnego Manual RV`;
- `Start BLIND state / Rozpocznij stan BLIND`;
- `Mark REVEALED / Oznacz REVEALED`;
- `End formal state / Zakończ stan formalny`;
- blokadę archiwizacji wątku i grupy wątków zależną od stanu `BLIND`;
- nieużywane tłumaczenia, style i testy kontrolki.

Nie usuwać ryzykownie kolumny bazy wyłącznie dla porządku. Starsze wartości `BLIND` i `REVEALED` mogą pozostać jako nieużywane dane zgodności, ale nie mogą blokować interfejsu ani archiwizacji.

Manual RV pozostaje prostą rozmową z Viewer System Promptem, opcjonalnym protokołem, historią i świadomie wybranymi załącznikami. Pełne pieczętowanie pre-Reveal pozostaje funkcją automatycznej/zarządzanej RV Session.

### 3.8. Maksymalny output i widoczny input/context

Conversation i Manual RV mają otrzymać pole:

`Maximum output tokens / Maksymalna liczba tokenów outputu`

Zasady:

- wartość dotyczy pojedynczej odpowiedzi AI;
- domyślna wartość to `min(Default maximum output tokens, limit modelu)`;
- usunąć ukryty limit `4096` z silnika rozmowy;
- wartość musi być dodatnią liczbą całkowitą i nie może przekraczać limitu modelu;
- zmiana modelu może wartość obniżyć, ale nie może bez ostrzeżenia podnieść świadomie wybranej niższej wartości;
- wartość jest zapisana dla bieżącej Conversation/Manual RV albo jednoznacznie inicjalizowana dla nowego wątku.

Przy composerze stale pokazywać procentowy wskaźnik, np. `Pamięć rozmowy: 14%`:

- zielony w bezpiecznym zakresie;
- żółty od około `75%`;
- czerwony od około `90%`;
- szczegóły pokazują szacowany input, limit modelu, zarezerwowany output i pozostałe miejsce;
- gdy provider nie podaje limitu: `Context limit unavailable / Limit kontekstu niedostępny`.

Jedna wspólna funkcja ma obliczać payload dla interfejsu i kontroli przed API. Musi uwzględniać:

- System Prompt;
- protokół Manual RV;
- całą historię wątku;
- Workspace Sources;
- bieżącą wiadomość;
- narzut wiadomości providera;
- konserwatywny koszt obrazów;
- margines bezpieczeństwa wynikający z różnych tokenizerów.

Nie usuwać ani nie streszczać historii po cichu. Po przekroczeniu limitu zablokować wysłanie i zaproponować nowy wątek, wyłączenie źródeł, usunięcie obrazów albo obniżenie rezerwy outputu.

### 3.9. Powtarzalny build Rust i kontrolowany Cargo.lock

Wymagania:

1. Wygenerować i przejrzeć `src-tauri/Cargo.lock` na gałęzi roboczej.
2. Zapisać lockfile w repozytorium.
3. Usunąć z workflow krok wykonujący automatyczny commit i `git push` do `main`.
4. CI i release mają korzystać z istniejącego lockfile przez `--locked`.
5. Zmiany zależności wykonywać w osobnym commicie lub Pull Requeście.
6. Build wydania nie może sam zmieniać źródła, z którego właśnie buduje artefakty.

### 3.10. Automatyczny backup przed migracją i walidacja restore

Przed pierwszą migracją bazy z wcześniejszej wersji:

- utworzyć spójny backup istniejącej bazy;
- zapisać wersję źródłowej aplikacji, wersję schematu, czas i SHA-256;
- nie rozpoczynać migracji, jeżeli backup się nie powiedzie;
- po migracji wykonać kontrolę integralności i oczekiwanego schematu;
- zachować bazę źródłową i backup przy każdym niepowodzeniu;
- nie usuwać automatycznie backupu po udanej migracji.

Przed restore, oprócz obecnej kontroli SHA:

1. Otworzyć kopię tylko do odczytu.
2. Wykonać `PRAGMA quick_check` albo `PRAGMA integrity_check`.
3. Wykonać `PRAGMA foreign_key_check`.
4. Sprawdzić wersję migracji i obecność oczekiwanych tabel.
5. Nie wykonywać SQL pochodzącego z importowanego pliku.
6. Dopiero po pozytywnym wyniku wykonać istniejący bezpieczny swap i zachować `pre_restore`.

Test aktualizacji:

- jeżeli ostatnim publicznym wydaniem pozostaje `0.7.7`, obowiązkowo przetestować `0.7.7 → 0.7.9`;
- jeżeli `0.7.8` zostanie wcześniej opublikowane, dodatkowo przetestować `0.7.8 → 0.7.9`;
- użyć reprezentatywnych profili, Workspace, Chat, Manual RV, Automatic RV, Research, Judge, źródeł i ustawień;
- przetestować kontrolowaną awarię migracji i potwierdzić brak utraty danych.

### 3.11. Testy kontraktowe providerów na lokalnym symulatorze

Lokalny symulator nie używa prawdziwych kluczy i płatnych zapytań.

Zakres:

- OpenAI/OpenAI-compatible, Google, Anthropic i Mistral;
- lista modeli, chat zwykły i streaming;
- odpowiedź poprawna, pusta, niepełna i nieznany model;
- `400`, `401`, `403`, `404`, `429` i `5xx`;
- `Retry-After`, timeout, zerwane połączenie i przerwany stream;
- użycie tokenów, request ID i rzeczywisty model zwrócony przez API;
- mapowanie i pomijanie parametrów reasoning;
- brak sekretów oraz pełnych treści w domyślnej diagnostyce.

Każda zmiana adaptera providera musi przejść test kontraktowy. Testy te nie zastępują późniejszej próby terenowej na koncie użytkownika.

### 3.12. Obowiązkowe GitHub Artifact Attestations dla wydania 0.7.9

Status: **warunek publikacji — wydania nie wolno opublikować bez poprawnej attestation**.

Attestation ma kryptograficznie wiązać artefakt z repozytorium, commitem i workflow, który go zbudował. Nie zastępuje testów, sum SHA-256 ani podpisu Authenticode.

Uprawnienia joba wydania:

```yaml
permissions:
  contents: write
  id-token: write
  attestations: write
```

`contents: write` pozostaje potrzebne, ponieważ workflow tworzy Draft Release i wysyła assety. `artifact-metadata: write` dodać wyłącznie wtedy, gdy zostanie świadomie włączone publikowanie rekordów na stronie linked artifacts; nie przyznawać go do podstawowej attestation binariów bez takiej potrzeby.

Wymagania:

1. Nadać krokowi Tauri identyfikator, np. `id: tauri_build`.
2. Po zbudowaniu uruchomić `actions/attest` przypięte do pełnego SHA zatwierdzonego commita.
3. Objąć attestation co najmniej instalatory `.exe` i `.msi`.
4. Jeżeli jako asset publikowany jest własny `AI_RV_Harness_v0.7.9_COMPLETE_SOURCE.zip`, również objąć go attestation.
5. Jeżeli wydawane są AppImage lub `.deb`, również objąć je attestation.
6. Jawnie odfiltrować oczekiwane typy plików i przerwać workflow, jeżeli lista artefaktów jest pusta.
7. Nie używać `continue-on-error`; błąd attestation blokuje publikację.
8. Release ma pozostać Draftem do zakończenia testów i weryfikacji wszystkich artefaktów.
9. Każdy artefakt pobrać i sprawdzić poleceniem:

```bash
gh attestation verify "PLIK" --repo lukeskytorep-bot/AI-RV-Harness
```

10. Do opisu Release dodać prostą instrukcję weryfikacji dla użytkownika.

Dokumentacja GitHuba:  
<https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations>

### 3.13. Release Immutability

Przed opublikowaniem `0.7.9` włączyć w ustawieniach repozytorium `Enable release immutability`.

Zasady:

- opcję włączyć przed publikacją, ponieważ działa dla przyszłych wydań;
- najpierw utworzyć Draft i dołączyć wszystkie artefakty;
- opublikować dopiero po testach oraz weryfikacji attestation;
- po publikacji wykonać `gh release verify` i `gh release verify-asset`;
- potwierdzić oznaczenie wydania jako `Immutable`;
- nie przesuwać tagu i nie podmieniać artefaktów po publikacji.

### 3.14. Przypięcie wszystkich GitHub Actions do pełnych SHA

Każde zewnętrzne `uses:` ma wskazywać pełny czterdziestoznakowy SHA, a obok komentarz z czytelną wersją.

Dotyczy między innymi:

- `actions/checkout`;
- `actions/setup-node`;
- `dtolnay/rust-toolchain`;
- `swatinem/rust-cache`;
- `tauri-apps/tauri-action`;
- `actions/attest`;
- ewentualnych akcji CodeQL.

Przed zapisaniem SHA potwierdzić, że commit należy do oficjalnego repozytorium akcji i odpowiada wybranemu tagowi. W finalnym repozytorium wyszukać wszystkie `uses:` i potwierdzić brak ruchomych tagów oraz nazw gałęzi.

## 4. Usprawnienia techniczne do wykonania w 0.7.9

Poniższe punkty są wartościowe. Jeżeli zmiana dotyka tego samego modułu co zakres obowiązkowy, należy wykonać je razem. W przeciwnym razie nie powinny blokować wydania bez osobnej decyzji.

### 4.1. Jeden współdzielony klient HTTP

- utworzyć jeden współdzielony `reqwest::Client` i używać puli połączeń;
- zachować timeout i bezpieczną konfigurację TLS;
- budować User-Agent z `env!("CARGO_PKG_VERSION")`, a nie ręcznie wpisanej wersji;
- sprawdzić anulowanie aktywnego requestu po zmianie sposobu przechowywania klienta.

### 4.2. Prywatność diagnostyki providera

- domyślnie zapisywać tylko provider, model, endpoint, status, request ID, czas, użycie tokenów i kod błędu;
- pełny request/response udostępniać dopiero po świadomym włączeniu `Detailed diagnostics`;
- przed włączeniem ostrzec, że dane mogą zawierać transcript, System Prompt, Reveal i dokumenty;
- zachować natychmiastowe czyszczenie logu;
- diagnostyka pozostaje ulotna i nie zawiera kluczy API.

### 4.3. Rzeczywista walidacja obrazów

- rozpoznawać format z sygnatury bajtów;
- odrzucać rozbieżność MIME, rozszerzenia i zawartości;
- zdekodować obraz przed zaakceptowaniem;
- ograniczyć szerokość, wysokość, liczbę pikseli i pamięć po dekompresji;
- zachować istniejące limity liczby oraz rozmiaru plików;
- dodać testy uszkodzonych plików i bomb dekompresyjnych.

### 4.4. Wspólne i dokładniejsze szacowanie kontekstu

- wynik zawsze oznaczać jako przybliżony;
- dodać margines bezpieczeństwa dla różnych tokenizerów;
- konserwatywnie uwzględnić obrazy;
- nie wysyłać automatycznie każdego długiego dokumentu w każdej turze;
- jedna funkcja ma zasilać wskaźnik UI i blokadę przed requestem;
- nie narzucać sztucznego limitu `4096`, jeżeli użytkownik i model dopuszczają więcej.

### 4.5. Ostrożna polityka retry

- nie ponawiać automatycznie `400`, `401`, `403`, `404`, błędów walidacji i nieobsługiwanego modelu;
- respektować `Retry-After` dla `429` z niskim, jawnym limitem prób;
- dla `5xx`, timeoutu i zerwanego streamu rozróżniać błąd przed wysłaniem od niepewnego wyniku po wysłaniu;
- gdy ponowienie może oznaczać drugi koszt, wymagać świadomej zgody użytkownika, chyba że provider daje bezpieczny klucz idempotencyjny;
- zapisywać liczbę prób, przyczynę, czas i request ID;
- koszt retry musi być widoczny w metadanych i podsumowaniu.

### 4.6. Pełniejsze metadane sesji i wywołań

Zachować istniejące metadane i uzupełnić, gdy provider rzeczywiście zwraca dane:

- commit SHA builda;
- rzeczywisty model zwrócony przez API;
- request ID każdego wywołania;
- reasoning rzeczywiście wysłany po mapowaniu;
- tokeny wejściowe, wyjściowe i reasoning z oznaczeniem `reported` albo `estimated`;
- snapshot ceny, źródło i czas pobrania;
- liczba retry i przyczyna;
- brak danych zapisywać jako `unavailable`, a nie wymyślać wartości.

### 4.7. Dependabot

Dodać `.github/dependabot.yml` dla cotygodniowych aktualizacji:

- npm w `/`;
- Cargo w `/src-tauri`;
- GitHub Actions w `/`.

Aktualizacje mają trafiać jako Pull Requesty i przechodzić CI. Nie łączyć automatycznie dużych wersji ani zmian bezpieczeństwa bez przeglądu.

### 4.8. CodeQL

Włączyć analizę dla:

- JavaScript/TypeScript;
- Rust;
- GitHub Actions, jeżeli bieżąca konfiguracja repozytorium udostępnia tę analizę.

Uruchamiać dla Pull Requestów, zmian na `main` i cyklicznie. Pierwsze alerty wymagają oceny, a nie bezrefleksyjnego ignorowania lub automatycznego blokowania bez analizy.

## 5. Zakres warunkowy

### 5.1. Oficjalne wydanie Linux

Windows pozostaje platformą główną. Linux może wejść do `0.7.9` tylko po:

- zbudowaniu AppImage i `.deb`;
- przetestowaniu obu pakietów na prawdziwym systemie Linux;
- potwierdzeniu dialogów, SQLite, keyringu, eksportu, backupu i providerów;
- objęciu opublikowanych pakietów attestation;
- dodaniu jasnej informacji o statusie wsparcia.

Samo uruchamianie CI na Ubuntu nie jest oficjalnym wydaniem Linux.

### 5.2. Blackbox

Nie wdrażać integracji wyłącznie na podstawie Blackbox CLI.

Warunki:

- potwierdzone publiczne i udokumentowane API odpowiednie dla aplikacji użytkownika;
- jasny model uwierzytelniania, endpointy, limity, modele i błędy;
- test kontraktowy na lokalnym symulatorze;
- test terenowy na koncie użytkownika;
- brak oficjalnego API oznacza pozostawienie Blackbox poza wydaniem.

## 6. Większe porządki zachowane na później

Te elementy pozostają zapisane, ale nie są automatycznym warunkiem publikacji `0.7.9`.

### 6.1. Podział dużego frontendu i code splitting

`src/App.tsx` ma obecnie około 2837 linii, a `src/styles/app.css` około 1343 linii. Stopniowo wydzielać Settings, Research, biblioteki i modale do osobnych komponentów oraz używać dynamicznego importu dla rzadziej otwieranych ekranów. Nie wykonywać jednego dużego refaktoru tuż przed publikacją.

### 6.2. Dostępność modali i ikon

- `aria-label` dla wszystkich przycisków ikonowych;
- `aria-labelledby` dla modali;
- Escape, focus trap i powrót fokusu;
- pełny przepływ klawiaturą;
- sprawdzenie czytnikiem ekranu najważniejszych formularzy.

### 6.3. Ograniczenie powierzchni SQL w WebView

Docelowo ograniczyć `sql:allow-execute` i przenieść najbardziej wrażliwe operacje do typowanych komend Rust lub bezpiecznej allowlisty. Nie wykonywać pospiesznej zmiany architektury bez testu migracji i wydajności.

### 6.4. Porządek zasobów i automatyczny manifest

- dodać `*.openai-download-*` do `.gitignore`;
- plików tego typu nie ma w kompletnej paczce `0.7.8`, więc nie trzeba usuwać ich z nowej bazy źródłowej;
- generować manifest Built-in Library z nazwy, typu, rozmiaru i SHA dokładnych bajtów;
- testem porównywać manifest z zasobami rzeczywiście spakowanymi do aplikacji;
- objąć tym mechanizmem cztery nowe dokumenty, protokoły i prompty.

## 7. Świadomie odłożone poza 0.7.9

- macOS;
- Tauri Updater i podpisane aktualizacje z aplikacji;
- Authenticode;
- SBOM;
- pełne automatyczne testy prawdziwego okna aplikacji;
- szyfrowanie lokalnej bazy;
- kolorowe, strukturalne szkice wektorowe generowane z walidowanych instrukcji modelu.

Attestation jest obowiązkowa dla `0.7.9` mimo odłożenia Authenticode. Są to różne mechanizmy: attestation potwierdza pochodzenie artefaktu z GitHub Actions, a Authenticode buduje zaufanie wydawcy w Windows.

## 8. Zalecana kolejność wdrożenia

1. Utworzyć gałąź `release/0.7.9` z kompletnego źródła `0.7.8`.
2. Wygenerować i zapisać `Cargo.lock`; usunąć automatyczny commit/push z workflow.
3. Przypiąć GitHub Actions do pełnych SHA i dodać attestation.
4. Dodać automatyczny backup przed migracją oraz logiczną walidację restore.
5. Usunąć formalny status Manual RV.
6. Wdrożyć wspólny max output i wskaźnik input/context.
7. Poprawić typografię.
8. Wdrożyć Tauri Dialog plugin.
9. Dodać dokumenty, parsery PDF/DOCX, wspólny spinacz i zabezpieczenia źródeł.
10. Utwardzić klienta HTTP, diagnostykę, obrazy i retry.
11. Dodać testy kontraktowe providerów.
12. Uzupełnić metadane, Dependabot i CodeQL zgodnie z decyzją o zakresie.
13. Wykonać pełne testy, zbudować Draft Release i zweryfikować attestation.
14. Przetestować aktualizację istniejącej instalacji i oba instalatory Windows.
15. Dopiero wtedy opublikować niezmienne wydanie.

## 9. Warunki utworzenia Draft Release 0.7.9

1. Wszystkie obowiązkowe pozycje mają kod, test i wynik weryfikacji.
2. `package.json`, `package-lock.json`, `src/version.ts`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` i User-Agent wskazują `0.7.9` bez ręcznego duplikowania wersji tam, gdzie można użyć metadanych builda.
3. `src-tauri/Cargo.lock` znajduje się w repozytorium i build używa `--locked`.
4. Żaden workflow nie wykonuje automatycznego commita ani `git push` do `main`.
5. Wszystkie zewnętrzne akcje są przypięte do pełnych SHA.
6. TypeScript i produkcyjny build Vite przechodzą.
7. Wszystkie testy Vitest przechodzą.
8. `cargo test --all-targets --locked` przechodzi.
9. `cargo clippy --all-targets --locked` przechodzi bez niezaakceptowanych ostrzeżeń.
10. Testy kontraktowe zmienionych adapterów przechodzą.
11. Testy negatywne PDF/DOCX i obrazów przechodzą.
12. Test starych wątków Manual RV zapisanych jako BLIND/REVEALED przechodzi.
13. Test output/context dla modeli o różnych limitach przechodzi.
14. Test aktualizacji z ostatniej publicznej wersji przechodzi bez utraty danych.
15. Test kontrolowanej awarii migracji zachowuje bazę źródłową i backup.
16. Windows release build tworzy oczekiwane `.exe` i `.msi`.
17. Krok attestation obejmuje wszystkie przeznaczone do publikacji artefakty i nie jest ignorowany przy błędzie.
18. Draft pozostaje nieopublikowany do zakończenia testów instalatorów.

## 10. Warunki publikacji 0.7.9

1. Pobrać artefakty z Draft Release.
2. Zweryfikować SHA-256 oraz `gh attestation verify` dla `.exe`, `.msi` i każdego dodatkowego assetu objętego provenance.
3. Przetestować instalację oraz uruchomienie `.exe` i `.msi` na Windows.
4. Przetestować aktualizację istniejącej instalacji.
5. Potwierdzić automatyczny backup przed migracją i integralność danych po aktualizacji.
6. Potwierdzić, że okno konsoli nie pojawia się w produkcyjnym Windows.
7. Potwierdzić czytelność interfejsu na wymaganych rozdzielczościach i skalowaniu.
8. Potwierdzić działanie dokumentów, Built-in Library Save i Manual RV.
9. Potwierdzić włączenie Release Immutability.
10. Opublikować Release dopiero po powodzeniu wszystkich wcześniejszych kroków.
11. Po publikacji wykonać `gh release verify` i `gh release verify-asset`.
12. Potwierdzić oznaczenie wydania jako `Immutable`.

## 11. Definicja zakończenia

Wydanie `0.7.9` jest zakończone dopiero wtedy, gdy:

- kod realizuje obowiązkowy zakres;
- pełne testy frontendowe i Rust przechodzą;
- aktualizacja istniejącej instalacji nie traci danych;
- artefakty są zbudowane z niezmiennego, sprawdzonego źródła;
- każdy publikowany instalator posiada weryfikowalną GitHub Artifact Attestation;
- Release jest niezmienny po publikacji;
- dokumentacja wyjaśnia użytkownikowi sposób weryfikacji;
- wynik testów i ograniczenia platform są jawnie zapisane.
