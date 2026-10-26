# MONITOR STREAM TELEPATHY REPAIR — STEP 1 AUDIT FIX 2

## Zakres

Ta nakładka jest małą poprawką do złożonej linii:

1. `AI-RV-Harness-ai-rv-2 (2).zip` — SHA-256 `8c640348be226af3b971e1905932fe49656aadd161de361a14cb6707589944be`;
2. `MONITOR STREAM TELEPATHY REPAIR STEP 1` — SHA-256 `586f3943ff64abadae908cd5320a847919e8a387ab39a2e9cbd215975a49a44c`;
3. `STEP 1 AUDIT FIX` — SHA-256 `0806ce110e0e636143214ff974cf25ab174995d23cca5b550a42b2f43001d17a`.

Nie zawiera STEP 2, zmian UI kolejnych etapów ani zmian budżetów Telepathy.

## Naprawa regresji Stop / znany wynik

`runWithStreamingRepetitionGuard()` rozróżnia teraz dwa przypadki:

- request odrzucony/przerwany: parent Stop lub utrata nadrzędnego sygnału pozostaje przyczyną terminalną;
- provider zwrócił definitywny wynik: wynik nie jest odrzucany tylko dlatego, że Stop wyścignął się z końcem requestu.

Dzięki temu caller może utrwalić znany wynik i dopiero potem zatrzymać dalszy run.

`callViewerWithOutputRecovery()` otrzymał opcjonalny `abortSignal`. Po znanym wyniku `length` lub `repetition_runaway` najpierw utrwala `VIEWER_OUTPUT_INCOMPLETE`, a następnie respektuje Stop przed rozpoczęciem drugiej płatnej próby. Resume korzysta z trwałego recovery level. Kompletna odpowiedź może zostać przyjęta i zapisana, natomiast dalsza faza nie jest uruchamiana po Stop.

Sygnał został podłączony do RCP, RV Lite, Custom, Telepathic RV oraz Manual RV. Nowy engine Telepathy już zatrzymuje dalszą serię przez istniejący `checkStop()` po zapisaniu definitywnego provider call.

## Testy regresyjne

Dodano/zmieniono kontrole dla:

- definitywnej odpowiedzi zwróconej równocześnie ze Stop;
- znanego `length` przy Stop: zapis incomplete, brak drugiego requestu w tym samym runie;
- complete przy Stop: wynik pozostaje dostępny callerowi;
- dotychczasowego parent Stop przy odrzuconym transporcie;
- signed Anthropic: wadliwa pętla nie trafia do accepted continuation; trwałym dowodem jest `VIEWER_OUTPUT_INCOMPLETE` z hash/powodem, bez wymagania starego `OUTPUT_TRUNCATED_LOOP` na wspólnej ścieżce recovery;
- zaktualizowanego zamrożonego hash Viewer wiring po audytowanej zmianie, przy osobnym niezmienionym kontrakcie promptu Monitora.

## Kontrole wykonane lokalnie

- Node 22 parser/check dla zmienionych plików produkcyjnych TypeScript: PASS.
- `verify:ux-data`: PASS, 31 migracji.
- `verify:v0.7.14-release-gate`: PASS.
- `verify:source` na czystym złożonym drzewie: PASS.
- Migracje 001–031: niezmienione przez tę nakładkę.

Nie deklarowano lokalnego PASS dla pełnego Vitest/typecheck/build/architecture, ponieważ komplet zależności npm nie jest dostępny w tym środowisku. Pełne bramki powinny zostać ponowione w środowisku audytora/CI.
