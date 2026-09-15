# Training/Research — techniczny Workspace i Viewer Notes R2

**Data:** 15 września 2026  
**Status:** `CANDIDATE — INDEPENDENT GITHUB ACTIONS AND FINAL WINDOWS RUNTIME SMOKE REQUIRED`

R2 powstał po niezależnym audycie R1, bez migracji bazy danych. Training i Research nie pokazują selektora Workspace, lecz zachowują techniczne `workspaceId`. Najstarszy aktywny Workspace wybranego Profilu jest wybierany deterministycznie; Workspace obcy lub zarchiwizowany nie jest używany.

Research pokazuje bezpośredni wybór `AI Profile / AI IS-BE`. Dla zwykłych badań dostępne są opcje `Do not use` oraz `Use current Viewer Notes`. Snapshot jest pobierany ponownie i zamrażany przy Experiment Lock. Resume korzysta wyłącznie z utrwalonych danych i zatrzymuje projekt po wykryciu driftu. Research nie aktualizuje Viewer Notes.

W porównaniu Profilów lub modeli każda condition otrzymuje aktualne Viewer Notes własnej, dokładnej tożsamości Viewer (`profileId + providerConfigId + modelId`). R1 błędnie kopiował snapshot bazowego Viewera do pozostałych tożsamości. Preflight R2 wymaga kompletnego snapshotu zgodnego z trasą każdej porównywanej tożsamości. W pozostałych typach badania nadal wymagany jest jeden identyczny snapshot we wszystkich conditions.

`Viewer Notes Impact` nadal porównuje `No Notes` z zamrożoną aktualną wersją, bez wyboru wersji historycznej.

## Wynik audytu i walidacji

- naprawiono błędne oczekiwanie testu immutable clone z R1;
- Vitest: **148/148 plików, 541/541 testów — PASS**;
- `npm run typecheck` — PASS;
- `npm run build` — PASS;
- `npm run verify:architecture` — PASS;
- `npm run verify:ux-data` — PASS;
- `npm run verify:source` na czystym R2 — PASS;
- migracje pozostają `001–023`; migracja `024` nie istnieje;
- complete source zbudowano ponownie z poprawnej bazy o 740 plikach; nie zawiera nazw `#U...`, `.git`, `node_modules`, `dist`, `target` ani `*.tsbuildinfo`.

Rust/Cargo oraz końcowy smoke Windows pozostają bramkami CI/runtime. Kandydat nie jest jeszcze oznaczony jako ukończony.
