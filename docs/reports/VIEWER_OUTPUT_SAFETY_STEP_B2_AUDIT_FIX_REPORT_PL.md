# VIEWER OUTPUT SAFETY — STEP B2 AUDIT FIX

## Cel

Poprawka po audycie B2. Zakres pozostaje ograniczony do Training blind Resume. Research i Markdown nie są zmieniane.

## Poprawione problemy

1. Training blind Resume używa teraz `createSessionReplay()` tak samo jak RV Sessions. Do RV Lite przekazywane są zarówno `replay.repository`, jak i `replay.chat`. Zaakceptowane kroki są odtwarzane, a provider jest wywoływany dopiero dla pierwszego brakującego kroku. Durable Viewer ledger B1 zachowuje poziom recovery i blokadę uncertain dispatch.
2. Dodano trwały etap `blind_initializing`. Training rezerwuje `sessionId` i `sessionCode` oraz zapisuje minimalny zamrożony pakiet inicjalizacyjny przed wejściem do kontrolera RV Lite. Pakiet zawiera zamrożony Viewer system prompt, Viewer Notes i hash automatycznego Revealu.
3. RV Lite może użyć zarezerwowanej `sessionIdentity`. Session Snapshot jest zapisywany przed callbackiem `onSessionCreated`. Callback w Training promuje checkpoint z `blind_initializing` do `blind_running` dopiero po trwałym zapisie snapshotu.
4. Crash window jest odzyskiwalny:
   - brak sesji i snapshotu: ponowienie inicjalizacji pod tym samym zarezerwowanym sessionId;
   - sesja istnieje, snapshotu brak: dokończenie inicjalizacji tej samej sesji bez drugiego INSERT;
   - sesja i snapshot istnieją, checkpoint nadal `blind_initializing`: promocja do `blind_running`, następnie zwykły B1 replay;
   - snapshot bez sesji: jawne zatrzymanie jako niespójność.
5. Po zapisaniu snapshotu tymczasowy `blindInitialization` jest usuwany z checkpointu. Długoterminowym źródłem zamrożonego kontekstu pozostaje immutable Session Snapshot.
6. Istniejące zachowanie crash-after-Reveal pozostaje idempotentne: stan `Revealed` promuje checkpoint bez ponownego blind.

## Testy dodane/rozszerzone

- rzeczywisty RV Lite + `createSessionReplay`: P1 accepted -> P2 `length` -> symulowany crash po trwałym `VIEWER_OUTPUT_INCOMPLETE` -> restart -> P1 replay -> pierwszy live dispatch P2 z 32K;
- sprawdzenie, że callback powiązania sesji następuje po zapisie Session Snapshot;
- recovery `blind_initializing` z istniejącą sesją i brakującym snapshotem;
- recovery `blind_initializing` po zapisaniu snapshotu;
- istniejące testy: frozen Field Guide/Viewer Notes, crash po Reveal bez ponownego blind.

## Weryfikacja lokalna

- `tsc --noEmit -p tsconfig.json`: PASS, 0 błędów.
- `npm run verify:ux-data`: PASS, 31 migracji.
- `npm run verify:architecture`: niepotwierdzone lokalnie, brak `node_modules/@babel/parser` w środowisku roboczym.
- Pełny Vitest/build: nieoznaczone jako PASS z tego samego powodu niepełnych zależności testowych.
- Schema: 031, bez migracji SQL.

## Zakres audytu odbiorczego

Audyt powinien szczególnie sprawdzić rzeczywisty kontroler Lite i replay, crash windows pomiędzy session row / snapshot / checkpoint, uncertain dispatch B1 oraz brak podwójnego Reveal/learning. B2 nie zmienia Research.
