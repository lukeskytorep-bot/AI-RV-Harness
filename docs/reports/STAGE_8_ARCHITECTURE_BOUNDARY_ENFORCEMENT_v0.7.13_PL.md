# ETAP 8 — Egzekwowanie granic architektonicznych

> **Korekta R1 po niezależnym audycie:** pierwotny kandydat zakładał klasyczny publiczny API kompilatora TypeScript, podczas gdy projekt używa TypeScript 7.0.2, którego główny eksport zawiera wyłącznie informacje o wersji. Na Node.js 24 powodowało to wyjątek przed analizą grafu oraz 5 niezaliczonych testów. R1 korzysta z jawnej zależności deweloperskiej `@babel/parser` z pluginami TypeScript/JSX. Zakres reguł, pusta allowlista i zmiana produkcyjna `sha256Text` pozostają bez zmian. Niezależnie potwierdzono: `verify:source`, `verify:ux-data`, `verify:architecture`, 145/145 plików i 519/519 testów, typecheck oraz Vite build — PASS. Po niezależnym audycie użytkownik potwierdził pełny zielony GitHub Actions dla dokładnego STAGE-8-R1, w tym Rust/Tauri i Clippy. Etap 8 jest zamknięty.

**Status:** `COMPLETED — FULL GITHUB ACTIONS PASS`  
**Data:** 12 września 2026  
**Baza:** dokładny `STAGE-7B-R1 — Shared Components Cleanup`  
**Bazowy source-tree:** `03d0fd8ae3c43ed4083540fd84fe2ca6aa1fae1d0b04ad09014163e5eabf8d21`  
**Bazowy complete-source ZIP SHA-256:** `29985c214c784e1255fbd59624bf6c96b0db5b39b53f28f2382465bdafbd528f`  
**Bazowy changed-files ZIP SHA-256:** `696a9cb6925be1afac458877418ab2987648eadd1f41a02f7c48b5109d2a0831`

## 1. Cel i ograniczenie zakresu

Etap 8 nie wykonuje kolejnej dużej modularizacji. Dodaje lekką automatyczną ochronę granic, które już istnieją po Etapach 1–7. Nie zmienia zachowania produktu, i18n, CSS, storage schema, migracji 001–023, controlled purge, credential binding, raw SQL hardening, provider retry, sesji, Training, Research, Judge, Viewer Notes, protokołów RV, blindingu, Reveal, Resume, persistence, legacy `chat_thread_groups/thread_group_id` ani PERF-UI lazy routes. Nie dodano migracji 024.

## 2. Read-only inwentaryzacja przed implementacją

Audyt produkcyjnego `src/` i providerów Rust wykonano przed dodaniem reguł.

### TypeScript

- **Runtime cycles:** znaleziono jeden realny cykl: `src/sessions/controller.ts -> src/aiCenter/viewerNotes.ts -> src/sessions/controller.ts`.
- **Type-only SCC:** istnieje jeden cykl wyłącznie typów: `src/targets/bundled.ts -> src/storage/repository.ts -> src/training/types.ts -> src/targets/bundled.ts`. Wszystkie trzy krawędzie są `import type`, więc nie uczestniczą w grafie runtime. Nie dodano dla niego wyjątku.
- **Feature → prywatne wnętrze innego feature:** 0 naruszeń.
- **Zewnętrzny konsument → prywatny plik feature:** 0 naruszeń po rozwiązywaniu importów względem publicznych `index.ts`.
- **`domain` → storage / React / Tauri / feature UI / provider transport:** 0 naruszeń.
- **UI/aplikacja → konkretne `browserRepository`, `sqliteRepository`, `storage/browser/*`, `storage/sqlite/*` lub plugin SQL:** 0 naruszeń w kodzie produkcyjnym.
- **Granica providera:** istniejący właściciel pojedynczej fizycznej próby `providerChatAttempt` pozostaje ograniczony do `src/providers/native.ts` i `src/providers/requestExecutor.ts`.
- **Wspólne komponenty:** osiem kanonicznych komponentów pozostaje w `src/components`; nie znaleziono lokalnych deklaracji o tych samych kanonicznych nazwach. Specjalizowany nagłówek AI Center pozostaje dozwolony.

### Rust

Potwierdzono zachowanie podziału Etapu 6:

- `src-tauri/src/providers.rs` pozostaje fasadą Tauri/DTO;
- adaptery: `providers/adapters.rs`;
- request builders: `providers/request_builders.rs`;
- response parsers: `providers/response_parsers.rs`;
- reasoning: `providers/reasoning.rs`;
- transport i cancellation: `providers/transport.rs`;
- błędy: `providers/errors.rs`;
- walidacja: `providers/validation.rs`;
- testy: `providers/tests.rs`.

Nie przeniesiono TypeScriptowego retry do Rust i nie przebudowano providerów ponownie.

## 3. Jedyna mała korekta kodu produkcyjnego

Realny cykl `sessions/controller.ts <-> aiCenter/viewerNotes.ts` został usunięty minimalną zmianą:

- dodano `src/application/sha256.ts` z dotychczasową implementacją `sha256Text`;
- `src/sessions/controller.ts` korzysta z helpera i nadal re-eksportuje `sha256Text`, dzięki czemu dotychczasowi konsumenci nie zmieniają kontraktu;
- `src/aiCenter/viewerNotes.ts` importuje helper bezpośrednio z `src/application/sha256.ts`.

Nie przeniesiono logiki sesji ani Viewer Notes. Zmiana usuwa wyłącznie krawędź odpowiedzialną za runtime cycle.

## 4. Automatyczna bramka

Dodano:

- `scripts/verify-architecture.mjs`;
- `scripts/verify-architecture-selftest.mjs`;
- `scripts/architecture-boundaries.json`;
- `src/architecture/architectureEnforcement.test.ts`;
- komendę `npm run verify:architecture`.

Bramka korzysta z parsera TypeScript już obecnego w projekcie. Nie dodano nowej zależności npm.

### Chronione invariants

1. brak cyklicznych importów **runtime** w produkcyjnym `src/`; pełna ścieżka cyklu pojawia się w komunikacie;
2. `src/domain/` nie zależy od infrastruktury/UI;
3. zewnętrzni konsumenci feature korzystają z jego `index.ts`, a nie prywatnych plików;
4. kod poza `src/storage/` nie importuje konkretnych implementacji Browser/SQLite ani pluginowego SQL;
5. `providerChatAttempt` ma tylko dotychczasowych właścicieli;
6. kanoniczne współdzielone komponenty pozostają w `src/components` i nie są odtwarzane lokalnie pod tą samą nazwą;
7. struktura providerów Rust z Etapu 6 pozostaje zachowana.

## 5. Allowlista

`allowlist` w `scripts/architecture-boundaries.json` jest **pusta**.

Mechanizm dopuszcza wyłącznie wyjątek wskazujący dokładny `rule`, dokładny `importer`, dokładny `import/target` i uzasadnienie. Wildcardy są odrzucane. Nieużywany wpis allowlisty powoduje błąd, dzięki czemu stary wyjątek nie może pozostać bezterminowo.

**Świadome wyjątki Etapu 8:** brak.

## 6. Testy negatywne narzędzia

`verify:architecture` uruchamia przed audytem rzeczywistego drzewa pięć fixture tests:

- sztuczny runtime cycle jest odrzucany i raportowana jest pełna pętla;
- `domain -> storage` jest odrzucany także dla `import type`;
- feature → prywatny plik innego feature jest odrzucany;
- nieużywany wpis allowlisty jest odrzucany;
- poprawny cross-feature import przez publiczne `index.ts` przechodzi.

Te same scenariusze znajdują się w `src/architecture/architectureEnforcement.test.ts`, aby wejść również do zwykłego runnera Vitest po instalacji zależności.

## 7. CI i release workflows

`npm run verify:architecture` dodano po istniejących bramkach integralności do:

- `.github/workflows/ci.yml`;
- `.github/workflows/release-windows.yml`;
- `.github/workflows/release-linux.yml`.

Każde naruszenie kończy proces kodem różnym od zera i podaje regułę, importer, niedozwolony import/target oraz szczegół. Dla cyklu raportowana jest pełna ścieżka.

## 8. Walidacja lokalna kandydata

Na dokładnym drzewie Etapu 8 wykonano:

- `npm run verify:source` — **PASS**;
- `npm run verify:ux-data` — **PASS**;
- `npm run verify:architecture` — **PASS**;
  - 198 produkcyjnych plików TS/TSX przeanalizowanych;
  - 0 wpisów allowlisty;
  - self-tests pięciu wymaganych scenariuszy — **PASS**.

`npm ci` został uruchomiony, ale środowisko audytowe nie miało dostępu DNS do `registry.npmjs.org` (`EAI_AGAIN`). Z tego powodu w tym środowisku nie można uczciwie podać wyniku pełnego Vitest, project typecheck ani Vite build dla kandydata. Nie podano przewidywanej liczby testów „na oko”. Lokalnie nie ma również `cargo`, więc `cargo test` i Clippy pozostają obowiązkową bramką niezależnego odbioru/GitHub Actions.

### Uwaga o ekstrakcji Unicode

Systemowe linuksowe `unzip` w środowisku audytu renderowało poprawne nazwy Unicode z archiwum R1 jako `#U...`. Central directory ZIP oraz ekstrakcja Python `zipfile` potwierdziły prawidłowe nazwy źródłowe. Do przygotowania Etapu 8 użyto ekstrakcji zachowującej Unicode. Bazowy source-tree po prawidłowej ekstrakcji został ponownie policzony zgodnie z manifestem i wynosi dokładnie `03d0fd8ae3c43ed4083540fd84fe2ca6aa1fae1d0b04ad09014163e5eabf8d21`.

## 9. Status odbioru

Dokładny STAGE-8-R1 przeszedł niezależny audyt oraz pełny zielony GitHub Actions potwierdzony przez użytkownika, obejmujący wymagane bramki frontendowe i natywne.

Status końcowy:

`COMPLETED — FULL GITHUB ACTIONS PASS`

Końcowy runtime smoke całej modularizacji pozostaje celowo częścią Etapu 9 i nie jest warunkiem ponownego otwarcia Etapu 8.
