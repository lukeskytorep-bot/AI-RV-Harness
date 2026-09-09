# AI RV Harness v0.7.13 — UX-DATA-4: Profile + Workspace UX

**Data:** 9 września 2026  
**Etap:** post-Etap-5 UX/data campaign — krok 4  
**Status:** niezależny odbiór frontendowy zakończony po dwóch poprawkach testowych; GitHub Actions wymagane dla bramek natywnych

## Cel

Wykonać mały pakiet UX i reguł danych po zamknięciu wspólnego systemu dialogów:

1. każdy nowy Profile otrzymuje automatycznie pierwszy Workspace;
2. tylko ostatni aktywny Workspace Profile jest chroniony przed Archive;
3. Profile i Workspace są prezentowane w bardziej kompaktowym układzie kafelkowym;
4. długa lista Training Runs ma własny ograniczony obszar przewijania.

Zmiana nie obejmuje jeszcze usuwania Thread, Unified Archive/Delete, Viewer Notes source migration ani Permanent Delete.

## 1. Automatyczny pierwszy Workspace

Dodano `src/application/profileWorkspace.ts` jako jawny cross-domain application use case.

`createProfileWithInitialWorkspace()`:

- tworzy Profile przez istniejący `AppRepository.createProfile()`;
- tworzy dokładnie jeden `Workspace 1` przez istniejący `createWorkspace()`;
- zwraca oba rekordy;
- jeżeli drugi zapis zawiedzie, archiwizuje dopiero co utworzony Profile jako recovery i ponownie zgłasza pierwotny błąd;
- jeżeli również recovery zawiedzie, zgłasza błąd zawierający oba problemy.

Dzięki temu aktywny katalog nie pozostaje z Profile bez obowiązkowego Workspace. Nie dodano migracji ani automatycznego backfillu istniejących Profile.

Oba produktowe przepływy tworzenia Profile w `App.tsx` korzystają teraz z tego use case’u:

- zwykły Create Profile;
- first-run setup nowego Profile.

Po sukcesie nowy Workspace staje się aktywnym Workspace, lecz użytkownik nie jest przymusowo przenoszony do jego ekranu podczas zwykłego tworzenia Profile.

## 2. Ochrona ostatniego aktywnego Workspace

Reguła produktu brzmi:

> Każdy aktywny Profile musi zachować co najmniej jeden aktywny Workspace.

Ochrona istnieje poniżej UI:

- Browser adapter odrzuca `archiveWorkspace()` jeżeli wskazany Workspace jest jedynym aktywnym Workspace swojego Profile;
- SQLite najpierw potwierdza istnienie aktywnego Workspace, a następnie wykonuje pojedynczy warunkowy `UPDATE`, który może zarchiwizować rekord tylko wtedy, gdy w tej samej instrukcji baza widzi więcej niż jeden aktywny Workspace tego Profile;
- `rowsAffected === 0` oznacza blokadę ostatniego Workspace.

Warunkowy SQLite `UPDATE` eliminuje okno wyścigu typu `COUNT → UPDATE`.

`archiveProfile()` pozostaje osobną cross-domain operacją i może archiwizować cały Profile wraz z jego ostatnim Workspace, zgodnie z istniejącym lifecycle Profile.

## 3. UI Profile → Workspaces

`ProfilesScreen` zachowuje Profile jako nadrzędne karty, lecz należące do nich Workspace są teraz kompaktowymi kafelkami zawierającymi:

- nazwę Workspace;
- opis albo ostatni czas otwarcia;
- bezpośrednie przejście do Workspace.

Lista Workspace wewnątrz Profile ma ograniczoną wysokość i własne przewijanie, aby duża liczba Workspace nie rozciągała karty bez końca.

Główny `WorkspacesScreen` również prezentuje Workspace jako kafelki pogrupowane według Profile. Menu `⋮` zachowuje Rename i Archive. Archive ostatniego aktywnego Workspace jest widoczny, ale disabled z lokalizowanym wyjaśnieniem.

## 4. Bounded Training list

`.training-run-list` otrzymał:

- ograniczoną wysokość;
- `overflow: auto`;
- `overscroll-behavior: contain`;
- stabilny gutter scrollbara.

Aktywny Training Run pozostaje nad przewijaną historią. Zmiana nie modyfikuje Training persistence, Resume, checkpointów, Viewer Notes ani Judge.

## Zachowane granice

Nie zmieniono:

- Thread / `ChatThreadGroup` modelu;
- Conversation / Manual RV persistence;
- Archive and recovery dla nowych typów danych;
- Permanent Delete / purge;
- Viewer Notes;
- ModelRoute/credential isolation z UX-DATA-2;
- shared dialog system z UX-DATA-3;
- SQLite schema ani migracji `001–020`;
- browser storage keys ani serializowanych rekordów;
- provider transport/retry;
- RV protocols, blind boundary, Reveal, Judge scoring/freeze ani Research Lock/Blinding/Unblind.

## Testy

Względem zielonego UX-DATA-3 baseline 128/437 dodano 2 nowe pliki testowe i 9 nowych przypadków łącznie.

Kandydat ma:

- **130 plików testowych**;
- oczekiwane **446 testów**.

Nowe/rozszerzone pokrycie obejmuje:

- Profile → exactly one `Workspace 1`;
- kolejność Profile przed Workspace;
- recovery przez archive Profile, jeżeli create Workspace zawiedzie;
- raportowanie podwójnej awarii przy nieudanym recovery;
- Browser last-active Workspace guard;
- SQLite atomic conditional last-active guard;
- SQLite archive, gdy sibling pozostaje;
- istniejący persistence test Workspace z drugim aktywnym siblingiem;
- kafelkowe klasy Profile/Workspace;
- disabled Archive dla ostatniego Workspace;
- architecture boundary blokujący product-level bezpośrednie `createProfile()` poza application use case;
- bounded/scrollable Workspace i Training directories.

## Walidacja lokalna

Zaliczone:

- `npm run verify:source`;
- TypeScript transpile/syntax całego `src/`: 314 plików / 0 błędów składni;
- skupiony semantic TypeScript check zmienionych plików: 0 nieignorowanych diagnostyk;
- runtime smoke `createProfileWithInitialWorkspace()`: sukces i recovery po błędzie;
- runtime smoke Browser Workspace guard: jedyny Workspace zablokowany, jeden z dwóch dozwolony;
- realne in-memory SQLite wykonanie warunkowego archive query: 1 Workspace → 0 rows affected; 2 Workspace → 1 row affected i dokładnie 1 aktywny pozostaje;
- pierwotna paczka nie przechodziła pełnej bramki: jeden test persistence opierał się na błędnym założeniu o pozycji rekordu po sortowaniu, a nowy test boundary nie deklarował lokalnie typów Node;
- oba problemy poprawiono bez zmiany kodu produkcyjnego: asercja wybiera teraz Workspace po `id`, a test boundary ma lokalną dyrektywę `reference types="node"`;
- po poprawkach: **130/130 plików testowych i 446/446 testów**;
- pełny project TypeScript typecheck przeszedł;
- produkcyjny build Vite przeszedł; pozostało wyłącznie istniejące ostrzeżenie o rozmiarze dużego chunku;
- `npm run verify:source` przeszedł na czystym źródle;
- dokładnie 84 factory Training target source files;
- brak zamierzonej zmiany schema/migrations.

## Kryterium odbioru

Niezależny frontend został odebrany. GitHub Actions musi jeszcze potwierdzić:

- Rust/Tauri tests;
- Clippy `-D warnings`.

Po zielonym CI UX-DATA-4 można oznaczyć `COMPLETED`.

Następny krok planu: **UX-DATA-5 — usunięcie Thread / `ChatThreadGroup` jako poziomu produktu**, wykonywane jako osobny, migracyjny kandydat z fixture starej bazy i bez łączenia z Permanent Delete.
