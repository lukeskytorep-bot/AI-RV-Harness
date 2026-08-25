# AI RV Harness 0.7.9 — informacje o wydaniu

Wersja 0.7.9 zawiera kompletny zakres 0.7.8 oraz nowe zabezpieczenia i przygotowanie wieloplatformowego procesu wydawniczego.

## Najważniejsze zmiany

- jeden natywny przycisk załączników w Conversation i Manual RV dla TXT, Markdown, tekstowych PDF, DOCX oraz obrazów PNG/JPEG/WebP/GIF;
- bezpieczny parser dokumentów z limitami rozmiaru, czasu, stron, złożoności XML, liczby wpisów ZIP i współczynnika kompresji;
- weryfikacja sygnatury, rozszerzenia, wymiarów i pełnego dekodowania obrazów;
- dołączone w niezmienionej postaci cztery dokumenty PL/EN: protokół telepatyczny 1.1 i słownik percepcyjny pola;
- widoczny limit outputu i wspólny konserwatywny estymator kontekstu używany przez interfejs oraz kontrolę przed wysłaniem;
- usunięte formalne sterowanie stanem BLIND/REVEALED z Manual RV;
- automatyczny backup bazy przed migracją, blokada migracji po błędzie backupu oraz walidacja integralności, kluczy obcych, schematu i wersji migracji;
- Blackbox jako provider korzystający z udokumentowanego interfejsu OpenAI-compatible i stałych oficjalnych endpointów;
- współdzielony klient HTTP, prywatna diagnostyka szczegółowa wyłączona domyślnie oraz bogatsze metadane odpowiedzi providera;
- automatyczne retry tylko dla odpowiedzi 425/429, z ograniczonym `Retry-After`; timeout, błąd sieciowy i 5xx wymagają świadomego wznowienia;
- workflowy Draft Release dla Windows NSIS/MSI i Linux AppImage/DEB;
- GitHub Artifact Attestations dla wszystkich oczekiwanych pakietów, pełne SHA akcji, Dependabot i CodeQL dla JavaScript/TypeScript oraz Rust.

## Ważne przed publikacją

Ta paczka jest kompletnym kandydatem źródłowym, ale nie należy publikować wydania bez wykonania `RELEASE_CHECKLIST_v0.7.9.md`. W szczególności repozytorium musi zawierać przejrzany `src-tauri/Cargo.lock`, a pakiety muszą przejść Rust CI, test instalacyjny i weryfikację attestation.

