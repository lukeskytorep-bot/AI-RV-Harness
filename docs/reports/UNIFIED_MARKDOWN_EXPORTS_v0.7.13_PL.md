# AI RV Harness v0.7.13 — wspólny format eksportów Markdown

## Status

Zaimplementowano jako osobny, ograniczony krok funkcjonalno-architektoniczny towarzyszący modularizacji.

## Cel

Celem zmiany jest usunięcie rozbieżności pomiędzy czytelnymi eksportami Conversation, Manual RV, zwykłych RV Sessions i Training. Zmiana nie modyfikuje schematu bazy danych ani technicznych pól `createdAt` i `completedAt`.

## Wspólny moduł

Dodano `src/exports/document/`, który odpowiada za:

- wspólny model metadanych dokumentu;
- stałą kolejność pól;
- te same polskie i angielskie etykiety;
- jedno formatowanie dat i godzin;
- pomijanie pustych lub niepasujących pól;
- renderowanie nagłówka, metadanych i separatora dokumentu Markdown.

Eksportery domenowe pozostają adapterami. Nadal odpowiadają za wybór właściwych danych oraz za treści specyficzne dla swojego obszaru.

## Reguły czasu

1. `Utworzono` jest zapisywane, gdy rekord posiada `createdAt`.
2. `Zakończono` jest zapisywane wyłącznie wtedy, gdy dany workflow posiada rzeczywiste `completedAt`.
3. `Wyeksportowano` jest zapisywane we wszystkich objętych zmianą dokumentach.
4. Czas nie jest dopisywany do nagłówka każdej wiadomości.
5. Manual RV nie ma formalnego przycisku zakończenia i dlatego nie otrzymuje pola `Zakończono`.
6. `updatedAt` nie jest traktowane jako czas zakończenia.

## Adaptery

### Conversation

- wspólne metadane Workspace, Profilu, trybu, modelu, utworzenia i eksportu;
- czas nie występuje przy poszczególnych wiadomościach;
- nie jest dodawane sztuczne zakończenie wątku.

### Manual RV

- wspólne metadane Workspace, Profilu, trybu, modelu, utworzenia i eksportu;
- brak czasu przy wiadomościach;
- brak pola `Zakończono`.

### Automatyczne i monitorowane RV Sessions

- metadane Workspace, Profilu, trybu, protokołu, Viewera, opcjonalnego Monitora, Judge, stanu i czasu;
- `Zakończono` tylko przy obecnym `completedAt`;
- zachowane: zapieczętowana część blind, Reveal i pliki Revealu, Viewer Review, Judge oraz późniejsze doprecyzowania.

### Training

- wspólne metadane w `summary.md` oraz w każdym `sessions/.../complete_session.md`;
- liczba ukończonych celów została nazwana `Postęp`, aby nie udawała znacznika czasu `Zakończono`;
- cały pakiet używa jednego czasu eksportu;
- zachowane: blind record, Reveal, załączniki, Viewer Review i wyniki Judge.

## Granice zmiany

- Bez zmian schematu storage.
- Bez usuwania technicznych timestampów z rekordów.
- Bez zmiany treści Blind, Revealu, Viewer Review lub Judge.
- Bez objęcia pakietów Research, które posiadają dodatkowe wymagania blindingu i powinny być migrowane osobno, jeżeli zostanie podjęta taka decyzja.
- Bez zmiany formatu danych technicznych JSON.

## Testy odbiorcze

- wspólna kolejność pól i pomijanie pól niepasujących;
- Manual RV bez `Zakończono`;
- completion wyświetlane tylko dla prawdziwego `completedAt`;
- Conversation i Manual RV bez czasu przy wiadomościach;
- RV Session zachowuje kompletną treść oraz nowe metadane;
- Training zachowuje sesje i pliki Revealu oraz używa wspólnego formatu;
- brak eksportu identyfikatorów credentiali.

## Weryfikacja lokalna

Po wdrożeniu wykonano:

- TypeScript typecheck — zaliczony;
- 90 plików testowych / 259 testów — zaliczone;
- produkcyjny build Vite — zaliczony.

Kod Rust/Tauri nie został zmieniony w tym kroku. Pozostaje zwykłe potwierdzenie pełnego pipeline'u w GitHub Actions po nałożeniu pakietu.
