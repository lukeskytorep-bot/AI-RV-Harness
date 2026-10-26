# Telepathy Fixed Lead / Transcript UX — poprawka po audycie

Data: 2026-10-11. Status: **POST-AUDIT CANDIDATE do ponownego audytu**. A1–A8 poprawiono w kodzie. Odbiór natywny i wizualny pozostaje otwarty.

## Baza i stosowanie paczki

Baza: `AI-RV-Harness-ai-rv-2.zip`, SHA-256 `534b7c96458895625fd969949a1dfe5ac12cbc6f9716b56474d1493f9c375f6e`. Kontynuowano źródła wcześniejszego kandydata z tego samego workspace. Nie użyto main ani WIKI_RELEASE_SYNC_1 jako bazy.

Nowa paczka `POST_AUDIT_CHANGED_FILES.zip` jest **zbiorczą nakładką względem oryginalnego ai-rv-2**: zawiera wcześniejszą implementację oraz poprawki audytowe. Nakładać ją na oryginalną bazę, zachowując ścieżki od katalogu głównego projektu. Nie wymaga najpierw nakładania poprzedniej paczki; zastępuje jej pliki. Manifest zawiera listę i SHA-256 każdego pliku. Nie wykonano push, merge ani publikacji.

Wersja aplikacji pozostaje 0.7.13, schemat 031. Wszystkie 31 migracji porównano bajtowo z oryginalnym ZIP-em: identyczne. Rozszerzenia checkpointu pozostają w istniejącym `plan_json._runtime`, bez migracji historycznych.

## Poprawki

| Punkt | Zmiana i dowód lokalny |
|---|---|
| A1 | Native `execute_statement` traktuje zero zmienionych wierszy upsertu rodzica jako konflikt. Obie transakcje batch — zwykła i fenced — dostają błąd przed zapisem dzieci i wykonują rollback. TS sprawdza także brak revision jako 0; odczyt wstępny jest tylko szybką kontrolą, ochronę wyścigu zapewnia transakcja. Test adaptera prawdziwego SQLite odtwarza native kontrakt: wyścig po odczycie, zwykły/fenced zapis, ledger, refleksje, uczestnicy i rundy nie ulegają regresji. Dodano również natywny test Rust, jeszcze nieuruchomiony. |
| A2 | Gateway waliduje JSON i kontrakt decyzji zanim zapisze `succeeded`. Odrzucona odpowiedź pozostaje diagnostyką `failed` z treścią, metrykami i numerem próby; instrukcje nie są rozsyłane. Resume zużywa drugą próbę, nigdy trzecią. Walidacja replay zabezpiecza także starsze błędne rekordy transportowego sukcesu. Testy: błędny JSON, błędni odbiorcy, restart z poprawną decyzją, trwałe wyczerpanie dwóch błędów. |
| A3 | Fingerprint obejmuje wiadomości, model, ustawienia generacji rozstrzygnięte przez capabilities, transport reasoning, endpoint/provider/model route, niestandardowe pole limitu wyjścia i sufit modelu. Każda próba zapisuje `requestSettings`, także po SQLite round-tripie. Wybrano **blokadę driftu przed dispatch**, zamiast automatycznie przyjmować nowe ustawienia. Planowe 16K → 32K nie zmienia kontraktu kroku. Zaakceptowany wynik jest odtwarzany bez ponownego resolve route/wywołania. Testy engine w browser i SQLite: temperature, reasoning, endpoint, restart na 32K; mounted oba panele: temperature/reasoning po Stop. |
| A4 | Wspólny guard human mutations czyta aktualny stan pod lease i odrzuca archiwum. Recovery również wymaga restore. Projekcja i panel nie pokazują formularzy kroków/recovery dla archiwum. Otwórz, Zapisz i Przywróć pozostają dostępne. Testy obu backendów obejmują cel, potwierdzenie, pierwszy/drugi blind, guidance, refleksję, sharing/komentarz oraz legalny cel po restore; mounted Conversation obejmuje readonly archiwum. |
| A5 | Tokeny i koszt mają znaną sumę oraz liczbę wywołań bez pełnego raportu. Wszystko nieznane pokazuje „brak danych”, częściowe dane — znaną sumę i brakujące raporty. Zachowano oznaczenie szacunkowego kosztu także przy częściowym pokryciu. Reasoning nie jest doliczany drugi raz. Testy obejmują measured zero, brak/partial/full usage, szacunek i fizyczne próby bez pełnych danych. |
| A6 | Bezpieczna projekcja tworzy jawny adapter legacy dla zapisanych blind answers, refleksji rund i refleksji końcowych. Zachowano osobną flagę legacy: nowy pusty transcript nie jest legacy. Przed Reveal człowiek będący odbiorcą nie widzi cudzych blinds ani celu. Mounted Conversation sprawdza stary zapis przed/po Reveal; eksport korzysta z tej samej projekcji i nie rekonstruuje promptów. |
| A7 | SQLite odróżnia NULL od świadomego `""` komentarza. Testy round-trip: NULL, pusty i niepusty tekst; browser/SQLite po odczycie ukończonego pustego komentarza nie otwierają ponownie sharing step. |
| A8 | Conversation podczas `busy` odczytuje co 500 ms tylko bezpieczną projekcję, bez nakładających się odczytów. Polling nie zmienia wybranej rundy. Cleanup i identyfikator workspace/serii odrzucają późne wyniki; operacja przy zmianie workspace/unmount jest przerywana. Mounted test pokazuje pierwszy checkpoint i narastające metryki przed końcem zadania, działający Stop, zachowaną rundę oraz odrzucenie późnego odczytu po zmianie workspace. |

Drobne uwagi UX: toggle historii ma wspólny tooltip hover/focus; Conversation ma etykiety „wymiany”, Training zachowuje „trening”. Materiały żądania są powiązane ze statusem call; dispatched/uncertain/failed pokazują wysłanie niepotwierdzone. Nie dodano nowych przycisków pomocy, preflight kosztowego, SessionCostGuard, rotacji dla nowego protokołu ani ręcznego generowania obowiązkowej refleksji.

## Weryfikacja

- Pełny Vitest: **1332 PASS**, 1 istniejący skipped; **241 plików PASS**, 1 skipped; bez unhandled errors.
- Siedem prób regresji audytora A1–A7: PASS, dołączone jako utrzymywane `independentAudit.test.ts` i `independentAudit.sqlite.test.ts`. Adapter SQL uzupełniono o kontrakt native odrzucający zero-row upsert przed dziećmi; nie zmieniono oczekiwanego zachowania testów.
- Typecheck, build, architecture, ux-data, source integrity, release structure: PASS. Release structure jest sprawdzeniem strukturalnym, nie dowodem wykonania aplikacji.
- `git diff --check`: PASS; migracje 001–031 identyczne bajtowo z bazą.
- SQLite: rzeczywisty `node:sqlite`, rollback konfliktu, lease/fence, archive/restore, checkpoint/reopen i fizyczny backup. To nie jest test działającej aplikacji Tauri ani potwierdzenie Rust bridge.
- Świeżego `npm ci` nie powtarzano w tym obrocie: wykorzystano zainstalowane wcześniej zależności po udokumentowanym `npm ci` poprzedniego kandydata; manifest i lockfile niezmienione.

## Otwarty odbiór i ograniczenia

`cargo test --manifest-path src-tauri/Cargo.toml` nie uruchomił testów: brak `cargo` (exit 127). Bridge TypeScript ↔ Rust także zablokowany brakiem cargo. Natywny guard i test zostały dołączone do źródeł; **nie mają tutaj wyniku runtime PASS**. Native CI musi potwierdzić transakcje zwykłe/fenced oraz reopen właściwej aplikacji.

Nie wykonano rzeczywistego wizualnego smoke ani płatnych wywołań dostawców. Testy DOM nie potwierdzają layoutu szeroko/wąsko, długich nazw, 125/150% zoom, obu motywów, sticky scroll ani natywnego eksportu. Do ponownego odbioru pozostają oba tryby, Stop/Resume, archive/restore, legacy i metryki podczas pracy w prawdziwym UI.

Próby nowego protokołu zapisane przez stary kandydat bez fingerprintu ustawień nie mają wystarczających danych do udowodnienia niezmienności requestu. Zaakceptowane wyniki pozostają odtwarzalne; ponowny dispatch niedokończonego starego kroku może zostać bezpiecznie zablokowany przez nowy fingerprint. Nie resetowano ledgeru ani liczników, nie odtwarzano nieznanych ustawień z aktualnego profilu. Stary protokół sesji pozostaje obsługiwany osobno.

Geografia zwiększa różnorodność, nie gwarantuje unikalności/zgodności wygenerowanego celu. Brakujące historyczne prompty pozostają jawnie brakujące.
