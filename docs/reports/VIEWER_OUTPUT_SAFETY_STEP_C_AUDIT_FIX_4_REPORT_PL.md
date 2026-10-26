# VIEWER OUTPUT SAFETY — STEP C AUDIT FIX 4

Data: 2026-10-10

## Cel

Naprawa ostatniej uwagi audytowej STEP C: rozdzielenie języka interfejsu od języka zapisanej sesji przy rekonstrukcji blind transcriptu.

## Zmiany

- `BlindTranscriptRecord` otrzymuje osobno `interfaceLanguage` i opcjonalny `sessionLanguage`.
- `interfaceLanguage` steruje wyłącznie etykietami/nagłówkami prezentacji.
- `sessionLanguage` steruje wyłącznie rekonstrukcją zaakceptowanego transcriptu do porównania ze stored transcript.
- Brak `sessionLanguage` w legacy nie powoduje zgadywania: stored transcript pozostaje widoczny jako fallback.
- `SessionInspection` przekazuje `snapshot?.sessionLanguage` jako język sesji.
- Live RV przekazuje `resolvedLanguage` jako język uruchomionej sesji oraz `settings.interfaceLanguage` jako język UI.

## Testy regresyjne

Dodano przypadki:

1. sesja EN + interfejs PL — brak podwójnego fallbacku, etykiety PL;
2. sesja PL + interfejs EN — brak podwójnego fallbacku, etykiety EN;
3. legacy bez snapshot language — zachowany literalny fallback.

## Zakres

Brak zmian w:

- budżetach 16K/32K;
- Resume/replay;
- repetition guard;
- migracjach i schema;
- przechowywanym transkrypcie, hashach i promptach.

Schema pozostaje 031.

## Weryfikacja lokalna

Pełny Vitest/typecheck/build nie został uruchomiony lokalnie, ponieważ w aktywnym środowisku nie ma kompletnego `node_modules`/lokalnego TypeScript. Zmiany są ograniczone do kontraktu prezentacyjnego i testów; właściwą bramą pozostaje pełny audyt i CI projektu.
