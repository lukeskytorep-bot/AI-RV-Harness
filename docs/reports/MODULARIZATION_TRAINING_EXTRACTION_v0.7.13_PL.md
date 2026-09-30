# AI RV Harness v0.7.13 — wydzielenie modułu Training

**Data:** 4 września 2026  
**Zakres:** Etap 4 modularizacji — Training  
**Charakter zmiany:** refaktoryzacja techniczna i utwardzenie testów bez celowej zmiany zasad produktu

## Wykonane zmiany

- przeniesiono `TrainingScreen` z `src/components/TrainingScreen.tsx` do `src/features/training/TrainingScreen.tsx`;
- utworzono publiczny punkt wejścia `src/features/training/index.ts`;
- wydzielono długotrwałą orkiestrację do `src/features/training/trainingExecution.ts`;
- `App.tsx` importuje Training wyłącznie przez publiczny punkt wejścia;
- curriculum i eksport pozostały w `src/training/`;
- wykonanie RV Lite pozostało w `src/sessions/`;
- zasady Judge pozostały w `src/judge/`;
- tożsamość oraz wersjonowanie Viewer Notes pozostały w `src/aiCenter/` i repository.

## Chronione zachowanie

Nowe testy charakterystyki potwierdzają:

1. checkpoint po każdym w pełni ukończonym celu;
2. Resume od pierwszego targetu bez trwałego checkpointu, nawet gdy zapisany `currentIndex` jest nieaktualny;
3. brak ponownego wykonywania targetów już ukończonych;
4. pauzę dopiero po dokończeniu i zapisaniu bieżącego targetu;
5. zachowanie ostatniego checkpointu po późniejszym błędzie providera;
6. przekazanie `AbortSignal` do aktywnej sesji i brak rozpoczęcia kolejnego targetu po cancellation;
7. najwyżej jedną refleksję Viewer Notes na każdy target ukończony w danym przebiegu;
8. renderowanie ekranu przez publiczny punkt wejścia bez dostępu do repository;
9. brak starego `src/components/TrainingScreen.tsx` i brak głębokich importów modułu.

## Integralność odzyskanego źródła

Podczas pierwszego pełnego testu wykryto, że ścieżki czterech katalogów fabrycznych targetów miały w ZIP-ie zakodowane fragmenty Unicode (`#U...`), a obok części plików znajdowały się techniczne duplikaty `.openai-download-*`. W pełnym snapshotcie przywrócono prawidłowe nazwy katalogów i dokładnie 84 właściwe pliki targetów. Nie zmieniono treści targetów.

## Weryfikacja lokalna

- typecheck TypeScript: zaliczony;
- testy bezpośrednie nowego modułu i granic: 34/34 zaliczone;
- pełny zestaw: **94 pliki testowe / 283 testy zaliczone**;
- produkcyjny build Vite: zaliczony.

Lokalne środowisko nie posiadało `cargo`, dlatego natywne testy Rust i Clippy pozostają do potwierdzenia przez istniejący workflow GitHub Actions po zastosowaniu paczki zmian.

## Wynik

Training jest fizycznie wydzielonym modułem Etapu 4. Następnym kandydatem frontendowym po zielonym CI są Workspaces/Conversations.
