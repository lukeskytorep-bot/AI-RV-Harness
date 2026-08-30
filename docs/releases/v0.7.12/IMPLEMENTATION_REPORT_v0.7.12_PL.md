# AI RV Harness v0.7.12 — raport wdrożenia

## Wykonany zakres

- osobny przycisk AI Center w lewej nawigacji;
- Overview, AI Monitor, Viewer Notes i AI Identities dla aktywnego Profilu;
- dokładna, pseudonimowa tożsamość Viewera obejmująca credential, provider/endpoint, model route i rolę;
- wersjonowane Viewer Notes z historią refleksji i aktywacji;
- pojemności 1024/2048/4096/8192 bez automatycznego obcinania;
- proste, domyślnie włączone przełączniki w RV Session, Training i Manual RV;
- snapshot notatek w Full RCP, RV Lite, Custom i Telepathic Session;
- refleksja po Viewer review i przed Monitor review;
- obrazy Revealu dla refleksji na trasach vision;
- `UPDATE`/`NO_CHANGE`, jedna naprawa JSON, kontrola stale-base i zachowanie poprzedniej wersji po błędzie;
- nowa migracja SQLite 20 oraz implementacje repozytorium SQLite i browser preview;
- Research `Viewer Notes Impact`: No Notes kontra jedna z pięciu ostatnich Frozen Notes;
- numer aplikacji 0.7.12 w npm, Tauri, Rust i testach wersji.

## Poprawki po końcowym sanity checku

- obliczanie wyników Research można bezpiecznie ponowić, jeżeli odślepienie zostało zapisane, ale odczyt Blinding Key, obliczenia albo zapis wyników chwilowo zawiodły;
- zwykłe i badawcze zestawy Judge wznawiają wyłącznie brakujące oceny oraz sprawdzają zgodność kolejności i tras już zamrożonych Judge’ów;
- cała nowa grupa 1–3 wyników Judge jest zapisywana w jednej transakcji SQLite dopiero po poprawnym zakończeniu wszystkich odpowiedzi i walidacji JSON;
- częściowy historyczny zestaw ocen nie jest już przedstawiany jako ukończony — interfejs pozwala jawnie dodać kolejnego Judge’a bez zmiany zamrożonych wyników;
- AI Center ponownie przelicza dane AI Monitora po zmianie filtra Workspace;
- dane przekazywane do refleksji Viewer Notes są oddzielone oznaczonymi blokami i opisane jako materiał do analizy, nie instrukcje; treść notatek nadal pozostaje wyłączną decyzją modelu;
- migracja AI Center blokuje również cross-identity aktywację wersji przy INSERT oraz cross-identity wpisy historii aktywacji.

Manual RV może używać zamrożonych notatek jako kontekstu, lecz nie wykonuje automatycznej refleksji, ponieważ ten operator-led tryb nie ma formalnego, kontrolowanego punktu Reveal + Viewer self-review. Continuous Conversation, Monitor Notes i Judge Center nie należą do tego wydania.

## Niezmienione granice integralności

Blind evidence jest pieczętowane przed Revelem. AI Judge nadal otrzymuje sanitizowany anonimowy pakiet i nie ma dostępu do warunku Research. Wyniki Judge pozostają 3+3+2+2, są zamrażane przed unblindingiem, a Viewer Notes nie są przekazywane Judge jako treść do oceny.

## Weryfikacja

W środowisku przygotowania paczki wykonano:

- TypeScript typecheck: zaliczony;
- Vitest: 74 pliki testowe, 207 testów zaliczonych;
- produkcyjny build Vite: zaliczony;
- npm audit dla zależności produkcyjnych: bez zgłoszonej podatności;
- składniowe wykonanie wszystkich 20 migracji SQLite w pustej bazie, `PRAGMA integrity_check` oraz osiem negatywnych prób triggerów AI Center: zaliczone;
- integralność wewnętrznych sum SHA-256 i obu archiwów ZIP: zaliczona;
- audyt paczek pod kątem katalogów generowanych i typowych wzorców credentiali: zaliczony.

Rust/Tauri, migrację na kopii prawdziwej bazy v0.7.11 oraz instalatory Windows/Linux musi ostatecznie potwierdzić GitHub CI i test wydaniowy, ponieważ lokalne środowisko nie zawiera Cargo.
