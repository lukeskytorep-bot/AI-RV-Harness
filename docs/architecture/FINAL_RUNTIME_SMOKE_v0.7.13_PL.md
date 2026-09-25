# AI RV Harness v0.7.13 — desktop runtime i release smoke

**Status modularizacji:** Etapy 1–9 `COMPLETED — AUTOMATED GATES PASS`.  
**Cel:** bieżąca ręczna bramka desktopowa przed akceptacją/release v0.7.13; zachowuje scenariusze modularizacji i obejmuje schema 25, Viewer Learning oraz provider-native continuation dla OpenRouter i Google native.  
**Wymagana baza:** dokładny aktualny zielony kandydat v0.7.13, nie historyczny ZIP Etapu 9.  
**Zasada:** wykonywać na desktopowym buildzie Tauri z kopią danych testowych. Nie używać jedynej kopii realnej bazy użytkownika.

## Warunki wejścia

- pełny GitHub Actions dla dokładnego aktualnego kandydata jest zielony;
- `verify:source`, `verify:ux-data`, `verify:architecture`, pełny Vitest, typecheck, Vite, Rust/Tauri i Clippy przechodzą;
- build uruchamia się z nowym, pustym profilem aplikacji;
- dostępna jest osobna kopia dokładnej zielonej bazy schema 24 do kontrolowanego testu upgrade 24 → 25; natywne testy nadal osobno zachowują bramkę v23 → v24;
- osobna baza legacy służy do sprawdzenia ekranu compatibility epoch; nie wolno pozwalać pluginowi SQL migrować jej automatycznie;
- dla provider smoke używany jest testowy credential należący do użytkownika.

## Checklista

| # | Scenariusz | Procedura minimalna | Wynik wymagany |
| --- | --- | --- | --- |
| 1 | Start na schema 25 | Uruchom aplikację na aktualnej bazie 25, zamknij i uruchom ponownie. | Start bez błędu, dane widoczne, brak ponownej/niekończącej się migracji. |
| 2 | Kontrolowany upgrade i legacy epoch | Uruchom kopię dokładnej zielonej bazy 24, a osobno kopię legacy v1–20. | Zielona v24 przechodzi do v25 z zachowaniem danych i tworzy obie tabele continuation state. Legacy jest zatrzymana przed `Database.load()` i oferuje bezpieczne zachowanie/start fresh; nie jest automatycznie migrowana. |
| 3 | Lazy routes | Otwórz kolejno Research, Settings i AI Center/Monitor, wróć na Home i otwórz je ponownie. | Każda trasa renderuje się, fallback znika, brak pustego ekranu i błędu dynamic import. |
| 4 | Zwykłe odczyty/zapisy | Utwórz/zmień nazwę Workspace lub Conversation, zapisz wiadomość/ustawienie i uruchom ponownie aplikację. | Odczyt i zapis działają; dane pozostają po restarcie. |
| 5 | Training | Uruchom krótki testowy Training, doprowadź co najmniej jeden target do trwałego checkpointu; jeśli możliwe przerwij i użyj Resume. | Brak duplikatu ukończonego kroku; checkpoint i Resume zachowują się zgodnie z rekordem. |
| 6 | RV Sessions | Uruchom testową RV Session do Reveal/Post-Reveal i otwórz zapisaną sesję. | Evidence/Reveal/stan sesji są spójne, zapis otwiera się po restarcie. |
| 7 | Provider + credential routing | Przetestuj połączenie na poprawnej konfiguracji; następnie sprawdź, że obcy/stary route albo zmieniony endpoint nie używa cudzego credentialu. | Poprawna konfiguracja działa; binding mismatch jest odrzucany czytelnym błędem. |
| 8 | Import załącznika | Użyj natywnego pickera do importu małego TXT/MD i jednego obsługiwanego obrazu lub dokumentu. | Załącznik trafia do UI; ścieżka systemowa nie jest przekazywana ręcznie przez WebView; błędny format jest odrzucany. |
| 9 | Backup | Utwórz backup aktualnej bazy i sprawdź manifest/listę backupów. | Backup kończy się sukcesem, ma poprawny manifest i przechodzi kontrolę integralności. |
| 10 | Restore + safety backup | Zmień dane po backupie, wykonaj Restore. | Przed Restore tworzony jest safety backup; przywrócone dane odpowiadają backupowi; aplikacja otwiera bazę po operacji. |
| 11 | Controlled purge | Na danych testowych zarchiwizuj wspierany obiekt, sprawdź preview, wykonaj permanent delete. | Preview odpowiada skutkom; purge usuwa właściwy zakres, nie zostawia FK violations ani otwartego purge context. |
| 12 | Training Viewer Learning | Wykonaj Training do zakończenia jednego targetu i otwórz Viewer Learning w AI Center. | Kolejność to Viewer Review → Field Guide Update → Viewer Notes Reflection; wersje są przypisane do exact identity/language i zachowują provenance. Zwykła RV Session nie tworzy nowych wersji. |
| 13 | Field Guide capacity/Resume | Przetestuj `NO_CHANGE` lub poprawny update, a w kontrolowanym przypadku odpowiedź ponad limitem i Resume. | Limit nie powoduje obcięcia; działa jedna poprawa pojemności; ukończone etapy nie są płatnie powtarzane po Resume. |
| 14 | Research/Judge sanity | Zablokuj minimalny Research z Notes OFF/CURRENT i Field Guide OFF/CURRENT; sprawdź także historię Field Guide, jeśli dostępna. | Lock zamraża dokładne snapshoty, Resume ich nie podmienia, Research nie tworzy wersji Notes ani Field Guide, a frozen Judge score/blinding nie zmienia się od odczytu. |
| 15 | OpenRouter Conversation continuity persistence | W Conversation użyj kompatybilnego modelu OpenRouter zwracającego `reasoning_details`, wykonaj kolejny turn, zamknij aplikację, uruchom ponownie i wykonaj następny turn w tej samej Conversation. | Assistant message i state zapisują się atomowo; po restarcie state jest odczytany, zwalidowany i replayowany wyłącznie przy zgodnym fingerprint. Ordinary transcript/export nie pokazuje payloadu. |
| 16 | Continuation backup/restore + purge | Po zapisaniu Conversation continuation state wykonaj backup, Restore i ponowny odczyt; następnie na osobnej kopii wykonaj controlled purge Conversation. | Backup/Restore zachowuje exact payload/hash/size; purge usuwa state razem z wiadomością i nie pozostawia orphan/FK violations. |
| 17 | Google native Conversation continuity | Użyj Google native Gemini 3.x zwracającego `thoughtSignature`: turn A → turn B → restart → turn C. W detailed diagnostics potwierdź obecność redacted continuation marker zamiast jawnego podpisu. | Request B/C zachowuje exact `thoughtSignature` na tym samym historycznym model `Part` (potwierdzane testem kontraktowym/providerowym), po restarcie persistence odtwarza state, debug nie ujawnia podpisu, a zmiana credential/model route blokuje replay zamiast go pomijać. |
| 18 | Google native Session/Resume/post-Reveal | Uruchom krótki RV Lite lub Full RCP przez Google native, przerwij po co najmniej jednym zapisanym Viewer response, wykonaj Resume i jeden post-Reveal turn. | State jest związany z dokładnym `session_event_id`, Resume replayuje go przed kolejnym Viewer call, a post-Reveal zapisuje kolejny signed turn atomowo. Historyczne sesje bez state pozostają text-only. |
| 19 | Restart końcowy | Zamknij aplikację po wszystkich operacjach i uruchom ponownie. | Brak startup error; ostatnie poprawne dane i archiwa są dostępne. |

## Kryterium zaliczenia

Aktualny kandydat v0.7.13 można zaakceptować do wydania wyłącznie wtedy, gdy wszystkie scenariusze mają wynik `PASS` albo scenariusz został jawnie oznaczony `N/A` z technicznym uzasadnieniem, które nie omija wymagania produktu. Brak credentialu lub brak interaktywnego desktop runtime nie jest `PASS`; oznacza, że release smoke pozostaje niewykonany.

Historycznego raportu kandydata Stage 9 nie należy przepisywać. Wynik każdego aktualnego smoke należy zapisać jako osobny, datowany raport odbioru wskazujący dokładny commit/source-tree i build Windows.
