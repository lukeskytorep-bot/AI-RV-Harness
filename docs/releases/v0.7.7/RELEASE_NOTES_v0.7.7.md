# AI RV Harness v0.7.7 — informacje o wydaniu

Wydanie 0.7.7 rozwija kompletne źródło 0.7.6. Aktualizacja jest addytywna: nie wymaga usuwania bazy SQLite, profili, Workspace'ów, celów ani wcześniejszych sesji.

## Najważniejsze zmiany

- Factory Training Targets pozostają zamkniętym, nieedytowalnym zestawem 84 celów. Usunięto nieaktywną funkcję `Download More`.
- Każdy nowy cel użytkownika trafia bezpośrednio do `My Targets`; formularz nie udaje już, że cel można dopisać do kategorii fabrycznej.
- Pełny trening zawsze wykonuje stały zestaw 84 celów fabrycznych. Trening częściowy ma siedem liczników kategorii fabrycznych i oddzielny licznik `My Targets`; wszystkie zaczynają od zera.
- Po Revealu Viewer automatycznie ocenia własną sesję: co zadziałało, co nie zadziałało, co było częściowe, co wymaga poprawy i co już wykonuje dobrze. W sesji monitorowanej następnie wypowiada się Monitor.
- Przycisk ręcznego generowania review i osobne `Ask for Target Clarification` zostały zastąpione automatycznym review oraz opcjonalną, dwustronną rozmową po Revealu.
- Eksport zwykłej sesji i treningu tworzy czytelny Markdown zamiast zestawu plików JSON. Jeśli Reveal zawiera obraz, prawdziwy plik graficzny jest kopiowany obok Markdownu i podlinkowany w treści.
- Research nadal zachowuje techniczne JSON-y potrzebne do audytu, odtwarzalności i zewnętrznej oceny. Jednocześnie dodaje pełne sesje `.md`, czytelny klucz odślepienia `.md`, szczegółowy README i realne obrazy Revealu.
- Po odślepieniu Research każda zakończona sesja pokazuje na ekranie badany warunek.
- Manual RV pozwala jawnie wybrać: bez protokołu, Full RCP 1.5a, RV Lite Core 1.1.0 lub RV Lite Extended 1.1.0.
- Lista ostatnich automatycznych sesji RV została przeniesiona do przewijanego panelu metadanych po prawej stronie.
- `Special Task` jest zwijany i wyjaśnia moment podania, zastosowanie oraz obowiązek opisania etykiet Subject/Structure/Object w Revealu.
- Fabryczne edytowalne prompty Viewera i Monitora podążają za językiem interfejsu. Zaakceptowane zasoby PL/EN Monitora są dostarczane jako wersja 1.3.0.
- Zachowano konserwatywną, nieprzerywającą sesji gilotynę powtórzeń: typowe powtarzające się deskryptory RV nie kończą sesji, a tylko oczywiste zapętlenia są skracane.
- Doprecyzowano licencję: kod źródłowy jest MIT, a dokumentacja, dołączone prompty, treści treningowe i pozostałe niekodowe zasoby wizualne są CC BY 4.0.

## Wersje

Wersja `0.7.7` jest zsynchronizowana w `package.json`, `package-lock.json`, frontendzie, konfiguracji Tauri, manifeście Cargo i natywnym nagłówku klienta API.

## Budowa Windows

Rozpakuj kompletną paczkę w głównym katalogu repozytorium, wgraj całość na gałąź `main`, a następnie uruchom ręcznie workflow `Release Windows`. Szczegółowa instrukcja znajduje się w `UPLOAD_TO_GITHUB.md`.
