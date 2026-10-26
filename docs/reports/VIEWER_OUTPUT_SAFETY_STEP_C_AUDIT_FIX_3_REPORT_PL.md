# VIEWER OUTPUT SAFETY — STEP C AUDIT FIX 3

## Zakres

Poprawka odpowiada wyłącznie na trzy pozostałe uwagi audytu STEP C AUDIT FIX 2. Nie zmienia budżetów, Resume, migracji ani schematu. Zaakceptowana baza pozostaje B3 + nakładki STEP C do czasu odbioru.

## Zmiany produkcyjne

1. Usunięto heurystykę kompletności opartą na progu 70% długości.
2. `BlindTranscriptRecord` rekonstruuje accepted blind transcript z `SessionEvent` według tych samych formatów tekstowych, których używają kontrolery:
   - Full RCP (fazy, Special Task, Monitor),
   - RV Lite (kroki i Special Task),
   - Custom Protocol,
   - Telepathic (kroki, mandatory deepening, T9 questions i Monitor deepening).
3. Do rekonstrukcji wchodzą wyłącznie zaakceptowane odpowiedzi. `accepted:false`, `length`, `max_tokens`, `error`, `content_filter` i odpowiedniki nie stają się częścią accepted transcriptu.
4. Stored transcript jest ukrywany tylko wtedy, gdy zrekonstruowany accepted transcript jest treściowo identyczny z przechowywanym transcript-em po normalizacji CRLF i brzegowego whitespace.
5. `PRE_REVEAL_SEALED` nie jest wymagany do poprawnego live view. Jeżeli bieżące eventy odtwarzają cały aktualny transcript, fallback nie jest dublowany.
6. Jeżeli eventy są tylko prefiksem, mają nieznany legacy shape albo nie odtwarzają dokładnie stored transcriptu, literalny fallback pozostaje widoczny. Nie ma heurystycznego dzielenia po nagłówkach ani modyfikacji źródłowych danych.

## Testy

Dodano/utrzymano przypadki:
- długa Faza 1 i brak krótkej Fazy 2: fallback pozostaje widoczny niezależnie od proporcji długości;
- pełny live RCP przed seal: brak podwójnego wyświetlenia;
- pierwsza próba `length`, druga zaakceptowana: partial osobno, accepted transcript bez fallback duplicate;
- odpowiedniki live/recovery dla RV Lite, Custom i Telepathic;
- Custom Protocol zachowuje własny nagłówek;
- niekompletne i odrzucone odpowiedzi nie liczą się jako accepted transcript;
- fenced structural drawing używa wyłącznie jednoznacznych separatorów/ramki i pozostaje `clear`;
- 80 identycznych zdań semantycznych w fence pozostaje `stop`.

## Guard

Kod produkcyjny repetition guardu nie został osłabiony w tej poprawce. Zmieniono wyłącznie wadliwy fixture rysunku: usunięto ciąg 700 identycznych znaków `X`, który sam spełniał kryterium runaway. Legalny rysunek jest reprezentowany przez ramkę `+----+` / `|    |`.

## Kontrole lokalne

TypeScript `transpileModule` dla trzech zmienionych plików: PASS, 0 błędów składni.

Pełnego Vitest/typecheck/build/verify:architecture nie deklaruje się jako PASS w tym środowisku; powinny zostać wykonane przez audytora i GitHub Actions na kompletnej bazie.

Schema pozostaje 031. Migracje bez zmian.
