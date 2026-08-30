# AI RV Harness v0.7.11 — plan zgodności reasoning i naprawy AI Monitora

**Status:** plan techniczny przed implementacją  
**Planowane wydanie:** 0.7.11  
**Data:** 26 sierpnia 2026  
**Baza źródłowa:** publiczne 0.7.10, commit `95e25c8b3a89e399c796264db46a874be758418b` (`hotfix 0.7.10`)

## 1. Zasada wydania

Wersja 0.7.10 została już publicznie wydana i nie będzie po cichu zmieniana ani zastępowana. Naprawa obsługi modeli reasoning zostanie przygotowana jako nowe wydanie 0.7.11.

Prace nad 0.7.11 rozpoczną się wyłącznie z pełnej, uporządkowanej kopii opublikowanych źródeł 0.7.10. Kopia zawiera także aktualny `src-tauri/Cargo.lock` z publicznego repozytorium.

## 2. Potwierdzony problem

Niektóre modele reasoning, przede wszystkim testowane warianty DeepSeek V4 i NVIDIA Nemotron 3 Ultra, wykonują długą analizę przed wygenerowaniem odpowiedzi końcowej. Provider może zwrócić tę analizę i odpowiedź finalną w oddzielnych polach albo w jednym surowym strumieniu rozdzielonym znacznikami.

Obecna warstwa providera Harnessa nie posiada pełnego, wspólnego modelu odpowiedzi reasoning. Skutek jest szczególnie poważny w trybie AI Monitora:

1. Monitor otrzymuje pełny, rosnący transkrypt i długo analizuje stan sesji.
2. Jego analiza może trafić do zwykłego `content` albo odpowiedź może zakończyć się przed utworzeniem finalnego `content`.
3. Harness traktuje każdą niepustą wartość `content` jako polecenie Monitora.
4. Reasoning zostaje wysłany Viewerowi jak zwykła interwencja.
5. Viewer może wykonać instrukcję wspomnianą jedynie w rozważaniach Monitora.
6. Wewnętrzny kontroler nadal pozostaje przy swoim rzeczywistym kroku, co powoduje rozjazd numeracji, powtórzenie kroku i skażenie transkryptu.

Załączona sesja `RVH-8DE3ECD84E` pokazuje pełny łańcuch regresji: reasoning Monitora po kroku 7 został zapisany jako dokładne polecenie, Viewer przedwcześnie wykonał T8, nagłówki nadal wskazywały krok 7, a następnie prawidłowy krok 8 został wykonany ponownie.

## 3. Najważniejsza decyzja projektowa

Harness nie będzie oceniał ani cenzurował treści finalnej wypowiedzi Monitora.

Jeżeli prawidłowe pole finalne zawiera jedno zdanie, trzy zdania, listę albo dłuższą naturalną instrukcję, cała treść zostanie przekazana Viewerowi dokładnie tak, jak zwrócił ją Monitor.

Harness nie będzie:

- skracał poleceń Monitora;
- ograniczał liczby zdań;
- usuwał uzasadnień z finalnej wypowiedzi;
- oceniał stylu ani merytorycznej jakości polecenia;
- szukał zakazanych zwrotów w zwykłym tekście;
- przepisywał wypowiedzi Monitora na własny format;
- odrzucał odpowiedzi tylko dlatego, że są rozbudowane.

Naprawa polega na technicznym rozdzieleniu kanałów zwróconych przez model lub providera:

```text
reasoning / thinking  -> osobny zapis techniczny i opcjonalny podgląd
final content         -> pełna wypowiedź Monitora przekazana Viewerowi
```

Jedyną specjalną wartością sterującą pozostaje dokładne `CONTINUE_PROTOCOL`, ponieważ jest ona częścią istniejącego kontraktu AI Monitora.

## 4. Wzorce zaczerpnięte z projektów open source

Implementacja będzie wzorowana na sprawdzonych rozwiązaniach, bez dodawania ciężkiego zewnętrznego serwera lub proxy do aplikacji desktopowej:

- **LiteLLM:** adapter każdego providera i normalizacja do wspólnego formatu `content`, `reasoning_content`, `thinking_blocks`;
- **LibreChat:** konfigurowalne klucze odpowiedzi `reasoning` i `reasoning_content` dla endpointów OpenAI-compatible;
- **Open WebUI:** obsługa natywnych pól reasoning oraz konfigurowalnych par znaczników takich jak `<think>...</think>`;
- **Ollama:** jawne oddzielenie `message.thinking` od `message.content`;
- **vLLM i SGLang:** wyspecjalizowane parsery rodzin modeli, które rozdzielają surową generację na reasoning i final content;
- **Vercel AI SDK:** osobne części reasoning oraz rezerwowanie miejsca na reasoning i odpowiedź finalną tam, gdzie wymaga tego kontrakt providera.

Nie będziemy kopiować całych bibliotek ani wprowadzać Pythona/LiteLLM jako obowiązkowej warstwy uruchomieniowej. Zastosujemy ich architekturę normalizacji w istniejącym backendzie Rust i typach TypeScript Harnessa.

## 5. Docelowy wewnętrzny format odpowiedzi

`ProviderChatResponse` zostanie rozszerzony do formatu równoważnego:

```ts
interface ProviderChatResponse {
  content: string;
  reasoningContent?: string;
  reasoningDetails?: unknown[];
  reasoningSource?:
    | "reasoning"
    | "reasoning_content"
    | "reasoning_details"
    | "google_thought_part"
    | "anthropic_thinking_block"
    | "thinking_field"
    | "tagged_content";
  finishReason?: string;
  actualModel?: string;
  usage: ProviderUsage;
  providerRequestId?: string;
  debugPayload?: ProviderDebugPayload;
}
```

Pole `content` będzie zawsze oznaczać wyłącznie odpowiedź finalną. Reasoning nigdy nie będzie dopisywany do `content` tylko po to, aby zachować kompatybilność z dotychczasowym interfejsem.

## 6. Adaptery odpowiedzi providerów

### 6.1. OpenRouter i OpenAI-compatible

Parser sprawdzi niezależnie:

- `choices[0].message.content` — finalna odpowiedź;
- `choices[0].message.reasoning` — reasoning tekstowy;
- `choices[0].message.reasoning_content` — reasoning tekstowy używany między innymi przez DeepSeek i część serwerów vLLM/SGLang;
- `choices[0].message.reasoning_details` — ustrukturyzowane bloki reasoning OpenRouter;
- alternatywne tablice części tekstowych w `content`.

Pola reasoning zostaną zachowane osobno. Nie będą łączone z finalnym `content`.

### 6.2. Google Generative AI

Obecny parser łączy wszystkie tekstowe elementy `candidates[0].content.parts`. Zostanie to zmienione:

- część z `thought: true` trafi do `reasoningContent`;
- zwykłe części tekstowe trafią do finalnego `content`;
- `thoughtSignature` i pozostałe metadane nie zostaną pokazane jako odpowiedź;
- kolejność finalnych części tekstowych zostanie zachowana.

### 6.3. Anthropic

Obecne filtrowanie bloków `text` zostanie zachowane i rozszerzone:

- bloki `text` -> finalne `content`;
- bloki `thinking` -> reasoning;
- bloki `redacted_thinking` -> bezpieczna metainformacja bez ujawniania zaszyfrowanej treści;
- sygnatury bloków zostaną zachowane wyłącznie tam, gdzie są potrzebne do prawidłowego replay.

### 6.4. Ollama i niestandardowe endpointy

Jeżeli odpowiedź zawiera osobne pole `thinking`, zostanie ono potraktowane jako reasoning, a `content` pozostanie odpowiedzią finalną.

### 6.5. ZAI i DeepSeek

ZAI i DeepSeek korzystające z odpowiedzi OpenAI-compatible zostaną obsłużone przez wspólny adapter, ale testy będą posiadały osobne fixtures dla pól i zachowań rzeczywiście zwracanych przez te serwisy.

## 7. Awaryjne rozdzielanie znaczników reasoning

Parser znaczników będzie używany tylko wtedy, gdy reasoning nie został już prawidłowo oddzielony przez natywne pola API albo gdy znaczniki rzeczywiście znajdują się w zwykłym `content`.

Początkowy rejestr obejmie co najmniej:

```text
<think>...</think>
<thinking>...</thinking>
<reason>...</reason>
<reasoning>...</reasoning>
<thought>...</thought>
<|begin_of_thought|>...<|end_of_thought|>
```

Zasady:

- treść pomiędzy rozpoznaną parą trafi do reasoning;
- tekst po znaczniku końcowym trafi do finalnego `content`;
- nie będziemy rozpoznawać reasoning po stylu wypowiedzi, słowach „Wait”, „Let me think” ani podobnych heurystykach;
- jeżeli rozpoczęty blok reasoning nie ma końca i brak osobnego finalnego `content`, odpowiedź zostanie oznaczona jako niedokończona, a nie przekazana Viewerowi;
- jeżeli provider dostarczył prawidłowe osobne pola, mają one pierwszeństwo przed parserem znaczników.

## 8. Budżet reasoning i finalnej odpowiedzi Monitora

Sztywne ograniczenie AI Monitora do 800 tokenów zostanie usunięte.

Nowa polityka nie będzie wyłączała reasoning. Będzie uwzględniała sposób liczenia tokenów przez konkretny model i provider.

### 8.1. Provider z osobnym budżetem reasoning

Jeżeli provider pozwala podać oddzielny budżet thinking/reasoning:

- poziom reasoning zostanie przetłumaczony na natywny parametr providera;
- całkowity limit zostanie ustawiony tak, aby po reasoning pozostało miejsce na finalną wypowiedź;
- finalna wypowiedź Monitora otrzyma własną rezerwę, bez ograniczania liczby zdań przez aplikację.

### 8.2. Provider ze wspólnym `max_tokens`

Jeżeli reasoning i finalna odpowiedź dzielą jeden limit:

- pierwsze wywołanie Monitora otrzyma bezpieczny limit całkowity większy niż 800;
- wartość zostanie ograniczona rzeczywistym maksimum modelu;
- poziom reasoning i typ transportu z rejestru modeli zostaną zachowane;
- limit jest maksymalnym pułapem, a nie poleceniem wykorzystania wszystkich tokenów.

Początkowa implementacja zostanie skalibrowana testami dla 4096 i 8192 tokenów. Ostateczna wartość nie zostanie wpisana na sztywno bez testów rzeczywistych tras DeepSeek i NVIDIA.

### 8.3. Kontrolowana próba odzyskania

Jeżeli odpowiedź zawiera reasoning, lecz nie zawiera finalnego `content`, albo zakończyła się z `finish_reason` wskazującym wyczerpanie limitu:

1. nie zostanie wysłana Viewerowi;
2. reasoning zostanie zachowany w diagnostyce;
3. Harness wykona najwyżej jedną kontrolowaną próbę z większym dozwolonym budżetem;
4. druga odpowiedź zostanie przetworzona od początku przez ten sam normalizator;
5. jeżeli nadal brak finalnego `content`, sesja zatrzyma się bez utraty transkryptu i będzie mogła użyć istniejącego przycisku `Kontynuuj`.

Nie będzie automatycznego przełączania modelu ani wyłączania reasoning.

## 9. Wykorzystanie odpowiedzi przez AI Monitora

Po normalizacji zachowanie będzie proste:

```text
content == "CONTINUE_PROTOCOL" -> kontroler przechodzi dalej
content jest niepuste          -> całe content trafia do Viewera
content jest puste             -> brak finalnej odpowiedzi, retry lub bezpieczne zatrzymanie
```

Nie będzie semantycznego filtra polecenia. Trzy lub więcej zdań zostanie przekazane w całości.

## 10. Przechowywanie i wyświetlanie reasoning

### 10.1. Sealed transcript

Reasoning Monitora ani Viewera nie będzie częścią zapieczętowanego transkryptu sesji. Sealed transcript zachowa dokładne instrukcje kontrolera, finalne wypowiedzi modeli i odpowiedzi Viewera.

### 10.2. Dane diagnostyczne

Reasoning może zostać zapisany lokalnie jako osobna część zdarzenia telemetrycznego lub metadanych odpowiedzi. Nie wymaga to dopisywania go do tekstu sesji.

### 10.3. Interfejs

W pierwszym zakresie 0.7.11 wymagane jest poprawne rozdzielenie i brak przecieku reasoning. Opcjonalny zwijany podgląd `Thinking` zostanie dodany, jeżeli można go przechować bez naruszania sealed transcript i bez komplikowania wznowienia sesji.

Jeżeli podgląd zostanie wdrożony:

- będzie domyślnie zwinięty;
- zostanie jednoznacznie oznaczony jako reasoning, a nie wypowiedź dla Viewera;
- nie trafi do zwykłego eksportu sesji ani pakietu AI Judge;
- diagnostyczny eksport reasoning będzie osobną świadomą opcją użytkownika;
- zamknięcie i ponowne otwarcie sesji nie pomiesza reasoning z finalną treścią.

Brak panelu `Thinking` nie może blokować podstawowej naprawy 0.7.11.

## 11. Zwykłe Conversations i Manual RV

Normalizacja odpowiedzi zostanie zastosowana centralnie, nie wyłącznie w AI Monitorze. Dzięki temu:

- Conversation wyświetli finalne `content`, a reasoning pozostanie oddzielne;
- Manual RV nie zapisze reasoning jako odpowiedzi AI;
- `Ponów odpowiedź` będzie reagować na brak finalnego `content`, a nie na sam fakt obecności reasoning;
- istniejące rozmowy i wiadomości pozostaną zgodne wstecznie;
- trzyzdaniowa lub dłuższa finalna odpowiedź pozostanie nienaruszona.

Reasoning nie powodował wcześniej równie widocznego uszkodzenia zwykłych sesji, ponieważ odpowiedź Viewera była zapisywana, a nie używana jako polecenie sterujące dla kolejnego modelu. AI Monitor przekazuje natomiast swoją finalną odpowiedź bezpośrednio jako następne polecenie Viewera, dlatego błędne rozdzielenie kanałów ma tam znacznie poważniejszy skutek.

## 12. Wznawianie przerwanej sesji

Istniejący mechanizm `Kontynuuj sesję` z 0.7.10 zostanie zachowany.

Przy braku finalnego `content` checkpoint musi wskazywać dokładnie, które wywołanie pozostało niedokończone:

- Monitor nie zakończył odpowiedzi -> ponowić tylko Monitora;
- Monitor zwrócił finalną interwencję, ale Viewer nie odpowiedział -> ponowić tylko Viewera z tą samą finalną interwencją;
- reasoning bez finalnego `content` nie jest zapisaną interwencją Monitora;
- wznowienie nie może dublować reasoning, interwencji ani odpowiedzi;
- krok kontrolera nie może zmienić się na podstawie treści reasoning.

## 13. Zmiany danych i zgodność wsteczna

Preferowany wariant podstawowej naprawy nie wymaga migracji bazy danych: reasoning może zostać zapisany w istniejących metadanych zdarzeń, a finalne `content` pozostaje w dotychczasowym miejscu.

Jeżeli trwały, zwijany podgląd reasoning w Conversation wymaga osobnego pola wiadomości, zostanie dodana mała migracja append-only. Migracja nie zmieni istniejących wiadomości, transkryptów ani hashy zapieczętowanych sesji.

## 14. Diagnostyka providera

Tryb szczegółowej diagnostyki zostanie rozszerzony o bezpieczne informacje:

- które pole zawierało reasoning;
- które pole zawierało finalne `content`;
- `finish_reason`;
- liczba reasoning tokens, jeżeli provider ją raportuje;
- liczba finalnych/output tokens;
- rzeczywisty model i identyfikator żądania;
- czy użyto natywnego pola, czy parsera znaczników;
- czy wykonano próbę z większym budżetem.

Sekrety, klucze i binarne załączniki nadal podlegają istniejącej redakcji technicznej debug payloadu.

## 15. Testy jednostkowe parserów

Powstaną fixtures co najmniej dla następujących odpowiedzi:

1. OpenRouter: `reasoning` + trzyzdaniowe `content`.
2. OpenRouter: `reasoning_content` + `content`.
3. OpenRouter: `reasoning_details` + `content`.
4. DeepSeek: długie `reasoning_content` + krótkie finalne polecenie.
5. DeepSeek: reasoning bez finalnego `content` i `finish_reason: length`.
6. NVIDIA/vLLM: `<think>...</think>` wewnątrz zwykłego `content`.
7. NVIDIA/vLLM: niezamknięty blok `<think>`.
8. Google: części `thought: true` i zwykłe części tekstowe.
9. Anthropic: `thinking`, `redacted_thinking` i `text`.
10. Zwykły model bez reasoning: samo `content`.
11. Tablica fragmentów tekstowych w `content`.
12. Pusta odpowiedź, blokada bezpieczeństwa i payload błędu.

Każdy test sprawdzi osobno `reasoningContent`, finalne `content`, `finishReason` oraz brak mieszania kanałów.

## 16. Testy integracyjne AI Monitora

Najważniejszy test regresyjny odtworzy przypadek sesji `RVH-8DE3ECD84E`:

- Monitor zwraca wieloakapitowe reasoning;
- finalne `content` zawiera trzyzdaniową interwencję albo `CONTINUE_PROTOCOL`;
- do Viewera trafia dokładnie finalne `content`;
- reasoning nie trafia do transkryptu;
- wewnętrzny krok kontrolera pozostaje prawidłowy;
- T8 nie wykonuje się przed zakończeniem cyklu kroku 7;
- właściwy T8 wykonuje się tylko raz;
- eksport ma prawidłowe nagłówki kroków.

Dodatkowe testy:

- brak finalnego `content` nie tworzy interwencji;
- retry z większym budżetem nie dubluje cyklu Monitora;
- wznowienie po restarcie aplikacji ponawia właściwe wywołanie;
- finalne polecenie z kilkoma zdaniami pozostaje identyczne bajt w bajt;
- `CONTINUE_PROTOCOL` działa jak dotychczas;
- zwykły model bez reasoning zachowuje dotychczasowe działanie.

## 17. Testy rzeczywistych tras

Po przejściu testów automatycznych należy wykonać kontrolowane sesje testowe:

| Viewer | Monitor | Cel testu |
|---|---|---|
| ZAI 5.2 | DeepSeek V4 Flash | długie reasoning i finalne polecenie |
| ZAI 5.2 | DeepSeek V4 Pro | reasoning, budżet i wielokrotne cykle |
| ZAI 5.2 | NVIDIA Nemotron 3 Ultra | natywne pola lub znaczniki reasoning |
| ZAI 5.2 | Google Gemini | części thought i final text |
| Gemma 4 31B | DeepSeek V4 Flash | zgodność z wcześniejszym testem użytkownika |
| ZAI 5.2 | Gemma lub Mistral | kontrola modelu bez problemu |

Dla każdej trasy należy zapisać:

- rzeczywiste pola odpowiedzi w zredagowanym debug payloadzie;
- `finish_reason`;
- raportowane reasoning tokens;
- liczbę prób;
- zgodność finalnego polecenia z tym, co otrzymał Viewer;
- poprawność numeracji kroków i brak duplikatów.

## 18. Zakres plików przewidywanych do zmiany

Lista może zostać doprecyzowana po implementacji, ale główne obszary to:

- `src-tauri/src/providers.rs` — parsing i normalizacja odpowiedzi;
- `src/providers/types.ts` — rozszerzony kontrakt odpowiedzi;
- `src/providers/native.ts` — mapowanie odpowiedzi backendu;
- `src/providers/capabilities.ts` i rejestr reasoning — polityka budżetu/transportu;
- `src/monitor/engine.ts` — używanie wyłącznie finalnego `content`;
- `src/sessions/controller.ts`;
- `src/sessions/telepathicController.ts`;
- pozostałe kontrolery automatyczne korzystające ze wspólnej warstwy chatu;
- `src/chat/engine.ts` — final content w Conversation i Manual RV;
- repozytorium zdarzeń/telemetrii, jeżeli reasoning będzie zapisywany lokalnie;
- interfejs sesji, tylko jeśli wejdzie zwijany podgląd `Thinking`;
- testy Rust i TypeScript dla wszystkich powyższych ścieżek.

## 19. Wersjonowanie i dokumentacja

Przy implementacji zostaną zaktualizowane:

- `package.json` -> 0.7.11;
- `src-tauri/tauri.conf.json` -> 0.7.11;
- `src-tauri/Cargo.toml`, jeżeli zawiera wersję pakietu wymagającą zmiany;
- `src/version.ts` i test spójności wersji;
- Release Notes 0.7.11;
- raport implementacji i lista zmienionych plików.

Opublikowane Release Notes powinny mówić o „improved compatibility with reasoning-capable providers and AI Monitor responses”, bez deklarowania, że wszystkie modele lub providerzy są jednakowi.

## 20. Weryfikacja przed wydaniem

Wymagane kontrole:

- TypeScript `tsc -b`;
- wszystkie testy Vitest;
- produkcyjny build Vite;
- `npm audit`;
- Rust `cargo test`;
- Rust `cargo clippy -- -D warnings`;
- CodeQL;
- test integralności wznowienia sesji;
- test eksportu sealed transcript;
- testy ręczne DeepSeek/NVIDIA/Google/ZAI;
- kontrola, że `Cargo.lock` pochodzi z aktualnej gałęzi i odpowiada `Cargo.toml`;
- budowa i attestation instalatorów Windows.

## 21. Kryteria akceptacji 0.7.11

Wydanie jest gotowe, gdy:

1. reasoning i finalne `content` są rozdzielane dla obsługiwanych formatów;
2. wielozdaniowe finalne polecenie Monitora jest przekazywane bez zmian;
3. reasoning nie trafia do Viewera ani sealed transcript;
4. DeepSeek i NVIDIA mogą dokończyć finalną odpowiedź przy włączonym reasoning;
5. brak finalnego `content` nie jest uznawany za interwencję;
6. retry i `Kontynuuj` nie dublują kroków ani wypowiedzi;
7. protokół Telepatyczny nie wykonuje T8 ani innego kroku przedwcześnie;
8. zwykłe sesje, Conversation i Manual RV zachowują kompatybilność;
9. wszystkie testy automatyczne i wymagane kontrole CI przechodzą;
10. instalator Windows przechodzi test praktyczny przed publikacją.

## 22. Elementy poza zakresem tej poprawki

- ocena jakości merytorycznej poleceń Monitora;
- skracanie lub przepisywanie wypowiedzi modeli;
- automatyczne przełączanie na inny model po błędzie;
- wyłączanie reasoning jako domyślna metoda zgodności;
- zmiana protokołów RV, Telepatycznego lub zasad blind;
- zmiana danych istniejących, zakończonych sesji;
- ponowne wydawanie lub podmienianie publicznego 0.7.10.

## 23. Kolejność implementacji

1. Utworzyć gałąź/stan roboczy 0.7.11 z pełnej bazy 0.7.10.
2. Rozszerzyć typ odpowiedzi providera bez zmiany zachowania kontrolerów.
3. Dodać natywne ekstraktory reasoning dla OpenAI-compatible, Google i Anthropic.
4. Dodać bezpieczny parser znaczników jako fallback.
5. Dodać fixtures i testy parserów Rust.
6. Usunąć twardy limit 800 i wdrożyć provider-aware token budget.
7. Przełączyć AI Monitor na finalne `content` z normalizatora.
8. Dodać regresję kroku 7/8 oraz test wielozdaniowej instrukcji.
9. Zastosować ten sam format w Conversation, Manual RV i zwykłych wywołaniach Viewera.
10. Zintegrować reasoning z diagnostyką i opcjonalnym podglądem.
11. Zweryfikować wznowienie i brak duplikacji.
12. Uruchomić pełne testy lokalne oraz CI.
13. Przeprowadzić rzeczywiste testy DeepSeek/NVIDIA/Google/ZAI.
14. Przygotować paczkę zmienionych plików lub pełne źródła 0.7.11 dopiero po wynikach testów.

