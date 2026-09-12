# AI RV Harness v0.7.13 — finalny runtime smoke modularizacji

**Cel:** ostatnia ręczna bramka Etapu 9 po zakończeniu Etapów 1–8.  
**Wymagana baza:** dokładny kandydat Etapu 9 zbudowany na zaakceptowanym STAGE-8-R1.  
**Zasada:** wykonywać na desktopowym buildzie Tauri z kopią danych testowych. Nie używać jedynej kopii realnej bazy użytkownika.

## Warunki wejścia

- pełny GitHub Actions dla dokładnego kandydata Etapu 9 jest zielony;
- `verify:source`, `verify:ux-data`, `verify:architecture`, pełny Vitest, typecheck, Vite, Rust/Tauri i Clippy przechodzą;
- build uruchamia się z nowym, pustym profilem aplikacji;
- dostępna jest osobna kopia reprezentatywnej starszej bazy do testu upgrade/restore;
- dla provider smoke używany jest testowy credential należący do użytkownika.

## Checklista

| # | Scenariusz | Procedura minimalna | Wynik wymagany |
| --- | --- | --- | --- |
| 1 | Start po migracji 23 | Uruchom aplikację na bazie po migracji 23, zamknij i uruchom ponownie. | Start bez błędu, dane widoczne, brak ponownej/niekończącej się migracji. |
| 2 | Upgrade starszej bazy | Uruchom kopię starszej bazy, pozwól wykonać migracje do 23. | Dane legacy pozostają dostępne; aplikacja pracuje na schema version 23. |
| 3 | Lazy routes | Otwórz kolejno Research, Settings i AI Center/Monitor, wróć na Home i otwórz je ponownie. | Każda trasa renderuje się, fallback znika, brak pustego ekranu i błędu dynamic import. |
| 4 | Zwykłe odczyty/zapisy | Utwórz/zmień nazwę Workspace lub Conversation, zapisz wiadomość/ustawienie i uruchom ponownie aplikację. | Odczyt i zapis działają; dane pozostają po restarcie. |
| 5 | Training | Uruchom krótki testowy Training, doprowadź co najmniej jeden target do trwałego checkpointu; jeśli możliwe przerwij i użyj Resume. | Brak duplikatu ukończonego kroku; checkpoint i Resume zachowują się zgodnie z rekordem. |
| 6 | RV Sessions | Uruchom testową RV Session do Reveal/Post-Reveal i otwórz zapisaną sesję. | Evidence/Reveal/stan sesji są spójne, zapis otwiera się po restarcie. |
| 7 | Provider + credential routing | Przetestuj połączenie na poprawnej konfiguracji; następnie sprawdź, że obcy/stary route albo zmieniony endpoint nie używa cudzego credentialu. | Poprawna konfiguracja działa; binding mismatch jest odrzucany czytelnym błędem. |
| 8 | Import załącznika | Użyj natywnego pickera do importu małego TXT/MD i jednego obsługiwanego obrazu lub dokumentu. | Załącznik trafia do UI; ścieżka systemowa nie jest przekazywana ręcznie przez WebView; błędny format jest odrzucany. |
| 9 | Backup | Utwórz backup aktualnej bazy i sprawdź manifest/listę backupów. | Backup kończy się sukcesem, ma poprawny manifest i przechodzi kontrolę integralności. |
| 10 | Restore + safety backup | Zmień dane po backupie, wykonaj Restore. | Przed Restore tworzony jest safety backup; przywrócone dane odpowiadają backupowi; aplikacja otwiera bazę po operacji. |
| 11 | Controlled purge | Na danych testowych zarchiwizuj wspierany obiekt, sprawdź preview, wykonaj permanent delete. | Preview odpowiada skutkom; purge usuwa właściwy zakres, nie zostawia FK violations ani otwartego purge context. |
| 12 | Viewer Notes | Wykonaj scenariusz Training, który czyta/aktualizuje Viewer Notes, następnie otwórz historię w AI Center. | Wersja jest przypisana do właściwej AI identity i zachowuje provenance/source snapshot; zwykła RV Session nie tworzy nowej wersji Notes. |
| 13 | Research/Judge sanity | Otwórz zapisany Research/Judge record lub wykonaj minimalny dozwolony test. | Frozen score/blinding state nie ulegają zmianie od samego otwarcia/odczytu. |
| 14 | Restart końcowy | Zamknij aplikację po wszystkich operacjach i uruchom ponownie. | Brak startup error; ostatnie poprawne dane i archiwa są dostępne. |

## Kryterium zaliczenia

Etap 9 można zamknąć wyłącznie wtedy, gdy wszystkie scenariusze mają wynik `PASS` albo scenariusz został jawnie oznaczony `N/A` z technicznym uzasadnieniem, które nie omija wymagania produktu. Brak credentialu lub brak interaktywnego desktop runtime nie jest `PASS`; oznacza, że smoke pozostaje niewykonany.

Po pełnym zaliczeniu zaktualizować:

- `STAGE_9_FINAL_MODULARIZATION_VALIDATION_v0.7.13_PL.md` → `COMPLETED — FINAL RUNTIME SMOKE PASS`;
- główny plan modularizacji → wszystkie Etapy 1–9 `COMPLETED`;
- `README_LIBRARY_INDEX.md` → kandydat Etapu 9 staje się `CURRENT VERIFIED BASELINE`.
