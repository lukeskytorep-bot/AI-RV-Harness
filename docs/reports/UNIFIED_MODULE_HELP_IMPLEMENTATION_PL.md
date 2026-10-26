# UNIFIED MODULE HELP — implementation report

Data: 2026-10-09

## Baza

Wdrożenie przygotowano na zrekonstruowanej aktualnej linii zaakceptowanej przez użytkownika:

- `AI-RV-Harness-ai-rv-2 (6).zip`
  - SHA-256: `d5db8309194238613560ca3a768b0224574aacb7cfc8cd82e7bc7bf76ee6189b`
- nałożone `AI_RV_Harness_v0.7.14_SHARED_PROFILE_SELECTOR_CHANGED_FILES.zip`
  - SHA-256: `8aa469fdd70e9fc6c9a74f0c7cde9086c0a9c9814648e9e244c60ea09a0a59ff`
- nałożone `AI_RV_Harness_v0.7.14_SHARED_PROFILE_SELECTOR_AUDIT_FIX.zip`
  - SHA-256: `fc17552e170a716b40e8668947de15b6f779347036daf764f8b08d5a30c547c7`

Nie nakładano wcześniejszego porzuconego `PROFILE_SWITCHER_ACTUAL_FIX`.

## Zakres wdrożenia

- Dodano wspólne komponenty `ModuleHelpButton` i `ModuleHelpPanel`.
- Conversation, RV Sessions, AI Training, AI–AI Telepathic Training, AI Center i Research używają wspólnego wzorca pomocy.
- Ikony modułów zastępują `CircleHelp`.
- AI Center, Conversation i RV Sessions używają wspólnej grupy nagłówka: ProfileSelector po lewej, pomoc po prawej.
- Pomoc Training została przeniesiona do nagłówka strony, licznik pakietu pozostaje wewnątrz rozwiniętej karty.
- Pomoc AI–AI Training została usunięta z wewnętrznego nagłówka panelu i przeniesiona do nagłówka Training.
- Pomoc AI Center została usunięta ze starego `details` w overview i jest dostępna pod głównym nagłówkiem we wszystkich widokach AI Center.
- Pomoc Research została przeniesiona spod buildera do nagłówka Research i pozostaje dostępna także podczas konfiguracji i przeglądania projektu.
- Zachowano teksty PL/EN, w tym Research „Instrukcja krok po kroku i słownik pojęć / Step-by-step guide and glossary”.
- Nie zmieniano migracji, providerów, protokołów, danych, Field Guide, Viewer Notes ani logiki sesji.

## Styl i dostępność

- Wspólne semantyczne tokeny `--module-help-*` wykorzystują zielonkawy akcent `var(--green)` we wszystkich motywach.
- Wspólny przycisk ma `type="button"`, `aria-expanded`, `aria-controls`, focus-visible i natywną obsługę klawiatury.
- Wspólny panel jest oznaczonym regionem.
- Na małej szerokości grupa nagłówka zawija się w kolejności Profil → pomoc, bez absolute positioning.

## Weryfikacja wykonana lokalnie

- `verify:ux-data`: PASS, 31 migracji.
- Transpilacja składni TypeScript/TSX wszystkich zmienionych plików przez TypeScript `transpileModule`: PASS.
- `verify:source`: nie jest miarodajny na tej rozpakowanej kopii z powodu odziedziczonych escaped Unicode filenames i brakujących dokumentów; dodatkowo lokalna próba `npm ci` utworzyła `node_modules`/tsbuildinfo, które verifier celowo odrzuca.
- `verify:architecture`, pełny `typecheck`, Vitest i build: niezaliczone lokalnie, ponieważ instalacja zależności w środowisku nie ukończyła się poprawnie. Powinny zostać wykonane przez GitHub Actions.
- Runtime/UI screenshot smoke: niewykonany w tym środowisku. Po zielonym CI należy sprawdzić działający build Windows zgodnie z instrukcją odbioru.

## Odbiór runtime

Sprawdzić co najmniej:

1. Conversation, RV Sessions i AI Center: identyczna grupa Profil + pomoc.
2. Training standard i AI–AI: jeden przycisk w PageHeader i brak drugiego przycisku wewnątrz panelu.
3. Research: pomoc dostępna z nagłówka w hubie, konfiguracji i projekcie.
4. Rozwijanie/zwijanie, PL/EN, wszystkie motywy, focus klawiatury.
5. Małe okno: zachowana kolejność Profil → pomoc i brak nakładania kontrolek.
