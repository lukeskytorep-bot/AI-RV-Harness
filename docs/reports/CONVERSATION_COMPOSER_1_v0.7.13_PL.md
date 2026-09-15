# CONVERSATION-COMPOSER-1 — automatycznie rosnący composer Conversation

**Projekt:** AI RV Harness v0.7.13  
**Data:** 15 września 2026  
**Status:** `CANDIDATE — INDEPENDENT AUDIT, FULL GITHUB ACTIONS AND WINDOWS RUNTIME SMOKE REQUIRED`

## 1. Baza

Krok został wykonany wyłącznie na dokładnym complete-source zaakceptowanego `PROFILES-WORKSPACE-MANAGEMENT-1-R1`, potwierdzonego przez użytkownika jako zielony w GitHub Actions.

- complete-source ZIP SHA-256: `fd634592f90493ac65fb46005b02fd52bba887c2d95c6810030aec81b1e702da`;
- liczba plików bazy: `746`;
- source-tree bazy: `17525366d08556ea72dba74e4d2277093b336a67f219959d28228ca16dbf8699`.

Surowy commit `a550f517286ed11d1267e332ac5d34f6943d8287` **nie** jest byte-identyczny z zaakceptowanym R1 i nie może być używany samodzielnie jako baza. Dostarczony complete-source nie zawiera `.git`, a po utworzeniu R1 nie zapisano w dostępnych materiałach SHA commita, który później otrzymał zielone Actions. Dlatego identyfikacja bazy opiera się na powyższym, potwierdzonym source-tree; instrukcja Git wymaga dodatkowego zapisania lokalnego `git rev-parse HEAD` przed nałożeniem kandydata.

## 2. Zakres zmiany

Zmiana dotyczy tylko głównego pola wiadomości w `src/features/conversations/ChatPanel.tsx` oraz prywatnego helpera i stylu Conversation. Nie rozszerzono jej na Research, Training, Viewer Notes, Post-Reveal ani inne edytory.

Nie zmieniono:

- providerów, transportu, retry, timeoutów ani streamingu;
- zapisu Conversation, Messages ani Workspace/Profile;
- promptów i renderera Markdown;
- Post-Reveal discussion;
- migracji, schematu SQLite ani browser storage;
- mechanizmu wysyłania wiadomości, załączników lub istniejącej semantyki klawiatury.

## 3. Implementacja

Dodano mały helper `composerSizing.ts`, który:

- liczy wysokość na podstawie `scrollHeight`;
- zachowuje minimum odpowiadające dwóm liniom;
- ogranicza wysokość do mniejszej z wartości: 18 widocznych linii albo 45% wysokości viewportu;
- po przekroczeniu limitu przełącza `overflow-y` na `auto`;
- przed pomiarem ustawia `height: auto`, dzięki czemu pole poprawnie kurczy się po usuwaniu tekstu.

`ChatPanel` otrzymał `ref` do głównego textarea oraz ponowny pomiar:

- po każdej zmianie kontrolowanej wartości `input`, w tym po wklejeniu, usunięciu oraz `setInput("")` po wysłaniu;
- po zmianie rozmiaru okna.

CSS Conversation zachowuje dwuliniowe minimum, limit 45vh / 18 linii, wewnętrzny scroll i `resize: vertical`. Composer jest `flex: 0 0 auto`, natomiast istniejąca lista wiadomości pozostaje elastycznym, scrollowanym obszarem. Nie dodano przycisku Rozwiń/Zwiń, ponieważ automatyczne powiększanie rozwiązuje problem bez nowej kontroli UI.

## 4. Zachowane zachowanie

Textarea nadal nie posiada własnego `onKeyDown` ani `onKeyPress`. Oznacza to, że ten krok nie zmienia istniejącego zachowania Enter/newline ani IME. Wysyłanie nadal korzysta z istniejącego przycisku i funkcji `send()`.

Pozostawiono bez zmian:

- `disabled` podczas wysyłania / pending retry;
- przycisk załączników i jego guardy;
- guardy przycisku Send;
- istniejące ścieżki zachowania tekstu przy błędzie: `setInput(content)` dla błędu przygotowania Viewer Notes oraz trwały `PendingChatTurn` dla błędu odpowiedzi providera;
- istniejące etykiety i placeholder pola.

## 5. Testy dodane w kandydacie

Dodano 12 testów w dwóch plikach:

- `composerSizing.test.ts` — czyste obliczenie wysokości: minimum, wzrost, limit, scroll, kurczenie, mały viewport;
- `conversationComposerBoundary.test.ts` — reset po wyczyszczeniu, zachowanie draft/pending turn, brak zmiany klawiatury/IME, disabled/attachments/send, resize okna, limit CSS i granica architektury.

Pokrywają one wymagania odbioru dotyczące krótkiej wiadomości, wieloliniowego wzrostu, limitu, scrolla, kurczenia, resetu po wysłaniu, zachowania treści przy błędzie, niezmienionego mechanizmu wysyłania/newline oraz granic architektury.

## 6. Walidacja wykonana w środowisku przygotowania

**PASS:**

- SHA-256 i source-tree bazy odtworzone dokładnie;
- `verify:source`;
- `verify:ux-data`;
- kontrola składni zmienionych TS/TSX przez `transpileModule` dostępnego TypeScript;
- ścisły typecheck samego `composerSizing.ts`;
- niezależny test wykonania czystej funkcji sizingowej;
- niezależny test zastosowania sizingu do mockowanego textarea (`height` / `overflowY`, wzrost, limit, kurczenie).

**NIE WYKONANO LOKALNIE z powodu ograniczenia środowiska, a nie błędu projektu:**

- pełnego `npm test`;
- pełnego `npm run typecheck`;
- `npm run build`;
- `npm run verify:architecture`.

Rozpakowany complete-source nie zawiera `node_modules`, lokalny cache npm jest pusty, a sandbox nie ma dostępu do npm registry. `npm ci --offline` kończy się `ENOTCACHED`; verifier architektury nie może uruchomić `@babel/parser` bez instalacji zależności. Z tego powodu kandydat nie otrzymuje lokalnej deklaracji pełnego PASS i musi przejść pełny GitHub Actions przed akceptacją.

## 7. Windows runtime smoke

Po nałożeniu kandydata należy sprawdzić na Windows co najmniej:

1. 1–2 linie pozostają małe;
2. długi wpis i paste rosną płynnie;
3. około 18 linii / 45% wysokości okna uruchamia wewnętrzny scroll;
4. kasowanie tekstu zmniejsza pole;
5. wysłanie i wyczyszczenie przywraca minimum;
6. zmiana rozmiaru okna przelicza limit;
7. ręczny pionowy resize nadal działa w granicach min/max;
8. Send i Paperclip pozostają widoczne i działają jak wcześniej;
9. lista wiadomości pozostaje własnym scrollowanym obszarem;
10. błąd przygotowania/sending nie usuwa zachowanej treści/pending turn;
11. Enter/newline i IME zachowują wcześniejsze zachowanie.

## 8. Status

`CANDIDATE — INDEPENDENT AUDIT, FULL GITHUB ACTIONS AND WINDOWS RUNTIME SMOKE REQUIRED`

Na tym kroku praca się zatrzymuje. Nie rozpoczęto kolejnego zadania.
