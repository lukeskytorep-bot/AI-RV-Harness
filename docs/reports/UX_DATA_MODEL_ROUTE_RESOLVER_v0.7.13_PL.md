# AI RV Harness v0.7.13 — UX-DATA-2: wspólny ModelRouteSelect i izolacja credential

**Data:** 9 września 2026  
**Etap:** post-Etap-5 UX/data campaign — krok 2  
**Status:** implementacja lokalna zakończona; wymaga niezależnego odbioru i GitHub Actions

## Cel

Zastąpić rozproszone składanie i filtrowanie tras modeli jednym kanonicznym resolverem oraz wspólnym selektorem UI, a jednocześnie zamknąć realny błąd izolacji credential: przy dwóch Profile korzystających z tego samego typu providera, lecz z różnych credentiali, część list AI Monitor/Judge mogła wcześniej korzystać z globalnego cache modeli i prezentować trasę należącą do innego Profile.

Zmiana dotyczy **nowych i bieżących wyborów** Viewer/Monitor/Judge. Nie przepisuje historycznych SessionSnapshot, Training execution snapshot, Research config ani zamrożonych Judge results.

## Potwierdzony problem bazowy

Przed UX-DATA-2 Viewer był w większości ścieżek ograniczany do provider connection związanego z Profile, ale kilka selektorów Monitor/Judge pracowało na pełnym `models[]`. Dotyczyło to m.in. first-run/profile defaults, RV Sessions, Training, single/batch Judge oraz Research.

Przy konfiguracji:

```text
Profile A -> credential A -> OpenRouter config A
Profile B -> credential B -> OpenRouter config B
```

oba provider configs mogły znajdować się w tym samym globalnym inventory. UI roli nie miało jednego obowiązkowego filtra `active Profile -> credential -> provider configs -> models`.

## Zakres wykonany

### Kanoniczny resolver

Dodano `src/modelRoutes.ts`, który jest właścicielem:

- budowy `providerConfigId::modelId`;
- parsowania route key;
- wyszukiwania modelu po route key;
- mapowania credential -> provider configs -> models;
- filtrowania modeli dla Profile;
- walidacji, czy route należy do credential;
- credential-scoped lookup modelu;
- wspólnego porządku favorite/recommended/name;
- Viewer default;
- Monitor/Judge default.

`src/profileModelDefaults.ts` pozostaje kompatybilnym publicznym miejscem dla wcześniejszych konsumentów i re-eksportuje helpery z nowego właściciela zamiast utrzymywać drugą implementację.

### Wspólny ModelRouteSelect

Dodano `src/components/ModelRouteSelect.tsx`.

Komponent:

- przyjmuje `profile` albo jawny `credentialId`;
- pokazuje tylko modele provider configs należących do właściwego credential;
- opcjonalnie zawęża wynik do konkretnego `providerConfigId`;
- używa jednego canonical route key;
- zachowuje favorite/recommended ordering;
- nie renderuje stale/foreign `value`, jeżeli nie należy do aktywnego scope;
- obsługuje role `viewer`, `monitor`, `judge`.

### Migracja konsumentów

Przepięto bieżące selektory/lookupy w:

- first-run Profile setup w `src/App.tsx`;
- Profile edit/default Monitor/Judge w `src/features/profiles/ProfileDialogs.tsx`;
- RV Sessions Monitor oraz single/batch Judge;
- Training Judge;
- single Judge Evaluation i Batch Evaluation;
- Research base Viewer oraz Research Judge;
- Research engine/preflight route-map helpers.

Po zmianie ręczne produkcyjne składanie `providerConfigId::modelId` w chronionych feature modules zostało usunięte. Konstrukcja pozostaje w `src/modelRoutes.ts`.

## Druga warstwa ochrony

Zmiana nie polega wyłącznie na ukryciu obcej opcji w `<select>`.

Logika wykonawcza Monitor/Judge również rozwiązuje bieżący route przez credential-scoped lookup. Oznacza to, że po zmianie Profile stara wartość pozostająca chwilowo w stanie komponentu nie może zostać użyta tylko dlatego, że model nadal istnieje w globalnym cache.

W Profile setup/edit przed zapisem default Monitor/Judge route jest dodatkowo walidowany przez `isRouteAllowedForCredential()`.

## Zachowanie historii i Resume

Historycznych tras **nie migrowano i nie przepisywano**.

Tam, gdzie workflow musi odtworzyć zapisany, zamrożony stan, nadal używany jest pełny historyczny lookup po stored route/model snapshot. Dotyczy w szczególności wcześniejszych Training execution snapshots oraz stored/frozen danych wymaganych do prezentacji lub Resume.

Zasada jest więc celowo asymetryczna:

```text
NEW/CURRENT SELECTION
active Profile -> own credential -> allowed routes only

HISTORICAL SNAPSHOT
stored route remains stored and is not rewritten by current Profile scope
```

## Testy dodane i rozszerzone

Względem zielonego UX-DATA-1 baseline 124/422 dodano dwa nowe pliki testowe oraz rozszerzono dwa istniejące zestawy. Łącznie kandydat ma **126 plików testowych** i oczekiwane **428 testów**.

Nowe przypadki obejmują:

- dwa Profile, ten sam provider type, dwa różne credentiale;
- `modelsForCredential()` i `modelsForProfile()` zwracają tylko własny model;
- foreign Monitor/Judge default jest odrzucany;
- credential-scoped lookup nie zwraca obcej trasy;
- `buildProfileAiConfiguration()` odrzuca route należący do innego credential;
- `ModelRouteSelect` nie renderuje modeli obcego Profile;
- stale foreign selected value jest zerowana prezentacyjnie;
- test architektury blokuje ponowne lokalne składanie route key w chronionych modułach;
- test architektury wymaga wspólnego `ModelRouteSelect` w migrowanych role/model UI.

## Walidacja lokalna

Zaliczone:

- `npm run verify:source`;
- syntaktyczna/transpile walidacja TypeScript całego zmienionego zakresu;
- runtime smoke kanonicznego resolvera: credential A widzi model A, foreign route jest odrzucona, own route jest akceptowana, foreign default daje pustą wartość;
- inspekcja produkcyjnego source potwierdzająca, że ręczne `providerConfigId::modelId` pozostało tylko w `src/modelRoutes.ts`;
- inventory: **126 plików testowych**, `App.tsx` 650 linii, dokładnie 84 factory Training target source files;
- brak zmian schematu SQLite i migracji.

Pełny Vitest/typecheck/Vite nie został uruchomiony w środowisku przygotowującym, ponieważ świeże `npm ci` nie zakończyło pobierania zależności, a częściowy katalog `node_modules` nie zawierał `vitest`. Końcowy pełny frontend oraz Rust/Tauri/Clippy muszą zostać potwierdzone przez niezależny odbiór i GitHub Actions dokładnej nakładki.

## Świadomie niewykonane

UX-DATA-2 nie zmienia:

- Thread/Conversation hierarchy;
- Archive/Restore/Permanent Delete;
- wspólnego systemu dialogów;
- Profile/Workspace layout;
- Training list layout;
- Viewer Notes lifecycle;
- SQLite schema/migrations;
- provider transport/retry;
- protokołów RV, Reveal, Judge scoringu ani Research Lock/Blinding.

## Kryterium odbioru

Po pełnym 126/428, typecheck, Vite, `verify:source`, Rust/Tauri i Clippy w GitHub Actions krok **UX-DATA-2** można oznaczyć jako zakończony.

Następny kandydat: **UX-DATA-3 — wspólny system dialogów Confirm / TextInput / Destructive / Information**.
