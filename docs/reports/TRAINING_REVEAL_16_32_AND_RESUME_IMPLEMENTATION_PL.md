# Training Reveal 16/32 + Resume — raport wdrożenia

Data: 2026-10-09

## Baza

Zmiana została przygotowana na aktualnej zaakceptowanej linii złożonej z:
- `AI-RV-Harness-ai-rv-2 (6).zip`
- `STEP6_CONVERSATION_PREFLIGHT_CHANGED_FILES`
- `STEP6_CONVERSATION_PREFLIGHT_TYPE_FIX`
- `STEP6_FINAL_RELEASE_GATE_CHANGED_FILES`
- `SHARED_PROFILE_SELECTOR_CHANGED_FILES`
- `SHARED_PROFILE_SELECTOR_AUDIT_FIX`
- `UNIFIED_MODULE_HELP_CHANGED_FILES`

Nie użyto porzuconego `PROFILE_SWITCHER_ACTUAL_FIX`.

SHA-256 bazowego `(6).zip`:
`d5db8309194238613560ca3a768b0224574aacb7cfc8cd82e7bc7bf76ee6189b`

Schema pozostaje `031`. Brak nowej migracji.

## Wdrożone zmiany

### 1. Jawna polityka budżetu Training Reveal

Dodano typowaną politykę `training_reveal` do wspólnego mechanizmu analytical output recovery.
Brak polityki zachowuje dotychczasowe limity pozostałych przepływów.

Dla zwykłego Training po Revealu:
- Viewer Review: 16 384, następnie jedno recovery 32 768 po `length`;
- Field Guide Update: `capacity + 16 384`, następnie `capacity + 32 768`;
- Viewer Notes Reflection: `capacity + 16 384`, następnie `capacity + 32 768`.

Polityka jest przekazywana jawnie z `trainingExecution.ts` do trzech operacji.
Naprawy JSON i capacity retry w Field Guide / Viewer Notes zachowują tę samą politykę.
Nie zwiększono `reasoningMaxTokens=10_000`, reasoning effort ani liczby semantic recovery.

Dla OpenRouter polityka Training Reveal pozwala skierować wymagany limit do istniejącej kontroli
rzeczywistego endpointu zamiast zatrzymywać pierwszą próbę wyłącznie na ogólnym `maxOutputTokens`
modelu. Potwierdzony limit endpointu nadal może obniżyć/odrzucić żądanie przed dispatch.

### 2. Resume niepewnego Viewer Review

Dodano `trainingResumeRecovery.ts`.

Istniejący przycisk `Wznów / Resume`:
- pobiera świeży `TrainingRun`;
- używa wyłącznie `activeTargetCheckpoint.sessionId`;
- odzyskuje już zapisaną kompletną opinię bez ponownego wywołania;
- dla zwykłego failed/pending kontynuuje bez dialogu;
- tylko dla unresolved `uncertain/dispatched` Viewer Review pokazuje istniejący `dialogs.confirm`;
- anulowanie nie zmienia checkpointu i nie wysyła requestu;
- po potwierdzeniu ponownie sprawdza stan pod istniejącym `withPostRevealReviewLease`;
- dopiero wtedy zapisuje trwałe rozstrzygnięcie `failed` istniejącym mechanizmem domenowym;
- następnie zwykły Training Resume ponawia tylko brakujący etap.

Dodano synchroniczny `resumeGuard`, aby podwójne kliknięcie nie uruchamiało dwóch ścieżek Resume.

### 3. Field Guide attemptCount

Pierwsza operacja Field Guide nie wymusza już `attemptCount: 1` po błędzie, jeżeli analytical
length recovery faktycznie dotarło do drugiego dispatch. Licznik jest aktualizowany przy
rzeczywistym rozpoczęciu logicznej próby providerowej. Lokalny stop przed dispatch nie udaje
drugiego wysłanego żądania.

Semantyka licznika pozostaje liczbą logicznych prób generacji Field Guide/capacity, a nie liczbą
fizycznych transport retry wykonywanych wewnątrz request executora.

## Testy dodane / rozszerzone

- `outputRecovery.test.ts`: 16k→32k dla Training Review, capacity+16k→capacity+32k dla obiektu uczenia,
  oraz potwierdzenie braku zmiany domyślnej polityki.
- `trainingExecution.test.ts`: sprawdza jawne przekazanie `budgetPolicy: "training_reveal"` do trzech etapów.
- `trainingResumeRecovery.test.ts`: anulowanie, trwałe rozstrzygnięcie pod lease oraz odzyskanie
  kompletnego Review bez dialogu.

## Kontrole wykonane lokalnie

- `verify:ux-data`: PASS, 31 migracji.
- transpile/syntax TypeScript dla 11 zmienionych plików TS/TSX: PASS.
- `verify:source`: na rozpakowanej kopii nadal FAIL wyłącznie z odziedziczonego problemu
  escaped Unicode filenames / brakujących dokumentów z GitHub ZIP, tak jak w poprzednich pracach.
- pełny `typecheck`, Vitest i build: nie oznaczono jako PASS lokalnie, ponieważ `npm ci`
  nie ukończyło instalacji zależności w środowisku roboczym.

Autorytatywnym kolejnym gate jest GitHub Actions na aktualnej gałęzi.

## Runtime

Większy budżet zmniejsza ryzyko `length`, ale nie gwarantuje braku innych błędów providera.
Ścieżka Resume jest osobnym zabezpieczeniem dla naprawdę niepewnego wyniku.
