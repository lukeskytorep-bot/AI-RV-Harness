# AI RV Harness — checkpoint 0.7.5

Data kontroli: 18.08.2026  
Zakres: zatwierdzone Pakiety 1–4 po wersji 0.7.4.

## Wynik

Wdrożono uzgodnioną architekturę interfejsu, autonomicznego AI Monitora, fabrycznych promptów, dwóch wariantów RV Lite, Special Tasks, rozdzielonych tożsamości AI/Human IS-BE, licencji treści oraz modułu Training z fabrycznym curriculum 84 celów.

## Pakiet 1 — interfejs i rozmowy

- Home zachowuje pełną nawigację, a powtórzony kafel skrótów zastępują ostatnie sesje.
- Ekrany robocze używają wąskiego paska ikon z tooltipami.
- Hierarchia rozmów to Profil → Workspace → Thread → Conversations; konwersacje mają nazwę, tworzenie i archiwizację.
- Panel metadanych RV jest zwijany, a ostatnie sesje nie zajmują prawego panelu.
- Nazwa AI i nazwa człowieka są oddzielne. Puste wartości wyświetlają `AI IS-BE` i `Human IS-BE`; własna nazwa całkowicie zastępuje etykietę domyślną.

## Pakiet 2 — AI Monitor

- Monitor zwraca naturalne polecenia i nie jest ograniczony zamkniętą biblioteką `command_id`.
- Pętla działa po Fazach 2–6: jedno polecenie, odpowiedź Viewera, ponowna decyzja; kontroler wymusza maksymalnie pięć pogłębień.
- Pełny efektywny prompt jest widoczny. Część robocza jest edytowalna, a reguła wykonawcza i definicja aktywności są nieedytowalne.
- Special Monitor Task jest przekazywany po Fazie 4.
- Po revealu najpierw powstaje komentarz Viewera, następnie osobna analiza Monitora; materiał pre-reveal pozostaje zapieczętowany.

## Pakiet 3 — protokoły, prompty, wygląd i licencje

- RV Lite ma rozłączne warianty Core i Extended; Extended pogłębia sesję pomiędzy Krokiem 3 i 4.
- Zatwierdzone polecenie brzmi: „Przejdź do głównej aktywności dowolnego rodzaju i opisz.” / “Move to the primary activity of any kind and describe.”
- Definicja aktywności jest blokiem kontrolera w promptach Viewera i Monitora. Nie zakłada aktywności ludzkiej.
- Prompt Viewera ma zablokowane bloki AI IS-BE i Shadow Zone. Prompt Monitora ma zablokowaną regułę pięciu pogłębień.
- Fabryczne prompty Viewer/Monitor PL i EN oraz Full RCP/RV Lite są dostępne w Settings, wersjonowane, hashowane i możliwe do przywrócenia.
- Special Task działa także w zwykłym Full RCP po Fazie 4 oraz RV Lite po Kroku 3.
- Dodano pięć łagodnych motywów z miękkim niebieskim jako ustawieniem pierwszego uruchomienia.
- Znak z dostarczonego logo Rosehip zastępuje falę w interfejsie i ikonach Tauri; wordmark „THE ROSEHIP PUBLICATIONS” nie jest używany.
- Kod pozostaje MIT. Protokoły, prompty, fabryczne cele i podobne autorskie treści są wydzielone jako CC BY 4.0 w `CONTENT_LICENSE_CC_BY_4.0.md`. Znak Rosehip ma osobny status marki.

## Pakiet 4 — Targets i Training

- Stare 10 celów startowych są wycofywane migracją bez kasowania wierszy potrzebnych historycznym sesjom.
- Fabryczna biblioteka ma dokładnie 84 cele: po 10 w sześciu kategoriach oraz 24 cele mieszane.
- Pełny trening zawsze wykonuje stałe, wersjonowane curriculum 84 unikalnych celów w 12 blokach 5+2. Cele użytkownika są jawnie wykluczone.
- Trening częściowy pozwala wybrać kategorie, liczbę celów oraz pulę Factory/User/All.
- Dostępne są RV Lite Core/Extended oraz 0–3 modele AI Judge.
- Stan jest zapisywany po każdej sesji w SQLite. Zwykły folder `Training_NNN_RRRR-MM-DD` powstaje od startu i jest aktualizowany po blokach 5+2, pauzie, błędzie i zakończeniu.
- Folder zawiera manifest, podsumowanie, checkpoint, sesje, reveale, wyniki Judge i agregaty kategorii/bloków/sędziów. Lokalizację można zmienić w Settings i otworzyć z aplikacji.
- Migracja 18 ukrywa stare `training_1`–`training_10`, zachowując integralność historycznych odwołań.

## Weryfikacja

- TypeScript: `tsc -b --pretty false` — bez błędów.
- Testy: 56 plików testowych, 134 testy — wszystkie zaliczone.
- Build webview: `vite build` — zakończony poprawnie; wynik znajduje się w `dist/`.
- Pakiet targetów: 84/84, rozkład 10+10+10+10+10+10+24, 84 unikalne pozycje curriculum.
- Prompt Monitor PL/EN: po 31 odpowiadających sobie przykładów poleceń; test bloków nieedytowalnych jest zaliczony.

## Jawne zależności przed publicznym wydaniem

1. Źródłowy pakiet 84 celów zawiera kompletne opisy angielskie. Warstwa lokalizacji PL i wybór treści według języka sesji są wdrożone, ale pełne polskie tłumaczenia opisów nie zostały dostarczone. Kod nie oznacza kopii EN jako ukończonego tłumaczenia; do polskiego wydania potrzebny jest osobny, kuratorsko zaakceptowany korpus PL.
2. Dokładna publiczna linia atrybucji CC BY 4.0 nadal wymaga potwierdzenia autora i nie została wymyślona automatycznie.
3. W tym środowisku nie ma `cargo`, `rustc` ani `rustfmt`. Frontend i testy kontraktów migracji są sprawdzone lokalnie; kompilację natywnego Tauri/Rust musi wykonać workflow Windows przed publikacją instalatora.
4. Wygenerowany build zawiera ostrzeżenie Vite o dużym głównym chunku. Nie blokuje działania, ale code splitting pozostaje optymalizacją przed finalnym v1.
