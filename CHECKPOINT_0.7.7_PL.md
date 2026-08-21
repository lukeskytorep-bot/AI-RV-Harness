# AI RV Harness — checkpoint 0.7.7

## Stan

Checkpoint 0.7.7 jest kompletnym źródłem aktualizacji przeznaczonym do zastąpienia zawartości repozytorium 0.7.6 i uruchomienia workflow GitHub Actions `Release Windows`.

## Zrealizowany zakres

1. Uproszczono rozdział Factory Training Targets / My Targets.
2. Pełny trening jest stałym programem 84 celów, a częściowy wybiera liczby dla kategorii fabrycznych i My Targets od zera.
3. Viewer wykonuje automatyczną samoocenę po Revealu; Monitor wypowiada się po Viewerze.
4. Zwykłe i treningowe eksporty są czytelnymi plikami Markdown. Obrazowy Reveal eksportuje także rzeczywisty plik obrazu.
5. Research dodaje czytelne sesje i klucze `.md`, zachowując techniczne JSON-y dla audytu.
6. Uporządkowano Manual RV, listę ostatnich sesji, Special Task i język promptów profilu.
7. Utrzymano nieprzerywającą sesji ochronę przed jednoznacznym zapętleniem odpowiedzi.
8. Zsynchronizowano numer wersji i dokumentację licencyjną.

## Granice danych

- Dane pre-Reveal pozostają zapieczętowane i niezmienne.
- Review i rozmowa po Revealu są przechowywane poza transcript'em pre-Reveal.
- Obrazy Revealu są kopiowane do eksportu, a nie tylko opisywane ścieżką.
- Research nie ujawnia warunku Judge'owi przed zamrożeniem ocen.
- Sekrety API nadal pozostają w magazynie systemu operacyjnego i nie trafiają do eksportów.

## Dokumenty źródła prawdy

- `RV_Harness_Release_v0.7.7_Functional_Specification_PL.md`
- `RELEASE_NOTES_v0.7.7.md`
- `RELEASE_PLAN_v0.7.7.md`
- `RELEASE_VERIFICATION_v0.7.7.txt`
- `UPLOAD_TO_GITHUB.md`
