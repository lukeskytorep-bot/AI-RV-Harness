# AI RV Harness v0.7.13 — zamknięcie gotowości wydania

> **Stan dokumentu:** RELEASED — WINDOWS AND LINUX ARTIFACTS VERIFIED  
> **Wersja źródła:** 0.7.13  
> **Commit wydania:** `b13fcc19245bbdc0f334d2ce22815a8c54444607`  
> **SQLite:** schema 027  
> **Data odbioru:** 30 września 2026  
> **Zasada publikacji:** GitHub Releases jest autorytatywnym źródłem publicznych binariów

## Stan funkcjonalny

Linia 0.7.13 została połączona z `main`, przeszła wymagane GitHub Actions i została zbudowana dla Windows oraz Linux. Obejmuje między innymi:

- zakończoną modularizację Etapów 1–9;
- UX-DATA lifecycle i compatibility epoch;
- Viewer Learning z oddzielnym Field Guide i Viewer Notes;
- 94 fabryczne cele Training w ośmiu kategoriach oraz Reveale PL/EN;
- typed Conversation/RV Workspaces;
- provider-native continuation dla zakontraktowanych transportów;
- OpenRouter stream canonicalization;
- analytical post-Reveal output recovery oddzielone od transport retry i capacity retry;
- Conversation Viewer Learning jako domyślnie włączony pakiet tylko do odczytu, gdy istnieje zgodna wytrenowana tożsamość;
- UI pomocy, Privacy, Credits i poprawiony Custom Protocol;
- schema 027 z kontrolowaną ścieżką 23→24→25→26→27 dla dokładnych zielonych granic.

## Zweryfikowane platformy

| Platforma | Pakiety | Wynik |
|---|---|---|
| Windows | NSIS `.exe`, MSI | Build z `main`, GitHub Actions, attestation i praktyczne uruchomienie: PASS. |
| Linux | AppImage, DEB | Build z `main`, GitHub Actions, attestation i praktyczne uruchomienie: PASS. |

Oba workflow wskazują ten sam commit wydania. Windows i Linux zachowują wspólną wersję aplikacji 0.7.13 oraz przypięty `src-tauri/Cargo.lock`.

## Atestacje

- Windows: <https://github.com/lukeskytorep-bot/AI-RV-Harness/attestations/51409244>
- Linux: <https://github.com/lukeskytorep-bot/AI-RV-Harness/attestations/51414231>

Dokładne nazwy artefaktów i SHA-256 znajdują się w `docs/releases/v0.7.13/SHA256SUMS.txt` oraz `RELEASE_VERIFICATION_v0.7.13.md`.

## Granica danych

v0.7.13 rozpoczyna nową epokę danych. Publiczne bazy v0.7.12 i wcześniejsze nie są automatycznie migrowane do bieżącego modelu. Ekran zgodności oferuje kontrolowany Start Fresh, który zachowuje poprzednią bazę i jej sidecary przed utworzeniem nowej bazy schema 027.

## Dokumenty odbiorowe

- `docs/releases/v0.7.13/RELEASE_NOTES_v0.7.13.md`;
- `docs/releases/v0.7.13/RELEASE_VERIFICATION_v0.7.13.md`;
- `docs/releases/v0.7.13/SHA256SUMS.txt`;
- `docs/releases/v0.7.13/SOURCE_IDENTITY.txt`;
- `docs/architecture/FINAL_RUNTIME_SMOKE_v0.7.13_PL.md`.

## Status końcowy

`v0.7.13 — RELEASED; WINDOWS AND LINUX ARTIFACTS VERIFIED`
