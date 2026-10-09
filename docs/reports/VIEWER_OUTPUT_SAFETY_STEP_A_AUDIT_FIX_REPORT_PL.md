# Viewer Output Safety — Etap A — poprawki po audycie

Data: 2026-10-09

## Zakres

Poprawiono sześć problemów potwierdzonych w audycie Etapu A, bez rozszerzania prac na późniejsze etapy B–D.

### 1. Replay nie może przesunąć odpowiedzi z późniejszej fazy

`resumeReplay.ts` nie filtruje już jedynie pojedynczych niekompletnych eventów. Wyznacza pierwszy
nierozstrzygnięty `VIEWER_OUTPUT_INCOMPLETE` według tożsamości kroku (`phase`, `promptNumber`
lub `step`, plus `source` / `exchangeNumber`) i nie odtwarza odpowiedzi z późniejszych kroków
jako zastępstwa.

Jeżeli po niekompletnej próbie istnieje późniejszy zaakceptowany event tego samego kroku,
próba jest uznana za rozstrzygniętą i replay może kontynuować dalej.

### 2. `error` i `content_filter` nie są sukcesem

`viewerResponseCompletion()` rozróżnia teraz:
- `complete`
- `output_limit`
- `empty`
- `provider_error`
- `refusal`

Jawne `error` / `failed` / `failure` oraz odmowa / content filter nie mogą przejść do następnej fazy.
Starszy niepusty zapis bez `finishReason` zachowuje ścieżkę zgodności.

### 3. Budżet każdej próby jest sprawdzany względem kontekstu i znanych limitów modelu

Każda semantyczna próba 16K/32K wykonuje kontrolę rzeczywistego zarezerwowanego outputu względem
`contextTokens` przed dispatch.

Znany `model.capabilities.maxOutputTokens` nie jest już usuwany dla OpenRoutera.
Jeżeli znany limit jest niższy, budżet jest ograniczany do tej pojemności; recovery nie jest wysyłane,
gdy nie daje większego realnego budżetu. Jawnie ustawiony budżet ponad znany limit jest odrzucany,
zamiast być cicho przepuszczany.

Dalsza walidacja konkretnej trasy w `executeProviderChat()` pozostaje aktywna.

### 4. Manual RV zapisuje diagnostykę prób

Dla `manual_rv` niekompletna próba nie trafia jako zaakceptowana wiadomość assistant.
Jej diagnostyka jest trwale zapisywana w `metadata_json` wiadomości użytkownika:
- reason / semanticAttempt / recoveryLevel
- requested/effective output budget
- finish reason / provider request id
- usage
- częściowy tekst

Po sukcesie ta sama wiadomość użytkownika otrzymuje `viewerOutputAccepted` z metadanymi
zaakceptowanego wyniku.

Nie wymaga to migracji, ponieważ `chat_messages.metadata_json` już istnieje.

### 5. Resume nie zależy wyłącznie od tekstu komunikatu

`isRecoverableProviderInterruption()` rozpoznaje utrwalony `VIEWER_OUTPUT_INCOMPLETE`
z kodem przyczyny (`output_limit`, `empty`, `no_larger_recovery_budget`) przed `SESSION_STOPPED`.
Dzięki temu Special Task / Viewer output exhaustion może pozostać wznowione nawet wtedy,
gdy tekst komunikatu nie pasuje do starego regexu.

Blokady user stop / cost / safety / credential itd. pozostają nadrzędne.

### 6. Poprawione testy

- fixture `ProviderModel` w `viewerOutputRecovery.test.ts` zawiera wymagane `pricing`;
- test RV Lite porównuje pełne wejście obu prób zamiast szukać napisu `Step 1`;
- dodano test przesunięcia P1/P2/P3 w replay;
- dodano test, że zaakceptowane recovery tego samego kroku rozstrzyga wcześniejsze incomplete;
- dodano test `error` / `content_filter`;
- dodano test context limit;
- dodano test trwałej diagnostyki manual RV;
- dodano test recoverability z utrwalonego kodu przyczyny.

## Kontrole lokalne

- `verify:ux-data`: PASS, 31 migracji.
- syntaktyczna transpilacja zmienionych plików TypeScript: PASS.
- pełny `typecheck` nie może być uczciwie oznaczony jako PASS w tej kopii, ponieważ brak lokalnych
  definicji `vite/client` i `node` w `node_modules`.
- pełny Vitest/build nie uruchomiony lokalnie z tego samego powodu.

Autorytatywnym gate pozostaje GitHub Actions na aktualnej gałęzi.

## Schema

Schema nadal `031`. Brak migracji.
