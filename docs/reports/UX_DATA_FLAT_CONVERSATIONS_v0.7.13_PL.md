# AI RV Harness v0.7.13 — UX-DATA-5: płaskie Conversation / Manual RV bez Thread jako poziomu produktu

**Data:** 9 września 2026  
**Etap:** post-Etap-5 UX/data campaign — krok 5  
**Status:** poprawiony kandydat przeszedł niezależny odbiór frontendowy; GitHub Actions wymagane dla bramek natywnych

## Cel

Usunąć `Thread` reprezentowany przez `ChatThreadGroup` jako obowiązkowy poziom produktu, bez utraty historycznych Conversation / Manual RV i bez łączenia tej zmiany z Permanent Delete.

Docelowa hierarchia użytkowa:

```text
Profile
└── Workspace
    ├── Conversation
    ├── Manual RV
    ├── RV Sessions
    └── Research
```

zamiast:

```text
Profile → Workspace → Thread group → Conversation / Manual RV
```

## Bezpieczna strategia kompatybilności

Nie dodano migracji `021` i nie usunięto fizycznie tabeli `chat_thread_groups` ani kolumny `chat_threads.thread_group_id`.

Powód: aktualny schemat już pozwala na `thread_group_id = NULL`, a główne listowanie Conversation / Manual RV używa `workspace_id + mode`. Najbezpieczniejszym rozwiązaniem jest więc logiczne spłaszczenie produktu przy pozostawieniu starych referencji jako historycznej metadanej kompatybilności.

Zasada po UX-DATA-5:

- nowe Conversation / Manual RV są tworzone bez ThreadGroup;
- SQLite zapisuje `thread_group_id = NULL`;
- Browser nie tworzy ani nie odczytuje grup jako elementu produktu;
- stare rekordy z `threadGroupId` pozostają czytelne;
- archived historyczny child można przywrócić bez przywracania legacy grupy;
- legacy tabela i stare rekordy grup nie są modyfikowane;
- fizyczne usunięcie legacy schema może być rozważone dopiero jako późniejszy cleanup po pełnej kompatybilności.

## Zmiany kontraktu produktu

Z publicznego `AppRepository` oraz wewnętrznego `WorkspacesConversationsRepository` usunięto operacje grup:

- `listChatThreadGroups`;
- `createChatThreadGroup`;
- `renameChatThreadGroup`;
- `archiveChatThreadGroup`;
- `listArchivedChatThreadGroups`;
- `restoreChatThreadGroup`.

`createChatThread(workspaceId, mode, title?)` nie przyjmuje już `threadGroupId`.

Techniczna nazwa `ChatThread` pozostaje na razie dla właściwego Conversation / Manual RV. `ChatThreadGroup` i `ChatThread.threadGroupId` pozostają wyłącznie jako typy/metadane historycznej kompatybilności.

## UI

`ChatPanel` nie posiada już:

- tworzenia Thread group;
- przełączania grup;
- rename/archive grupy;
- obowiązkowego parent Thread przed Conversation.

Użytkownik tworzy bezpośrednio Conversation albo Manual RV w aktualnym Workspace.

`Settings → Archive and recovery` nie ma już osobnej sekcji Thread groups. Archived Conversation / Manual RV są widoczne bezpośrednio i ich Restore zależy od aktywnego Workspace, nie od historycznego ThreadGroup.

Aktywne PL/EN nazewnictwo produktu zostało uproszczone do `Conversations / Rozmowy`.

## Fixture starej hierarchii

Dodano `src/storage/fixtures/legacyThreadHierarchy.ts`, który reprezentuje historyczny układ:

- Workspace;
- aktywną i archived ThreadGroup;
- aktywny Conversation powiązany z grupą;
- archived Conversation powiązany z archived grupą;
- Messages.

Testy potwierdzają, że stare dane są widoczne i zachowane po logicznym spłaszczeniu, a nowe rekordy nie otrzymują już group parent.

## Realna walidacja SQLite

Na świeżej bazie zastosowano wszystkie migracje `001–020`, następnie utworzono historyczne grupy, grouped Conversations i Message. Potwierdzono:

- wszystkie 20 migracji przechodzi;
- stary aktywny grouped Conversation jest nadal widoczny;
- archived legacy Conversation można przywrócić bez przywracania jego archived grupy;
- archived stan legacy grupy pozostaje niezmieniony;
- nowy Conversation może zostać zapisany z `thread_group_id = NULL`;
- tabela `chat_thread_groups` pozostaje nienaruszona;
- Messages pozostają zachowane.

## Proweniencja bazy UX-DATA-4

Fizyczne SHA-256 dostarczonych, poprawionych artefaktów UX-DATA-4 zgadzają się z niezależnym manifestem:

- changed-files: `d558978c50b2296ee2e56e361afd8508cee39edcdebb8dd44eb8147eb7f8d922`;
- complete source: `56e2bc3e970d11720f5aa33dffbc8d427724f6d2ec39a63d16d8a8710f4a7a7a`.

Jednocześnie dostarczony complete ZIP zawiera trzy nazwy zasobów DOCX zapisane jako literalne markery `#U...`, przez co czyste `verify:source` na tym konkretnym przepakowaniu nie przechodzi. GitHub Actions przeszedł na poprawionej nakładce zastosowanej do zdrowego drzewa.

Dlatego kanoniczna baza robocza UX-DATA-5 została odtworzona jako:

1. dokładny zielony UX-DATA-3 complete source;
2. dokładna, audytowana i zielona nakładka UX-DATA-4 o SHA `d558978c...`.

Wszystkie 17 plików kodowych z UX-DATA-4 jest bajtowo zgodnych z dostarczonym complete ZIP-em, a poprawne nazwy Unicode zasobów zostają zachowane.

## Testy kandydata

Bazowy UX-DATA-4 ma **130 plików / 446 testów** po niezależnym odbiorze i zielonym GitHub Actions.

Pierwotne rozliczenie 450 testów było zaniżone: niezmieniony kandydat zawierał 451 testów. Niezależny odbiór dodał dwa przypadki regresyjne dla brakującego Workspace, dlatego poprawiony wynik to:

- **131 plików testowych**;
- **453 testy**.

Niezależnie wykonano pełny Vitest, project typecheck i produkcyjny build Vite. Wszystkie przeszły; Vite zgłosił jedynie istniejące ostrzeżenie o rozmiarze dużego chunku.

Lokalnie zaliczono:

- `npm run verify:source` na zdrowym drzewie;
- TypeScript transpile/syntax całego `src/`: 316 plików / 0 błędów;
- runtime smoke Browser/SQLite dla legacy i nowych Conversation;
- realne SQLite migrations `001–020` + fixture legacy;
- brak produkcyjnych wywołań sześciu ThreadGroup lifecycle APIs;
- brak `chat_thread_groups` access w aktywnych Browser/SQLite adapterach Conversation;
- brak aktywnego ThreadGroup UI w ChatPanel/Archive/i18n;
- Restore nie aktywuje osieroconej Conversation, gdy jej nadrzędny Workspace nie istnieje — w Browser ani SQLite;
- dokładnie 84 factory Training Targets.

## Świadomie niewykonane

Ten krok nie zmienia:

- fizycznego legacy schema;
- migracji `001–020`;
- Permanent Delete / purge;
- Soft Archive dla RV Sessions, Training, Research i My Targets;
- Viewer Notes source preservation;
- provider transport/retry;
- protokołów RV, blind boundary, Reveal;
- Judge scoring/freeze;
- Research Lock/Blinding/Unblind.

## Kryterium odbioru

Po zielonym GitHub Actions można oznaczyć **UX-DATA-5 — flat Conversations / removal of Thread product layer** jako `COMPLETED`.

Następny krok: **UX-DATA-6 — Soft Archive / Restore dla brakujących typów danych**.
