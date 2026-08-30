# Jak wgrać kompletne źródło 0.7.9 i przygotować Draft Release

1. Pobierz i rozpakuj `AI_RV_Harness_v0.7.9_COMPLETE_SOURCE.zip`.
2. W GitHub Desktop sklonuj repozytorium `AI-RV-Harness` albo otwórz jego istniejącą lokalną kopię.
3. Zamknij AI RV Harness i skopiuj **całą zawartość** rozpakowanej paczki do katalogu repozytorium. Kopiuj zawartość, a nie nadrzędny folder.
4. Zgódź się na zastąpienie plików. Paczka nie zawiera `node_modules`, `dist` ani `src-tauri/target`.
5. Sprawdź w GitHub Desktop pliki dodane, zmienione i usunięte. Wykonaj commit na gałęzi roboczej i push.
6. Ponieważ środowisko przygotowania nie miało Rust, uruchom `Actions` → **Prepare Cargo lockfile**. Pobierz artefakt, przejrzyj `Cargo.lock`, umieść go w `src-tauri/Cargo.lock`, wykonaj osobny commit i push.
7. Poczekaj na zielone CI i CodeQL. Nie obchodź wymogu `--locked`.
8. Wykonaj całą `RELEASE_CHECKLIST_v0.7.9.md`, w tym włącz **Enable release immutability** przed publikacją.
9. Z `main` uruchom ręcznie **Release Windows** oraz **Release Linux**. Oba workflowy pozostawiają Release jako Draft i generują attestation.
10. Pobierz każdy asset i sprawdź:

```bash
gh attestation verify "PLIK" --repo lukeskytorep-bot/AI-RV-Harness
```

11. Opublikuj Release dopiero po testach instalacyjnych Windows/Linux, teście Blackbox na koncie użytkownika i pełnej weryfikacji Draftu.

Nie wgrywaj paczki plik po pliku przez przeglądarkowe `Add file → Upload files`; łatwo wtedy pozostawić mieszaninę wersji lub pominąć katalogi ukryte, w tym `.github`.

