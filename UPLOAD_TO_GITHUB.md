# Jak wgrać kompletne źródło 0.7.6 i zbudować Windows EXE

Najbezpieczniejsza metoda to GitHub Desktop, ponieważ zachowuje katalogi, pliki ukryte (`.github`, `.gitignore`) i usuwa z repozytorium pliki, których nie ma już w nowej wersji.

1. Pobierz i rozpakuj `AI_RV_Harness_v0.7.6_COMPLETE_UPDATE_source.zip`.
2. W GitHub Desktop sklonuj repozytorium `AI-RV-Harness` albo otwórz jego istniejącą lokalną kopię.
3. Zamknij AI RV Harness.
4. Skopiuj **całą zawartość** rozpakowanej paczki do katalogu repozytorium. Kopiuj zawartość, nie dodatkowy nadrzędny folder.
5. Zgódź się na zastąpienie istniejących plików. Nie kopiuj `node_modules`, `dist` ani lokalnego `src-tauri/target` — nie ma ich w paczce.
6. W GitHub Desktop sprawdź, czy widoczne są zarówno pliki dodane/zmienione, jak i usunięte.
7. Commit: `Release 0.7.6 complete source`.
8. Kliknij `Push origin` i poczekaj na zielony workflow `CI`.
9. W GitHub wejdź w `Actions` → `Release Windows` → `Run workflow`, wybierając gałąź `main`.
10. Workflow utworzy `Cargo.lock`, zweryfikuje frontend i Rust, a następnie utworzy szkic wydania `AI RV Harness v0.7.6` z instalatorem Windows.

Nie dodawaj paczki plik po pliku przez przeglądarkowe `Add file → Upload files`. Ta metoda w przeszłości pozostawiła w repozytorium mieszaninę wersji i brakujące katalogi.

