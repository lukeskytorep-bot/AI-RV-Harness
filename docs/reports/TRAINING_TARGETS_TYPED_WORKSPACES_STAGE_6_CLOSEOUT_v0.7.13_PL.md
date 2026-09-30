# AI RV Harness v0.7.13 — Etap 6: dokumentacja i closeout

**Data:** 27 września 2026  
**Baza:** `ai-rv-2` / `d25ce7a5c850c37643f15024fd2be1decac24ab7` (`TYPED-WORKSPACES-STAGE-5-R1-CI-FIX`)  
**Bazowy source-tree:** `03235fb6fda13b4c0cf2acc923ed8291aed6bf6201f048ba184bc3c1d8c59e40`  
**Schema SQLite:** 026  
**Zakres:** wyłącznie dokumentacja bieżąca i closeout etapów 1–5; bez zmiany zachowania runtime

## Wynik

Dokumentacja bieżąca została zsynchronizowana z zaakceptowanym stanem etapów 1–5:

- 94 factory Training Targets w ośmiu kategoriach;
- Full Training jako 1–10 przebiegów po osiem sesji;
- zamrożony plan targetów i kolejności oraz wersjonowana zgodność Resume dla historycznego curriculum 84/7;
- rozdzielenie Conversations i RV Sessions w głównej nawigacji;
- Manual RV jako część RV Sessions, przy zachowaniu wspólnego silnika `ChatPanel`;
- Workspace kinds `conversation`, `rv` i `legacy_combined`;
- osobne aktywne Conversation/RV Workspace IDs;
- automatyczne, ukryte rozwiązywanie technicznego RV Workspace dla Training i Research;
- schema 026 oraz exact-green v25 → v26 compatibility gate.

Nie zmieniono historycznych wymagań, specyfikacji starszych wersji ani raportów kandydatów. Dokumenty te opisują wcześniejszy stan i pozostają dowodem historycznym.

## Dokumentacja w aplikacji

Kanoniczny zwijany panel PL/EN **Jak działa AI Training? / How does AI Training work?** został sprawdzony względem aktualnej implementacji. Opisuje osiem kategorii, przebiegi 1–10, 8–80 sesji, profile-scoped repeat policy, pauzę/Resume, kolejność Viewer Review → Field Guide Update → Viewer Notes Reflection oraz read-only użycie wiedzy poza Training.

Nie przywrócono selektora Workspace w Training ani Research. Globalny breadcrumb/TopBar może pokazywać kontekst aplikacji, ale Training i Research nie udostępniają użytkownikowi wyboru technicznego Workspace. Runtime rozwiązuje kompatybilny `rv` albo `legacy_combined` deterministycznie.

## Zmienione living docs

- `README.md`;
- `docs/README.md`;
- `docs/architecture/README.md`;
- `docs/architecture/SYSTEM_OVERVIEW.md`;
- `docs/architecture/CODE_MAP.md`;
- `docs/architecture/MODULE_BOUNDARIES.md`;
- `docs/architecture/UX_DATA_COMPATIBILITY_GATE.md`;
- `docs/architecture/ENGINEERING_DESIGN_AND_INTEGRITY_SAFEGUARDS.md`;
- `docs/architecture/FINAL_RUNTIME_SMOKE_v0.7.13_PL.md`;
- nowy living document `docs/architecture/TRAINING_TARGETS_AND_TYPED_WORKSPACES.md`.

## Walidacja lokalna

| Bramka | Wynik |
| --- | --- |
| `npm ci --no-audit --no-fund` | PASS |
| pełny Vitest | PASS — 193 pliki / 991 testów |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run verify:source` | PASS |
| `npm run verify:ux-data` | PASS — 26 migracji |
| `npm run verify:architecture` | PASS — 230 produkcyjnych TS/TSX, 0 wyjątków |
| lokalne linki Markdown | PASS — 337 plików, 0 uszkodzonych linków |
| `git diff --check` | PASS |
| Rust tests / Clippy lokalnie | NOT RUN — brak lokalnego toolchainu Rust |

Build zachowuje wcześniejsze nieblokujące ostrzeżenie o dużym głównym chunku: około 2,07 MiB po minifikacji i 623 KiB gzip. Nie jest to błąd funkcjonalny ani regresja tego etapu; etap dokumentacyjny nie zmienia grafu runtime.

## Odbiór końcowy

Przed oznaczeniem całego etapu jako finalnie zaakceptowanego wymagane są:

1. pełne zielone GitHub Actions dla dokładnego commita Etapu 6, w tym Rust tests i Clippy;
2. Windows runtime smoke według zaktualizowanego `FINAL_RUNTIME_SMOKE_v0.7.13_PL.md`, ze szczególnym uwzględnieniem schema 25 → 26, typed Workspaces, jednego pełnego przebiegu Training oraz Resume;
3. synchronizacja kanonicznego planu i Library Index po potwierdzeniu zielonego commita.

**Status:** `CANDIDATE — LOCAL FRONTEND AND DOCUMENTATION GATES PASS; FULL GITHUB ACTIONS AND WINDOWS RUNTIME SMOKE REQUIRED`
