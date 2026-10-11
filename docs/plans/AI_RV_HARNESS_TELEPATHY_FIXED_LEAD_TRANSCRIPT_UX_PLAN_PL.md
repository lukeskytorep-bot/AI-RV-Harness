# AI RV Harness — telepatia: stały prowadzący, pełny zapis rozmów i spójny ekran

**Instrukcja implementacji dla innego AI · wersja 1.1 · 11 października 2026**

Stan dokumentu: plan przygotowany na podstawie kodu. Nie jest raportem z wykonania zmian. Wszystkie punkty odbioru poniżej trzeba dopiero zrealizować i sprawdzić. Ustalenia użytkownika są wymaganiami; proponowane nazwy nowych typów i komponentów są wskazówkami implementacyjnymi.

## 1. Cel i właściwa baza

Użytkownik chce uporządkować telepatię w **AI Training (AI–AI)** i **Conversation (człowiek–AI)**, a następnie zastąpić rotację nadawców jednym prowadzącym wybieranym na całą serię. Prowadzący tworzy cel, widzi odpowiedzi uczestników i decyduje o maksymalnie trzech dodatkowych cyklach pytań. Zapis rozmowy musi pokazywać pytania, przekazane materiały, odpowiedzi i refleksje, wyraźnie oddzielając uczestników.

Pracuj na zaakceptowanej linii **ai-rv-2 po Viewer Output Safety i Training History UX**, z zielonym CI oraz poprawką zależności testów DOM. Nie używaj automatycznie dołączanych `AI-RV-Harness-main.zip` ani `AI_RV_Harness_v0.7.13_WIKI_RELEASE_SYNC_1.zip` jako podstawy.

Baza sprawdzona do tego planu:

`AI_RV_Harness_v0.7.14_FULL_THROUGH_TRAINING_HISTORY_UX_DOCUMENTATION_CURRENT.zip`

SHA-256: `3eb73286d63c6725c87736e761112a99adbaa12ef6e6cee759cd51439d5f8283`.

W tej bazie `package.json` ma wersję **0.7.13**, a schema bazy wynosi **031**. Nazwa paczki 0.7.14 nie oznacza, że wolno samodzielnie zmienić wersję aplikacji. Jeśli dostaniesz nowszą zaakceptowaną bazę, wykonaj porównanie i zachowaj jej poprawki; zapisz dokładną podstawę w raporcie.

Nie przebudowuj zwykłego RV Training, RV Sessions, Research ani ogólnej Conversation. Z tych ekranów pobieramy sprawdzone wzorce wyglądu i metryk. Zmiany zachowania dotyczą dwóch powierzchni **telepatycznych**.

## 2. Co już potwierdzono w aktualnym kodzie

| Obszar | Stan zastany i wynik dla implementacji |
| --- | --- |
| Pomoc telepatycznego Training | `TrainingScreen.tsx` już przekazuje `ModuleHelpButton` jako `PageHeader.action`, a panel pomocy używa `ModuleHelpPanel`. Nie dodawaj drugiego przycisku ani nie przenoś go ponownie. Sprawdź rzeczywisty układ i zaktualizuj treść pomocy do nowego przebiegu. |
| Historia telepatycznego Training | `TelepathicTrainingPanel.tsx` renderuje „Zapisane treningi telepatyczne” jako sekcję w głównej zawartości. Nie korzysta z prawego, zwijanego panelu zwykłego Training. |
| Rotacja | Training tworzy `senderPolicy: { kind: "rotate" }`. Conversation pozwala wybrać `rotate`, `human_only`, `fixed_ai`. Planner potrafi już przypisać stałego AI lub człowieka. |
| Przebieg odbiorcy | `ensureBlind()` w `engine.ts` wykonuje pierwszy opis i automatyczne drugie spojrzenie. Nie ma jeszcze trzech cykli pytań decydowanych przez wspólnego prowadzącego. |
| Refleksje | Refleksje po Reveal są częścią silnika. Osobne refleksje całej serii wywołują przyciski w obu panelach. Użytkownik chce automatyzacji również tego końcowego etapu. |
| Niepewne wywołania | Training pokazuje panel tylko przy `unresolved.length > 0`. Nie jest on bezwarunkową dekoracją. To rzeczywista ochrona przed ponownym wysłaniem wywołania o nieznanym wyniku. |
| Preflight | Oba panele mają widoczny preflight konfiguracji i kosztowe szacunki. Training ma pauzę po bieżącej rundzie; to nie jest żądany natychmiastowy Stop. |
| Transkrypcja | Training renderuje głównie `blind.first`, `blind.second`, refleksję i komentarz po wymianie. Nie daje pełnej chronologii wejść. Kolejność kart wynika z tablicy uczestników, a nie z gwarancji „prowadzący pierwszy”. |
| Trwałość | Browser zapisuje stan JSON, ale SQLite rozkłada go na osobne tabele. Dodanie pól TS bez zmiany odczytu/zapisu SQLite oznacza utratę nowych danych po restarcie. |
| Koszty | Gateway otrzymuje `ProviderChatResponse.usage`, ale obecny `TelepathicProviderCallRecord` nie przechowuje usage ani czasu. W RV helper `withEstimatedCost()` stosuje wycenę z katalogu, gdy provider nie zwróci kosztu. Nie wolno nazwać wszystkich obecnych wartości kosztami potwierdzonymi przez dostawcę. |
| Viewer Learning | Telepatyczny Training zamraża własne Field Guide i Viewer Notes uczestników, wyłącznie do odczytu. Conversation nie ma identycznego podłączenia tych snapshotów. |

Zrzuty ekranu nie były dostępne lokalnie podczas sporządzania planu. Ustalenia techniczne pochodzą z kodu; finalny wygląd wymaga uruchomienia UI.

## 3. Mapa plików — od czego zacząć

Ścieżki w tabeli są względne względem katalogu głównego źródeł.

| Pliki istniejące | Odpowiedzialność |
| --- | --- |
| `src/features/training/TrainingScreen.tsx` | Nagłówek pomocy, przełącznik trybów, wzorzec prawej historii, trzy ikony i działający tooltip zwykłego Training. |
| `src/features/training/TrainingScreen.dom.test.tsx` | Wzorzec rzeczywistych testów montowanego ekranu; baza ma już jsdom w devDependencies. |
| `src/features/training/TelepathicTrainingPanel.tsx` | Konfiguracja, start/kontynuacja, historia, preflight, recovery, przycisk refleksji i zapis rund. |
| `src/features/conversations/TelepathicExchangePanel.tsx` | Analogiczna powierzchnia człowiek–AI, formularze ludzkich działań i końcowych refleksji. |
| `src/telepathicExchange/types.ts`, `planner.ts`, `target.ts`, `blind.ts` | Kontrakty, przypisanie prowadzącego, zamrożenie celu, granica zamknięcia zapisu blind. |
| `src/telepathicExchange/engine.ts` | Wywołania etapów, replay, blokada uncertain, Reveal, refleksje i zgoda na wymianę. |
| `src/telepathicExchange/packets.ts`, `prompts.ts` | Jawne pakiety wejściowe z ograniczeniem kontekstu do serii/rundy/uczestnika. |
| `src/telepathicExchange/providerGateway.ts` | Sprawdzenie trasy i tożsamości, zapis prepared/dispatched/succeeded/failed/uncertain, wywołanie providera. |
| `src/telepathicExchange/training.ts`, `trainingLearning.ts` | Tworzenie treningu i zamrażanie własnych materiałów uczestników. |
| `src/telepathicExchange/conversationView.ts` | Bezpieczna projekcja dla ludzkiego uczestnika: przed Reveal ukrywa cel i cudze odpowiedzi, gdy człowiek jest odbiorcą. |
| `src/telepathicExchange/preflight.ts`, `trainingPreflight.ts`, `conversationPreflight.ts` | Oddzielić szacunki kosztowe od potrzebnej walidacji technicznej. |
| `src/telepathicExchange/store.ts`, `src/storage/contracts/telepathicExchangeRepository.ts` | Trwały stan i lease. |
| `src/storage/browser/telepathicExchangeRepository.ts`, `src/storage/sqlite/telepathicExchangeRepository.ts` | Obie implementacje zapisu; wymagane round-trip nowych danych. |
| `src-tauri/migrations/028_telepathic_exchange_series.sql`, `029_telepathic_series_run_lease.sql` | Istniejące tabele i ograniczenia. Nie zmieniać tych migracji. |
| `src-tauri/src/database.rs`, `src/storage/databaseNative.ts` | Nazwane operacje zapisu i native fenced transaction. Zmiany SQL muszą być zgodne po obu stronach. |
| `src/monitor/prompt.ts`, `src/resources/systemPrompts.ts` | Źródło wiedzy o roli Monitora; potrzebna adaptacja do prowadzącego znającego cel. |
| `src/sessions/metrics.ts`, `src/sessions/costGuard.ts`, `src/providers/types.ts` | Zliczanie usage i czasów, odróżnienie zgłoszonego kosztu od estymacji. `costGuard.ts` obecnie zawiera tylko helper wyceny — nie przywracać dawnego limitu wydatków. |
| `src/components/ModuleHelp.tsx`, `SafeMarkdown.tsx` | Wspólna pomoc i bezpieczny Markdown. |
| `src/features/rvSessions/RvSessionPanel.tsx`, `RvSessionsScreen.tsx` | Wizualny wzorzec metryk i Stop. |
| `src/styles/training-research.css`, `conversations.css`, `monitor.css`, `app.css` | Aktywne style. `src/main.tsx` importuje `src/styles/app.css`, który importuje te arkusze. W katalogu `styles/` istnieje również kopia; nie poprawiaj wyłącznie nieimportowanej kopii. |
| `src/exports/session.ts`, `sessionDocument.ts`, `native.ts` | Wzorce zapisu dokumentów; telepatia wymaga własnej kompletnej projekcji eksportowej. |

Proponowane nowe, małe moduły: `leadGuidance.ts`, `transcript.ts`, `runtimeMetrics.ts`, wspólny komponent transkrypcji, wspólny panel historii telepatii. Nie twórz kolejnego wielkiego kontrolera zawierającego UI, promptowanie, SQL i routing.

## 4. Wymagania bez negocjowania zakresu

1. Jeden prowadzący wybierany **przed startem**, stały przez całą serię, bez losowania i rotacji w nowych seriach.
2. W AI–AI prowadzącym jest wybrany AI; w człowiek–AI może nim być człowiek albo AI. Zachować istniejące ograniczenia liczby uczestników.
3. Każda runda nadal ma własny cel. Prowadzący tworzy go przed blind, następnie cel zostaje trwale zamrożony. Jeden prowadzący przez pięć rund nie oznacza jednego wspólnego celu dla pięciu rund.
4. Prowadzący decyduje o pytaniach, ich adresatach i wcześniejszym zakończeniu udziału odbiorcy. Harness wykonuje i zapisuje decyzje.
5. Maksymalnie **trzy dodatkowe cykle prowadzenia na rundę**, po początkowych odpowiedziach. Zero, jeden lub dwa też są poprawne.
6. Refleksje AI po Reveal oraz końcowe refleksje AI całej serii są automatycznymi etapami. Zgoda na cudze wypowiedzi pozostaje osobnym wyborem.
7. Nie dodawać przycisku „wykonaj końcową refleksję”, wymaganego do zwykłego ukończenia. Wyjątkowe recovery ma własne akcje.
8. Usunąć widoczny kosztowy preflight; dodać metryki faktycznych wywołań i Stop. Nie dodawać finansowego blokera ani nowego mechanizmu autoryzacji kosztu.
9. Historia telepatycznego Training po prawej, domyślnie otwarta, zwijana, z fontem i trzema ikonami jak w zwykłym Training. Zachować spójny wzorzec historii w telepatycznej Conversation.
10. Czytelny zapis według uczestników: prowadzący pierwszy, potem pozostali w stałej kolejności. Pokazać zarówno otrzymane informacje, jak i odpowiedzi.
11. Trwała nawigacja do sekcji uczestników i mały powrót do listy uczestników.
12. Zachować Resume, ochronę niepewnych wywołań, zamrożenie tras/tożsamości, lease i granicę blind/Reveal. Nie naprawiać UI kosztem tych mechanizmów.
13. Twórca celu otrzymuje dodatkowo losowo wybrany obszar geograficzny dla każdej rundy. Odbiorcy przed Reveal nie otrzymują tego obszaru — najwyżej samą kategorię, gdy włączono ujawnianie tematu.

Nie dodawać selektorów Workspace, nowych profili ustawień kosztowych ani dodatkowych widoków niezwiązanych z tym planem.

## 5. Nowy przebieg jednej rundy

### 5.1. Zamrożenie serii

Nowa konfiguracja ma stałe `senderPolicy: fixed_ai` lub `human_only`. Pole wyboru prowadzącego wykorzystuje wybranych uczestników, a nie niezależny model nieobecny w serii. Planner nadaje tego samego `senderParticipantId` każdej rundzie.

Zamrozić: uczestników i ich kolejność, prowadzącego, trasy i tożsamości, własne materiały Field Guide/Viewer Notes, wersję instrukcji prowadzenia, język i maksymalną liczbę cykli równą 3. Dodać także zapisane losowe przypisania geografii celów według punktu 5.2a. Zmiany profilu w tle nie mogą przepisać już uruchomionej serii.

Dla nowych serii dodać znacznik wersji przebiegu, np. `protocolVersion: "fixed_lead_v1"`. Brak znacznika oznacza istniejący przebieg legacy. Nie zamieniaj po cichu starych rotujących serii na nowe.

### 5.2. Cel i początkowe odpowiedzi

Prowadzący przygotowuje cel. Człowiek wprowadza go swoim istniejącym formularzem; AI robi to swoim pakietem. Zachować zamrożenie, hash i potwierdzenie gotowości przekazania. Dopiero potem odbiorcy dostają początkową instrukcję blind i tworzą własne opisy.

W nowym przebiegu nie wykonuj dotychczasowego bezwarunkowego `receiver_second` jako dodatkowego czwartego pogłębienia. Po pierwszych opisach kontrolę nad pogłębieniami przejmuje prowadzący. Legacy zachowuje poprzednią semantykę.

### 5.2a. Losowy obszar geograficzny wyłącznie dla twórcy celu

**Dopisek użytkownika z 11 października 2026.** Jeden z modeli powtarzał podobne lub identyczne cele, gdy w kolejnych rundach dostawał tę samą ogólną kategorię bez pamięci poprzednich rund. Dodaj proste urozmaicenie instrukcji tworzenia celu, wspólne dla telepatycznego Training i Conversation. Nie dodawaj nowego selektora ani przycisku na ekranie.

Harness losuje z jawnej, wersjonowanej puli obszar geograficzny, osobno dla każdej nowej rundy. Instrukcja twórcy łączy **kategorię + obszar**. Przykłady:

- „Przygotuj jeden cel: lokalizacja w Japonii”.
- „Przygotuj jeden cel: obiekt lub struktura w Afryce”.
- „Przygotuj jeden cel: wydarzenie w Ameryce Południowej”.
- „Przygotuj jeden cel: aktywność człowieka lub maszyny w Australii”.

Geografia jest ograniczeniem dla twórcy, nie gotowym celem. AI nadal sam wybiera konkretną lokalizację, obiekt, aktywność, wydarzenie lub osobę pasującą do obszaru. Polecenie nie ma wymuszać najbardziej znanego zabytku, stereotypu ani tej samej kategorii szczegółowej. Zachować wybraną przez użytkownika kategorię; dla `any` pozwolić wybrać dowolny cel powiązany z wylosowanym obszarem. Nie dopisuj niezgodnych kategorii ani nie generuj listy wielu celów zamiast jednego.

Początkowa pula powinna zawierać wskazane przez użytkownika obszary i kraje oraz kilka dodatkowych wysp. Przykładowa kompletna wersja startowa:

| Grupa wpisów | Wpisy |
| --- | --- |
| Kontynenty i większe obszary | Europa, Ameryka Północna, Ameryka Środkowa, Ameryka Południowa, Antarktyda, Arktyka, Afryka, Azja, Australia |
| Europa i kraje transkontynentalne | Rosja, Polska, Niemcy, Francja, Anglia, Włochy, Hiszpania, Norwegia, Grecja, Turcja |
| Azja i Bliski Wschód | Japonia, Chiny, Indie, Nepal, Pakistan, Afganistan, Arabia Saudyjska, Wietnam, Indonezja |
| Afryka | Republika Południowej Afryki, Egipt, Kenia, Nigeria, Maroko, Madagaskar |
| Ameryki | Meksyk, Brazylia, Chile, Argentyna, Stany Zjednoczone, Kanada, Peru |
| Wyspy i archipelagi | Islandia, Grenlandia, Hawaje, Wyspy Kanaryjskie, Galapagos, Nowa Zelandia, Fidżi |

Jest to **pula obszarów**, nie wykaz samych państw: Anglia, Arktyka czy Hawaje nie muszą być prezentowane jako osobne suwerenne państwa. Każdy wpis ma stabilny ID oraz etykiety PL/EN. Jednego obszaru nie duplikować pod różnymi nazwami, np. USA / Stany Zjednoczone; Madagaskar nie powinien wystąpić drugi raz tylko dlatego, że jest też wyspą. Obszary mogą się geograficznie nakładać, np. Azja i Japonia — to dopuszczalne, ale nie dowodzi niepowtarzalności celów.

Rekomendacja losowania: przetasowana pula bez powtórzeń **tego samego wpisu** w ramach serii, do jej wyczerpania; potem nowa permutacja, bez powtórzenia ostatniego wpisu na granicy dwóch permutacji. Użyć lokalnego źródła losowości, np. Web Crypto, i testowalnego interfejsu RNG. Nie pytać modelu, aby sam „losowo wybrał kraj”. Nie dodawać infrastruktury QRNG, nowego wywołania providera ani finansowego preflight.

Wybrane obszary najlepiej zapisać wraz z planem wszystkich rund przed pierwszym wywołaniem twórcy celu. Trwale zachować `areaId`, etykietę/pool version oraz przypisanie do rundy. Jeśli losowanie odbywa się dopiero przed konkretną rundą, wynik musi być zapisany pod lease **przed przygotowaniem/dispatch pakietu**. Restart, techniczny retry, length recovery oraz wznowienie po Stop używają tego samego obszaru. Nie losować ponownie przy renderze, odczycie historii ani automatycznej drugiej próbie. Po zamrożeniu celu nie zmieniać obszaru ani treści celu.

Przykładowe rozszerzenie przypisania nowej rundy (nazwa typu do dopasowania):

```ts
targetGeography?: {
  areaId: string;
  labelPl: string;
  labelEn: string;
  poolVersion: string;
};
```

W nowych seriach `fixed_lead_v1` obszar jest wymagany dla tworzenia celu. W starych seriach pole może nie istnieć: nie losuj go wstecz i nie udawaj, że był częścią historycznego promptu. Jeśli zapisujesz go w `plan_json`, sprawdź odczyt i zachowanie dodatkowych pól przypisania w obu repozytoriach; SQLite może odbudowywać przypisanie z tabeli rund. Samo zapisanie rozszerzonego JSON nie gwarantuje, że helper odczytu nie wyrzuci tego pola.

**Granica informacji:** twórca dostaje kategorię i obszar; odbiorca dostaje tylko kategorię, jeśli `discloseTopicToReceivers` jest włączone. Przykład: prowadzący dostaje „lokalizacja w Wietnamie”, uczestnicy wyłącznie „lokalizacja”. Gdy ujawnianie tematu jest wyłączone, odbiorcy nie dostają nawet kategorii. Zachować istniejący przełącznik; nie włączać go automatycznie. Nie wysyłać geography w pakiecie odbiorcy, instrukcjach guidance, statusie widocznym odbiorcy ani przedrevealowej projekcji transkrypcji. Człowiek prowadzący otrzymuje obszar przy tworzeniu celu, natomiast człowiek odbiorca nie może go zobaczyć przed Reveal. Po Reveal obszar i rzeczywista instrukcja tworzenia celu mogą wejść do pełnej historii i eksportu.

Zmienna wskazówka geograficzna **zmniejsza tendencję do powtarzania**, ale nie gwarantuje, że AI nigdy nie poda tego samego celu — obszary mogą się nakładać, a model może zignorować instrukcję. Nie obiecuj matematycznej unikalności, nie dodawaj bez uzgodnienia kolejnej pętli generowania celów ani automatycznej wymiany zamrożonego celu. Jeśli model jawnie nie spełni ograniczenia, zachować rzeczywistą odpowiedź i zgłosić problem zgodnie z walidacją celu, zamiast po cichu zmieniać wylosowany obszar.

### 5.3. Do trzech dodatkowych cykli prowadzenia

Prowadzący otrzymuje odpowiedzi wszystkich odbiorców z bieżącej rundy, wraz z ich identyfikatorami i dotychczasowymi pytaniami. Dla AI należy zbudować odrębny pakiet decyzyjny. Nie doklejaj przypadkowego globalnego transcriptu ani poprzednich rund.

Proponowany jawny kontrakt decyzji:

```ts
interface LeadGuidanceDecision {
  cycle: 1 | 2 | 3;
  finishRound: boolean;
  finishParticipantIds: string[];
  broadcast?: { recipientIds: string[]; instruction: string };
  individual?: { participantId: string; instruction: string }[];
}
```

To przykład formatu, nie gotowy istniejący typ. Walidacja musi wymagać istniejących aktywnych odbiorców, unikalnych adresatów i najwyżej jednej instrukcji na odbiorcę w cyklu. Broadcast może objąć wszystkich nadal aktywnych albo wskazaną podgrupę; nie łącz go z drugą instrukcją indywidualną dla tego samego odbiorcy. Decyzja musi jasno zakończyć rundę lub wskazać przynajmniej jedno dalsze działanie. Nieprawidłowy JSON nie daje kontrolerowi prawa wymyślania pytań.

Dla prowadzącego człowieka formularz pozwala wybrać adresatów, wysłać wspólną lub osobne krótkie instrukcje, zakończyć udział wskazanych odbiorców albo przejść do zamknięcia blind. Obowiązują te same limity i zapis, co dla AI. Nie wymagać od człowieka pisania JSON.

Cykl liczy się raz dla całej rundy. Przykład: prowadzący wysyła pytanie A i B w cyklu 1, kończy udział A, pyta B w cyklu 2, następnie kończy rundę. Nie zużywa się trzech obowiązkowych cykli dla każdego odbiorcy. Trzeci cykl jest ostatnim, nie początkiem kolejnej pętli.

Odbiorca otrzymuje własne wcześniejsze wypowiedzi i tylko skierowaną do niego instrukcję. Prowadzący dostaje nowe odpowiedzi przed kolejną decyzją. Odbiorca zakończony nie dostaje późniejszych pytań. Po zakończeniu lub cyklu 3 wszystkie opisy zostają zamknięte, a ich hash obejmuje również dodatkowe odpowiedzi.

**Dwa różne limity:** 3 cykle to kroki merytoryczne; 2 próby techniczne to recovery pojedynczego wywołania. Nigdy nie wpisuj liczby cykli do `providerAttemptCount`: obecna SQLite ogranicza to pole do 0–2. Każda decyzja i każda odpowiedź w cyklu ma osobny stabilny scope, np. `lead_guidance:cycle:2` i `receiver_guidance:cycle:2:recipient:<id>`.

### 5.4. Wiedza i bezpieczeństwo prowadzącego

Prowadzący AI ma własne Field Guide/Viewer Notes oraz instrukcje roli Monitora. Wykorzystaj fabryczne źródło Monitora, ale adaptuj je: obecny Monitor RV bywa ślepy względem celu, a prowadzący telepatię sam tworzy cel. Nie kopiuj sprzecznych instrukcji słowo w słowo.

Prowadzący ma dostawać neutralne wskazówki pomagające pogłębić opis, bez ujawniania celu przed Reveal. Zapisz osobno granicę dostępu do wiedzy i walidację odbiorców. Zwykły filtr słów lub prompt nie gwarantuje wykrycia każdego semantycznego przecieku; nie przedstawiaj go jako dowodu pełnej ochrony. Testuj znane jawne przecieki i oznacz ograniczenie w raporcie.

Nie przekazuj cudzych Field Guide/Viewer Notes. Dla Conversation dodaj jawne zamrażanie własnych materiałów AI, potrzebne do roli prowadzącego; nie pożyczaj historii zwykłej rozmowy. Nie włączaj automatycznie aktualizacji tych materiałów. Obecny telepatyczny Training ma tryb read-only i użytkownik nie zamówił tu nowej polityki zapisu do Viewer Learning.

### 5.5. Reveal, refleksje i wymiana

Po zamknięciu blind: Reveal → automatyczna własna refleksja każdego AI → pytanie o zgodę na zobaczenie wypowiedzi innych → udostępnienie tylko po zgodzie → komentarz po wymianie. Odpowiedź „nie” kończy ten etap dla odbiorcy i nie blokuje rundy.

Prowadzący otrzymuje komplet wypowiedzi i refleksji uczestników jako część swojej roli. Nie powinien musieć zgadzać się na materiały konieczne do prowadzenia. Jego kompletne podsumowanie po refleksjach odbiorców musi powstać, gdy te refleksje rzeczywiście już istnieją, a nie przed ich wykonaniem.

Człowiek nie staje się automatycznie AI: jego własna refleksja i zgoda nadal są ludzkimi czynnościami. Automatyzacja dotyczy wywołań AI. Nie omijaj ludzkiego formularza, aby doprowadzić serię do `completed`.

Po ostatniej rundzie silnik automatycznie przechodzi do końcowych refleksji AI całej serii. Zachować własny zakres danych odbiorcy; prowadzący ma pełny uprawniony pakiet. Oddzielić „wszystkie rundy ukończone” od „finalizacja serii zakończona”. Jeśli refleksja jest przerwana, Resume kontynuuje finalizację, nie zaczyna nowych rund.

Nie uruchamiaj modelu w `useEffect` tylko dlatego, że użytkownik otworzył historyczny rekord. Auto-finalizacja wynika z pracy silnika, a naprawa starej niepełnej serii jest jawnym Resume brakującego etapu. Zapobiec zagnieżdżeniu lease: obecne `runTelepathicFinalReflections()` samo zakłada blokadę; wydziel wewnętrzną funkcję albo wywołaj je po zwolnieniu poprzedniej blokady.

## 6. Trwały zapis — najpierw kontrakt, potem UI

### 6.1. Wymagane dane

Trwale przechowywać: decyzje i numer cyklu, adresatów i instrukcje, odpowiedzi, zakończenie odbiorców, aktualny etap, finalizację, zdarzenia transkrypcji, usage/czas wywołań oraz archiwizację. Każde zdarzenie ma stabilny ID, kolejność, serię/rundę, autora i adresatów. Każda próba modelu ma scope, fingerprint wejścia, stan dispatch, wynik i metryki.

Zapis decyzji prowadzącego musi poprzedzać wysłanie pytań. Zapis dyspozycji musi poprzedzać wywołanie providera. Zapis odpowiedzi musi poprzedzać przejście do następnego cyklu. Restart pomiędzy tymi punktami nie może wygenerować innej decyzji, ponownie rozesłać części pytań ani ominąć pozostałych odbiorców.

Przykładowe zdarzenie transkrypcji:

```ts
interface TelepathicTranscriptEvent {
  id: string;
  seriesId: string;
  roundId?: string;
  sequence: number;
  stage: string;
  kind: "instruction" | "materials" | "response" | "consent" | "reveal" | "reflection" | "notice";
  authorId: string; // participant ID albo controller
  recipientIds: string[];
  text: string;
  providerCallId?: string;
  cycle?: 1 | 2 | 3;
  attachmentRefs?: string[];
  createdAt: string;
}
```

Przygotowanie pakietu to nie dowód, że model go odebrał. Widok musi odróżniać przygotowano/wysłano/otrzymano odpowiedź/wynik niepewny. To samo dotyczy anulowanego requestu.

### 6.2. Szczególna uwaga na SQLite

Obecny `saveTelepathicSeries()` zapisuje `config_json` i `plan_json`, a pozostałe dane do tabel uczestników, rund, blind, refleksji i wywołań. Nowe pole na `TelepathicSeriesState` samo nie zostanie zapisane. Nie wkładaj zmiennego checkpointu lub transcriptu do zamrożonej konfiguracji tylko po to, aby ominąć zmianę storage.

Rekomendacja: rozszerzenie runtime w nowej tabeli, np. `telepathic_series_runtime`, z kluczem serii i wersjonowanym `record_json`, zawierającym nowe checkpointy, zdarzenia, metryki per call i znacznik archiwum. Dopuszczalne jest lepiej uzasadnione rozdzielenie tych danych na tabele, ale wymagania round-trip i transakcji są takie same.

W sprawdzonej bazie nie ma kolumn przechowujących te dane. **Nie narzucać fikcyjnej obietnicy „bez migracji”**. Jeśli wybierzesz nową tabelę, dodaj jedną nową migrację — następną po 031, w tej bazie 032 — z rejestrem, testami kompatybilności i backup/restore. Nie zmieniaj bajtów migracji 001–031. Przy nowszej bazie sprawdź kolejny wolny numer.

Zapis danych bazowych i runtime musi być jednym fenced transaction z aktualnym lease. Zaktualizuj nazwane operacje native i ich kontrakty; nie otwieraj surowej dowolnej powierzchni SQL. Przy odczycie starej serii brak rekordu runtime musi mieć bezpieczną wartość domyślną i nie zmieniać historii.

Archiwizacja nie może zostać cofnięta przez zapis starego obiektu silnika. Odczytać aktualny rekord, zastosować guard, zachować marker i sprawdzić konflikt. Analogicznie chronić zamrożoną tożsamość prowadzącego i zamknięte blind. Testować realną SQLite, nie tylko obiekt w pamięci.

### 6.3. Replay i recovery

Rozszerz istniejący ledger, nie zastępuj go przypadkową pętlą retry. Zachować istniejące 2 próby techniczne na jeden scope i brak trzeciej po restarcie. Guidance scopes zawierają cykl i odbiorcę, więc nie kolidują z pierwszym opisem ani inną rundą.

Replay używa zapisanego wyniku. Nie wysyła ponownie zaakceptowanej odpowiedzi, nie dolicza drugi raz jej usage i nie generuje ponownie eventów transkrypcji. Fingerprint obejmuje rzeczywiste wejście i istotne ustawienia; dawnych hashy nie reinterpretować bez reguły zgodności.

Sprawdź jawnie `finishReason` w gateway/engine: obecny telepatyczny gateway zapisuje `succeeded` po zwróceniu odpowiedzi, a engine korzysta z samego tekstu. Nie uznawaj `length`, `error`, pustego lub odmówionego wyniku za kompletną decyzję ani zakończony opis. Wykorzystaj zaakceptowaną politykę Viewer Output Safety dla właściwych odpowiedzi Viewer/receiver: 16K → 32K w granicach możliwości modelu, trwały drugi poziom, bez trzeciej automatycznej próby. Nie kopiuj 32K bez rozróżnienia do każdej małej decyzji JSON prowadzącego. Przypisz politykę do etapów i przetestuj ją; nie zmieniaj globalnych budżetów innych modułów.

Błędy pewne przed dispatch mogą podlegać istniejącemu retry. `dispatched/uncertain` blokuje automatyczne ponowienie. Wynik ucięty ma być zapisany jako niezaakceptowany materiał diagnostyczny, a nie sealed blind lub pełna refleksja. Wyczerpanie prób wymaga jawnego stanu problemu, nie pozornego sukcesu.

## 7. Pełna i czytelna transkrypcja

### 7.1. Układ

Zachować wybór rundy. W obrębie oglądanej rundy uczestnicy mają osobne sekcje: duży nagłówek **„Prowadzący — nazwa”**, następnie **„Uczestnik 2 — nazwa”** itd. Prowadzący zawsze pierwszy, pozostali według zamrożonej kolejności. Finalne refleksje serii mają równie jednoznaczny zakres, bez pomieszania z konkretną rundą.

W obrębie uczestnika zdarzenia są chronologiczne. Nagłówek powinien mieć wyraźny rozmiar/odstęp, ale nie nadpisywać wymagania zwykłego, niepogrubionego fontu nazw w bocznej historii. To różne zastosowania typografii.

Etykiety przy wiadomościach: od kogo, do kogo, jaki etap/cykl. Pokazać pytania kontrolera, instrukcje prowadzącego, materiały dostarczone w pakiecie, odpowiedzi, zgodę/odmowę wymiany, faktycznie przekazane cudze wypowiedzi, komentarze i refleksje. Broadcast pojawia się u prowadzącego z listą adresatów i u każdego adresata jako otrzymana wiadomość.

Przykład rzeczywistej zawartości sekcji odbiorcy: „Instrukcja od kontrolera” → „Twój pierwszy opis” → „Pytanie od prowadzącego · cykl 1” → „Twoja odpowiedź” → „Reveal” → „Twoja refleksja” → „Zgoda na wypowiedzi innych: tak” → „Otrzymane wypowiedzi” → „Komentarz po wymianie”.

Nie wymyślać tekstów promptów historycznych serii. Stary rekord z samą odpowiedzią może być pokazany z informacją „Treść wysłanego pytania nie została zapisana w tej wersji”. Rekonstrukcja dzisiejszym promptem mogłaby fałszywie sugerować, że taki właśnie prompt wysłano.

### 7.2. Co oznacza „nic nie ukrywamy”

Pokazujemy rzeczywisty zapis wymiany, nie tylko wygodne odpowiedzi. Nie oznacza to publikowania API key, credential fingerprint, prywatnej ścieżki dyskowej, surowego opaque continuation ani wewnętrznego rozumowania, którego dostawca nie udostępnił. Pokazywać treść instrukcji i materiałów faktycznie przekazanych modelowi, z bezpiecznymi referencjami załączników.

**Nie usunąć ochrony z `buildTelepathicConversationView()`.** Człowiek będący odbiorcą ogląda ten sam ekran w czasie blind; wyświetlenie sekcji prowadzącego z celem lub cudzych odpowiedzi zniszczy próbę. W tej sytuacji przed Reveal pokaż nawigację i bezpieczne statusy sekcji; pełną treść udostępnij po Reveal. Dla prowadzącego człowieka i obserwatora AI–AI można udostępnić dane zgodnie z ich rolą. Ukrycie musi być w projekcji danych, nie tylko w CSS.

Widok dla użytkownika po Reveal może zawierać pełny zapis. Nie oznacza to, że wszystkie te dane automatycznie trafiają do każdego AI: zgoda odbiorcy nadal kontroluje jego następny pakiet modelowy.

### 7.3. Nawigacja

Nad transkrypcją umieścić pasek uczestników: Prowadzący, następnie nazwy odbiorców. Tworzy się z zamrożonej listy po starcie, także gdy odpowiedzi jeszcze nie istnieją. Pozostaje po zatrzymaniu/zakończeniu i po otwarciu historycznego rekordu.

Każdy odnośnik prowadzi do stabilnego nagłówka sekcji. ID musi uwzględniać serię, rundę i participant ID; nie używać samej nazwy AI, bo nazwy mogą się powtarzać. Pasek może być sticky w obrębie scrollującego transcriptu, z zawijaniem lub przewijaniem poziomym przy wąskim oknie. Nie powinien zasłaniać nagłówka po skoku: zastosować odpowiedni `scroll-margin-top`.

Przy każdej sekcji mała strzałka z tooltipem i aria-label „Wróć do listy uczestników / Back to participants”. Przewija właściwy kontener, nie cały ekran przypadkowo. Obsłużyć klawiaturę, sensowny focus po skoku oraz `prefers-reduced-motion`.

### 7.4. Markdown i eksport

Każda wiadomość jest osobnym rekordem renderowanym przez sprawdzony `SafeMarkdown`. Nie sklejaj odpowiedzi wielu uczestników w jeden ciąg Markdown: niedomknięty fence jednego AI nie może połknąć kolejnej sekcji. Surowy fallback ma być lokalny dla wadliwego rekordu. Stream preview nie jest dowodem zaakceptowanej kompletnej odpowiedzi.

Eksport korzysta z tej samej projekcji zdarzeń i kolejności uczestników. Zawiera pytania, przekazane materiały, odpowiedzi i refleksje wszystkich rund; nie tylko ostatnią widoczną rundę. Bez credentiali, native tokenów ciągłości i nieprzeznaczonych do udostępnienia danych technicznych. Archiwizacja oraz ponowne otwarcie zachowują tę treść.

## 8. Historia, pomoc i akcje ekranowe

### 8.1. Historia telepatycznego Training

Prawa kolumna według wzorca zwykłego Training, domyślnie rozwinięta. Lokalny stan otwarcia; nie zapisuj go w DB/Profile/Settings. Po zwinięciu lista znika, główna zawartość dostaje miejsce, a mały przycisk rozwinięcia zostaje. Zwijanie nie zatrzymuje serii, nie kasuje wyboru rundy ani aktywnego rekordu.

Nazwy serii i identyfikatory sesji mają font zwykłego Training/RV:

```css
font: 11px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
font-weight: 400;
```

Pierwszy wiersz karty: nazwa/data oraz **trzy ikony**: Otwórz, Zapisz, Archiwizuj. Tooltip na hover i focus, aria-label PL/EN, `type="button"`, dostępny focus. Rozwiń istniejący dobry TooltipButton do wspólnego komponentu, jeśli to ułatwia współdzielenie; nie kopiuj uszkodzonego tooltipu ucinanego przez overflow.

Jeżeli karta potrzebuje Wznów albo innych akcji recovery, pozostają w osobnym wierszu poniżej. Nie wstawiać ich w górny rząd trzech ikon. CSS: grid/flex, `min-width: 0`, gap i zawijanie; bez ręcznych przesunięć przycisków. Mały toggle historii może zachować istniejące pozycjonowanie wzorca — zakaz sztucznych przesunięć dotyczy układu akcji kart, nie sprawdzonego toggle.

Zapis i archiwizacja muszą działać, nie być atrapami ikon. Repozytorium telepatii nie ma obecnie dedykowanej metody archiwizowania; dodać trwałą obsługę, ukrywanie z aktywnej listy i możliwość przywrócenia w zgodzie z istniejącym mechanizmem Archive and recovery. Nie używać `cancelled` jako synonimu `archived`. Archiwum zachowuje dane i nie uruchamia modelu. Chronić aktywną serię i szybkie kliknięcia.

Conversation używa tego samego wyglądu kart, tooltipów i transkrypcji; dopasować boczny panel do istniejącego układu Conversation tak, aby nie zagnieździć dwóch konkurujących prawych historii.

### 8.2. Pomoc

W Training lokalizacja już jest prawidłowo podłączona. Potwierdzić top-right header w UI i wspólny zielonkawy styl, ikonę modułu, focus i rozwijany panel pod nagłówkiem. Uaktualnić PL/EN: stały prowadzący, do 3 cykli, automatyczne refleksje, zgoda, Stop, realne metryki. Usunąć z pomocy opis rotacji i ręcznego wywoływania refleksji dla nowego przebiegu.

W Conversation zachować wspólny nagłówek Profil → Jak działa…, nie dodawać drugiego lokalnego przycisku „Jak działa” w telepatycznym panelu. Nie ruszać innych modułów bez znalezionego konkretnego błędu.

### 8.3. Panel niepewnego wywołania

Warunek wyświetlania: rzeczywista próba `dispatched/uncertain` wymagająca decyzji, nie zwykły status paused, pusta historia ani dowolny błąd. Usunąć samodzielne techniczne komunikaty bez czynności użytkownika.

Proponowana treść PL: „Nie udało się potwierdzić wyniku wysłanej wiadomości. Dostawca mógł już ją przetworzyć. Program nie wyśle jej ponownie bez Twojej decyzji.” Dalej nazwa uczestnika i etap w ludzkim języku, np. „Nemo · refleksja po ujawnieniu celu”. Techniczne ID, scope i numer próby można umieścić w rozwijanych szczegółach.

Zamiast niezrozumiałego „Uznaj za nieudaną” użyj „Zezwól na ponowienie / Allow retry”, wyjaśniając możliwość powtórnego kosztu. Decyzja zwalnia konkretną próbę, nie resetuje limitu 2 i nie oznacza, że poprzedni request na pewno zawiódł. Gdy limit jest wyczerpany, nie pokazuj obietnicy kolejnej próby, której engine nie wykona. Nie otwieraj ukończonych rund tylko dlatego, że niepewna jest końcowa refleksja.

## 9. Kosztowy preflight, metryki i Stop

### 9.1. Usunięcie preflight z produktu

Usunąć oba widoczne przyciski „Uruchom preflight” oraz karty zawierające przewidywany koszt serii. Start przeprowadza potrzebną walidację wewnętrznie: tożsamość, dostępność trasy, capabilities, wymagania obrazów i pojemność faktycznie przygotowanego pakietu. Techniczna walidacja nie może żądać zgody na przewidywane dolary ani zastępować się kolejnym przyciskiem.

Nie usuwać sprawdzenia kontekstu końcowej refleksji ani nie ucinać po cichu jej materiałów. Wskazać, które wyniki dotychczasowego preflight są wyłącznie kosztowe, a które naprawdę chronią poprawność requestu. Zachować tylko potrzebne techniczne kontrole w ścieżce startu/dispatch. Brak ceny modelu nie powinien blokować poprawnej serii.

### 9.2. Faktyczne metryki

Obok aktywnej serii pokazać Wywołania, Tokeny, Koszt, Czas, z wyglądem RV Sessions. Utrwalać per-call `usage`, czas, providerRequestId i pochodzenie ceny. Do sumy wchodzą również odrzucone próby, jeśli ich usage/koszt zostały dostarczone. Niepewny koszt ma być oznaczony jako niepełny, nie zero.

Koszt zgłoszony przez provider ma pierwszeństwo. Gdy go brak, wycena z katalogu jest tylko „szacunkowa”; lepiej pokazać brak potwierdzonego kosztu niż prezentować prognozę jako rachunek. Suma mieszana musi wskazywać, że część jest oszacowana lub nieznana. Nie dodawać reasoningTokens drugi raz do totalTokens ani zakładać, że każdy provider raportuje je rozłącznie.

Zliczaj requesty według trwałych prób, nie liczby renderów ani replay. Jeśli występują fizyczne retry w executorze, rozróżnij je od logicznego etapu i nie ukrywaj ich w liczniku. Nie twierdź, że „dispatched” dowodzi naliczenia opłaty — to tylko zarejestrowane wysłanie/ryzyko.

Czas bieżącej serii nie resetuje historii do zera po Resume. Wybierz jasno opisany czas aktywnego wykonywania, bez doliczania przerwy nocnej, i zachowaj go w rekordzie. Żadne metryki nie sterują limitem finansowym.

### 9.3. Stop

Przycisk „Zatrzymaj / Stop” obok metryk podczas aktywnego wykonywania. Zastąpienie samego `pauseRequested.current` jest konieczne: obecnie zatrzymuje on dopiero po rundzie.

Dodać sygnał anulowania użytkownika i połączyć go z sygnałem utraty lease. Nie zastępować jednego drugim. Sprawdzać Stop przed każdym dispatch, po zakończeniu await i przed uruchomieniem następnego etapu, odbiorcy, cyklu lub refleksji. Odłączyć event listenery i posprzątać kontrolery w finally.

Stop przerywa oczekiwanie na aktualne wywołanie, zatrzymuje dalsze wysyłanie i zapisuje checkpoint. Nie gwarantuje zatrzymania naliczania kosztu u zewnętrznego providera. Jeśli wywołanie zostało już wysłane i wynik jest nieznany, pozostaje uncertain; Resume wymaga jego rozstrzygnięcia. Jeśli wynik został już odebrany i trwale zapisany, nie zamieniaj go w fikcyjną porażkę.

Stop nie jest archiwizacją ani usunięciem, nie zmienia celu i nie kasuje udziału. Po zatrzymaniu użytkownik może wznowić od checkpointu. Nie rozsyłać automatycznie finalnych refleksji po kliknięciu Stop. Formy czekające na człowieka zachowują zapis; nie generować sztucznej odpowiedzi za niego.

## 10. Kolejność wykonania

1. Potwierdź bazę i zrób mapę istniejących ścieżek. W raporcie oznacz pomoc Training jako istniejącą, nie przypisuj sobie jej dodania.
2. Dodaj wersję przebiegu, kontrakty prowadzącego/cykli/transcriptu/metryk/finalizacji/archiwizacji oraz kompatybilność legacy.
3. Zrealizuj trwały zapis browser i SQLite, w tym przypisania geografii i wersji puli, migrację jeśli potrzebna, named writes i fenced transaction. Najpierw test round-trip, dopiero potem engine.
4. Dodaj stałego prowadzącego, losowanie obszaru wyłącznie dla twórcy celu, własne materiały i instrukcje Monitor, walidację decyzji oraz do 3 cykli. Użyj tego samego rdzenia dla obu trybów.
5. Rozszerz durable scopes/replay/recovery i klasyfikację niepełnych odpowiedzi. Testuj restart w środku rozsyłania pytań.
6. Dodaj automatyczne refleksje i finalizację, respektując ludzkie działania i zgodę na wymianę.
7. Dodaj trwałe metryki i Stop; usuń widoczny kosztowy preflight, pozostaw potrzebne walidatory.
8. Zbuduj wspólną transkrypcję i role-aware projekcję, eksport oraz nawigację do uczestników.
9. Ujednolić prawą historię, ikonki, tooltipy, font, recovery i pomoc PL/EN. Nie naruszać standardowego Training.
10. Wykonaj testy, gates i prawdziwy UI smoke; przygotuj jedną spójną paczkę do audytu. Jeśli praca jest dzielona na kroki, opisuj brakujące punkty wprost, nie oznaczaj całego planu jako ukończonego po samym UI.

## 11. Testy wymagane do odbioru

Testy muszą sprawdzać wynik działania, nie wyłącznie szukać tekstów w JSX. Nie usuwać istniejących testów retry/izolacji po to, aby nowy przebieg przeszedł.

| Grupa | Scenariusze obowiązkowe |
| --- | --- |
| Prowadzący | 5 rund z tym samym AI; człowiek jako stały prowadzący; AI prowadzący z człowiekiem odbiorcą; odrzucenie prowadzącego spoza serii; stare rotujące rekordy nadal czytelne i wznawialne po staremu. |
| Geografia celu | Różne wylosowane wpisy w kolejnych rundach; poprawne PL/EN dla regionów, krajów i wysp; lokalizacja/obiekt/pozostałe kategorie; powtórzenie dopiero po wyczerpaniu puli; zapis przed dispatch; retry/restart/Stop nie zmienia obszaru; round-trip SQLite zachowuje pole przypisania; legacy bez sztucznego dopisania. |
| Izolacja geografii | Twórca widzi kategorię + obszar; odbiorca z włączonym tematem tylko kategorię, z wyłączonym nie widzi obu; brak obszaru w pakietach, guidance i UI człowieka odbiorcy przed Reveal; po Reveal pełna historia/eksport; przegląd pytań prowadzącego pod kątem ujawniania obszaru. |
| Guidance | 0, 1, 2, 3 cykle; brak czwartego; broadcast i indywidualne adresaty; wcześniejsze zakończenie A z dalszym pytaniem do B; nieprawidłowe ID/duplikat/JSON; brak automatycznego pytania wymyślonego przez kontroler. |
| Izolacja | Odbiorca nie dostaje celu, cudzych odpowiedzi ani cudzych learning; prowadzący dostaje wszystkie odpowiedzi bieżącej rundy; człowiek odbiorca nie widzi ich w projekcji UI przed Reveal; po Reveal zapis jest pełny. |
| Restart | Przerwanie po decyzji prowadzącego, po dispatch do A, po zapisie A i przed B; replay nie ponawia A; numer cyklu i zamknięcie odbiorcy zachowane; drift wejścia blokowany; lease drugiego okna blokuje równoległe wykonanie. |
| Output safety | `length` nie zamyka blind; 16K → 32K na właściwym etapie; restart nie resetuje próby; po dwóch próbach brak trzeciej; `error`/empty/refusal nie są sukcesem; brak automatycznego retry uncertain. |
| Refleksje | Bez dodatkowego kliknięcia po rundzie i całej serii; Resume samej finalizacji; refleksje odbiorców dostępne prowadzącemu; odmowa wymiany nie blokuje; człowiek nie dostaje automatycznie wygenerowanej refleksji w swoim imieniu. |
| Metryki | Koszt provider, brak kosztu, oszacowanie, mieszana/niepełna suma; reasoning bez podwójnego liczenia; failed length z usage; uncertain z brakującym usage; restart i replay bez resetu/dublowania. |
| Stop | W trakcie requestu i między odbiorcami; brak następnego dispatch; brak refleksji po Stop; zapis wyniku odebranego przed Stop; uncertain po wysłanym anulowanym wywołaniu; sygnał lease nadal działa. |
| SQLite i browser | Nowe dane round-trip; stare rekordy bez rozszerzenia; atomowy zapis i zachowanie lease; archive/restore; backup/restore; archiwizacja nie cofnięta starym snapshotem; migracje historyczne byte-identical. |
| Transkrypcja | Prowadzący pierwszy mimo tablicy zaczynającej się odbiorcą; pytanie + odpowiedź; broadcast u właściwych adresatów; pełne otrzymane materiały; brak fałszywej rekonstrukcji legacy; eksport wszystkich rund. |
| Markdown | Niedomknięty fence u A nie psuje B; nagłówki modelu nie zastępują nagłówków uczestników; osobne rekordy; preview odróżnione od pełnego wyniku. |
| Mounted DOM | Prawy panel domyślnie otwarty; toggle zachowuje aktywną rundę; 3 ikony i tooltip hover/focus PL/EN; recovery w osobnym wierszu; nawigacja i powrót; Stop; brak preflight i przycisku generowania refleksji; conditional uncertain. |
| Regresja | Dotychczasowe Training Resume/End i DOM testy, ProfileSelector, ModuleHelp, Viewer Output Safety, zwykła Conversation/RV/Research bez zmiany zachowania. |

Uruchomić co najmniej:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run verify:architecture
npm run verify:ux-data
npm run verify:source
npm run verify:v0.7.14-release-gate
npm run verify:openrouter-continuation-bridge
```

Jeśli zmieniono native writes lub migrację, uruchomić również właściwy zestaw Rust oraz rzeczywiste testy SQLite zgodnie z workflow repozytorium. Po nowej migracji verifier UX powinien oczekiwać nowej liczby, a nie sztucznie wymuszać PASS „31”. Backup/restore i zgodność epoch muszą uwzględniać nowy aktualny schemat.

Baza zawiera `jsdom: 26.1.0` w devDependencies. Nie twierdzić, że testów montowanych nie da się napisać z powodu braku DOM runnera. Jeśli instalacja lokalnie nie działa, przygotować poprawne testy i zgłosić niewykonany check. „PASS” wymaga faktycznego uruchomienia; brak unhandled errors jest obowiązkowy.

UI smoke: szerokie okno oraz wąska historia około 330 px; zoom 125% i 150%; długie nazwy; sześciu AI; wiele rund; długie pytania i odpowiedzi; dark/light; obsługa klawiaturą; tooltip nieucięty przez scroll; sticky pasek niezasłaniający nagłówka; trzy ikonki nie nachodzą na Resume/recovery; Stop i otwarcie rekordu po restarcie. Nie zastępować realnego UI screenshotem makiety ani samym statycznym testem źródła.

## 12. Teksty PL/EN i końcowa lista odbioru

| PL | EN |
| --- | --- |
| Prowadzący | Lead |
| Wybierz prowadzącego | Select lead |
| Uczestnicy | Participants |
| Pytanie od prowadzącego | Instruction from lead |
| Instrukcja od kontrolera | Instruction from controller |
| Przekazane materiały | Supplied materials |
| Cykl 1 z maksymalnie 3 | Cycle 1 of up to 3 |
| Zakończ pytania do tego uczestnika | Finish guidance for this participant |
| Wróć do listy uczestników | Back to participants |
| Otwórz trening | Open training |
| Zapisz trening | Save training |
| Archiwizuj trening | Archive training |
| Zwiń historię / Rozwiń historię | Collapse history / Expand history |
| Zatrzymaj | Stop |
| Końcowe refleksje w toku | Final reflections in progress |
| Koszt zgłoszony przez dostawcę | Provider-reported cost |
| Koszt szacunkowy | Estimated cost |
| Koszt niepełny / niedostępny | Cost incomplete / unavailable |
| Zezwól na ponowienie | Allow retry |

Przy oddawaniu paczki sprawdź wszystkie poniższe punkty:

- [ ] Właściwa zaakceptowana baza i zachowanie późniejszych poprawek.
- [ ] Stały prowadzący w obu trybach, wersjonowana kompatybilność legacy.
- [ ] Zapisany losowy obszar każdej nowej rundy, wyłącznie dla twórcy celu; brak zmiany przy retry/Resume i brak przecieku do odbiorców.
- [ ] Własne learning i instrukcja Monitora prowadzącego; brak nowej polityki zapisu learning.
- [ ] Do 3 opcjonalnych cykli, osobni odbiorcy, trwałe pytania/odpowiedzi.
- [ ] Brak przecieku celu/cudzych odpowiedzi do blind odbiorcy i jego UI.
- [ ] Automatyczne refleksje AI oraz finalizacja, bez przycisku jako warunku ukończenia.
- [ ] Replay/Resume/uncertain/lease i właściwa obsługa length zachowane.
- [ ] Trwały zapis SQLite, nie tylko TS/browser; uzasadniona nowa migracja, jeśli użyta.
- [ ] Prawa historia, 3 działające ikony, archive/restore, tooltip i właściwy font.
- [ ] Prowadzący pierwszy, pełne wejścia/wyjścia, bezpieczny Markdown, kompletny eksport.
- [ ] Nawigacja do uczestników i powrót działają też dla zapisanego rekordu.
- [ ] Widoczny kosztowy preflight usunięty, techniczne walidatory zachowane.
- [ ] Trwałe, uczciwie opisane metryki i działający Stop.
- [ ] Pomoc we wspólnym nagłówku, teksty PL/EN zgodne z nowym działaniem.
- [ ] Testy DOM, domeny i storage faktycznie uruchomione, brak unhandled errors.
- [ ] Realny UI smoke wykonany lub wyraźnie pozostawiony do wykonania.

Dostarcz ZIP zmienionych plików, manifest i sumy kontrolne, raport dokładnej bazy oraz wyniki kontroli. W raporcie oddziel: wykonane zmiany, istniejące wcześniej mechanizmy, testy PASS, testy niewykonane i pozostałe ograniczenia. Jeśli tworzysz pełną bazę, składaj ją z tej samej linii i wszystkich zaakceptowanych nakładek. Nie publikuj ani nie merge'uj samodzielnie — użytkownik wgrywa paczkę i zleca audyt.
