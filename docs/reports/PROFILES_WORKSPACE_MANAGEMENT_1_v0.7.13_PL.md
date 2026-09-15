# PROFILES-WORKSPACE-MANAGEMENT-1-R1 — AI RV Harness v0.7.13

**Data:** 15 września 2026  
**Status:** `CANDIDATE — INDEPENDENT AUDIT, FULL GITHUB ACTIONS AND WINDOWS RUNTIME SMOKE REQUIRED`

## Baza

Autorytatywną bazą paczki jest zaakceptowany complete-source Training/Research R2 (745 plików), a nie surowy commit `a550f517286ed11d1267e332ac5d34f6943d8287`. Audyt wykazał, że commit ten nie odtwarza R2 bajt w bajt: brakuje w nim plików i zmian Training/Research obecnych w zaakceptowanym R2. Dlatego R1 zbudowano bezpośrednio na dokładnym complete-source R2 o SHA-256 `49263f0f8ae90fc30b96ccfbbc8ff9c024297c6947fbc2801c58aae89c285a63` i source-tree `c6a18b5b88e10a25858ca374e35e1ee80b48224c733314bb7b4974048a13f633`.

## Zakres wykonany

- Profiles zachowuje wszystkie aktywne Workspace każdego Profilu, tworzenie Workspace i wejście do Workspace.
- Każdy Workspace w kafelku Profilu ma menu `⋯` z Rename i Archive.
- Nie dodano edycji opisu, ponieważ aktualny kontrakt repozytorium nie udostępnia operacji aktualizacji opisu istniejącego Workspace; opis pozostaje obsługiwany przy tworzeniu.
- Rename/Archive korzystają ze wspólnych application use cases w `src/application/workspaceManagement.ts`; logika repozytoriów i lifecycle nie została zduplikowana.
- Guard ostatniego aktywnego Workspace pozostaje w UI i w istniejących repozytoriach Browser/SQLite.
- Dodano kontrolę właściciela Profile przed mutacją Workspace.
- Menu zatrzymuje propagację kliknięcia, ma `aria-label`, natywną obsługę klawiatury przez `summary`, przywraca focus do triggera i zamyka się po akcji.
- `Workspaces` usunięto z głównej nawigacji i z union typu aktywnych stron.
- Stary identyfikator `workspaces` jest mapowany przez `normalizePage()` do `profiles`.
- Produkcyjny `WorkspacesScreen` i jego prywatne operacje zostały usunięte. Zachowano wyłącznie potrzebny `WorkspaceSwitcherDialog`, przeniesiony do własnego pliku.
- Nie zmieniono schematu SQLite, migracji, `workspaceId`, Training/Research technical Workspace, Conversations, Manual RV, RV Sessions, controlled purge, Viewer Notes, providerów, credential routing, retry ani promptów.
- Migracja 024 nie została dodana.

## Testy i bramki

Dodano/zmieniono testy obejmujące: komplet aktywnych Workspace w Profiles, menu i jego izolację od otwierania Workspace, rename/archive use cases, blokadę ostatniego aktywnego Workspace, brak mutacji obcego Profilu, przypisanie nowego Workspace do wybranego Profilu, usunięcie Workspaces z nawigacji, mapowanie starego identyfikatora oraz brak prywatnych cross-feature imports.

W niezależnym audycie R1 wykonano:

- `npm run verify:source` — PASS;
- `npm run verify:ux-data` — PASS;
- Vitest — **148/148 plików, 547/547 testów PASS**;
- `npm run typecheck` — PASS;
- `npm run build` — PASS;
- `npm run verify:architecture` — PASS (200 produkcyjnych TS/TSX, pusta allowlista).

Pierwotny kandydat miał jeden błędny test, który oczekiwał tekstu `Every Profile...`, mimo że stabilny kontrakt i18n brzmi `Each Profile...`. R1 poprawia wyłącznie oczekiwanie testu; zachowanie produkcyjne pozostaje bez zmian. Cargo/Rust/Clippy i Windows runtime smoke pozostają obowiązkowymi bramkami GitHub Actions/odbioru.

## Runtime smoke po GitHub Actions

Na Windows należy sprawdzić: Profiles z wieloma Workspace, Rename, Archive, guard ostatniego Workspace, archiwizację aktywnego Workspace, utworzenie Workspace dla konkretnego Profilu, otwieranie Workspace z kafelka, `⋯` bez wejścia do Workspace, keyboard/focus menu oraz uruchomienie aplikacji z ewentualnym starym identyfikatorem `workspaces`.
