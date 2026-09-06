# AI RV Harness v0.7.13 — Training/Monitor Resume Stabilization

**Data:** 5 września 2026  
**Status:** zaimplementowane i zweryfikowane lokalnie; natywne GitHub Actions oczekują na potwierdzenie po zastosowaniu paczki

## Cel

Mały hotfix stabilizacyjny przed ekstrakcją RV Sessions usuwa dwa potwierdzone okna niespójności: ponowne wykonanie zapisanej pracy po awarii między skutkiem domenowym a checkpointem Training oraz użycie starego promptu Monitora z pamięci aplikacji po jego zapisaniu.

## Wprowadzone zmiany

### Durable Resume Training

- Przy checkpointcie `review_completed` Training pobiera zamrożone wyniki Judge i używa `selectMissingJudgeSelections(...)`.
- Jeżeli wszystkie wymagane wyniki już istnieją, nie następuje żadne nowe wywołanie providera; Training tylko domyka checkpoint `judging_completed`.
- Jeżeli istnieje część wyników, uruchamiani są wyłącznie brakujący Judge’owie.
- Przy checkpointcie `session_revealed` Training rozpoznaje ukończony automatyczny Viewer Review w zapisanym transkrypcie po dokładnym, kanonicznym poleceniu i następującej po nim odpowiedzi Viewera.
- Zapisany Review jest ponownie używany do idempotentnej refleksji Viewer Notes zamiast ponownego pytania Viewera. Istniejąca ochrona przez hash pakietu zapobiega powtórzeniu ukończonej refleksji.
- Dowolna ręczna rozmowa post-Reveal nie jest błędnie uznawana za automatyczny Review.

### Zapis promptu AI Monitora

- Dodano wąską operację repository `setProfileMonitorSystemPrompt(profileId, prompt)` dla SQLite i browser storage.
- Zapis promptu nie przepisuje już całej konfiguracji AI Profile z potencjalnie nieaktualnego obiektu UI.
- Po udanym zapisie `App.tsx` odświeża kanoniczną listę Profiles; następna sesja uruchomiona bez restartu używa nowego promptu.
- Błąd początkowego ładowania historii Monitora ma osobny, widoczny komunikat i nie jest maskowany przez Empty State.

### CI i integralność source

`npm run verify:source` został dodany po `npm ci` do głównego workflow CI oraz workflowów Windows i Linux Release.

Po czerwonym przebiegu wcześniejszego commita Git potwierdzono dodatkowo rozjazd numeru wersji `0.7.12`/`0.7.13`. Kumulatywna nakładka zawiera teraz wszystkie pliki wersji wymagane do ustawienia `0.7.13`: `package.json`, `package-lock.json`, `src/version.ts`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` i `src-tauri/Cargo.lock`. Istniejące testy `version.test.ts` oraz `versionConsistency.test.ts` chronią ich zgodność.

## Testy regresyjne

Dodano testy potwierdzające, że zapisane oceny Judge nie powodują ponownego wywołania providera po Resume, zapisany automatyczny Viewer Review jest używany bez drugiego wywołania Viewera, a zapis promptu Monitora zmienia tylko dedykowane pole i odświeża kanoniczny stan Profile.

## Weryfikacja lokalna

- `npm run typecheck` — zaliczone;
- `npm test -- --run` — **102 pliki testowe / 310 testów**, zaliczone;
- `npm run build` — zaliczone;
- `npm run verify:source` — zaliczone.

Hotfix nie zmienia promptów Viewer/Monitor/Judge, rubryki Judge, allowlisty pakietu oceny, logiki scoringu ani maszyny zwykłej RV Session. Nie zmienia kodu Rust. Natywne testy i Clippy pozostają standardową bramką GitHub Actions po zastosowaniu paczki.

## Następny krok

Po zielonym GitHub Actions tego dokładnego kandydata można rozpocząć kontrolowaną ekstrakcję RV Sessions jako ostatniego dużego panelu Etapu 4.
