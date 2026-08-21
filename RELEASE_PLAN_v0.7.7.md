# AI RV Harness — Release Plan v0.7.7

## Status: wdrożone

### Cele i trening

- [x] Usunąć `Download More` z ustawień celów.
- [x] Pozostawić 84 Factory Training Targets jako zamkniętą bibliotekę.
- [x] Dodawanie celu kierować wyłącznie do My Targets.
- [x] Pełny trening: zawsze stałe 84 Factory Targets.
- [x] Częściowy trening: siedem kategorii Factory + oddzielne My Targets, wartości początkowe zero.

### Sesje i review

- [x] Automatycznie wykonać Viewer review po Revealu.
- [x] W sesjach monitorowanych wykonać Monitor review po Viewerze.
- [x] Usunąć ręczny przycisk generowania review.
- [x] Zastąpić osobną klaryfikację opcjonalną rozmową dwustronną.
- [x] Udostępnić w Manual RV wybór Full RCP / RV Lite Core / RV Lite Extended.
- [x] Przenieść ostatnie sesje do panelu metadanych.
- [x] Zwinąć i wyjaśnić Special Task.

### Eksport

- [x] Zwykła sesja: jeden czytelny `complete_session.md` plus obrazy Revealu.
- [x] Trening: `summary.md`, po jednym `complete_session.md` na sesję i obrazy Revealu.
- [x] Research: czytelne Markdowny, klucz odślepienia i README przy zachowaniu JSON do audytu.
- [x] Nie osadzać surowego JSON-u jako ludzkiej wypowiedzi w Markdownzie.

### Prompty, zabezpieczenia i licencja

- [x] PL/EN edytowalne prompty fabryczne zależne od języka interfejsu.
- [x] Zaakceptowane zasoby Monitora PL/EN.
- [x] Konserwatywna gilotyna tylko dla jednoznacznych zapętleń, bez przerwania sesji.
- [x] Jednoznaczny podział MIT / CC BY 4.0 bez osobnego wyjątku dla znaku Rosehip.

### Wydanie

- [x] Wersja 0.7.7 zsynchronizowana w frontendzie i Tauri/Rust.
- [x] Dokumentacja GitHub Actions i Windows release zaktualizowana.
- [x] Kompletne źródło przygotowane do paczki ZIP.
