# AI RV Harness v0.7.13 — UX-DATA-3: wspólny system dialogów aplikacji

**Data:** 9 września 2026  
**Etap:** post-Etap-5 UX/data campaign — krok 3  
**Status:** implementacja lokalna zakończona; niezależny odbiór i GitHub Actions wymagane

## Cel

Zastąpić rozproszone `window.confirm`, `window.prompt` i `window.alert` jednym współdzielonym mechanizmem, który będzie można później wykorzystać także dla Archive/Restore, Deletion Preview i Permanent Delete bez tworzenia kolejnych niezależnych modali.

Bazą jest dokładny zielony UX-DATA-2 po niezależnej korekcie kolizji identycznej trasy Judge pomiędzy credentialami.

## Zakres wykonany

Dodano `src/components/AppDialogProvider.tsx` i zamontowano jeden `AppDialogProvider` wokół `App` w `src/main.tsx`.

Publiczny hook `useAppDialogs()` udostępnia trzy operacje:

- `confirm(...)`;
- `prompt(...)`;
- `information(...)`.

Wspólna powierzchnia wspiera:

- `normal`, `warning` i `destructive` severity;
- tytuł, opis i dodatkowe szczegóły;
- text input z wartością początkową;
- wymagany input;
- dokładną frazę potwierdzającą, przygotowaną pod przyszły Permanent Delete;
- async action;
- busy state;
- prezentację błędu bez zamykania dialogu;
- kolejkę kilku dialogów;
- ochronę przed przypadkowym podwójnym wykonaniem async action;
- modalne Confirm/Cancel oraz information-only OK;
- lokalizowane etykiety przekazywane z istniejącego i18n.

## Migracja istniejących dialogów

Przed zmianą produkcyjny frontend zawierał 20 bezpośrednich wywołań browser-native dialogów. Po migracji poza centralnym providerem pozostało 0.

Przepięto:

- Profiles: archive i ostrzeżenie przy zmianie credential binding;
- Workspaces: rename, archive i prezentację błędów;
- Conversations / Manual RV: tworzenie Conversation, archive Conversation, remove source i archive Thread group;
- Targets: delete My Target;
- Settings: reset capability cache, detailed diagnostics warning, restore backup confirm/error oraz rename przy konflikcie restore Workspace;
- AI Center: zwiększenie Viewer Notes capacity i human restore historycznej wersji;
- Provider Settings: usunięcie providera;
- Research: recovery interrupted assignments.

Browser-native `confirm/prompt/alert` istnieją wyłącznie jako centralny fallback w `AppDialogProvider`, potrzebny dla izolowanego renderowania komponentu poza głównym App root. Normalny runtime zawsze montuje wspólny host przez `main.tsx`.

## Istotne utwardzenia

### Kolejka bez race condition

Podczas lokalnego audytu nowego kodu wykryto potencjalny wyścig: drugi dialog otwierany bezpośrednio po `await` pierwszego mógł zostać nadpisany przez opóźnione przejście kolejki. Mechanizm poprawiono tak, aby następny wpis kolejki był aktywowany przed rozwiązaniem Promise bieżącego dialogu.

### Brak podwójnego async action

Samo `disabled` w React nie jest jedyną ochroną. Provider posiada również synchroniczny `busyRef`, ustawiany przed rozpoczęciem action. Dzięki temu dwa niemal równoczesne submit eventy nie mogą uruchomić tej samej operacji dwa razy.

## Świadomie niewykonane

UX-DATA-3 nie zmienia:

- Thread / `ChatThreadGroup` modelu;
- Archive/Restore lifecycle;
- Permanent Delete;
- Profile/Workspace layout;
- Training list layout;
- Viewer Notes persistence;
- ModelRoute resolvera z UX-DATA-2;
- SQLite schema ani migracji `001–020`;
- browser storage keys;
- provider transport/retry;
- protokołów RV, Reveal, Judge scoringu ani Research Lock/Blinding/Unblind.

## Testy

Dodano 2 pliki testowe / 9 przypadków:

- `src/components/AppDialogProvider.test.tsx` — 6 przypadków powierzchni dialogu;
- `src/appDialogBoundary.test.ts` — 3 reguły architektoniczne.

Pokrycie obejmuje:

- Confirm + Cancel;
- prompt i initial value;
- wymagany input;
- exact destructive confirmation phrase;
- busy state i busy label;
- error widoczny w dialogu;
- information-only dialog;
- zakaz `window/globalThis.confirm|prompt|alert` poza centralnym providerem;
- wymaganie pojedynczego `AppDialogProvider` wokół `App`;
- wymaganie `useAppDialogs` we wszystkich migrowanych konsumentach.

Zielony UX-DATA-2 baseline posiadał 126 plików / 428 testów. Kandydat UX-DATA-3 ma **128 plików testowych** i oczekiwane **437 testów**.

## Walidacja lokalna

Zaliczone:

- dokładny SHA i source-tree identity bazy UX-DATA-2 potwierdzone przed zmianą;
- `npm run verify:source`;
- syntaktyczna/transpile walidacja całego `src/`: 311 plików, 0 błędów składni;
- skupiony TypeScript check nowego provider/testów z lokalnymi stubami brakujących zależności;
- inspekcja architektoniczna: 20 native dialog calls w baseline, 0 poza providerem w kandydacie;
- dokładnie 84 factory Training target source files;
- brak zmian schema/migrations.

Pełny `npm ci` w środowisku przygotowującym nie zakończył pobierania zależności (`TransportTimeoutError`), dlatego pełny Vitest, projektowy TypeScript, Vite oraz Rust/Tauri/Clippy muszą zostać wykonane przez niezależny odbiór i GitHub Actions dokładnej paczki.

## Kryterium odbioru

Po pełnym **128/437**, TypeScript, Vite, `verify:source`, Rust/Tauri i Clippy krok **UX-DATA-3** można oznaczyć jako `COMPLETED`.

Następny krok planu: **UX-DATA-4 — Profile + Workspace UX**: automatyczny pierwszy Workspace, ochrona tylko ostatniego aktywnego Workspace, kafelkowy układ Profile → Workspaces oraz ograniczenie wysokości listy Training zgodnie z zapisanym planem.
