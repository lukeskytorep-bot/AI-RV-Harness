# AI RV Harness v0.7.13 — VIEWER-LEARNING-1-R1 — Field Guide Foundation

**Data:** 17 września 2026  
**Status:** `CANDIDATE — INDEPENDENT AUDIT PASS; FULL GITHUB ACTIONS AND WINDOWS RUNTIME SMOKE REQUIRED`

## Baza

R1 jest liczony bezpośrednio względem zaakceptowanego `DATABASE-COMPATIBILITY-EPOCH-1-R1`:

- 754 pliki;
- source-tree `2bf60e9fe6f10066bf448ec20a19062cad34cc0c5086604dff48dfc04e05593b`;
- schema SQLite 23;
- data epoch `v0.7.13`.

## Zakres funkcjonalny

Kandydat tworzy fundament `Viewer Learning` bez uruchamiania automatycznego uczenia. Wprowadza:

- oddzielne `Field Guide` i niezmienione `Viewer Notes`;
- prompt Viewera składany z `Locked Core Identity`, `Locked Base Vocabulary` i `Trainable Field Guide`;
- immutable wersje, historię aktywacji, restore-as-new-version i capacity 2048/4096/8192;
- separację exact Viewer identity oraz języka PL/EN;
- kontrolowany bootstrap historycznego `default_viewer_system_prompt`;
- frozen Field Guide snapshot dla nowych sesji i Training oraz jego ponowne użycie podczas Resume;
- migrację 024 jako wspierany upgrade wyłącznie zielonego schematu v23 bieżącej epoki.

Nie dodano Training Field Guide Reflection ani uczenia przez Research. Post-Reveal, Viewer Notes Reflection, Judge, Monitor, provider retry oraz migracje 021–023 pozostają poza zmianą semantyczną.

## Poprawki niezależnego audytu R1

Pierwszy kandydat nie przechodził pełnego Vitest: istniejący test `postRevealContextBoundary.test.ts` haszował całe `systemPrompts.ts` i `telepathicController.ts`, mimo że oba pliki musiały otrzymać wyłącznie Viewer-specific Field Guide wiring. R1 zastępuje tę fałszywą granicę dwiema precyzyjnymi kontrolami:

- haszem faktycznych wyników promptów zwykłego i telepatycznego Monitora dla PL/EN;
- kontrolą, że po odjęciu dokładnie dozwolonego Field Guide wiring kontroler telepatyczny jest byte-for-byte zgodny z zaakceptowaną bazą.

Audyt wykrył także różnicę między adapterami Browser i SQLite przy legacy baseline. R1 egzekwuje w obu adapterach, że baseline:

- istnieje;
- ma stan dokładnie `unresolved`;
- należy do tego samego Profilu co exact Viewer identity;
- nie może zostać ponownie użyty ani powiązany przez bezpośrednie wywołanie ścieżki tworzenia wersji.

Dodał testy regresyjne `factory-equivalent` i cross-Profile linking.

## Migracja i dane

Migracja 024 dodaje `field_guide_settings`, `field_guide_versions`, `field_guide_activation_events` i `field_guide_legacy_baselines`. Wersje i historia aktywacji pozostają append-only poza istniejącym `controlled_purge_context`. Exact v23→v24 jest objęte natywnym testem zachowania danych i provenance. Publiczne schematy 1–20 nadal są zatrzymywane przez compatibility epoch gate i nie są automatycznie migrowane.

## Zweryfikowane lokalnie

- Vitest: **155/155 plików, 605/605 testów**;
- TypeScript project typecheck: PASS;
- Vite production build: PASS (pozostaje nieblokujące ostrzeżenie o dużym chunku);
- `verify:source`: PASS;
- `verify:ux-data`: PASS — 24 migracje;
- `verify:architecture`: PASS — 206 produkcyjnych TS/TSX, 0 wyjątków;
- overlay i complete-source: byte-for-byte PASS po czystej rekonstrukcji;
- migracje 021–023: byte-for-byte zgodne z bazą;
- brak `.git`, `node_modules`, `dist`, `target`, `*.tsbuildinfo` i nazw `#U...` w paczkach.

Rust/Cargo i Clippy nie były dostępne lokalnie, dlatego pełne GitHub Actions pozostają obowiązkowe.

## Wymagany runtime smoke Windows

Należy sprawdzić co najmniej:

1. v23→v24 na rzeczywistej zielonej bazie;
2. start świeżej bazy v24;
3. oddzielne Field Guide dla dwóch identity i PL/EN;
4. jawne powiązanie custom legacy baseline;
5. brak ponownego powiązania baseline;
6. frozen Resume po zmianie aktywnej wersji;
7. restore-as-new-version i capacity;
8. niezmienione Viewer Notes;
9. Research bez mutacji Field Guide;
10. controlled purge z historią Field Guide.

## Odbiór

`VIEWER-LEARNING-1-R1` może zostać oznaczony jako zakończony dopiero po zielonym GitHub Actions i Windows runtime smoke. Następny krok — Training Reflection / update Field Guide — pozostaje zablokowany do tego czasu.
