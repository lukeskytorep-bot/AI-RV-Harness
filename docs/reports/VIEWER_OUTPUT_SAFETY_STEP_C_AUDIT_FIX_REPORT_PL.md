# VIEWER OUTPUT SAFETY — STEP C AUDIT FIX

Data: 2026-10-10

## Zakres

Poprawka wyłącznie do zaakceptowanej bazy B3 + STEP C. Nie zmienia schematu danych ani migracji.

## Poprawki po audycie

1. Repetition guard nie maskuje już całej zawartości fenced code. Maskowane są wyłącznie linie o charakterze rysunkowym/strukturalnym. Powtarzany tekst wewnątrz backtick/tilde fence nadal jest analizowany i może zatrzymać sesję.
2. BlindTranscriptRecord buduje nagłówki faz/kroków z metadata zdarzeń (`phase`, `promptNumber`, `step`, `questionNumber`, `telepathicPhase`) zamiast wymagać, aby model/prompt umieszczał nagłówek w treści.
3. Niepełny zestaw eventów nie ukrywa zapisanego `fallbackTranscript`. Jeżeli eventy nie zawierają wystarczającej pary instrukcja + zaakceptowana odpowiedź, zapisany transcript jest pokazany literalnie, a eventy niekompletnej próby osobno.
4. `postRevealContextBoundary.test.ts` ma zaktualizowany hash zaakceptowanego Telepathic Viewer-only STEP C wiring. Osobny hash kontraktu promptu Monitora pozostaje bez zmian.

## Testy dodane / poprawione

- powtarzane zdania w fenced block → `stop`;
- fenced ASCII drawing → `clear`;
- realny RV Lite zatrzymuje fenced textual runaway przed następnym krokiem i Reveal;
- Phase/RV Lite/Telepathic headings pochodzą z metadata;
- pojedynczy `VIEWER_OUTPUT_INCOMPLETE` nie ukrywa starszego zapisanego transcriptu;
- dotychczasowa izolacja niedomkniętego Markdown fence pozostaje testowana.

## Kontrole lokalne

- syntaktyczna transpilacja wszystkich 7 zmienionych plików TS/TSX: PASS;
- bezpośrednia kontrola repetition guard: fenced textual loop=stop; fenced drawing=clear; structural separators=clear; >120k non-repetitive=clear;
- próba uruchomienia Vitest nie została zaliczona jako PASS: lokalne środowisko nie ma binarki `node_modules/.bin/vitest`, a `npx` zakończył się timeoutem;
- migracje nie zostały zmienione; schema pozostaje 031.

Pełny Vitest, typecheck, build, verify:architecture i verify:source powinny zostać wykonane przez audyt/CI na kompletnej bazie.
