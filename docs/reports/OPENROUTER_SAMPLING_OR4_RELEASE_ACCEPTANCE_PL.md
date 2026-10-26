# OR-SAMPLING-4 — Final release gate i dokumentacja

**Data:** 2026-10-17  
**Baza:** zielony `AI_RV_HARNESS_OR_SAMPLING_3_SOURCE_FIXED_2`  
**Schema:** 32  
**Zakres:** finalizacja OpenRouter Additional Sampling Parameters

## 1. Werdykt

**PASS implementacyjny / release-candidate, z jawnym pozostawieniem płatnego runtime smoke do wykonania przez operatora.**

OR-SAMPLING-4 nie zmienia logiki samplingu. Synchronizuje dokumentację, potwierdza dostępne release gates i zapisuje granice dowodowe. Kod bazowy OR-SAMPLING-3 SOURCE_FIXED_2 został zgłoszony przez operatora jako zielony w CI przed rozpoczęciem tego kroku.

Nie deklaruje się wykonania płatnego OpenRouter API ani Windows desktop runtime w tym środowisku.

## 2. Funkcja końcowa

OpenRouter Viewer profile może opcjonalnie włączyć `top_p`, `top_k` i `seed`.

- sekcja jest domyślnie wyłączona;
- Auto oznacza brak klucza w request;
- `0` pozostaje wartością manualną;
- temperatura jest niezależna;
- parametry nie przechodzą automatycznie do Monitor/Judge ani innych providerów;
- aktywny manualny parametr unsupported/unknown blokuje zapis profilu, ale zapamiętana wartość nie jest automatycznie kasowana;
- użytkownik może jawnie ustawić parametr na Auto albo wyłączyć całą sekcję;
- manual sampling wymusza endpoint capability preflight także dla małych requestów;
- niepotwierdzone wsparcie parametru kończy się local stop przed dispatch;
- `provider.require_parameters=true` jest dodatkowym zabezpieczeniem wire dla manualnego samplingu;
- Session/Research snapshot i Resume zachowują zamrożone ustawienia;
- klasyczny optional learning zachowuje Training Continuity T5.

## 3. Dostępne kontrole wykonane w OR-SAMPLING-4

| Kontrola | Wynik |
| --- | --- |
| `npm run verify:ux-data` | PASS — 32 migracje, schema 032 rozpoznana |
| `npm run verify:v0.7.14-release-gate` | PASS — schema 32 |
| `npm run verify:runtime-ownership` | PASS |
| statyczna obecność migration 032 / UI / validator / Rust wire fields / RV Sessions propagation | PASS |
| `npm run verify:openrouter-continuation-bridge` | NIE WYKONANO — Vitest nie jest zainstalowany; `npm ci` zakończone TransportTimeoutError |
| pełny Vitest / typecheck / Vite build / architecture | NIE WYKONANO lokalnie — zależności nie zostały zainstalowane; bazowy SOURCE_FIXED_2 był zgłoszony przez operatora jako zielony w CI |
| `npm run verify:source` | NIE MOŻE BYĆ użyty jako czysty dowód dla tej kopii ZIP — verifier wykrywa znane artefakty `#U...`/brakujące runtime docs w archiwum ekstrakcyjnym |
| Cargo / Clippy `-D warnings` | NIE WYKONANO w tym środowisku |
| Windows desktop runtime | NIE WYKONANO |
| rzeczywisty płatny OpenRouter API | NIE WYKONANO — wymaga jawnej zgody operatora i credential |

Nie zamieniać pozycji „NIE WYKONANO” na PASS na podstawie samego source review.

## 4. Dokumentacja zsynchronizowana

Zaktualizowano:

- `docs/wiki/Development-Status.md` — schema 32 i status sampling;
- `docs/wiki/Providers-Models-and-AI-Monitor.md` — semantyka UI/Auto/manual, ownership, routing i ograniczenia reprodukowalności;
- `docs/README.md` — registry do schema 032;
- dodano `docs/architecture/OPENROUTER_SAMPLING_PARAMETERS_v0.7.14_EN.md` — pełny kontrakt i runtime checklist.

## 5. Ryzyko i reprodukowalność

Seed nie gwarantuje identycznych odpowiedzi między providerami, endpoint variants, model revisions ani różnymi backendami samplingu. Jest wartością żądaną, nie dowodem deterministycznego wykonania.

Manualne `top_p`, `top_k` i `seed` zawężają zbiór dopuszczalnych endpointów. Mogą więc zmienić dostępność, latency i koszt względem Auto. Harness nie może twierdzić, że wewnętrzny sampler został faktycznie zastosowany tylko dlatego, że API przyjęło request.

## 6. Runtime smoke wymagający operatora

Na dokładnym release candidate, z jawnie zatwierdzonym kluczem OpenRouter, wykonać:

1. legacy OpenRouter / sampling disabled — brak nowych samplerów i `require_parameters`;
2. enabled + wszystkie Auto — brak nowych samplerów i `require_parameters`;
3. `top_p=0.04`, `top_k=0`, `seed=42` — zapis/restart/request;
4. mały request — potwierdzić capability preflight;
5. unknown/unsupported endpoint metadata — zero dispatch;
6. duży Training Reveal — wybrana trasa spełnia sampling i capacity;
7. dwa warianty tego samego providera — potwierdzić, że finalny selector rzeczywiście nie otwiera wariantu odrzuconego;
8. STOP/Resume po zmianie profilu — stare ustawienia snapshotu pozostają;
9. Research Lock po zmianie profilu/modelu — frozen settings pozostają;
10. optional Guide/Notes failure — `failed_preserved`, brak trzeciego fizycznego dispatch;
11. diagnostyka/export — manual vs Auto/omitted bez sekretów;
12. porównać route/provider/cost z Auto, ponieważ manual sampling może ograniczyć routing.

## 7. Warunek pełnej runtime akceptacji

Pełny finalny runtime PASS funkcji można nadać dopiero po scenariuszach z sekcji 6 na dokładnym kandydacie. Brak płatnego smoke nie cofa poprawności implementacji ani zielonych automated gates, ale pozostaje uczciwie oznaczonym zakresem nieprzetestowanym.
