# AI RV Harness v0.7.14 — final desktop runtime i release smoke

**Status:** `STEP 6 — RELEASE GATE CANDIDATE`; automatyczne CI musi być zielone, a poniższy desktop smoke musi zostać wykonany na dokładnym kandydacie przed formalnym zamknięciem v0.7.14.  
**Publiczna baza odniesienia:** v0.7.13.  
**Bieżąca granica danych:** SQLite schema **31**.  
**Zasada:** testy runtime wykonujemy na kopii danych i testowych credentialach. Nie używamy jedynej kopii realnej bazy użytkownika.

## Warunki wejścia

- dokładny commit kandydata ma zielony workflow CI: `verify:source`, `verify:ux-data`, `verify:architecture`, `verify:v0.7.14-release-gate`, typecheck, Vitest, Vite build, Rust tests, OpenRouter continuation bridge i Clippy;
- wszystkie migracje `001–031` są zarejestrowane w jednej, ciągłej kolejności, a wcześniejsze zaakceptowane migracje pozostają byte-identical;
- dostępna jest kopia aktualnej zielonej bazy oraz osobna kopia starszej zielonej bazy do kontrolowanego upgrade;
- backup/restore wykonujemy wyłącznie na kopii testowej;
- provider smoke wykorzystuje credential należący do testującego użytkownika.

## Checklista

| # | Scenariusz | Procedura minimalna | Wynik wymagany |
| --- | --- | --- | --- |
| 1 | Start i restart na schema 31 | Uruchom aplikację na aktualnej bazie 31, zamknij ją i uruchom ponownie. | Brak startup error, dane dostępne, migracje nie wykonują się ponownie. |
| 2 | Upgrade current epoch | Uruchom kopię ostatniej zaakceptowanej bazy sprzed zmian 0.7.14 i pozwól aplikacji wykonać wyłącznie wspierany current-epoch upgrade do 31. | Dane istniejące przed upgrade pozostają dostępne; `integrity_check=ok`; brak FK violations. |
| 3 | Legacy compatibility epoch | Uruchom osobną bazę spoza current epoch. | Baza nie jest po cichu migrowana; aplikacja oferuje istniejącą ścieżkę preserve/start fresh. |
| 4 | Lazy routes i nawigacja | Otwórz Research, Settings, AI Center, Conversations, Training i RV Sessions, wróć na Home i otwórz ponownie. | Brak pustego ekranu, dynamic-import error i utraty aktywnego Profile/Workspace. |
| 5 | Profile/Workspace routing | Przełącz Profile i osobne Conversation/RV Workspaces, wykonaj restart. | Każdy ekran korzysta z właściwego Profile, Workspace, identity i route; brak odziedziczenia stanu poprzedniego Profilu. |
| 6 | Standard Conversation | Wyślij kilka zwykłych tur tekstowych i wykonaj retry jednej odpowiedzi. | Zachowanie pozostaje zgodne z v0.7.13, continuation/fingerprint nie są mieszane pomiędzy trasami. |
| 7 | Conversation attachment metadata | Wyślij wiadomość z tekstowym Workspace Source i obrazem na trasie vision; wykonaj osobno przypadek bez vision oraz retry po restarcie bez ponownego dołączenia obrazu. | Historia zachowuje nazwy/type i prawdziwy status prób; nie przechowuje bytes/base64/path; retry tej samej wiadomości dopisuje próbę, a po restarcie nie udaje ponownego wysłania brakujących bytes. |
| 8 | Telepathic Conversation preflight | Skonfiguruj kilka Profili AI i uruchom preflight przed Start. Zmień model/uczestnika/liczbę rund i sprawdź unieważnienie starego wyniku. | UI pokazuje aktualny szacunek budżetu/kosztu; Start wymaga aktualnego PASS; runtime executor nadal pozostaje ostatecznym guardem każdego requestu. |
| 9 | Telepathic Conversation, human sender | Człowiek tworzy i zamraża target, potwierdza transmission, AI zapisują first/second look, potem Reveal/reflections. | Target jest zamrożony przed blind; receiver nie widzi targetu ani cudzych odpowiedzi przed Revealem; restart/Resume nie powtarza ukończonych kosztownych etapów. |
| 10 | Telepathic Conversation, AI sender i rotacja | Uruchom serię z wieloma Profilami i rotacją sendera. | Każdy AI używa własnego Profile/Workspace/identity/route; nowa runda ma świeży kontekst; harmonogram odpowiada konfiguracji. |
| 11 | `NO_SUBMISSION` | W kontrolowanym teście doprowadź receivera do dwóch nieudanych prób. | Runda idzie dalej; Reveal używa promptu dla brakującej odpowiedzi i nie każe porównywać nieistniejącego blind. |
| 12 | Human empty reflection | Człowiek zapisuje pustą refleksję, aplikacja zostaje zamknięta i otwarta ponownie. | `reflection: ""` pozostaje ukończonym etapem i nie jest żądane ponownie. |
| 13 | Telepathic lease/Resume | Zatrzymaj serię na checkpoint, wykonaj Resume; jeśli dostępne są dwie instancje testowe, sprawdź konkurencję i utratę lease. | Jedna instancja jest właścicielem; wygasłego lease nie można odnowić; spóźniony checkpoint starego właściciela zostaje odrzucony. |
| 14 | Telepathic Training preflight | Wybierz 2–6 różnych Profili, temat i liczbę rund; uruchom preflight. | Widać schedule, budżet i koszt; zmiana konfiguracji unieważnia wynik; Start nie przechodzi przy blokującym preflight. |
| 15 | Telepathic Training 3 Profile × 3+ rundy | Uruchom rotację senderów, przerwij po checkpoint i wykonaj Resume. | Operator widzi pełny postęp, modele tylko własne dozwolone dane; Field Guide/Viewer Notes są zamrożone i read-only; Training ich nie aktualizuje. |
| 16 | Learning freeze po restarcie | Po utworzeniu serii zmień aktywny Field Guide/Viewer Notes, następnie wznow serię. | Resume nadal używa exact frozen content/hash z początku serii. |
| 17 | Provider errors / `uncertain` | Doprowadź do kontrolowanego timeoutu/ambiguous dispatch w telepathic flow. | Automatyczny retry nie duplikuje kosztu; operator otrzymuje jawne recovery dla `uncertain`. |
| 18 | Standard RV Session do Reveal | Wykonaj testową sesję do Reveal i otwórz ją ponownie po restarcie. | Evidence, frozen Reveal i stan sesji są spójne. |
| 19 | Post-Reveal review recovery | Doprowadź Viewer review do sukcesu, a Monitor review do błędu; uruchom Resume. | Powtarzany jest tylko pierwszy brakujący etap; Viewer i Reveal nie są wykonywane ponownie. |
| 20 | Post-Reveal `length` i `uncertain` | Przetestuj `length` oraz osobno niepewny wynik po dispatch. | `length` pozostaje bezpiecznie resumable; `uncertain` wymaga jawnej decyzji operatora przed retry. |
| 21 | Post-Reveal lease fencing | Dwie instancje próbują wznowić tę samą opinię; w kontrolowanym przypadku A traci lease, B go przejmuje, A kończy późno. | Tylko właściciel aktualnej wersji lease może zapisać response/continuation/checkpoint; spóźnione zapisy A są atomowo odrzucone. |
| 22 | Provider + credential routing | Sprawdź poprawny route, następnie mismatch endpoint/model/credential. | Poprawna konfiguracja działa; niezgodny binding jest odrzucony bez replay cudzego continuation. |
| 23 | OpenRouter/Google continuation persistence | Wykonaj turn/session, restart i następny turn na zgodnym fingerprint; następnie zmień route. | Exact continuation state przeżywa restart i jest replayowany tylko przy zgodnym binding; debug/export nie ujawnia sekretnego payloadu. |
| 24 | Backup schema 31 | Utwórz backup po utworzeniu Conversation metadata, telepathic series i post-Reveal checkpoints. | Backup manifest i integralność są poprawne; baza w backupie przechodzi integrity/FK checks. |
| 25 | Restore + safety backup | Zmień dane po backupie, wykonaj Restore. | Najpierw powstaje safety backup; przywrócone metadata/telepathic/recovery state odpowiadają backupowi; aplikacja startuje po restore. |
| 26 | Controlled purge | Na danych testowych wykonaj archive → preview → permanent delete wspieranego obiektu. | Zakres purge jest właściwy; continuation/metadata zależne nie zostają osierocone; brak FK violations. |
| 27 | Standard Training / Viewer Learning regresja | Wykonaj zwykły Training i sprawdź Viewer Learning. | Klasyczny Training nadal aktualizuje learning zgodnie z dotychczasowymi zasadami; telepathic Training nie zapisuje zmian. |
| 28 | Research/Judge regresja | Uruchom minimalny Research/Judge z frozen controls. | Research nie aktualizuje Field Guide/Viewer Notes; frozen score/blinding pozostają stabilne. |
| 29 | PL/EN | Wykonaj po jednym Telepathic Conversation i Training w PL i EN. | Teksty UI i prompty odpowiadają roli/stage; nie występuje mieszanie języka ani ujawnienie hidden topic/target. |
| 30 | Restart końcowy | Zamknij aplikację po wszystkich operacjach i uruchom ponownie. | Brak startup error; ostatnie poprawne dane, archiwa, serie, checkpointy i historia są dostępne. |

## Kryterium zaliczenia

Krok 6 może otrzymać status `COMPLETED` dopiero, gdy:

1. dokładny commit ma zielone wszystkie automatyczne bramki CI;
2. migracje 001–031 oraz current-epoch upgrade są zaakceptowane;
3. scenariusze desktop smoke mają wynik `PASS` albo jawne `N/A` z technicznym uzasadnieniem, które nie omija wymagania produktu;
4. backup/restore został wykonany na kopii danych, a nie wyłącznie oceniony statycznie;
5. wynik zostanie zapisany jako osobny, datowany raport wskazujący commit/source-tree, platformę i wersję aplikacji.

Brak interaktywnego desktop runtime lub credentialu nie jest `PASS`. Ten dokument jest checklistą kandydata v0.7.14 i nie zastępuje historycznego raportu publicznego v0.7.13.
