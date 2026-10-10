# Training History UX — STEP 2 AUDIT FIX

Data: 2026-10-10.
Baza: zaakceptowany STEP 1 AUDIT FIX 2 + STEP 2 HISTORY UI. Ta paczka jest małą nakładką naprawczą do STEP 2.

## Zakres poprawki

1. Archiwizacja korzysta z tego samego synchronicznego `trainingOperationGuard` i reaktywnego `trainingOperationPending` co Start/Resume/End. Guard jest rezerwowany przed pierwszym `await` (przed dialogiem), utrzymywany przez dialog i zapis oraz zwalniany w `finally`, także po anulowaniu lub błędzie.
2. Po potwierdzeniu archiwizacji następuje świeży odczyt TrainingRun. Jeśli run rozpoczął wykonywanie podczas otwartego dialogu, archiwizacja nie jest wykonywana.
3. Ikona Archive jest wyłączona podczas `trainingOperationPending`; zachowano dotychczasową blokadę aktywnego runu przy `busy`.
4. Przejście Standard Training -> AI–AI jest wyłączone podczas `trainingOperationPending` i dodatkowo sprawdza wspólny guard.
5. Trzy ikony historii oraz przełącznik całej historii używają jednego `TooltipButton`. Tooltip otwiera się na hover i focus, ma `role=tooltip`, jest renderowany portalem do `document.body` i ma pozycjonowanie `fixed`, więc nie podlega `overflow` panelu/listy.
6. Zachowano dynamiczne etykiety PL/EN, `aria-label`, `aria-expanded`, `aria-controls`, `type=button` i focus przycisku.
7. Kontener listy sesji z docelowym `id` pozostaje zamontowany także przy zwinięciu (`hidden`), więc `aria-controls` nie wskazuje na nieistniejący element.

## Testy dodane/zmienione

- test wspólnego synchronicznego guarda potwierdza, że druga operacja Start/Resume/End/Archive nie może wejść przed zwolnieniem pierwszej;
- test potwierdza trwałość celu `aria-controls` przy zwiniętej liście sesji;
- test kontraktowy sprawdza użycie wspólnego guarda przez Archive, świeży odczyt runu, blokadę przejścia AI–AI oraz portal tooltipu z hover/focus.

Środowisko lokalne nie ma `node_modules`, `jsdom`, Testing Library ani react-test-renderer. Dlatego nie deklaruję pełnego Vitest/typecheck/build ani prawdziwych testów kliknięć DOM jako PASS. Audytor poprzedniej paczki uruchomił pełne bramki (1255 PASS + build/typecheck/architecture/source/ux-data); tę nakładkę należy ponownie sprawdzić w jego kompletnym środowisku.

## Odbiór wizualny

Windows/Tauri UI, panel 330 px, breakpoint, zoom 125%/150%, długa nazwa, ciąg bez spacji oraz realne prostokąty ikon/przycisków NIE zostały lokalnie zweryfikowane. Nie deklaruję braku kolizji na podstawie samego CSS.

Schema pozostaje 031. Migracje i trwały kontrakt termination ze STEP 1 nie zostały zmienione.
