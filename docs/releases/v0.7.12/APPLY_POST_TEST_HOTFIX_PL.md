# Nakładanie poprawki po testach v0.7.12

Paczka `AI_RV_Harness_v0.7.12_POST_TEST_HOTFIX_CHANGED_FILES.zip` jest przeznaczona do nałożenia na aktualne źródła v0.7.12, które zawierają już pierwszy pakiet poprawek.

1. Zamknij aplikację i proces deweloperski.
2. Wykonaj kopię katalogu repozytorium albo utwórz osobny commit.
3. Rozpakuj paczkę do katalogu głównego repozytorium, zachowując strukturę i zastępując wskazane pliki.
4. Nie usuwaj pozostałych plików projektu. To jest paczka nakładkowa, nie pełne źródło.
5. Uruchom typecheck, Vitest, build oraz obowiązkowe kontrole Rust/Tauri w swoim workflow.
6. Sprawdź `Settings → Data storage`, menu z trzema kropkami na liście Workspace oraz pojedynczy trening z małym limitem Viewer Notes.

Alternatywnie można użyć pełnego archiwum źródłowego, które zawiera skonsolidowany stan po obu pakietach poprawek v0.7.12.

`Cargo.lock` nie został zmieniony przez ten hotfix.
