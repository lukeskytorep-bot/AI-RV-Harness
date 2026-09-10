# AI RV Harness v0.7.13 — SECURITY-IPC-1B: credential routing hardening

**Data:** 10 września 2026  
**Status:** `CANDIDATE — INDEPENDENT AUDIT AND FULL GITHUB ACTIONS REQUIRED`  
**Baza:** zaakceptowany SECURITY-IPC-1A po pełnym zielonym GitHub Actions  
**Wymagany source-tree bazy:** `85faaecfde8e27b1d418579018d5e1f9221166b9b001f39abc6d97f407d58c61`

## Cel

SECURITY-IPC-1B zamyka konkretny problem wykryty przez SECURITY-IPC-0: WebView może obecnie wpływać na `provider_configs` poprzez istniejący raw SQL write surface, dlatego sama tabela SQLite nie może być źródłem autoryzacji określającym, do którego providera lub endpointu wolno wysłać zapisany sekret.

Etap nie usuwa jeszcze `sql:allow-execute` i nie przebudowuje repository. Sekret pozostaje w systemowym keychainie, a wraz z nim zostaje zapisany chroniony binding provider route.

## Wykonane zmiany

### 1. Wersjonowany rekord credentialu w keychainie

Nowe credentiale nie są już zapisywane jako sam tekst sekretu. `src-tauri/src/secrets.rs` zapisuje rekord v1 obejmujący:

- `version`;
- `credentialId`;
- `secret`;
- `providerKind`;
- `normalizedEndpoint`.

Rekord ma rozpoznawalny prefiks formatu. Nie jest kopiowany do SQLite, eksportów ani stanu frontendu.

### 2. Natywna kontrola bindingu przed wydaniem sekretu

`provider_discover_models` i `provider_chat` najpierw:

1. rozwiązują rzeczywisty base URL dla `ProviderKind`;
2. normalizują endpoint po stronie Rust;
3. proszą `secrets.rs` o sekret dla dokładnej pary provider + endpoint;
4. otrzymują sekret tylko wtedy, gdy `credentialId`, provider i endpoint zgadzają się z rekordem keychain.

Zmiana `provider_configs` w SQLite nie wystarcza więc do przekierowania wcześniej zapisanego sekretu.

Dla providerów ze stałym endpointem (`OpenRouter`, Google, OpenAI, Anthropic, Z.AI, DeepSeek, Mistral, Blackbox) binding korzysta ze stałego natywnego endpointu. Dla `CustomOpenai` binding obejmuje znormalizowany własny base URL.

### 3. Bezpieczna kompatybilność z legacy `secret-only`

Stary wpis keychain zawierający wyłącznie sekret jest nadal rozpoznawany przez:

- `has_credential`;
- `credential_identity_fingerprint`;
- usuwanie credentialu.

Nie jest jednak automatycznie autoryzowany dla providera na podstawie danych WebView/SQLite. Pierwsze użycie providera zwraca kontrolowany komunikat wymagający jawnego ponownego wpisania API key.

Settings otrzymał przy istniejącym providerze akcję ponownego wpisania API key. Rebind:

- zachowuje istniejący `providerConfigId` i zależne rekordy;
- zapisuje wersjonowany binding w systemowym keychainie;
- aktualizuje wyłącznie metadane maski/fingerprint;
- ponownie wykonuje test/model discovery dla tego samego providera.

Dla `CustomOpenai` rebind wykorzystuje dokładny aktualny base URL. Zmiana endpointu w SQLite bez rebindu skutkuje błędem binding mismatch. Aby zaakceptować nowy endpoint, użytkownik musi ponownie podać sekret.

### 4. Rozdzielenie create i rebind

`store_credential` służy do utworzenia nowego wpisu i odrzuca istniejący `credentialId`. `rebind_credential` wymaga istnienia credentialu i jawnie zastępuje jego chroniony rekord nowym rekordem związanym z podaną trasą.

Obie komendy są objęte istniejącym ACL głównego okna. AppManifest, permission i `invoke_handler` zawierają obecnie ten sam zestaw 35 komend.

## Testy

Dodano/rozszerzono ochronę testową dla:

- round-trip rekordu v1;
- wykrywania legacy `secret-only` bez automatycznej autoryzacji;
- odrzucenia podmiany providera;
- odrzucenia podmiany endpointu;
- odrzucenia podmiany `credentialId`;
- odrzucenia nieznanej wersji bindingu;
- kanonicznej normalizacji endpointu;
- wymogu używania `get_credential_for_binding` przez oba provider commands;
- braku `provider_configs` w natywnej granicy autoryzacji credentialu;
- przekazywania provider/base URL przez nowe credentiale i rebind;
- zachowania rebindu dla istniejącego `ProviderConfig` bez tworzenia nowego ID;
- obecności `store_credential` i `rebind_credential` w jawnym ACL/AppManifest.

Przewidywany wynik pełnego Vitest na bazie 1A: **140 plików testowych / 498 testów**. Dokładny wynik musi potwierdzić niezależny audyt/CI.

## Chronione obszary

SECURITY-IPC-1B nie zmienia:

- migracji `021–023` i nie dodaje `024`;
- `chat_thread_groups/thread_group_id`;
- controlled purge;
- Viewer Notes source snapshots;
- frozen/locked/immutable guards;
- `database_execute_transaction` ani raw SQL write surface;
- `sql:allow-execute`;
- TypeScriptowego transport retry;
- protokołów RV, Reveal, Resume, Research Lock/Blinding/Unblind;
- Judge scoring/freeze.

`provider_configs` pozostaje metadanymi produktu i źródłem konfiguracji UI, ale nie jest źródłem autoryzacji wydania sekretu przez keychain.

## Lokalna walidacja

W środowisku przygotowania wykonano:

- `node scripts/verify-source-integrity.mjs .` — PASS;
- `node scripts/verify-ux-data-compatibility.mjs .` — PASS;
- kontrolę AppManifest/ACL/`invoke_handler` — PASS, 35/35/35;
- statyczną kontrolę, że provider calls korzystają z `get_credential_for_binding` — PASS;
- statyczną kontrolę braku `provider_configs` w natywnej autoryzacji credentialu — PASS;
- kontrolę SHA migracji `021–023`, `database.rs` i TypeScript retry względem zaakceptowanej bazy — PASS, bez zmian;
- kontrolę braku migracji `024` — PASS;
- transpile/syntax check zmienionych plików TypeScript/TSX przy użyciu TypeScript compiler API — PASS.

Lokalne środowisko nie posiada `cargo`/`rustc` ani kompletnego `node_modules`, dlatego pełny Vitest, project typecheck, Vite, `cargo test` i Clippy pozostają obowiązkową bramką niezależnego audytu/GitHub Actions.

## Kryterium odbioru

Kandydat może otrzymać `COMPLETED` dopiero po:

1. pełnym Vitest;
2. project TypeScript typecheck;
3. produkcyjnym Vite build;
4. `verify:source`;
5. `verify:ux-data`;
6. `cargo test --all-targets --locked`;
7. `cargo clippy --all-targets --all-features -- -D warnings`;
8. potwierdzeniu testów binding mismatch i legacy compatibility;
9. kontroli, że `provider_configs` nie stał się źródłem autoryzacji;
10. potwierdzeniu braku zmian chronionych obszarów.

Po przyjęciu SECURITY-IPC-1B następny osobny krok to **SECURITY-IPC-1C — zamknięcie raw SQL write surface**. Etap 7 pozostaje zablokowany do zakończenia 1C i jego pełnego odbioru.
