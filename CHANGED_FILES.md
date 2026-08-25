# AI RV Harness v0.7.8 — paczka zmienionych plików

Paczka zawiera wyłącznie pliki dodane lub zmienione w ramach integracji Protokołu Telepatycznego oraz naprawy Zadań Specjalnych.

## Instalacja

1. Rozpakuj zawartość ZIP bezpośrednio w katalogu głównym repozytorium `ai-rv-harness`.
2. Zezwól na zastąpienie istniejących plików.
3. Przejrzyj zmiany w Git i uruchom lokalne testy/CI przed publikacją.

Nie dołączono `node_modules`, `dist`, plików tymczasowych ani artefaktów kompilacji.

## Najważniejsze zmiany

- naprawiono Zadania Specjalne w Full RCP i RV Light: są teraz wykonywane jako osobne wywołania Viewera, zapisywane w zdarzeniach i widoczne w transkrypcie;
- zachowano ślepotę AI Monitora: treść Zadania Specjalnego jest udostępniana dopiero od właściwego punktu po Fazie 4;
- dodano Protokół Telepatyczny PL/EN do Automatic RV, AI Monitor RV oraz listy protokołów Manual RV;
- dodano dziewięciokrokowy kontroler telepatyczny, obowiązkowe pogłębienia po krokach 3–5, obsługę pytań po kroku 8 oraz przejście do Reveal po kroku 9;
- dodano odzyskiwanie przerwanej ręcznej sekcji pytań kroku 8 bez ponownego wykonywania kroków 1–8;
- rozdzielono zwykłe i telepatyczne cele użytkownika oraz dodano 10 dostarczonych celów startowych;
- zaktualizowano wersję aplikacji do `0.7.8` i plan wydania Revision 7.

## Weryfikacja wykonana w środowisku roboczym

- TypeScript: `tsc -b --pretty false` — OK;
- testy: 61 plików, 158 testów — wszystkie zaliczone;
- build web: `vite build` — OK;
- Vite zgłasza wyłącznie ostrzeżenie o paczce JavaScript większej niż 500 kB;
- Rust/Cargo nie były dostępne w środowisku, dlatego nie uruchomiono testów Rust ani Clippy i nie wygenerowano `Cargo.lock`. Te kontrole powinny wykonać lokalne środowisko Rust lub GitHub CI.

## Pliki

- `RELEASE_PLAN_v0.7.8_REVISION_7.md`
- `package-lock.json`
- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/src/providers.rs`
- `src-tauri/tauri.conf.json`
- `src/App.tsx`
- `src/components/ResearchBuilder.tsx`
- `src/components/TrainingScreen.tsx`
- `src/monitor/engine.ts`
- `src/monitor/prompt.ts`
- `src/resources/protocolRegistry.test.ts`
- `src/resources/protocolRegistry.ts`
- `src/resources/protocols/Telepathy_v1.1.en.md`
- `src/resources/protocols/Telepathy_v1.1.pl.md`
- `src/resources/systemPrompts.test.ts`
- `src/resources/systemPrompts.ts`
- `src/resources/telepathic-targets/t1.md` … `t10.md`
- `src/sessions/controller.test.ts`
- `src/sessions/controller.ts`
- `src/sessions/costGuard.ts`
- `src/sessions/modeCompatibility.test.ts`
- `src/sessions/modeCompatibility.ts`
- `src/sessions/rvLiteController.test.ts`
- `src/sessions/rvLiteController.ts`
- `src/sessions/telepathicController.test.ts`
- `src/sessions/telepathicController.ts`
- `src/sessions/telepathicControllerPrompts.ts`
- `src/sessions/types.ts`
- `src/storage/browserRepository.ts`
- `src/storage/repository.ts`
- `src/storage/sqliteRepository.ts`
- `src/styles/app.css`
- `src/targets/service.test.ts`
- `src/targets/service.ts`
- `src/targets/telepathicBundled.test.ts`
- `src/targets/telepathicBundled.ts`
- `src/targets/types.ts`
- `src/training/curriculum.ts`
- `src/types.ts`
- `src/version.ts`

## Pochodzenie Protokołu Telepatycznego

- `Telepathy_v1.1.en.md`: `9db147cf0935ecc33ca2cf307b46b7010c8f2e5428e8fafd62dc8f6004f3994b`
- `Telepathy_v1.1.pl.md`: `f0e25179748ed9df6f2a4e00e10c3f20f8d2743c776e7d18c6a76949deeeb8ba`

Pliki Markdown zostały przygotowane z zatwierdzonych wersji protokołu PL/EN, bez zmiany treści merytorycznej.
