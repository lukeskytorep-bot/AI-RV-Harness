# Architektura retry — bieżąca implementacja

Przegląd: 16.10.2026, kod po Training Continuity T5, schema 31. Podstawowa dokumentacja developerska jest po [angielsku](PROVIDER_RETRY_ARCHITECTURE_FINAL_EN.md); ten plik jest polskim odpowiednikiem.

## Własność wykonania

Rust wykonuje jedną fizyczną próbę HTTP. TypeScript requestExecutor.ts zarządza transportowym retry i raportem wszystkich fizycznych prób. Zmieniony prompt/output to nowa próba semantyczna, której polityka należy do domeny. Nie otaczać gotowego executora kolejną pętlą retry ani nie zmieniać modelu jako automatycznej naprawy.

configuredRetries oznacza dodatkowe próby, 0–5, domyślnie 2. Zero wyłącza retry transportowe, a nie każdy osobny kontrakt recovery. retry.ts najpierw respektuje semanticOutputStarted i błędy terminalne, potem rozpoznane przejściowe typy, pojedyncze recovery body/decode/JSON/empty i statusy HTTP. Obsługiwane statusy przejściowe to 408, 425, 429, 500, 502, 503, 504, 524 i 529. Cancellation/configuration/permanent nie stają się automatycznym retry. Retry-After jest ograniczony do 30 s; backoff z jitterem ma sufit min(8000,500*2**failedAttempt) ms. Stop przerywa również oczekiwanie.

## Dowody i recovery

response_finished oznacza odebrany cały transport, także odpowiedź odrzuconą. Nie dowodzi poprawności ani commit. Wcześniejszy unknown nie znika po późniejszej odpowiedzi. Provisional stream nie jest zaakceptowanym dowodem. Wspólna decyzja Resume zachowuje krok/fingerprint/historię; niepewny dispatch wymaga jawnego rozstrzygnięcia. Zaakceptowane wywołania są odtwarzane lokalnie.

Classic Training Field Guide i Viewer Notes mają własne trwałe limity dwóch wysłanych żądań na sesję/pakiet, wspólne dla fizycznych retry i napraw output/JSON/pojemności. Nie sumować niezależnych limitów. failed_preserved zachowuje dokładną pamięć lub jej brak i pozwala kontynuować opcjonalny learning; Stop/DB/ownership/hash/unknown nadal przerywają.

## Budżety

Automatyczny blind Viewer: 16K/32K. Manual RV: 32K/48K. Bieżący Judge/post-Reveal/Training Review: 32K/48K. Learning wymaga training_reveal i C+32K/C+48K, bez podnoszenia C. Live Monitor pozostaje 16K/32K. Zamrożone polityki Research i Telepatii zachowują swoje wersje; legacy Research bez polityki Judge ma 8K/16K dla brakujących ocen. Dokładna tabela i źródła: [bieżące przepływy](CURRENT_WORKFLOWS_v0.7.14_PL.md).

Nie ma twardego SessionCostGuard/CostAuthorization. Diagnostyka kosztów nie zastępuje ochrony niepewnego dispatchu.

## Kontrole

Testy retry/requestExecutor, Viewer Resume, learning SQLite, natywnego heartbeat i bridge pozostają oddzielnymi dowodami. Komendy: [Developer Guide EN](../development/README.md). Windows/płatne modele wymagają rzeczywistego [odbioru runtime](FINAL_RUNTIME_SMOKE_v0.7.14_EN.md), nie samego odczytu historycznego raportu.
