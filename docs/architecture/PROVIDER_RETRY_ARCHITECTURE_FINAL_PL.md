# Architektura retry dostawców — aktualna implementacja

**Przegląd:** 11 października 2026. **Zakres:** zaakceptowana linia AI RV po Training History UX; schema 031. Wrześniowe raporty zamknięcia zachowują znaczenie historyczne. Ten dokument opisuje obecny kod, nie plan nowej implementacji. Pełne odnośniki do regresji: [EN](PROVIDER_RETRY_ARCHITECTURE_FINAL_EN.md).

## Właściciel mechanizmu

Rust wykonuje jedną fizyczną próbę HTTP. Transport retry należy wyłącznie do `src/providers/requestExecutor.ts`: executeProviderRequest / executeProviderChat. Executor chroni przed zagnieżdżaniem, zachowuje niezmienny payload i raportuje logicalRequestId, liczbę fizycznych prób, czas i niepewność naliczeń. Błędy normalizuje providerError.ts. Zmieniony prompt lub budżet wyjścia to osobna próba semantyczna; naprawa JSON/pojemności dokumentu należy do domeny. Nie zmienia się automatycznie modelu.

## Polityka retry.ts

configuredRetries oznacza dodatkowe próby po pierwszej, ograniczone do 0–5; domyślnie 2. Zero wyłącza retry transportu, nie wszystkie niezależne mechanizmy output recovery.

| Błąd | Retry transportu |
| --- | --- |
| Dowolny typowany błąd z semanticOutputStarted | brak automatycznego ponowienia |
| HTTP 408, 425, 429, 500, 502, 503, 504, 524, 529 | według configuredRetries |
| Typowane connect, timeout, request_send | według configuredRetries |
| rate_limit_exceeded, provider_overloaded, provider_unavailable, timeout, server | według configuredRetries, po wcześniejszej kontroli semantic-start |
| response_body_read/decode, invalid_provider_json, empty_assistant_response | najwyżej jedno ponowienie, gdy retry jest włączone; obowiązują wcześniejsze kontrole |
| cancelled, configuration, response_body_too_large, AbortError | brak |
| Pozostałe trwałe lub nierozpoznane błędy, uwierzytelnienie/safety/kontekst/route bez rozpoznanej klasy przejściowej | brak |
| length lub niekompletny wynik semantyczny | osobne output recovery |

Kolejność klasyfikacji ma znaczenie: najpierw semantic-start i typowane blokady, następnie providerErrorType, single-recovery i HTTP. Nie należy kopiować tabeli jako nowego klasyfikatora zmieniającego tę kolejność. Parser starszych stringów jest fallbackiem. Zakończony ProviderExecutionError nie jest ponawiany przez zewnętrzny kontroler.

Retry-After jest ograniczone do 30 sekund. Bez niego jitter losuje od zera do `min(8000, 500 * 2**failedAttempt)` ms. Anulowanie przerywa request i oczekiwanie. Timeout i prezentacja są osobnymi politykami effectiveRequestEnvelope/streamingPolicy.

## Streaming, dispatch i zapis

Błąd odczytu body może wystąpić po generacji i naliczeniu kosztu. Po rozpoczęciu treści semantycznej automatyczne ponowienie transportu jest zablokowane. Częściowy streaming nie jest kompletnym dowodem. Kontroler rozstrzyga recovery na podstawie trwałych prób/checkpointu, nie ostatniej widocznej linijki.

Ledger Viewera zachowuje stepId, fingerprint, attemptId i dispatch start po restarcie. Niepewnego wyniku nie zmienia się na potwierdzony błąd tylko po to, żeby odblokować płatne ponowienie. Post-Reveal ma własną jawną decyzję i lease fencing. Resume odtwarza zaakceptowane odpowiedzi lokalnie; live zaczyna się od pierwszej brakującej. Retry nie duplikuje promptów ani zakończonej pracy Monitora i nie resetuje recovery semantycznego.

## Budżety i koszt

Blind Viewer preferuje 16 384 → 32 768. Training Reveal review stosuje tę samą preferencję, a Field Guide/Viewer Notes: C + 16 384 → C + 32 768. Pozostałe domyślne analizy pozostają 8192 → 16 384. Research zachowuje zamrożoną politykę, w tym starszą konfigurację. Efektywne limity zależą od modelu/endpointu i kontekstu. To nie jest uniwersalny limit dwóch wywołań HTTP, ponieważ transport i jawne naprawy domenowe mają własne zakresy.

Nie ma dawnej blokady wydatku SessionCostGuard/CostAuthorization. Nie wolno przywracać jej z historycznego planu. Usage, estymacje i ostrzeżenia o niepewnym naliczeniu pozostają diagnostyką, a ochrona uncertain dispatch nadal obowiązuje.

Aktualne szczegóły: [przepływy PL](CURRENT_WORKFLOWS_v0.7.14_PL.md). Rzeczywiste testy desktop/provider: [checklista PL](FINAL_RUNTIME_SMOKE_v0.7.14_PL.md). Zielone testy automatyczne nie są dowodem wykonania smoke.
