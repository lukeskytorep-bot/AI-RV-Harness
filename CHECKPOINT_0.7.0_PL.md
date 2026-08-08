# AI RV Harness — checkpoint 0.7.0

Stan: oba brakujące pakiety treści z checkpointu 0.6.0 są już włączone. Frontend i logika TypeScript przechodzą pełną weryfikację. Natywny Windows build pozostaje do wykonania przez przygotowany workflow GitHub Actions, ponieważ bieżące środowisko nie ma lokalnego toolchainu Rust.

## Zmiany względem 0.6.0

- RV Lite PL został zatwierdzony i dołączony jako wersjonowany zasób.
- RV Lite EN korzysta z wcześniej dostarczonego angielskiego źródła oraz uzgodnionego czterowywołaniowego flow.
- RV Lite wykonuje dokładnie 4 wywołania Viewera: Prompt 1 → Prompt 2 (Steps 1–2) → Prompt 3 (Step 3 + obowiązkowy Deepening Movement) → Prompt 4 (Functional Sketches) → Reveal.
- `Nemo` nie jest zaszyte w protokole. Powitanie używa nazwy/imienia aktualnego Profilu; przy pustej nazwie PL brzmi `Witaj, przedstawiam układ sesji RV.`
- Profil może mieć puste pole nazwy/AI name; UI pokazuje wtedy neutralną etykietę bez wstrzykiwania jej do promptu RV Lite.
- Dodano 10 starter Training Targets dostarczonych do projektu.
- Dawne numery plików i błędne pola `Target coordinates` zostały usunięte z pakietu. Kanoniczne Target ID to 1–10, a pliki mają nazwy `target_1.md` … `target_10.md`.
- Training Targets są seedowane idempotentnie przy pierwszym uruchomieniu i trafiają do tej samej kolekcji Training co przyszłe rozszerzenia.
- Dodano workflow `.github/workflows/release-windows.yml`: Windows runner + Node + Rust + testy + `tauri-apps/tauri-action@v1` + draft GitHub Release.
- CI zaktualizowano do wersji akcji używanych w aktualnym przykładzie Tauri.

## Weryfikacja

- `npm run typecheck` — OK.
- `npm test -- --run` — OK, **26 plików / 56 testów**.
- `npm run build` — OK; jedynie ostrzeżenie Vite o pojedynczym chunku JS > 500 kB.
- `npm audit --omit=dev` — **0 podatności**.
- skan źródeł pod kątem typowych wzorców rzeczywistych kluczy API — brak trafień.
- testy RV Lite wymuszają 4 wywołania, autosave przed kolejnym call'em, obowiązkowy Deepening, oddzielny Prompt 4, dynamiczne imię i Reveal dopiero po seal.
- test pakietu Training wymusza dokładnie 10 Target ID 1–10 i brak starych `Target coordinates`.

## Pozostała granica przed pierwszym instalatorem

Lokalny Rust nie jest wymagany po stronie użytkownika. Po umieszczeniu projektu w repozytorium GitHub workflow Windows może zbudować natywną aplikację i utworzyć draft Release. Pierwszy build na Windows musi jeszcze faktycznie przejść, zanim instalator zostanie nazwany zweryfikowanym wydaniem.
