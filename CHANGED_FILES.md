# AI RV Harness v0.7.9 — zakres zmian względem kompletnego 0.7.8

Podstawowym artefaktem jest pełna paczka źródłowa 0.7.9. Ten plik służy tylko jako indeks zmian do przeglądu w Git.

## Kod i interfejs

- `src/App.tsx`, `src/styles/app.css`, `src/i18n.ts` — załączniki, dokumenty, kontekst/output, Blackbox, diagnostyka, typografia i uproszczenie Manual RV;
- `src/attachments/` — natywny import dokumentów/obrazów i obsługa czterech dokumentów wbudowanych;
- `src/chat/contextBudget.*`, `src/chat/outputPreference.*`, `src/chat/engine.*` — wspólne budowanie payloadu, estymacja i izolacja niezaufanych źródeł;
- `src/providers/` — Blackbox, diagnostyka prywatności, ostrożna polityka retry, rzeczywisty model i request ID;
- `src/sessions/*Controller.ts` — metadane wywołań, Retry-After oraz bezpieczne zachowanie USER STOP;
- `src/sources/`, `src/storage/` — PDF/DOCX, stan źródeł i walidacja bazy po migracji;
- `src/workflowSecurity.test.ts` — kontrola łańcucha dostaw workflowów.

## Warstwa natywna

- `src-tauri/src/documents.rs` — parser TXT/MD/PDF/DOCX, walidacja/dekodowanie obrazów i cztery dokumenty PL/EN;
- `src-tauri/src/dialogs.rs` — oficjalny natywny dialog Tauri;
- `src-tauri/src/storage.rs` — backup przed migracją i logiczna walidacja restore/live DB;
- `src-tauri/src/providers.rs` — Blackbox/OpenAI-compatible, współdzielony klient, diagnostyka i symulator kontraktowy;
- `src-tauri/src/artifacts.rs` — walidacja rzeczywistej zawartości obrazów;
- `src-tauri/migrations/019_add_blackbox_provider.sql` — migracja zachowująca dane i Favorites;
- `src-tauri/resources/documents/` — cztery oryginalne DOCX.

## Wydanie i bezpieczeństwo

- `.github/workflows/ci.yml`, `release-windows.yml`, `release-linux.yml`, `prepare-cargo-lock.yml`, `codeql.yml`;
- `.github/dependabot.yml`;
- `RELEASE_PLAN_v0.7.9_REVISION_1.md`, `RELEASE_NOTES_v0.7.9.md`, `RELEASE_CHECKLIST_v0.7.9.md`, `IMPLEMENTATION_REPORT_v0.7.9.md`;
- wersja `0.7.9` w npm, Tauri i kodzie aplikacji.

Pełną listę plików i ich sumy zawiera `SHA256SUMS.txt`.

