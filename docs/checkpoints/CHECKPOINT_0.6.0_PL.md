# AI RV Harness — checkpoint 0.6.0

Stan: rdzeń funkcjonalny v1 jest zaimplementowany i objęty testami TypeScript/SQLite. Checkpoint nie jest oznaczony jako pełne v1, ponieważ brakuje dwóch zatwierdzonych pakietów treści.

## Gotowe

- Profile, Workspace, Chat Conversation/Manual RV i izolacja kontekstu.
- Providerzy, bezpieczne API keys, dynamiczny registry modeli, capabilities, Favorites.
- Full RCP v1.5a PL/EN, Automatic, Automatic + AI Monitor, Custom Protocol i ordinary batch.
- STOP, retry, timeout, cost stop, autosave, crash/recovery bez cichego powtarzania płatnych runów.
- Reveal tekst/obrazy, zapieczętowany pre-reveal, osobny post-reveal Viewer transcript.
- AI Judge 1–3, 3+3+2+2, niezależne konteksty, frozen scores, vision guard.
- 7 szablonów Research, Preflight, Experiment Lock, randomizacja, recovery, freeze → unblind, wyniki i export.
- Target Clarification dopiero po Reveal; w Research dopiero po frozen scores.
- Calibration History, metryki token/cost/time, Session Code, repeat policy.
- Backup/Restore/Export, managed artifacts, Monitor export, redacted API debug view.
- 9 migracji SQLite z triggerami chroniącymi evidence i Research Lock.

## Brakujące dane wejściowe

1. Dokładny, zatwierdzony zasób **RV Lite PL i EN**. Nie został zastąpiony wymyślonym/parafrazowanym tekstem.
2. **10 starter Training Targets** z zasobami i metadanymi źródła/licencji bezpiecznymi do redystrybucji.

## Weryfikacja środowiska

- `npm run typecheck` — OK.
- pełne `npm test -- --run` — OK, 23 pliki / 50 testów.
- `npm run build` — OK; Vite zgłasza wyłącznie ostrzeżenie o chunku JS > 500 kB.
- 9 migracji SQLite + testy triggerów integralności — OK.
- skan źródeł pod kątem przypadkowo zapisanych kluczy API — bez rzeczywistych poświadczeń.
- kompilacja natywnego Tauri/Rust i instalatora Windows — do wykonania na środowisku z toolchainem Rust/Tauri; w bieżącym środowisku Rust nie jest zainstalowany.

Pełne v1 można oznaczyć dopiero po dostarczeniu dwóch brakujących pakietów treści i przejściu natywnego build/QA na Windows.
