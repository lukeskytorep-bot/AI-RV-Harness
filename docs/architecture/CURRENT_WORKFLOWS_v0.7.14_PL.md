# Aktualne przepływy — gałąź rozwojowa v0.7.14

**Przegląd:** 11 października 2026. **Baza:** zaakceptowana gałąź AI RV po Training History UX, testach DOM i poprawce ich zależności. **Schema:** 031. Wersja package.json nadal wynosi 0.7.13. Nazwa v0.7.14 oznacza zakres rozwoju, nie opublikowanie nowych instalatorów ani zaliczenie desktop smoke. Pełny opis z właścicielami kodu: [EN](CURRENT_WORKFLOWS_v0.7.14_EN.md).

## Budżety

Limit generacji jest oddzielny od kontekstu wejścia. Zwiększenie limitu odpowiedzi nie zwiększa okna kontekstu modelu. Reasoning może zużywać limit generacji; liczniki natywne i przeliczone OpenRoutera nie są osobnymi porcjami pracy, które należy bezwarunkowo dodawać.

| Operacja | Preferowany limit pierwszej / recovery próby |
| --- | --- |
| Blind Viewer zwykłego RV, Manual RV i klasycznego Training | 16 384 → 32 768 |
| Nowy Research z zamrożoną standardową polityką | 16 384 → 32 768, według snapshotu Experiment Lock |
| Starszy Research bez nowego snapshotu polityki | zachowany zamrożony limit; brak cichej aktualizacji |
| Viewer Review po Reveal w klasycznym Training | 16 384 → 32 768 |
| Field Guide / Viewer Notes w Training Reveal | pojemność dokumentu C + 16 384 → C + 32 768 |
| Judge zwykły i Training, RV post-Reveal Viewer/Monitor | 16 384 → 32 768 |
| Live Monitor w istniejącym RCP / klasycznym Telepathic RV | 16 384 → 32 768 |
| Judge w zamrożonym Research bez snapshotu polityki Judge | 8192 → 16 384; zgodność dla brakujących ocen |
| Propozycje learning poza polityką Training Reveal | C + 8192 → C + 16 384 |

To wartości preferowane, ograniczane przez rzeczywisty model/endpoint i dostępny kontekst. Recovery musi rzeczywiście zwiększać efektywny limit, inaczej kończy się jawnym błędem. Jawnie ustawiony większy budżet Viewera jest zachowywany tam, gdzie model go obsługuje. Pojemność C samego dokumentu pozostaje niezmieniona. Output recovery, naprawa JSON i ponowienie z powodu przekroczonej pojemności dokumentu są osobnymi operacjami; nie wolno obiecywać dwóch wywołań HTTP dla wszystkich możliwych napraw.

## Próby, wznowienia i niepewny dispatch

`length`, jawny error/refusal i pusta odpowiedź nie stają się zaakceptowanym dowodem tylko dlatego, że HTTP zwróciło 200. Niekompletny wynik pozostaje zapisany diagnostycznie i nie przesuwa fazy dalej jako kompletna odpowiedź.

Trwały ledger wiąże `stepId`, fingerprint wejścia i attemptId, rozróżniając także Monitor exchange i Special Task. Zapis `VIEWER_OUTPUT_ATTEMPT_STARTED` pozwala rozpoznać przerwę po rozpoczęciu dispatch. Restart nie resetuje recovery: po pierwszym potwierdzonym length pozostaje większa próba; po wyczerpaniu drugiej nie ma trzeciej automatycznej próby. Niepewny wynik bez trwałego zakończenia oraz drift fingerprintu blokują niebezpieczne automatyczne wznowienie. Nie odgaduje się miejsca wznowienia z ostatniej widocznej linijki.

Replay odtwarza lokalnie zaakceptowane odpowiedzi, bez powtórnych zapisów i wywołań. Live zaczyna się przy pierwszym brakującym wywołaniu. Transport retry pozostaje oddzielne od limitu prób semantycznych.

Training używa checkpointu i tej samej Session przy wspieranym blind Resume, bez ponownego losowania celu ani tworzenia zastępczej płatnej sesji. Po Reveal wraca do pierwszego brakującego etapu. Niepewny Viewer Review wymaga jawnej decyzji operatora i ponownej kontroli pod lease. Research stosuje jawne same-session Resume, snapshot konfiguracji/learning/polityki i istniejący ledger; nie ukrywa niepełnej płatnej próby nową sesją. Research i AI–AI Telepathic Training nie zapisują Field Guide ani Viewer Notes.

## Historia Training

Trzy ikony Pokaż/Ukryj sesje, Zapisz i Archiwizuj stoją przy nazwie treningu. Wznów i Zakończ trening zajmują osobny wiersz niżej. Tooltip działa myszą i klawiaturą, a nazwy i identyfikatory używają monospace 11px/1.25, weight 400. Układ zawija się w wąskim panelu, bez absolutnych przesunięć i nakładania wierszy.

Historia jest domyślnie rozwinięta po wejściu. Lokalny przełącznik nie kasuje aktywnego treningu, wybranej sesji ani rozwiniętej karty i nie trafia do Settings/Profile/DB.

Zakończ trening zapisuje `termination: { reason: "user_finished", endedAt }` i status Interrupted. To rezygnacja z dalszego wykonywania, nie ukończenie wszystkich celów. Indeks, checkpoint, snapshot, sesje i wyniki pozostają. Marker przetrwa restart oraz archive/restore; zwykły update nie może go usunąć ani ponownie ustawić Running. Silnik i Resume ponownie czytają rekord i odrzucają zakończony trening. Wznów/Zakończ znikają, ale historia nadal jest dostępna. Nie ma statusu Cancelled ani migracji 032.

## Markdown, Profil i pomoc

Zaakceptowane odpowiedzi blind są renderowane jako osobne rekordy przez BlindTranscriptRecord i bezpieczny renderer Markdown. Niedomknięty fence jednej odpowiedzi nie przejmuje następnej fazy. Jawny surowy fallback nie zmienia zapisanego dowodu. Streaming pokazuje stan roboczy; widoczny tekst nie oznacza zaakceptowanego zakończenia.

AI Center, Conversation i RV Sessions korzystają ze wspólnego ProfileSelector. Zmiana Profilu synchronizuje zgodne konteksty Conversation/RV; ponowny wybór aktywnego Profilu zachowuje ręcznie otwarty Workspace. Konkretny Workspace wybiera się w Profiles, bez dodatkowych przycisków w nagłówkach Conversation/RV. Pomoc używa ModuleHelpButton/Panel, zielonego stylu i ikony modułu, z panelem poniżej nagłówka.

## Koszt i weryfikacja

Usunięto twardą blokadę wydatku SessionCostGuard/CostAuthorization. Estymacje, usage i diagnostyka naliczeń pozostają odrębnymi danymi. Ochrona przed niepewnym dispatch nadal obowiązuje: poprzednia próba mogła zostać rozliczona.

Testy DOM korzystają z jsdom i lokalnej adnotacji środowiska testu. Zmiany zależności wymagają obu plików package.json/package-lock.json. Zielone testy nie zastępują rzeczywistego Windows/Linux desktop smoke na konkretnym kandydacie.

## Kandydat: telepatia ze stałym prowadzącym

Nowe serie telepatyczne używają fixed_lead_v1: geografii tylko dla twórcy, opcjonalnych cykli prowadzenia, automatycznej finalizacji AI i wspólnej transkrypcji/historii/eksportu. Odbiór native i wizualny pozostaje otwarty; wcześniejsze sekcje opisują zaakceptowaną bazę wejściową. Zobacz [opis przebiegu](TELEPATHY_FIXED_LEAD_v0.7.14_EN.md) oraz [raport wdrożenia](../reports/TELEPATHY_FIXED_LEAD_TRANSCRIPT_UX_IMPLEMENTATION_PL.md).

## Zgodność BUDGET-0

Nowy draft Research synchronizuje viewerControl, requested/effective settings i snapshot polityki przed preflight oraz Experiment Lock. Domyślnie jest to 16 384, z recovery co najmniej 32 768; większy jawny budżet pozostaje, a wspólny niższy limit modeli ogranicza pierwszą wartość. Nowe projekty zapisują także kontrakt Judge 16K/32K. Resume nie przepisuje istniejących polityk Viewera (również 8K) ani projektów legacy; brakujące oceny Judge w projekcie bez nowego snapshotu nadal używają 8K/16K. Pojemności learning i headroom bez zmian: Training Reveal C+16K/C+32K, pozostałe learning C+8K/C+16K. Gateway nowej Telepathy zachowuje swoją politykę, w tym sharing consent 8K/16K. Nie dodajemy live Monitora do klasycznego Training ani Research.

## PERF-HISTORY-1 — lekka historia telepatii

Conversation i Telepathic Training listują strony po 50 summaries przez listTelepathicSeriesSummaries. SQL filtruje mode/workspace/archive przed paginacją; porządek updatedAt DESC, id DESC i dwupolowy cursor. Nie przesyła plan_json/config_json ani dowodów. Nazwy uczestników zachowują rowid order. Pusta strona używa jednego SELECT, niepusta dwóch. Pełny stan pobierany jest przy otwarciu/eksporcie jednego wpisu oraz przez niezmienione Resume. Początkowo otwierana jest najwyżej jedna najnowsza aktywna seria; jeśli jest starsza niż strona archiwum, dodatkowy summary odczyt archive=active/limit=1 lokalizuje ją. UI pokazuje loading/error/retry/Load more i resetuje pierwszą stronę po operacji. Deduplikacja zapobiega podwójnym kartom, ale strony nie są zamrożonym snapshotem całej historii. Browser nadal parsuje wspólny localStorage JSON, bez klonowania pełnych stanów listy. Polling 500/750 ms i checkpoint writes pozostają bez zmian do kolejnych etapów. Desktop smoke pozostaje osobnym gate.
