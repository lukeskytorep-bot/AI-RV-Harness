# AI RV Harness v0.7.12 — poprawki po testach

> Status: zaimplementowane i zweryfikowane lokalnie  
> Baza: v0.7.12 po pierwszym pakiecie poprawek  
> Charakter: hotfix funkcjonalny bez migracji destrukcyjnej

## Zakres wdrożenia

### Viewer Notes

- zwykłe sesje RV (Manual, Automatic i Monitor) mogą korzystać z aktywnych notatek wyłącznie jako kontekstu tylko do odczytu;
- tylko Training może tworzyć lub aktualizować Viewer Notes;
- refleksja jest wykonywana po każdym ukończonym celu treningowym, po zapieczętowaniu części blind, Revealu i własnej ocenie Viewera;
- opinia Monitora, wynik Judge'a i późniejsza rozmowa nie są przekazywane do refleksji;
- po przekroczeniu limitu pojemności Harness wykonuje jedną dodatkową próbę;
- druga próba ponownie otrzymuje pełne źródła decyzji: aktualne notatki, zapieczętowaną część blind, Reveal i własną ocenę Viewera;
- otrzymuje również odrzuconą propozycję oraz liczby: rozmiar aktualnych notatek, rozmiar propozycji i limit;
- model może skrócić lub przeorganizować całość, zastąpić mniej przydatne wnioski, skrócić nowy materiał albo wybrać `NO_CHANGE`;
- druga nieudana próba kończy się kontrolowanym `FAILED_CAPACITY`; program nigdy sam nie obcina tekstu.

### AI Center i Credits

- opis działania AI Center i Viewer Notes znajduje się w zakładce Overview, gdzie jest łatwiej zauważalny;
- opis wyjaśnia granicę Profilu, wszystkie Workspace'y tego Profilu, role Viewer/Monitor/Judge, Training-only updates, historię wersji i Research;
- w Settings widoczny jest pełny, kopiowalny adres do `CREDITS.md`, niezależnie od obsługi otwierania linków przez system.

### Workspace i centralne archiwum

- lista wszystkich Workspace'ów ma menu z trzema kropkami;
- menu pozwala zmienić nazwę albo zarchiwizować Workspace;
- archiwizacja jest miękka: zachowuje rozmowy, wątki, sesje, źródła i inne dane;
- odzyskiwanie znajduje się centralnie w `Settings → Data storage`;
- można przywracać Profile, Workspace'y, rozmowy i pojedyncze wątki;
- przywrócenie elementu podrzędnego jest blokowane, dopóki nadrzędny Profil lub Workspace pozostaje zarchiwizowany;
- przywrócenie rozmowy przywraca tylko wątki zarchiwizowane razem z nią, a nie wątki zarchiwizowane wcześniej osobno;
- konflikt nazwy Workspace można rozwiązać przez podanie nowej nazwy przy przywracaniu;
- trwałe usuwanie danych pozostaje poza tym hotfixem i będzie osobnym etapem.

## Ocena złożoności

Zmiana ma złożoność **średnią**. Elementy interfejsu są niewielkie, ale Viewer Notes dotykają granic integralności sesji, walidacji pojemności i audytowalnej historii. Archiwizacja wymaga zachowania relacji rodzic–dziecko oraz odróżnienia wcześniejszej archiwizacji wątku od archiwizacji wykonanej razem z rozmową.

## Weryfikacja

- TypeScript typecheck: zaliczony;
- Vitest: 77 plików testowych, 222 testy zaliczone;
- Vite production build: zaliczony;
- Cargo.lock: bez zmian;
- Rust `cargo check` / `cargo test`: niewykonane w tym środowisku, ponieważ polecenie `cargo` nie jest zainstalowane; powinny pozostać obowiązkowym etapem CI/release workflow.

## Świadomie odłożone

- trwałe usuwanie zarchiwizowanych danych;
- automatyczna polityka retencji;
- modyfikowanie notatek poza Training;
- dodatkowe źródła wspomagające refleksję, takie jak AI Field Perception Lexicon.
