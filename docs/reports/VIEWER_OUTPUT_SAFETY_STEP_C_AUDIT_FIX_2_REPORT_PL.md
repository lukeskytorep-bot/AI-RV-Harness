# VIEWER OUTPUT SAFETY — STEP C AUDIT FIX 2

## Zakres

Poprawka odpowiada wyłącznie na trzy pozostałe uwagi audytu STEP C. Nie zmienia migracji, schematu ani zaakceptowanej bazy B3.

## Zmiany

1. `BlindTranscriptRecord` nie uznaje już pojedynczej pary instruction/response za dowód kompletności eventów. Literalny zapisany transkrypt pozostaje widoczny, dopóki zestaw eventów nie ma trwałego `PRE_REVEAL_SEALED`, nie zawiera niekompletnych/odrzuconych odpowiedzi, ma wymagane zaakceptowane odpowiedzi oraz obejmuje porównywalną objętość zapisanego transkryptu.
2. Odpowiedzi z `accepted:false` albo finish reason `length`, `max_tokens`, `error`, `content_filter` i odpowiednikami nie liczą się jako zaakceptowana pokrywa eventowa. Starsze odpowiedzi bez jawnego `accepted` pozostają zgodne, o ile nie mają znanego błędnego finish reason.
3. Event Custom Protocol z `metadata.customProtocol` i `metadata.step` otrzymuje nagłówek `Protokół własny — krok N` / `Custom protocol — Step N`, a nie Telepathic.
4. Stary test fenced guard został rozdzielony na dwa kontrakty: legalny strukturalny rysunek jest `clear`, a powtarzany tekst semantyczny wewnątrz fence jest `stop`. Kod produkcyjny guardu nie wymagał dalszej zmiany.

## Testy regresyjne

Dodano przypadki:
- zapieczętowany, lecz tylko częściowo reprezentowany event stream nie ukrywa dłuższego stored transcript;
- `accepted:false` nie liczy się jako zaakceptowana odpowiedź;
- `finishReason:length` nie liczy się jako zaakceptowana odpowiedź;
- Custom Protocol ma własny nagłówek;
- fenced structural drawing pozostaje `clear`;
- fenced repeated semantic text pozostaje `stop`.

## Kontrole lokalne

Składnia zmienionych TS/TSX została sprawdzona przez TypeScript `transpileModule`: PASS, 0 błędów składni.

Pełnego Vitest/typecheck/build nie deklaruje się jako PASS w tej kopii roboczej; odbiór powinien wykonać audytor i GitHub Actions na kompletnych zależnościach.

Schema pozostaje 031. Migracje bez zmian.
