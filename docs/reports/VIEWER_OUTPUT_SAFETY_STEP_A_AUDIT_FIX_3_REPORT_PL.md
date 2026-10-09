# Viewer Output Safety — Etap A — poprawka po trzecim audycie

Poprawiono regresję Manual RV dla modeli z maksymalnym wyjściem niższym niż 16K.

## Zachowanie

- standardowy pierwszy budżet Viewera pozostaje 16 384;
- jeżeli model ma znany niższy limit, np. 8 192, pierwsza próba jest ograniczana do 8 192 zamiast blokowana przed dispatch;
- po `length` helper próbuje wyznaczyć recovery 32 768, ale ponownie ogranicza je do znanego limitu modelu;
- jeśli recovery nie daje większego realnego budżetu niż pierwsza próba, nie wysyła się drugiego identycznego płatnego żądania;
- krok kończy się jawnym `no_larger_recovery_budget`.

Wspólna funkcja `viewerOutputPreferredBudget()` jest używana zarówno przez właściwy helper recovery, jak i przez preflight Manual RV, dzięki czemu obie ścieżki stosują tę samą politykę.

Dodano test regresyjny modelu z `maxOutputTokens: 8192`: provider jest wywołany dokładnie raz z 8192, a po `length` nie następuje drugi dispatch z tym samym limitem.

Schema pozostaje 031. Brak migracji.
