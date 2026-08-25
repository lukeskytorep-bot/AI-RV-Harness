# AI RV Harness 0.7.9 — checklista publikacji

Nie publikuj Release, dopóki wszystkie obowiązkowe pola nie zostaną potwierdzone.

## 1. Jednorazowe przygotowanie `Cargo.lock`

- [ ] Wypchnij źródła na osobną gałąź.
- [ ] Uruchom ręcznie workflow **Prepare Cargo lockfile**.
- [ ] Pobierz artefakt `AI-RV-Harness-v0.7.9-Cargo-lock`.
- [ ] Przejrzyj plik, umieść go jako `src-tauri/Cargo.lock` i wykonaj osobny commit.
- [ ] Potwierdź, że CI używa `--locked` i nigdzie nie wykonuje `git commit` ani `git push`.

## 2. CI i bezpieczeństwo

- [ ] TypeScript, 169 testów Vitest i Vite build przechodzą na GitHubie.
- [ ] `cargo fmt --check`, `cargo test --all-targets --locked` i Clippy z `-D warnings` przechodzą.
- [ ] CodeQL JavaScript/TypeScript i Rust zakończony; alerty przejrzane.
- [ ] Dependabot nie zgłasza nieprzejrzanych krytycznych aktualizacji.

## 3. Draft Release i atestacja

- [ ] W ustawieniach repozytorium włączono **Enable release immutability** przed publikacją.
- [ ] Uruchomiono **Release Windows** i **Release Linux** z `main`.
- [ ] Draft zawiera co najmniej `.exe`, `.msi`, `.AppImage` i `.deb`.
- [ ] Oba workflowy zakończyły kroki `actions/attest` bez `continue-on-error`.
- [ ] Każdy pobrany asset przechodzi:

```bash
gh attestation verify "PLIK" --repo lukeskytorep-bot/AI-RV-Harness
```

- [ ] Sumy SHA-256 pobranych pakietów zostały zapisane i porównane.

## 4. Testy instalacyjne i aktualizacja danych

- [ ] Czysta instalacja Windows: NSIS i MSI.
- [ ] Aktualizacja istniejącej instalacji 0.7.8 z realną bazą testową.
- [ ] Automatyczny backup `pre_migration` istnieje i zawiera manifest SHA-256.
- [ ] Po migracji aplikacja zachowała Profile, Workspace, targety, sesje, Research, ulubione modele i konfiguracje providerów.
- [ ] Kontrolowana wadliwa kopia/restore zostaje odrzucona bez zastąpienia działającej bazy.
- [ ] Linux AppImage i DEB sprawdzone na prawdziwym Ubuntu: dialogi, SQLite, keyring, eksport, backup/restore i providery.

## 5. Testy funkcjonalne 0.7.9

- [ ] Załączniki TXT/MD/PDF/DOCX oraz prawidłowe obrazy działają; uszkodzone/spoofowane pliki są odrzucane.
- [ ] Cztery dokumenty w About otwierają się i zapisują z identycznym SHA-256.
- [ ] Conversation i Manual RV zachowują izolację kontekstu; obrazy są tylko na następną turę.
- [ ] Limit outputu, estymacja kontekstu i blokada przekroczenia używają tych samych danych.
- [ ] Zadania Specjalne oraz cały Protokół Telepatyczny 1.1, recovery i Reveal po kroku 9 działają.
- [ ] Blackbox: discovery modeli i rozmowa sprawdzone na koncie użytkownika; błędy nie ujawniają klucza.
- [ ] 425/429 może wykonać ograniczone retry; timeout/network/5xx nie powoduje cichego drugiego płatnego wywołania.

## 6. Publikacja

- [ ] Draft i wszystkie assety zostały ręcznie sprawdzone.
- [ ] Release opublikowano bez przesuwania tagu i bez późniejszej podmiany assetów.
- [ ] `gh release verify` i `gh release verify-asset` przechodzą; Release jest oznaczony jako `Immutable`.
