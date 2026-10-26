# AI RV Harness v0.7.14 — wspólny wybór Profilu

Data wdrożenia: 2026-10-08.

## Baza

Wdrożenie wykonano na pełnym źródle wskazanym przez Edwarda:

- archiwum: `AI-RV-Harness-ai-rv-2 (6).zip`;
- SHA-256 archiwum bazowego: `d5db8309194238613560ca3a768b0224574aacb7cfc8cd82e7bc7bf76ee6189b`;
- schema danych pozostaje bez zmian: `031`.

Nie nakładano wcześniejszego patcha `PROFILE_SWITCHER_ACTUAL_FIX`. Nowe wdrożenie zastępuje jego plan docelowym wspólnym selektorem Profilu.

## Zakres wdrożenia

1. Dodano wspólny `src/components/ProfileSelector.tsx` z natywnym `select`, etykietą PL/EN oraz nazwami z `aiIsBeDisplayName()`.
2. AI Center korzysta teraz z tego wspólnego komponentu zamiast własnej implementacji selecta.
3. Conversation i RV Sessions używają tego samego `ProfileSelector` w nagłówku. Wartość pochodzi z `workspace.profileId`.
4. Z Conversation i RV Sessions usunięto lokalny stan, przycisk i integrację `WorkspaceSwitcherDialog`. Sam legacy komponent pozostawiono w źródle jako nieużywany, aby patch nakładany jako overlay nie wymagał fizycznego kasowania plików; żaden z tych ekranów go już nie importuje ani nie renderuje.
5. W `App.tsx` dodano jeden `handleProfileChange`, używany przez AI Center, Conversation i RV Sessions.
6. Zmiana Profilu synchronizuje oba konteksty przez istniejące `rememberActiveWorkspace()` i `latestCompatibleWorkspace()`. Nie zmienia bieżącej strony ani zakładki Manual/Automatic.
7. Ponowne wybranie już aktywnego Profilu zachowuje aktualne identyfikatory Workspace, dzięki czemu ręcznie otwarty konkretny Workspace nie jest zastępowany.
8. Przełączanie Profilu w Conversation/RV Sessions pozostaje zablokowane podczas aktywnej operacji. Globalny guard w `App.tsx` pozostaje dodatkową ochroną.

## Testy dodane / zaktualizowane

- `src/application/profileSelection.test.ts` sprawdza wybór najnowszych kompatybilnych Workspace’ów, `legacy_combined`, ignorowanie archiwalnych/obcych Workspace’ów, zachowanie ręcznie wybranego Workspace’u przy ponownym wyborze tego samego Profilu oraz odrzucenie nieznanego Profilu.
- `src/sharedProfileSelectorBoundary.test.ts` pilnuje wspólnego komponentu na trzech ekranach, braku Workspace switchera w Conversation/RV Sessions, jednego callbacku w `App.tsx` oraz blokady podczas operacji.
- Zaktualizowano istniejące boundary tests do nowego kontraktu UI.

## Weryfikacja lokalna

- `verify:ux-data`: PASS, 31 migracji.
- ręczny test wykonania `resolveProfileWorkspaceSelection`: PASS.
- parsowanie/transpilacja składni zmienionych plików TypeScript/TSX przez TypeScript: PASS.
- `verify:source`: lokalnie zatrzymuje się na odziedziczonych z archiwum nazwach `#U...` i brakujących dokumentach Unicode; nie jest to efekt tego patcha.
- `verify:architecture`, pełny `typecheck`, Vitest i build nie zostały wiarygodnie uruchomione lokalnie, ponieważ rozpakowane archiwum nie zawiera zależności, a lokalna instalacja `npm ci` nie została ukończona. Te bramki muszą potwierdzić GitHub Actions.

## Odbiór runtime

Po zielonym CI należy potwierdzić w działającej aplikacji:

- ten sam `Aktywny Profil / Active Profile` select w AI Center, Conversation i RV Sessions;
- A → B w Conversation zmienia historię i Conversation Workspace na B;
- A → B w RV Sessions zmienia RV Workspace na B bez zmiany Manual/Automatic;
- A → B w AI Center pozostawia AI Center i używa kontekstu RV Profilu B;
- po wyborze B przechodzenie między tymi trzema ekranami nie przywraca A;
- ponowny wybór aktywnego Profilu nie podmienia ręcznie otwartego Workspace’u.
