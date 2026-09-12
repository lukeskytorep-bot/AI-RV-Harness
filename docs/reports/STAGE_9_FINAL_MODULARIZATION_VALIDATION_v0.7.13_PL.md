# ETAP 9 — końcowa walidacja modularizacji i dokumentacja

**Status:** `CANDIDATE — PRE-RUNTIME AUDIT PASS; FINAL DESKTOP RUNTIME SMOKE REQUIRED`  
**Data:** 12 września 2026  
**Baza:** dokładny zaakceptowany `STAGE-8-R1 — Architecture Boundary Enforcement`  
**Bazowy complete-source ZIP SHA-256:** `8418576e09d62e4f1dc7d79f3fe7f58cc8405e1ef2b4fdb97db02e6cbd9ab463`  
**Bazowy source-tree:** `26c888fd2df96c269d0c61dfcf17ae4d8f561c639716f79b099df0b8083964d2`

## 1. Cel

Etap 9 jest końcową bramką całej modularizacji. Nie wprowadza nowej funkcji produktu ani nowej migracji. Jego zadaniem jest potwierdzić, że Etapy 1–8 są rzeczywiście zakończone, że granice architektury nie zawierają tymczasowych wyjątków, że dokumentacja odpowiada aktualnemu kodowi, że stare bazy przechodzą do migracji 023 bez utraty danych oraz że pełny desktopowy przepływ aplikacji działa po refaktoryzacji.

## 2. Proweniencja bazy

Zweryfikowano oba artefakty STAGE-8-R1:

- complete-source ZIP: `8418576e09d62e4f1dc7d79f3fe7f58cc8405e1ef2b4fdb97db02e6cbd9ab463` — zgodny z manifestem;
- changed-files ZIP: `dd1365e67ec658b8bbdad64f7205feeeddb2068707cbbae46019d468d4e2c5f6` — zgodny z manifestem.

Po ekstrakcji przez Python `zipfile`, która zachowuje poprawne nazwy Unicode, snapshot zawiera 721 plików i odtwarza dokładnie source-tree `26c888fd2df96c269d0c61dfcf17ae4d8f561c639716f79b099df0b8083964d2` według algorytmu `relative_path\0file_sha256\n`.

Systemowe `unzip` w środowisku audytu ponownie renderuje część poprawnych nazw Unicode jako `#U...`; nie jest to wada archiwum. Do obliczeń proweniencji użyto ekstrakcji zachowującej Unicode.

## 3. Stan Etapów 1–8

| Etap | Wynik końcowego audytu Etapu 9 | Podstawa |
| --- | --- | --- |
| 1 — mapa kodu i granice | `COMPLETED` | `CODE_MAP`, `MODULE_BOUNDARIES`, ADR i egzekwowane granice istnieją w bieżącym źródle. |
| 2 — centralny provider transport/retry | `COMPLETED` | Jeden właściciel retry w TypeScript; pojedyncza próba HTTP po stronie Rust; testy kontraktowe i wcześniejszy zielony GitHub Actions. |
| 3 — pierwszy wzorzec modułu frontendowego | `COMPLETED` | `src/features/home/` i publiczny entry point istnieją i są objęte regułami architektury. |
| 4 — odchudzenie `App.tsx` | `COMPLETED` | Zaplanowane ekrany mają moduły feature; krytyczna logika sesji pozostała u swoich właścicieli. |
| 5 — podział repository | `COMPLETED — 8/8` | Kontrakty Browser/SQLite istnieją dla wszystkich zaplanowanych domen; stabilna fasada zachowana. |
| 6 — providerzy Rust | `COMPLETED` | Fasada `providers.rs` i osobne adaptery/builders/parsers/reasoning/transport pozostają rozdzielone i chronione. |
| 7 — i18n/style/wspólne komponenty | `COMPLETED` | Modularne i18n/CSS i kanoniczne shared components są obecne; Unicode source guard pozostaje aktywny. |
| 8 — egzekwowanie granic | `COMPLETED — FULL GITHUB ACTIONS PASS` | Użytkownik potwierdził pełny zielony GitHub Actions dla dokładnego STAGE-8-R1; `@babel/parser` jest przypiętą zależnością dev, allowlista jest pusta. |

Etap 9 nie znalazł przesłanki do ponownego otwarcia żadnego z Etapów 1–8.

## 4. Końcowy audyt granic

Niezależny, read-only skan bieżącego `src/` wykazał:

- 198 produkcyjnych plików TypeScript/TSX;
- 471 rozwiązywalnych wewnętrznych krawędzi runtime;
- 0 cykli runtime;
- 0 prywatnych importów pomiędzy różnymi feature modules;
- 0 niedozwolonych zależności `src/domain/` do storage/features/provider infrastructure;
- 0 produkcyjnych importów konkretnej implementacji Browser/SQLite poza warstwą storage;
- `providerChatAttempt` pozostaje ograniczony do `src/providers/native.ts` i `src/providers/requestExecutor.ts`;
- `scripts/architecture-boundaries.json` ma pustą `allowlist`.

Nie pozostawiono prowizorycznego wyjątku architektonicznego. Legacy `chat_thread_groups/thread_group_id` jest świadomą warstwą zgodności danych, a nie wyjątkiem w regułach zależności. Workspace Sources, Custom Protocol version persistence i wybrane cross-domain lifecycle operations pozostają jawnie własnością stabilnej fasady `AppRepository`; Etap 9 formalizuje ten stan jako zaakceptowany kontrakt, a nie oczekujący „późniejszy split”. Ewentualne przyszłe przeniesienie wymaga osobnej decyzji architektonicznej i nie jest częścią niedokończonej modularizacji v0.7.13.

## 5. SQLite i migracje 001–023

Zweryfikowano dokładnie 23 pliki migracji `001`–`023`. Rejestr Rust jest ciągły, a `CURRENT_MIGRATION_VERSION` jest wyprowadzany z ostatniej migracji i ma wartość 23. Nie istnieje migracja 024.

W tym środowisku wykonano niezależny smoke SQLite przy użyciu silnika SQLite dostępnego w Pythonie:

1. fresh database: zastosowanie `001 → 023` — PASS;
2. `PRAGMA foreign_key_check` po fresh migration — 0 naruszeń;
3. `PRAGMA integrity_check` — `ok`;
4. baza v20: zastosowanie `001 → 020`, następnie `021 → 023` — PASS;
5. reprezentatywna baza legacy v20 z Profile, Workspace, Thread-group Conversation, Message, Target, RV Session, Training, locked Research i Viewer Notes — PASS;
6. zachowano `thread_group_id`, Message, target live reference i `target_id_snapshot`, Research `target_id_snapshot`, Viewer Notes live refs i immutable `source_snapshot_json` z Training provenance;
7. `controlled_purge_context` istnieje i pozostaje pusty po migracji;
8. `PRAGMA foreign_key_check` po upgrade — 0 naruszeń;
9. `PRAGMA integrity_check` po upgrade — `ok`.

Bieżące źródło zawiera ponadto natywne testy Rust dla fresh `001→023`, upgrade `020→023`, walidacji live database i backup/restore preflight dla migracji 23, oraz osobny reprezentatywny test kompatybilności UX-DATA v20→023.

## 6. Synchronizacja dokumentacji

W Etapie 9 zsynchronizowano living architecture documentation:

- `docs/architecture/CODE_MAP.md` — Etap 8 jest zamknięty, a Etap 9 jest końcową bramką;
- `docs/architecture/MODULE_BOUNDARIES.md` — poprawiono nieaktualny opis parsera: R1 korzysta z jawnej zależności `@babel/parser`, nie z parsera TypeScript „już obecnego” w projekcie;
- `docs/architecture/README.md` — dodano odnośnik i status końcowej walidacji;
- `docs/reports/STAGE_8_ARCHITECTURE_BOUNDARY_ENFORCEMENT_v0.7.13_PL.md` — status zsynchronizowany z pełnym zielonym GitHub Actions;
- dodano `docs/architecture/FINAL_RUNTIME_SMOKE_v0.7.13_PL.md` jako kanoniczną checklistę finalnego desktopowego smoke;
- główny plan modularizacji i Library Index są aktualizowane razem z paczką Etapu 9 poza repozytorium źródłowym.

## 7. Finalny runtime smoke — stan

Końcowy runtime smoke jest jedyną niezakończoną częścią Etapu 9. Musi zostać wykonany na rzeczywistym buildzie desktopowym Tauri, nie przez samą inspekcję źródła.

W tym środowisku nie można go uczciwie oznaczyć jako wykonany, ponieważ:

- `npm ci` nie może pobrać brakujących pakietów z rejestru, a cache nie zawiera pełnego zestawu zależności;
- nie ma lokalnego `cargo` ani `rustc`;
- środowisko nie udostępnia interaktywnego desktopowego WebView/Tauri;
- pełny provider smoke wymaga rzeczywistej, autoryzowanej konfiguracji credential/provider.

Dlatego Etap 9 **nie otrzymuje jeszcze `COMPLETED`**. Nie zastępujemy finalnego runtime smoke samą analizą statyczną ani faktem, że wcześniejsze GitHub Actions są zielone.

Kanoniczna checklista: `docs/architecture/FINAL_RUNTIME_SMOKE_v0.7.13_PL.md`.

## 8. Werdykt

**Kod i architektura:** `PASS`  
**Etapy 1–8:** `COMPLETED`  
**Granice / prowizoryczne wyjątki:** `PASS — 0 architecture allowlist exceptions`  
**Migracje / zgodność legacy:** `PASS`  
**Dokumentacja:** `SYNCED FOR STAGE 9 CANDIDATE`  
**Final desktop runtime smoke:** `REQUIRED`  

Status całego Etapu 9:

`CANDIDATE — PRE-RUNTIME AUDIT PASS; FINAL DESKTOP RUNTIME SMOKE REQUIRED`

Po zaliczeniu checklisty runtime bez regresji można zmienić Etap 9 i cały plan modularizacji na:

`COMPLETED — FINAL RUNTIME SMOKE PASS`.
