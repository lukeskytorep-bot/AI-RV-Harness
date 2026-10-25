# Dokumentacja i porządkowanie AI RV Harness — 11 października 2026

## Dokładna baza

Zaakceptowana gałąź AI RV po Training History UX i poprawkach testów DOM, z załączonego pełnego ZIP-a. Nie użyto main.zip ani starej paczki WIKI_RELEASE_SYNC jako bazy kodu.

SHA-256 pełnej wejściowej bazy: `5349141e356058d5ccfd8244e35ab19f435a200f625851329aec47693f4d2183`.

Dodatkowo uwzględniono zaakceptowane tłumaczenie DOCUMENTATION_EN_SYNC oraz aktualny FINAL_RUNTIME_SMOKE_PL_ONLY. Kod porównano byte-for-byte z pełną wejściową bazą. Schema 031 i wersja package.json 0.7.13 pozostają bez zmian; nazwa v0.7.14 oznacza zakres gałęzi rozwojowej.

## Zmiany

- README i indeksy odróżniają bieżący kod gałęzi od opublikowanego wcześniej baseline i historycznych raportów.
- Aktualny kontrakt przepływów EN/PL opisuje blind Viewer 16K→32K, Training Reveal review, headroom C+16K→C+32K dla learning, domyślne pozostałe analizy i zamrożoną starszą politykę Research.
- Retry EN/PL opisuje istniejący executor, statusy 524/529, kolejność klasyfikacji, semanticOutputStarted, Retry-After/jitter i osobne recovery semantyczne/domenowe.
- Usunięto z living architecture wymagania przywrócenia SessionCostGuard. Usage/estymacje i uncertain dispatch pozostają oddzielne.
- Uzupełniono trwały ledger, exact step/fingerprint, dispatch-start, restart bez resetu recovery, same-session Resume Training/Research, user_finished i izolację Markdown.
- Indeksy i code map wskazują faktyczne pliki właścicieli. Ujednolicono opis aktualnej schema 031 bez przepisywania raportów historycznych.
- Checklisty runtime EN/PL zawierają wspólne scenariusze 1–41; dodano recovery/stream/Markdown i Training History layout, dostępność, trwałe zakończenie oraz Profil/pomoc.
- Usunięto z obu living continuation docs zmienny katalog modeli Anthropic jako podstawę reguł; bieżący kontrakt opiera się na rzeczywiście zwróconych blokach i istniejącym request/capabilities. Nie zmieniano adaptera ani walidatora.

## Weryfikacja wykonana w tej turze

PASS: byte-for-byte porównanie src, src-tauri, scripts, styles, workflowów i plików zależności z zaakceptowaną bazą — zero różnic. Wszystkie migracje pozostają identyczne.

PASS: verify:source wraz z self-testem; verify:ux-data (31 migracji); verify:architecture wraz z self-testem (265 produkcyjnych TS/TSX, zero allowlist); verify:v0.7.14-release-gate.

PASS: 113 lokalnych odnośników w README/indeksach/architecture i spójna numeracja 41 scenariuszy EN/PL. PASS: odnośniki do kodu w nowym kontrakcie/retry.

Pełnego Vitest/build/Rust oraz desktop/provider smoke nie powtarzano w dokumentacyjnej turze, ponieważ produkcja i zależności są niezmienione. Zielone CI poprzedniej poprawki potwierdził użytkownik; to nie jest nowy niezależny wynik CI tej paczki. Testów desktopowych nie przedstawiamy jako zaliczonych.

## Nakładanie

Nakładka DOCUMENTATION_CURRENT_SYNC_CHANGED_FILES zawiera wyłącznie zmienione dokumenty i własny manifest/sumy w docs/reports. Nałożyć na aktualną zaakceptowaną gałąź z EN Sync, zachowując ścieżki. Pełny ZIP jest alternatywną złożoną bazą, nie kolejną nakładką do dopisania. Nie zawiera node_modules, dist, kompilacyjnych cache ani Rust target.

CONSOLIDATED_SHA256SUMS.txt w pełnej bazie opisuje jej aktualne pliki; wcześniejsze manifesty etapów pozostają historycznym zapisem paczek z czasu ich tworzenia, nie manifestem nowej całej bazy.

## Porządkowanie katalogu projektu

Przejrzano metadane 653 pozycji zwróconych dla katalogu AI RV Harness (pliki i foldery, rekursywnie). To stan zaobserwowanej listy, nie dowód przeczytania każdego dokumentu ani pełnego porównania duplikatów.

Przeniesiono 120 plików; wszystkie operacje zwróciły sukces. Luźne paczki/audyty trafiły do Training History UX, Viewer Output Safety, UI Consistency, Source Snapshots i Documentation Updates. Niejednoznaczne screenshots/teksty trafiają do Diagnostics/Incoming 2026-10-11. Starsze pliki z 00_CURRENT zachowano w 90_ARCHIVE/Former Current z podziałem na Source/Patches/Release. Niczego nie usuwano, nie zmieniano zawartości paczek ani nie rozstrzygano identyczności wariantów po samej nazwie.

Uaktualnione indeksy kierują do nowej pełnej bazy i nakładki. Wiki v0.7.13, protokoły, cele, assets i historyczne raporty zachowują swój zakres. Wcześniejsza kolejka do usunięcia nie była przedmiotem usuwania ani przywracania w tej turze. Oryginalne ID i historia wersji przenoszonych plików pozostają zachowane.
