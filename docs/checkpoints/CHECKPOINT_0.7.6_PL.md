# AI RV Harness — checkpoint 0.7.6

Data: 19.08.2026  
Status: kompletne źródło wydania przygotowane do CI i Windows GitHub Action

## Stan produktu

AI RV Harness pozostaje lokalną aplikacją Tauri 2 + React/TypeScript + Rust + SQLite. Dane formalnych sesji, Reveale, oceny Judge, Training i Research są przechowywane lokalnie. Surowe klucze API pozostają w magazynie poświadczeń systemu operacyjnego i nie trafiają do backupów ani eksportów.

## Zrealizowany zakres 0.7.6

1. Przenośny backup i przywracanie z natywnym wyborem folderu.
2. Nowe bezpieczne ustawienia początkowe: duży tekst i `avoid_profile`.
3. Rozdzielenie stałych 84 Training Targets od dowolnych My Targets.
4. Automatyczne sesje zwykłe używają tylko My Targets.
5. Jasna opcja celu podawanego dopiero po części ślepej.
6. Zerowe początkowe liczniki treningu częściowego.
7. Rozwijana historia i czytelny eksport Training.
8. Automatyczny losowy dobór celów przy blokadzie Research.
9. Rozwijana historia i czytelny eksport Research.
10. Dokładne polecenia kontrolera w transkryptach sesji.
11. Polski Viewer Prompt zgodny z zaakceptowaną treścią.
12. Nieprzerywająca Smart Guillotine dla jednoznacznych pętli generacji.
13. Responsywny edytor Profilu ze sticky footerem.
14. Ujednolicona informacja MIT / CC BY 4.0 bez osobnego wyjątku dla logo.
15. Zapis pojedynczej kompletnej sesji do dowolnie wskazanego folderu.

## Niezmienniki bezpieczeństwa

- Target Reveal nie może trafić do Viewera ani Monitora przed zapieczętowaniem części ślepej.
- Zapisany transcript pre-Reveal jest niezmienny; rozmowa po Revealu ma oddzielny zapis.
- Ocena Judge używa wyłącznie dozwolonego pakietu dowodowego.
- Wyniki Research są zamrażane przed odślepieniem mapowania.
- Cele fabryczne są nieedytowalne i jest ich dokładnie 84.
- Przywracanie najpierw weryfikuje backup, następnie tworzy safety backup, dopiero później zamyka bazę i dokonuje zamiany.
- Backup nie zawiera surowych kluczy API.
- Ochrona przed pętlą nie ocenia znaczenia odpowiedzi. Reaguje dopiero na 60 kolejnych identycznych linii, 600 identycznych znaków, silnie powtarzany ogon albo granicę 120 000 znaków.

## Kontrola lokalna

- TypeScript: `npm run typecheck`.
- Testy frontendowe: 57 plików, 137 testów — wszystkie zakończone powodzeniem.
- Build web: `npm run build`.
- Rust + Clippy + instalator Windows: workflow GitHub Actions, ponieważ lokalne środowisko przygotowania paczki nie zawiera toolchainu Rust.

Dokładny wynik końcowego przebiegu jest zapisany w `RELEASE_VERIFICATION_v0.7.6.txt` dołączonym do paczki.

## Pliki źródła prawdy

- `RV_Harness_Release_v0.7.6_Functional_Specification_PL.md` — aktualny opis as-built;
- `RELEASE_NOTES_v0.7.6.md` — różnice względem 0.7.5;
- `RELEASE_PLAN_v0.7.6.md` — zaakceptowane wymagania i ich status;
- `README.md` — uruchamianie, architektura, licencje i workflow;
- `UPLOAD_TO_GITHUB.md` — bezpieczne wgranie kompletnej paczki.
