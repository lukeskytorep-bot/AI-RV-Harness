# Viewer Output Safety — Etap A

Data: 2026-10-09

## Baza

Jedyna baza implementacji:
`AI-RV-Harness-ai-rv-2.zip`

SHA-256:
`e48feec377f883ffe8ae901d3310c12f01bd25f511760ca35ea3a16a6a093c8b`

Schema pozostaje `031`. Brak nowej migracji.

## Zakres Etapu A

Etap A wdraża fundament bezpieczeństwa wyjścia Viewera:
- wspólną politykę 16K -> 32K dla standardowych wywołań Viewera,
- klasyfikację `length` / `max_tokens` / `max_output_tokens` jako niekompletnej próby,
- dokładnie jedno semantic output recovery tego samego kroku,
- brak przejścia do następnego kroku po drugim `length`,
- trwałe zdarzenia `VIEWER_OUTPUT_INCOMPLETE`,
- metadane accepted/recovery level/budget na zaakceptowanych zdarzeniach,
- odrzucenie niekompletnych eventów przez Resume replay,
- usunięcie arbitralnego limitu 120 000 znaków z repetition guard,
- zachowanie prostego repetition guard wyłącznie dla jednoznacznych pętli,
- test regresyjny P1: 6 Touch/Echo Dot x 5 kroków bez fałszywego wykrycia pętli.

## Budżety

Standardowe ścieżki objęte polityką:
- `rv_session_viewer`
- `manual_rv_viewer`
- `training_blind_viewer`
- `research_viewer` z zachowaniem istniejącego zamrożonego budżetu w aktualnym etapie kompatybilności
- Viewer w RCP, RV Lite, Custom Protocol oraz kontrolerze telepatycznym

Dla standardowych nowych kroków:
- pierwsza próba: 16 384
- po jednoznacznym `length`: jedna próba do 32 768
- jeśli realny route nie daje większego budżetu, druga identyczna próba nie jest wysyłana

Jawnie większy istniejący budżet nie jest obniżany.

## Persistence / replay

Pierwsza odpowiedź zakończona limitem:
- nie jest dopisywana do accepted transcript/history,
- jest zapisywana diagnostycznie jako `VIEWER_OUTPUT_INCOMPLETE`,
- zawiera policy version, semantic attempt, recovery level, requested/effective output budget,
  finish reason, provider request id (jeżeli dostępny) i usage.

Zaakceptowane odpowiedzi zapisują `accepted: true` i wykorzystany poziom recovery.
Replay odrzuca:
- `accepted: false`,
- historyczne `VIEWER_RESPONSE` z finishReason `length` / odpowiednikami.

## Repetition / 120k

Usunięto `MAX_OUTPUT_CHARACTERS = 120_000` jako kryterium "generation loop".
Duża, ale niepowtarzalna odpowiedź powyżej 120k znaków nie jest już uznawana za repetition.

Pozostają wyłącznie proste, konserwatywne reguły:
- >=600 identycznych niebiałych znaków z rzędu,
- >=60 identycznych kolejnych linii,
- >=20 identycznych bloków na końcu odpowiedzi.

Jeżeli sanitizer faktycznie wykryje jednoznaczną pętlę, kontrolery nie zapisują przyciętego tekstu
jako ukończonego kroku i zatrzymują sesję.

Nie dodano specjalnej logiki Echo Dot do kodu produkcyjnego.

## Conversation

Zwykła Conversation pozostaje poza nową polityką budżetu.
Manual RV korzysta z 16K/32K recovery.

## Testy dodane / rozszerzone

- helper: `length -> stop`, dwa razy `length`, brak recovery po zwykłym `stop`,
- RCP: 16K -> 32K tego samego Phase 1 i brak akceptacji partial,
- RCP: drugi `length` zatrzymuje sesję przed Phase 2,
- RV Lite: 16K -> 32K i tylko recovery trafia do transcript,
- Custom Protocol: recovery tego samego kroku,
- Manual RV: partial assistant nie trafia do historii; Conversation zachowuje stary budżet,
- replay: dawny `VIEWER_RESPONSE` z `finishReason: length` nie jest sukcesem,
- repetition: pełny P1 z 6 Touch/Echo Dot x 5 kroków jest legalny,
- repetition: duża odpowiedź >120k bez runaway jest legalna.

## Kontrole lokalne

- `verify:ux-data`: PASS, 31 migracji.
- syntaktyczna transpilacja wszystkich zmienionych TS/TSX przez TypeScript: PASS.
- pełny typecheck/Vitest/build: nie deklarowano PASS lokalnie; dostępne `node_modules` jest niepełne.
- `verify:source` na kontenerowo rozpakowanym ZIP-ie nadal zgłasza odziedziczone escaped Unicode filenames
  i brak trzech dokumentów z nazwami Unicode. Nie aktualizowano verifiera ani hashy.

Autorytatywnym gate pozostaje GitHub Actions na dokładnej gałęzi użytkownika.

## Poza Etapem A

Nie jest to jeszcze zakończenie całego planu Viewer Budget/Recovery.
Dalsze etapy nadal obejmują:
- trwałe Resume poziomu recovery po restarcie,
- Training blind checkpoint przed pierwszym płatnym krokiem,
- rozróżnienie Research Resume vs restart,
- pełną izolację Markdown i przegląd infrastrukturalnych resource guards / diagnostyki.
