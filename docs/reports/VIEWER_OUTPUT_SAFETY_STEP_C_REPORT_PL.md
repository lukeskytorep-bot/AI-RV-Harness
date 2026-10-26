# VIEWER OUTPUT SAFETY — STEP C

## Zakres

Baza: zaakceptowany `VIEWER_OUTPUT_SAFETY_STEP_B3_AUDIT_FIX_2`, SHA-256 paczki bazowej `ab8b0e942496c57eb737c7ecc397ce64e96015b39a06cefe44e1ea048eee347d`.

Etap C obejmuje wyłącznie izolację renderowania ślepego transkryptu Markdown oraz utwardzenie klasyfikacji repetition/resource guard. Nie zmienia protokołów RV, polityki 16K/32K, schema SQLite, Experiment Lock ani logiki Resume z B1–B3.

## 1. Izolacja Markdown

Dodano `BlindTranscriptRecord`, który buduje widok z trwałych `SessionEventRecord` i renderuje każdą instrukcję/odpowiedź osobnym `SafeMarkdown`.

Obsługiwane bloki:

- `CONTROLLER_STEP`;
- `SPECIAL_TASK_INJECTED`;
- `MONITOR_INTERVENTION`;
- `VIEWER_RESPONSE`;
- `VIEWER_SPECIAL_TASK_RESPONSE`;
- `VIEWER_MONITOR_RESPONSE`;
- `VIEWER_OUTPUT_INCOMPLETE`.

Dzięki temu niedomknięty fenced code w jednej odpowiedzi Viewera nie może zmienić interpretacji Markdown następnej fazy, Special Task ani kolejnej odpowiedzi.

`SessionInspection` pobiera teraz `listSessionEvents(sessionId)` i używa tego widoku. Obejmuje to wspólny ekran inspekcji używany przez RV, Training i Research.

Live RV również odświeża eventy bieżącej sesji i renderuje je przez ten sam komponent. Niekompletna próba może więc zostać pokazana nawet wtedy, gdy nie weszła do zaakceptowanego `preRevealTranscript`.

### Legacy

Jeżeli stara sesja nie ma użytecznej struktury eventów, nie próbujemy dzielić tekstu heurystycznie po `## Phase` / `## Faza`. Fallback renderuje przechowywany transcript literalnie w `<pre>`. Chroni to przed przejęciem parsera Markdown i nie modyfikuje źródłowego materiału.

## 2. Repetition/resource guard

Dotychczasowa zasada z Step A pozostaje: sam rozmiar odpowiedzi, także >120 000 znaków, nie jest dowodem pętli.

Dodatkowo:

- fenced code blokowany backtickami lub tyldami jest maskowany na potrzeby analizy repetition;
- czysto strukturalne linie/separatory nie są traktowane jako semantic repetition;
- długie ciągi znaków typowych dla separatorów/rysunków (`-_=+*~|.:`) nie są samodzielnym dowodem runaway;
- repeated-tail detector wymaga obecności znaków literowych lub cyfrowych w powtarzanym bloku;
- rzeczywisty powtarzany tekst nadal daje `stop`.

Przy wykrytym runaway kontrolery nadal zatrzymują sesję przed następnym krokiem, ale oprócz `OUTPUT_TRUNCATED_LOOP` zapisują teraz `VIEWER_OUTPUT_INCOMPLETE` z zachowanym użytecznym fragmentem, `accepted:false`, `reason:"repetition_runaway"`, długościami i SHA-256 surowego outputu. Nie jest tworzony zaakceptowany `VIEWER_RESPONSE`.

Objęte ścieżki: Full RCP, RV Lite, Custom oraz Telepathic, w tym Special Task, odpowiedź Viewera na Monitor oraz telepathic Resume.

## 3. Testy dodane/zmienione

- otwarty fence w odpowiedzi fazy nie wpływa na Markdown kolejnej fazy;
- `VIEWER_OUTPUT_INCOMPLETE` jest osobnym blokiem prezentacji;
- legacy fallback pozostaje literalny i nie jest heurystycznie dzielony;
- odpowiedź >120k znaków pozostaje `clear`;
- długie separatory strukturalne pozostają `clear`;
- duży fenced drawing pozostaje `clear`;
- prawdziwe 60 identycznych zdań nadal daje `stop`;
- RV Lite potwierdza zapis `VIEWER_OUTPUT_INCOMPLETE` przy runaway i brak zaakceptowanego `VIEWER_RESPONSE`.

## 4. Kontrole lokalne

- syntaktyczna transpilacja wszystkich zmienionych TS/TSX przez TypeScript 5.8.3: PASS, 0 błędów;
- `verify:ux-data`: PASS, 31 migracji;
- dodatkowe bezpośrednie sprawdzenie repetition guard: real loop=`stop`, separator=`clear`, fenced drawing=`clear`, duży poprawny output=`clear`;
- `npm ci --ignore-scripts`: nie zakończył się w dostępnym czasie; lokalne `node_modules` pozostało niepełne;
- `verify:architecture`: nieuruchomione do końca z powodu brakującego lokalnie `@babel/parser`;
- pełny Vitest/typecheck/build: do potwierdzenia przez audyt i CI.

Schema pozostaje `031`; migracje nie są zmieniane.

## 5. Warunki odbioru

Audyt powinien szczególnie sprawdzić:

1. open fence w P4 + P5 nadal renderuje P5 jako osobny Markdown;
2. to samo w `SessionInspection` dla Training/Research;
3. fallback starej sesji bez eventów nie wykonuje heurystycznego splitu;
4. runaway zapisuje partial jako incomplete, ale nie jako accepted response i nie przechodzi do następnej fazy;
5. separator/fenced drawing/duży prawidłowy output nie daje false positive;
6. prawdziwa pętla nadal jest zatrzymywana;
7. pełny Vitest, typecheck, build, `verify:architecture`, `verify:ux-data` i GitHub Actions są zielone.
