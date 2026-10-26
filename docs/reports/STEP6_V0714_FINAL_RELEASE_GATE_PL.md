# AI RV Harness v0.7.14 — STEP 6 final release gate

**Stan dokumentu:** kandydat do końcowej walidacji.  
**Zakres:** domknięcie planu v0.7.14 po zaakceptowanych Krokach 1–5.  
**Publiczne wydanie odniesienia:** v0.7.13.  
**Bieżący schema boundary:** 31.

## Cel

Krok 6 nie wprowadza nowego dużego subsystemu. Jego rolą jest udowodnienie, że funkcje dodane w 0.7.14 współistnieją z dotychczasowym produktem bez naruszenia izolacji, persistence, provider routing, backup/restore i istniejących trybów.

Automatyczna część gate'u obejmuje:

- source-integrity i UX-DATA compatibility;
- architecture boundary verifier;
- dedykowany `verify:v0.7.14-release-gate` pilnujący krytycznych markerów Steps 1–5 i schema 31;
- TypeScript typecheck;
- pełny Vitest;
- Vite build;
- Rust tests i Clippy;
- cross-language OpenRouter continuation bridge.

Manualna część gate'u jest opisana w `docs/architecture/FINAL_RUNTIME_SMOKE_v0.7.14_PL.md` i obejmuje realny desktop runtime, restart, provider calls, backup/restore oraz konkurencyjne Resume tam, gdzie jest to praktycznie możliwe.

## Inwarianty wymagane do zamknięcia

- target telepatyczny jest zamrożony przed blind i nie zmienia się przy Reveal;
- receiver nie otrzymuje targetu ani cudzych blind responses przed Reveal;
- `NO_SUBMISSION` nie generuje fikcyjnego porównania po Revealu;
- pusta, jawnie ukończona refleksja człowieka pozostaje ukończona po SQLite round-trip;
- telepathic series lease i post-Reveal review lease nie mogą być odnowione po wygaśnięciu;
- spóźniony właściciel nie może zapisać fenced checkpointu po przejęciu lease;
- AI–AI Training używa frozen Field Guide/Viewer Notes read-only i ich nie aktualizuje;
- Conversation attachment history zapisuje metadata prób, a nie bytes/base64/path obrazu;
- post-Reveal recovery wznawia pierwszy brakujący Viewer/Monitor stage i nie powtarza ukończonych kosztownych wywołań;
- `uncertain` wymaga jawnej decyzji operatora;
- wspólny provider executor pozostaje ostateczną kontrolą runtime context capacity, a preflight Conversation/Training jest informacją i blokadą konfiguracji przed Start;
- backup/restore i controlled purge zachowują zgodność schema 31 i nie tworzą orphan records.

## Status przed desktop smoke

Po zielonym CI automatyczna część Step 6 może otrzymać status `AUTOMATED GATES PASS`. Nie należy jeszcze oznaczać v0.7.14 jako wydanego ani Step 6 jako całkowicie zakończonego, dopóki nie zostanie wykonany runtime smoke i zapisany datowany raport dla dokładnego kandydata.
