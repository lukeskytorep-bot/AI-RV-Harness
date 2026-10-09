# Viewer Output Safety — Etap A — poprawki po drugim audycie

Data: 2026-10-09

Poprawiono trzy pozostałe problemy z drugiego audytu Etapu A.

## 1. Legacy replay z `VIEWER_RESPONSE + finishReason:length`

Bariera replay obejmuje teraz zarówno nowe `VIEWER_OUTPUT_INCOMPLETE`, jak i starsze eventy
providerowe oznaczone jako niekompletne / błędne przez `finishReason`, `accepted:false` lub `failed:true`.

Przypadek:
P1 complete -> P2 legacy `length` -> P3 complete

odtwarza P1, a następnie przechodzi do live Resume P2. P3 nie może zostać podstawione jako P2.
Jeżeli późniejsza zaakceptowana odpowiedź ma ten sam identyfikator kroku, wcześniejsza niekompletna
próba może zostać uznana za rozstrzygniętą.

## 2. Domyślne 16K nie jest zastępowane przez maksymalną pojemność modelu

Dla zwykłej polityki Viewer:
- brak jawnego limitu lub jawny limit <= 16K -> pierwsza próba 16K;
- recovery -> 32K, jeśli route/model rzeczywiście pozwala na większy budżet;
- jawnie ustawiony limit > standardowego poziomu nie jest obniżany.

Manual RV wykonuje również swój wstępny context preflight z budżetem wynikającym z tej samej polityki,
zamiast używać `model.capabilities.maxOutputTokens` jako domyślnego żądania.

Przykład modelu z pojemnością 65536 nie powoduje już automatycznego ustawienia pierwszej próby Manual RV
na 65536. Standard pozostaje 16384.

## 3. Fixture telepathic recovery

Test recovery kontrolera telepatycznego otrzymał prawidłową predefiniowaną treść pytania Step 8.
Nie zatrzymuje się już na walidacji pustej listy przed osiągnięciem badanego recovery 16K -> 32K.

## Testy regresyjne

Zaktualizowano `resumeReplay.test.ts`, aby:
- dawny `length` był barierą także wtedy, gdy po nim istnieje Monitor/P3;
- jawnie odtworzyć P1 complete -> P2 legacy length -> P3 complete i sprawdzić brak przesunięcia.

## Schema

Schema pozostaje 031. Brak migracji.

Pełnego Vitest/typecheck/build nie oznaczono lokalnie jako PASS, ponieważ ta kopia robocza nie zawiera
kompletnego `node_modules`. Autorytatywnym gate pozostaje GitHub Actions.
