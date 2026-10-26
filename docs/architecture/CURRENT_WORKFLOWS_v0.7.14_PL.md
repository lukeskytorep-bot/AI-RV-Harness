# Bieżące przepływy — linia rozwojowa v0.7.14

Przegląd: **16.10.2026**, kod `ai-rv-2` po Training Continuity T5, commit `9c92bdbb94d1125406e0094779102458cdeee87c`. Wersja aplikacji nadal **0.7.13**, schema **31**. To opis kodu, a nie deklaracja publikacji v0.7.14 lub zakończonego odbioru Windows. Główną dokumentacją developerską jest angielski [Developer Guide](../development/README.md); szczegółowym odpowiednikiem tego opisu jest [Current Workflows EN](CURRENT_WORKFLOWS_v0.7.14_EN.md).

## Budżety z aktualnego kodu

| Operacja | Preferowana pierwsza próba / recovery |
| --- | --- |
| Conversation | Domyślnie 16 384; bez uniwersalnej zasady dwóch wywołań |
| Manual RV Viewer | 32 768 → 49 152 |
| Automatyczny blind Viewer i classic Training | 16 384 → 32 768 |
| Nowy Research Viewer | Zwykle 16 384 → 32 768, polityka zamrożona przy Lock; większe obsługiwane ustawienia zachowane |
| Judge, post-Reveal Viewer/Monitor, Training Review | 32 768 → 49 152 |
| Field Guide / Viewer Notes | Pojemność C + 32 768 → C + 49 152 |
| Live Monitor | 16 384 → 32 768 |
| Research Judge z zamrożoną polityką v1 / v2 | 16 384 → 32 768 / 32 768 → 49 152 |
| Stary locked Research bez polityki Judge | 8192 → 16 384 dla brakujących ocen |
| Nowa Telepatia: Reveal, wspólne komentarze i refleksja serii | 32 768 → 49 152 |
| Pozostałe nowe etapy fixed-lead / zgoda na dzielenie | 16 384 → 32 768 / 8192 → 16 384 |

Źródła: `startupDefaults.ts`, `chat/outputPolicy.ts`, `sessions/viewerOutputRecovery.ts`, `providers/outputRecovery.ts`, `operationResourceProfiles.ts`, `monitor/engine.ts` i `telepathicExchange/outputBudgets.ts`.

Limity modelu/endpointu i wolny kontekst mogą zmniejszyć efektywne allowance. Reasoning może zużywać output; limit outputu nie powiększa kontekstu. Pojemność dokumentu C nie rośnie. Learning wymaga jawnego `training_reveal`; nie ma aktualnej domyślnej ścieżki C+8K/C+16K. Stare zamrożone polityki Research i zakresów telepatycznych pozostają bez zmian. Stare nieoznaczone ustawienie Conversation 8000/8192 jest jednokrotnie podnoszone do 16 384; późniejsze świadome obniżenie pozostaje.

## Wynik transportu i Wznów

`response_finished` oznacza odebranie całego transportu (`body_read` lub `sse_done`), także odrzuconej odpowiedzi. Nie dowodzi poprawności odpowiedzi ani lokalnego commit. Wcześniejszy unknown fizycznej próby nie znika tylko dlatego, że późniejsza odpowiedź przyszła. Sam HTTP 200, panel providera lub `finish_reason=stop` nie wystarcza.

Rust wykonuje jedną próbę HTTP, a `requestExecutor.ts` zarządza transportowym retry. UI i silniki korzystają ze wspólnej decyzji `viewerResumeDecision.ts` / `viewerResumeLedger.ts`. Zapisany zaakceptowany wynik odtwarza się bez dispatch. Zakończone odrzucenie nie jest pokazywane jako nadal generowana odpowiedź. Świadome zezwolenie na dodatkową próbę istotnego kroku zachowuje historię i nie otwiera ponownie learning. Niepewny dispatch wymaga jawnego rozstrzygnięcia, a nie automatycznego płatnego resend.

Finalny kanał jest oddzielony od prywatnego reasoning. Dosłowny tag `<think>` wewnątrz JSON pozostaje danymi. Ograniczony kandydat finalnej odpowiedzi z hashem i walidacją może być zapisany w istniejących zdarzeniach learning i `learning_candidates.json` do analizy bez kolejnego wywołania.

## Ciągłość classic Training

Kolejność trwałych etapów: blind Session → Reveal → Viewer Review → Field Guide Update → Viewer Notes Reflection → opcjonalny Judge.

Każdy rodzaj learning ma własny trwały limit **dwóch wysłanych żądań na sesję/pakiet**, wspólny dla retry transportowego, recovery oraz napraw JSON/pojemności. Restart nie resetuje limitu. Pewne not_dispatched może zwolnić rezerwację; unknown nie jest takim dowodem.

- `updated`: jedna zaakceptowana niezmienna wersja;
- `model_no_change`: decyzja modelu, brak ostrzeżenia;
- `failed_preserved`: rzeczywisty FAILED_* i przyczyna, zachowanie dokładnej poprzedniej wersji lub jej braku, dalszy Training;
- `disabled`: aktualizacja wyłączona.

Niepowodzenie aktualizacji nie jest NO_CHANGE. Stop, DB/ownership, uszkodzenie/hash snapshotu, niezgodność tożsamości i niepewny dispatch nadal przerywają wykonanie. Zapis audytu/rozliczenia musi się udać przed przesunięciem checkpointu. Viewer Notes otrzymują dokładny Field Guide po bieżącej aktualizacji albo zachowaniu; poprawny nowy Field Guide nie jest cofany po błędzie Notes.

Tylko classic Training tworzy te wersje. Conversation, RV, Research i AI–AI Telepathic Training używają dozwolonych snapshotów tylko do odczytu.

## Ownership, Stop i zakończenie

Rust odnawia klasyczne workflow co **10 s**, TTL pozostaje **45 s**. Token wiąże profil/owner/version i okno. Utrata lease lub błąd DB anuluje związany transport bez callbacku JS oraz blokuje późniejsze zapisy. `nativeHeartbeat:true` wyłącza timer JS; starszy port zachowuje fallback. Release zatrzymuje dokładny token. Destroyed przerywa i zwalnia, a samo CloseRequested tego nie robi. Registry zamkniętych etykiet resetuje się przy pełnym restarcie procesu. Telepatia i post-Reveal zachowują własne lease. Przełączenie do innego programu nie jest uśpieniem komputera.

Stop zachowuje checkpoint i wymaga świadomego Wznów. Zakończ jest trwałą decyzją o niewykonywaniu dalszej pracy. Training zapisuje `termination.reason=user_finished` i Interrupted, nie fałszywe Completed. Stare wywołania silnika/repozytorium są blokowane; historia zostaje. Research ma marker poza zamrożoną konfiguracją. Rzeczywista przyczyna abort i odebrane dowody pozostają zachowane.

## Training, AI Center i eksport

Nagłówek Training jest neutralny, niezależny od globalnego Conversation Workspace. Ustawienia nowego treningu są opisane osobno; aktywny run i historia pokazują zapisany profil/model. Nowy dropdown nie przełącza po cichu istniejącego runu przy Resume.

Historia zachowuje dotychczasowe akcje i dostępne klawiaturą tooltipy. Ukończony trening pokazuje liczbę nieudanych aktualizacji i rozwijane osobne przyczyny Field Guide/Notes. AI Center używa tego samego rozróżnienia. Gdy pierwsza wersja nie powstała, komunikat mówi o braku zapisanej wersji. NO_CHANGE nie jest ostrzeżeniem.

Eksport działa również po przerwaniu pierwszej sesji przed dodaniem jej do sessionIds. Zawiera bieżący checkpoint, czytelny zapisany przebieg, rozliczenia/wersje/hashe/audyty i ograniczone kandydaty finalne. Łączy run/checkpoint/zdarzenia bez duplikatów. summary.md odsyła do szczegółów. Nieukończona sesja nie zwiększa postępu ani średniej ukończonych sesji. Pliki mogą zawierać prywatne materiały — sprawdź je przed udostępnieniem.

## Telepatia i prezentacja

Nowe serie fixed_lead_v1 zamrażają prowadzącego, uczestników, learning, trasy, geografię i polityki. Każda runda ma nowy zamrożony cel; prowadzący może wykonać do trzech dodatkowych cykli. Starsze serie zachowują zapisane znaczniki i semantykę. Odbiorca przed Reveal nie otrzymuje celu/geografii ani cudzych blind odpowiedzi; późniejsze dzielenie podlega zgodzie. Operator ma szerszy widok niż model. Nowe decyzje używają `fixed_lead_guidance_v2`: osobna instrukcja w `individual` dla każdego aktywnego Viewera albo jawne zakończenie jego udziału. Zakończenie rundy wymaga pustej listy instrukcji. Takie samo pytanie do kilku osób musi mieć osobny wpis dla każdej z nich. Zapisane decyzje i requesty v1 zachowują swój kontrakt, w tym zaakceptowane broadcasty.

Historia używa 50-elementowych stron podsumowań z filtrem przed LIMIT i kursorem updatedAt/id. Otwarcie/eksport wczytuje szczegóły bez modelu. Projekcja czytelnego dialogu jest oddzielna od dowodów i continuation, a polling respektuje call ID i ownership. Nie oznacza to zakończenia wszystkich planowanych optymalizacji historii/refresh.

BlindTranscriptRecord i rekordy telepatyczne izolują Markdown. Niedomknięty code fence nie pochłania kolejnej odpowiedzi. Provisional stream nie jest zaakceptowanym dowodem, a SafeMarkdown nie ładuje dowolnych zdalnych obrazów.

## Odbiór

Nie ma twardego SessionCostGuard/CostAuthorization. Metryki kosztów i niepewność płatnego dispatchu to oddzielne sprawy. Schema pozostaje 31, allowlista architektury jest pusta.

Kontrole wykonuj według [Developer Guide EN](../development/README.md). Linux/testy, kontrolowany SQLite, okno Windows i płatny provider wymagają osobnych opisów wyniku. Końcowy runtime zapisuje się z commitem/platformą/modelem według [checklisty EN](FINAL_RUNTIME_SMOKE_v0.7.14_EN.md); historyczne manifesty nie są aktualnym odbiorem.
